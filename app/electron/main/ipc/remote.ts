import type { MainServices } from "../runtime"
import type { SshTarget } from "../../../shared/remote"
import { remotePreferences } from "../remote/workspace-routing.mjs"
export function registerRemoteIpc({ handle, remote }: Pick<MainServices, "handle" | "remote">) {
  handle("envoi:remote-list", (event) => remote.list(event.sender.id))
  handle("envoi:remote-connect", async (event, target: SshTarget) => {
    const preferences = await remotePreferences()
    if (preferences.value.pluginStates?.["envoi.remote-ssh"] === false)
      throw Error("Remote SSH is disabled")
    return remote.connect(event.sender.id, target)
  })
  handle("envoi:remote-reconnect", async (event, root: string) => {
    await remote.ready
    const entry = remote.entries.get(`${event.sender.id}:${root}`)
    const target = entry?.target ?? remote.profiles[root]?.target
    if (!target) throw Error("Unknown SSH workspace")
    const preferences = await remotePreferences()
    if (preferences.value.pluginStates?.["envoi.remote-ssh"] === false)
      throw Error("Remote SSH is disabled")
    return remote.connect(event.sender.id, target, root)
  })
  handle("envoi:remote-disconnect", (event, root?: string) =>
    remote.disconnect(event.sender.id, root),
  )
  handle("envoi:remote-answer", (event, id: string, answer: string) =>
    remote.answer(event.sender.id, id, answer),
  )
  for (const method of ["terminal-open", "terminal-input", "terminal-close"])
    handle(`envoi:${method}`, () => {
      throw Error("Open an SSH workspace to use its terminal")
    })
}
