import { randomBytes } from "node:crypto"
import path from "node:path"

type Operation = { cancelled: boolean; root?: string; kind: "compile" | "chat" | "lint" | "lsp" }
type BrowseBinding = { root: string; controller: AbortController }

// Owns window-scoped resources. A watch ticket cannot survive close or replacement.
export class ProjectSessionManager {
  private tokens = new Map<string, string>()
  private roots = new Map<string, string>()
  private projects = new Map<string, string>()
  private active = new Map<number, string>()
  private watches = new Map<number, () => void>()
  private tickets = new Map<number, object>()
  private requests = new Map<number, Set<Operation>>()
  private bindings = new Map<number, object>()
  private paths: Pick<typeof path, "relative" | "resolve" | "isAbsolute" | "sep">
  private browsing = new Map<number, BrowseBinding>()
  private disposeLanguage: (owner: number, root?: string) => void
  constructor(
    disposeLanguage: (owner: number, root?: string) => void,
    paths: Pick<typeof path, "relative" | "resolve" | "isAbsolute" | "sep"> = path,
  ) {
    this.paths = paths
    this.disposeLanguage = disposeLanguage
  }
  bindRoot(root: string) {
    if (this.tokens.has(root)) return
    const token = randomBytes(16).toString("hex")
    this.tokens.set(root, token)
    this.roots.set(token, root)
  }
  token(root: string) {
    return this.tokens.get(root)
  }
  rootForToken(token: string) {
    return this.roots.get(token)
  }
  projectRoot(id: string) {
    return this.projects.get(id)
  }
  projectId(root: string) {
    return [...this.projects].find(([, value]) => value === root)?.[0]
  }
  activeRoot(owner: number) {
    return this.active.get(owner)
  }
  beginBinding(owner: number) {
    const ticket = {}
    this.bindings.set(owner, ticket)
    return ticket
  }
  isCurrentBinding(owner: number, ticket: object) {
    return this.bindings.get(owner) === ticket
  }
  bindProject(owner: number, id: string, root: string) {
    this.bindRoot(root)
    this.projects.set(id, root)
    if (this.active.get(owner) !== root) {
      this.stopWatch(owner)
      this.cancelBrowse(owner)
      this.disposeLanguage(owner)
    }
    this.active.set(owner, root)
  }
  browse(owner: number) {
    return this.browsing.get(owner)
  }
  bindBrowse(owner: number, root: string) {
    if (this.browsing.get(owner)?.root === root) return
    this.cancelBrowse(owner)
    this.browsing.set(owner, { root, controller: new AbortController() })
  }
  cancelBrowse(owner: number) {
    this.browsing.get(owner)?.controller.abort()
    this.browsing.delete(owner)
  }
  stopWatch(owner: number) {
    this.tickets.delete(owner)
    this.watches.get(owner)?.()
    this.watches.delete(owner)
  }
  beginWatch(owner: number) {
    this.stopWatch(owner)
    const ticket = {}
    this.tickets.set(owner, ticket)
    return ticket
  }
  isCurrentWatch(owner: number, ticket: object) {
    return this.tickets.get(owner) === ticket
  }
  attachWatch(owner: number, ticket: object, dispose: () => void) {
    if (!this.isCurrentWatch(owner, ticket)) {
      dispose()
      return
    }
    this.watches.set(owner, dispose)
  }
  trackCompile(owner: number, root?: string) {
    return this.trackOperation(owner, root, "compile")
  }
  trackOperation(owner: number, root: string | undefined, kind: Operation["kind"]) {
    const request: Operation = { cancelled: false, root, kind }
    const requests = this.requests.get(owner) ?? new Set<Operation>()
    requests.add(request)
    this.requests.set(owner, requests)
    return {
      request,
      finish: () => {
        requests.delete(request)
        if (!requests.size) this.requests.delete(owner)
      },
    }
  }
  cancelCompile(owner: number) {
    for (const request of this.requests.get(owner) ?? [])
      if (request.kind === "compile") request.cancelled = true
  }
  close(owner: number) {
    this.bindings.delete(owner)
    this.disposeLanguage(owner)
    this.cancelBrowse(owner)
    this.active.delete(owner)
    this.stopWatch(owner)
    for (const request of this.requests.get(owner) ?? []) request.cancelled = true
  }
  restrict(root: string) {
    const affected = [...new Set(this.projects.values())].filter((candidate) => {
      const relative = this.paths.relative(root, candidate)
      return (
        !relative ||
        (!relative.startsWith(".." + this.paths.sep) &&
          relative !== ".." &&
          !this.paths.isAbsolute(relative))
      )
    })
    for (const requests of this.requests.values())
      for (const request of requests)
        if (
          request.root &&
          affected.some(
            (candidate) => this.paths.relative(candidate, this.paths.resolve(request.root!)) === "",
          )
        )
          request.cancelled = true
    for (const owner of this.active.keys()) {
      for (const candidate of affected) this.disposeLanguage(owner, candidate)
      const binding = this.browsing.get(owner)
      if (binding && affected.includes(binding.root)) this.cancelBrowse(owner)
    }
    return affected
  }
  stopRootWatches(root: string) {
    for (const [owner, active] of this.active) if (active === root) this.stopWatch(owner)
  }
  forget(root: string) {
    for (const [owner, active] of this.active) if (active === root) this.close(owner)
    for (const [id, directory] of this.projects) if (directory === root) this.projects.delete(id)
    const token = this.tokens.get(root)
    if (token) this.roots.delete(token)
    this.tokens.delete(root)
  }
}
