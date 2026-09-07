import { killProcessTree } from "../../server/process-tree.mjs"
import { utilityProcess } from "electron"
import path from "node:path"
import { rm } from "node:fs/promises"

type Event = Record<string, unknown>
interface Pending {
  resolve(value: unknown): void
  reject(error: Error): void
  onEvent?: (event: Event) => void
}
export class BackendHost {
  private child: Electron.UtilityProcess | undefined
  private pending = new Map<number, Pending>()
  private sequence = 0
  private closing = false
  constructor(private name: string) {}
  private start() {
    if (this.closing) throw Error("应用正在退出。")
    if (this.child) return this.child
    const child = utilityProcess.fork(path.join(import.meta.dirname, "backend.js"), [], {
      serviceName: `Envoi ${this.name}`,
      stdio: "pipe",
    })
    // Drain pipes so verbose tool output cannot block the child.
    child.stdout?.resume()
    child.stderr?.resume()
    this.child = child
    const processes = new Set<number>(),
      directories = new Set<string>()
    const cleanup = () => {
      for (const pid of processes) killProcessTree(pid)
      processes.clear()
      for (const directory of directories)
        void rm(directory, { recursive: true, force: true }).catch(() => {})
      directories.clear()
    }
    child.on(
      "message",
      (message: {
        resource?: { pid?: number; directory?: string; active: boolean }
        id: number
        result?: unknown
        error?: string
        event?: Event
      }) => {
        if (message.resource) {
          const { pid, directory, active } = message.resource
          if (pid) {
            if (active) processes.add(pid)
            else processes.delete(pid)
          }
          if (directory) {
            if (active) directories.add(directory)
            else directories.delete(directory)
          }
          return
        }
        const request = this.pending.get(message.id)
        if (!request) return
        if (message.event) {
          request.onEvent?.(message.event)
          return
        }
        this.pending.delete(message.id)
        if (message.error) request.reject(Error(message.error))
        else request.resolve(message.result)
      },
    )
    child.once("exit", () => {
      cleanup()
      if (this.child === child) this.child = undefined
      for (const request of this.pending.values())
        request.reject(Error(`${this.name} 后台进程已退出，请重试。`))
      this.pending.clear()
    })
    return child
  }
  call<T = unknown>(
    method: string,
    args: unknown[] = [],
    options: { owner?: number; root?: string; onEvent?: (event: Event) => void } = {},
  ): Promise<T> {
    const child = this.start(),
      id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        onEvent: options.onEvent,
      })
      try {
        child.postMessage({ id, method, args, owner: options.owner, root: options.root })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  async cancel(owner?: number, root?: string) {
    if (this.child) await this.call("cancel", [], { owner, root })
  }
  async dispose() {
    if (this.closing) return
    const child = this.child
    if (!child) {
      this.closing = true
      return
    }
    const shutdown = this.call("shutdown").catch(() => {})
    this.closing = true
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      shutdown,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 4000)
      }),
    ])
    clearTimeout(timer)
    child.kill()
  }
}
