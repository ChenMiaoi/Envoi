import { dataStore } from "../../../server/local-data.mjs"
import type { MainServices } from "../runtime"
export function registerDataIpc(services: Pick<MainServices, "lspService" | "handle" | "remote">) {
  const { lspService, handle, remote } = services
  // dataStore 返回 {status, body}（镜像 HTTP，含 409 revision 冲突）；>=400 抛错，语义同原 HTTP client。
  const store = async (input: Parameters<typeof dataStore>[0]): Promise<unknown> => {
    const result = (await dataStore(input)) as { status: number; body: { error?: string } }
    if (result.status >= 400) throw new Error(result.body?.error ?? "本机数据操作失败")
    return result.body
  }
  handle("envoi:data-get", (_event, name: string, key?: string) =>
    store({ store: name, key: key ?? "default", action: "get" }),
  )
  handle(
    "envoi:data-put",
    async (
      _event,
      name: string,
      value: unknown,
      key?: string,
      opts?: { migrate?: boolean; expectedRevision?: number },
    ) => {
      const result = await store({
        store: name,
        key: key ?? "default",
        action: "put",
        value,
        migrate: opts?.migrate,
        expectedRevision: opts?.expectedRevision,
      })
      if (name === "preferences" && (key ?? "default") === "default") {
        const saved = result as { value: unknown; revision: number }
        lspService.configurePreferences(saved.value, saved.revision)
        const preferences = saved.value as {
          pluginStates?: Record<string, boolean>
          pluginWorkspaces?: Record<string, Record<string, boolean>>
        }
        for (const entry of remote.entries.values()) {
          if (preferences.pluginStates?.["envoi.remote-ssh"] === false) {
            remote.disconnect(entry.owner, entry.root)
            continue
          }
          const value = {
            pluginStates: {
              ...preferences.pluginStates,
              ...preferences.pluginWorkspaces?.[entry.root],
            },
          }
          entry.preferences = [value, saved.revision]
          if (entry.state === "connected")
            await remote.call(entry.owner, entry.root, "preferences", entry.preferences)
        }
      }
      return result
    },
  )
}
