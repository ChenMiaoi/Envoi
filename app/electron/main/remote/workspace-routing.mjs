import { dataStore } from "../../../server/local-data.mjs"
import { safePathParts } from "../../../shared/file-rules.mjs"
export const isRemoteRoot = (root) => typeof root === "string" && /^(ssh|wsl):\/\//.test(root)

export async function remotePreferences() {
  const result = await dataStore({ store: "preferences", key: "default", action: "get" })
  return { value: result.body?.value ?? {}, revision: result.body?.revision ?? 0 }
}

// Routes all workspace capabilities through the same owner-bound Linux environment.
// Unknown remote operations fail here; a remote identifier never reaches local fs/process APIs.
export async function routeRemoteWorkspace(remote, sessions, owner, channel, args) {
  const method = channel.replace(/^envoi:/, "")
  if (method.startsWith("remote-")) return undefined
  const active = sessions.activeRoot(owner)
  let root = isRemoteRoot(args[0]) ? args[0] : (args[0]?.rootPath ?? args[0]?.root)
  const ambient = new Set([
    "compiler-runtime",
    "cancel-compile",
    "git-runtime",
    "install-lsp",
    "install-tool",
    "probe-lsp-path",
    "probe-tool-path",
    "configure-tools",
    "terminal-open",
    "terminal-input",
    "terminal-close",
  ])
  if (!root && ambient.has(method)) root = active
  if (method === "watch-project" && args[0] === null) root = active
  const projectId = args[0]?.projectId ?? args[1]?.projectId
  if (projectId && !root) root = sessions.projectRoot(projectId)
  if (!isRemoteRoot(root)) return undefined
  await remote.ready
  const profile = remote.profiles[root]
  const key = `${owner}:${root}`
  const entry = remote.entries.get(key)
  if (method === "project-trust")
    return {
      value: {
        trusted: entry?.trusted ?? profile?.trusted ?? false,
        decided: entry?.decided ?? profile?.decided ?? false,
      },
    }
  if (method === "bind-project") {
    const ticket = sessions.beginBinding(owner)
    if (!profile && !entry)
      throw Error("Unknown workspace; connect from its connection plugin first")
    const target = entry?.target ?? profile.target
    const preferences = await remotePreferences()
    if (
      preferences.value.pluginStates?.[target.kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"] ===
      false
    )
      throw Error("Workspace connection plugin is disabled")
    await remote.connect(owner, entry?.target ?? profile.target, root)
    if (!sessions.isCurrentBinding(owner, ticket)) throw Error("Remote project binding cancelled")
    const id = "remote-" + new URL(root).hostname
    if (args[1]?.prepare) sessions.prepareProject(owner, id, root)
    else {
      if (isRemoteRoot(active) && active !== root) remote.disconnect(owner, active)
      sessions.bindProject(owner, id, root)
    }
    return {
      value: {
        ok: true,
        project: {
          id,
          path: root,
          name:
            (entry?.target ?? profile.target).directory.split("/").filter(Boolean).at(-1) ?? "/",
        },
      },
    }
  }
  if (method === "canonical-directory" || method === "trust-directory") {
    remote.get(owner, root)
    return { value: root }
  }
  if (method === "close-project") {
    await remote.disconnect(owner, root)
    sessions.close(owner)
    return { value: null }
  }
  if (
    method === "lsp-close" &&
    (!entry || entry.state !== "connected" || sessions.activeRoot(owner) !== root)
  )
    return { value: null }
  if (!entry) throw Error("Remote workspace is not connected in this window")
  const prepared = sessions.preparedProject?.(owner)
  const preparingRead =
    prepared?.root === root && ["fs-list", "fs-read", "asset-url"].includes(method)
  if (sessions.activeRoot(owner) !== root && !preparingRead)
    throw Error("Remote workspace is not active in this window")
  if (method === "grant-project-trust" || method === "restrict-project") {
    const trusted = method === "grant-project-trust"
    remote.profiles[root].trusted = trusted
    remote.profiles[root].decided = true
    await remote.saveProfiles()
    for (const candidate of remote.entries.values()) {
      if (candidate.root !== root) continue
      candidate.trusted = trusted
      candidate.decided = true
      candidate.trustRevision = (candidate.trustRevision ?? 0) + 1
      if (candidate.state === "connected") {
        try {
          await remote.call(candidate.owner, root, "trust", [trusted])
        } catch {
          await remote.disconnect(candidate.owner, root)
        }
      }
      remote.send(candidate.owner, "envoi:trust-changed")
    }
    return { value: { trusted, decided: true } }
  }
  if (method === "asset-url") {
    const parts = safePathParts(args[1])
    return { value: `envoi://${sessions.token(root)}/${parts.map(encodeURIComponent).join("/")}` }
  }
  if (method === "fs-inspect-deletion")
    return {
      value: {
        path: root,
        name: entry.target.directory,
        label: entry.target.host,
        kind: "project",
        related: [],
        blocked: "Remote workspace deletion is not supported",
      },
    }
  if (method === "watch-project") {
    entry.watching = args[0] !== null
    return { value: await remote.call(owner, root, method, [entry.watching]) }
  }
  if (method === "fs-list") {
    const listing = await remote.call(owner, root, method)
    return {
      value: {
        ...listing,
        projectId: prepared?.root === root ? prepared.id : sessions.projectId(root),
        name: entry.target.directory.split("/").filter(Boolean).at(-1) ?? "/",
      },
    }
  }
  if (
    [
      "fs-children",
      "fs-read",
      "fs-save",
      "fs-write",
      "fs-write-files",
      "fs-mkdir",
      "fs-remove",
      "fs-rename",
      "fs-copy",
      "lsp-close",
    ].includes(method)
  )
    return { value: await remote.call(owner, root, method, args.slice(1)) }
  if (!entry.trusted) throw Error("Trust this remote workspace before running tools")
  // Network requests and native dialogs stay on the desktop; storage is remote.
  if (method === "library" || method === "paper-browse") return undefined
  if (
    [
      "lsp-open",
      "lsp-change",
      "lsp-query",
      "language-tool",
      "rtl-project",
      "python-environment",
      "git-init",
      "git-status",
      "git-log",
      "git-show",
    ].includes(method)
  ) {
    const callArgs = args.slice(1)
    if (method === "lsp-open") {
      const { value, revision } = await remotePreferences()
      const preferences = {
        pluginStates: { ...value.pluginStates, ...value.pluginWorkspaces?.[root] },
      }
      entry.preferences = [preferences, revision]
      await remote.call(owner, root, "preferences", entry.preferences)
      // Local executable paths must never be sent to a remote host.
      callArgs.length = 4
    }
    if (method === "rtl-project") callArgs[0] = { ...callArgs[0], toolPath: undefined }
    if (method === "language-tool") callArgs.length = 3
    return { value: await remote.call(owner, root, method, callArgs) }
  }
  if (
    [
      "compile",
      "lint",
      "tools",
      "compiler-runtime",
      "cancel-compile",
      "git-runtime",
      "terminal-open",
      "terminal-input",
      "terminal-close",
    ].includes(method)
  )
    return { value: await remote.call(owner, root, method, args) }
  throw Error(`This capability is not available in Remote workspaces yet: ${method}`)
}
