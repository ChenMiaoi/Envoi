import { randomUUID } from "node:crypto"
import type { MainServices } from "../runtime"
import { listWslDistributions, browseWslDirectories } from "../remote/wsl.mjs"
import type { SshTarget } from "../../../shared/remote"
import { remotePreferences } from "../remote/workspace-routing.mjs"
export function registerRemoteIpc({ handle, remote }: Pick<MainServices, "handle" | "remote">) {
  handle("envoi:remote-wsl-distributions", () => listWslDistributions())
  handle("envoi:remote-wsl-directories", (_event, host: string, input?: string) =>
    browseWslDirectories(host, input),
  )
  handle("envoi:remote-list", (event) => remote.list(event.sender.id))
  const opening = new Map<string, AbortController>()
  async function connect(
    sender: Electron.WebContents,
    input: SshTarget | string,
    requestId: string = randomUUID(),
  ) {
    const owner = sender.id
    if (sender.isDestroyed()) throw Error("Connection window was closed")
    if (typeof requestId !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(requestId))
      throw Error("Invalid connection request")
    const key = `${owner}:${requestId}`
    if (opening.has(key)) throw Error("Connection request is already pending")
    const controller = new AbortController()
    opening.set(key, controller)
    const closed = () => controller.abort(Error("Connection window was closed"))
    sender.once("destroyed", closed)
    try {
      await remote.ready
      const root = typeof input === "string" ? input : undefined
      const target =
        typeof input === "string"
          ? (remote.entries.get(`${owner}:${input}`)?.target ?? remote.profiles[input]?.target)
          : input
      if (!target) throw Error("Unknown remote workspace")
      const preferences = await remotePreferences()
      if (
        preferences.value.pluginStates?.[
          target.kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"
        ] === false
      )
        throw Error("Workspace connection plugin is disabled")
      controller.signal.throwIfAborted()
      const result = await remote.connect(owner, target, root, controller.signal)
      controller.signal.throwIfAborted()
      return result
    } finally {
      opening.delete(key)
      sender.removeListener("destroyed", closed)
    }
  }
  handle("envoi:remote-connect", (event, target: SshTarget, requestId?: string) =>
    connect(event.sender, target, requestId),
  )
  handle("envoi:remote-reconnect", (event, root: string, requestId?: string) =>
    connect(event.sender, root, requestId),
  )
  handle("envoi:remote-cancel", (event, requestId: string) => {
    opening.get(`${event.sender.id}:${requestId}`)?.abort(Error("Connection cancelled"))
  })
  handle("envoi:remote-disconnect", (event, root?: string) =>
    remote.disconnect(event.sender.id, root),
  )
  handle("envoi:remote-answer", (event, id: string, answer: string) =>
    remote.answer(event.sender.id, id, answer),
  )
  for (const method of ["terminal-open", "terminal-input", "terminal-close"])
    handle(`envoi:${method}`, () => {
      throw Error("Open a Linux workspace to use its terminal")
    })
}
