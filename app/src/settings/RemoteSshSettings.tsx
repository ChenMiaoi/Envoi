import { Network } from "lucide-react"
import { useEffect, useState } from "react"
import { useT } from "@/i18n/useT"
import { usePreferences } from "./context"
import { useProject } from "@/project/context"
import { envoi, ipcError } from "@/lib/desktop"
import type { ToolInfo } from "./extensionTools"
export function RemoteSshSettings({ kind = "ssh" }: { kind?: "ssh" | "wsl" }) {
  const plugin = kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"
  const { t } = useT(),
    { preferences, update } = usePreferences()
  const root = useProject((state) => state.project.rootPath)
  const active = root?.startsWith(`${kind}://`)
  return (
    <article
      data-testid={kind === "wsl" ? "extension-wsl" : "extension-remote-ssh"}
      className="rounded-2xl border border-border/70 bg-card/80 p-4"
    >
      <div className="flex items-center gap-3">
        <Network className="size-8 text-primary" />
        <div className="flex-1">
          <h3 className="text-sm font-semibold">
            {t(kind === "wsl" ? "wsl.title" : "remote.title")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(kind === "wsl" ? "wsl.description" : "remote.description")}
          </p>
        </div>
        <input
          type="checkbox"
          aria-label={`${t(kind === "wsl" ? "wsl.title" : "remote.title")} · ${t("extensions.enabled")}`}
          checked={preferences.pluginStates[plugin] !== false}
          disabled={active}
          onChange={(event) =>
            update({
              pluginStates: {
                ...preferences.pluginStates,
                [plugin]: event.target.checked,
              },
            })
          }
        />
      </div>
      <button
        disabled={preferences.pluginStates[plugin] === false}
        className="mt-3 rounded border px-3 py-1.5 text-xs text-primary disabled:opacity-40"
        onClick={() => window.dispatchEvent(new CustomEvent("envoi:open-remote", { detail: kind }))}
      >
        {t(kind === "wsl" ? "wsl.title" : "remote.manage")}
      </button>
      {active && <p className="mt-2 text-xs text-muted-foreground">{t("remote.disableHint")}</p>}
    </article>
  )
}
export function RemoteExtensionTools({ root }: { root: string }) {
  const { t } = useT()
  const [tools, setTools] = useState<ToolInfo>(),
    [error, setError] = useState("")
  const load = () => {
    void envoi()
      .tools({ root, refresh: true })
      .then((info) => {
        setTools(info as ToolInfo)
        setError("")
      })
      .catch((error) => setError(ipcError(error).message))
  }
  useEffect(() => {
    let alive = true
    void envoi()
      .tools({ root })
      .then((info) => {
        if (alive) setTools(info as ToolInfo)
      })
      .catch((error) => {
        if (alive) setError(ipcError(error).message)
      })
    return () => {
      alive = false
    }
  }, [root])
  return (
    <div className="space-y-3">
      <RemoteSshSettings />
      <RemoteSshSettings kind="wsl" />
      <p className="text-xs text-muted-foreground">{t("remote.toolsHint")}</p>
      <button className="text-xs text-primary" onClick={load}>
        {t("settings.tools.refresh")}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {Object.entries(tools?.groups ?? {}).map(([group, rows]) => (
        <div key={group} className="rounded-xl border p-3">
          <h3 className="text-sm font-medium">{group}</h3>
          {rows.map((tool) => (
            <p key={tool.id} className="mt-2 text-xs">
              <span className={tool.available ? "text-green-600" : "text-muted-foreground"}>
                {tool.label} ·{" "}
                {tool.available ? (tool.version ?? tool.path) : t("extensions.notFound")}
              </span>
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}
