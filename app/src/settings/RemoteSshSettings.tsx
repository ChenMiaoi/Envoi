import { AsmProjectSettings } from "./AsmProjectSettings"
import { Network, SquareTerminal } from "lucide-react"
import { useEffect, useState } from "react"
import { useT } from "@/i18n/useT"
import type { MessageKey } from "@/i18n/runtime"
import { usePreferences } from "./context"
import { useProject } from "@/project/context"
import { envoi, ipcError } from "@/lib/desktop"
import { Button } from "@/components/ui/button"
import type { RemoteState } from "../../shared/remote"
import type { ToolInfo } from "./extensionTools"
import { remoteStatusDot, remoteStatusPill } from "@/project/remoteStatus"
import { RtlProjectSettings } from "./RtlProjectSettings"
import { languagePlugins } from "./pluginCatalog"
import { pluginEnabled } from "./model"
const visuals = {
  ssh: { icon: Network, color: "bg-emerald-500/10 text-emerald-400 ring-emerald-400/20" },
  wsl: { icon: SquareTerminal, color: "bg-violet-500/10 text-violet-400 ring-violet-400/20" },
} as const
export function RemoteSshSettings({ kind = "ssh" }: { kind?: "ssh" | "wsl" }) {
  const plugin = kind === "wsl" ? "envoi.wsl" : "envoi.remote-ssh"
  const { t } = useT(),
    { preferences, update } = usePreferences()
  const root = useProject((state) => state.project.rootPath)
  const active = root?.startsWith(`${kind}://`) ? root : undefined
  const [connection, setConnection] = useState<RemoteState>()
  useEffect(() => {
    if (!active || typeof envoi().remoteList !== "function") {
      setConnection(undefined)
      return
    }
    let alive = true
    void envoi()
      .remoteList()
      .then((entries) => {
        if (alive) setConnection(entries.find((entry) => entry.root === active))
      })
      .catch(() => {})
    const off = envoi().onRemoteEvent((event) => {
      if (event.type === "state" && event.value.root === active) setConnection(event.value)
    })
    return () => {
      alive = false
      off()
    }
  }, [active])
  const enabled = preferences.pluginStates[plugin] !== false
  const title = t(kind === "wsl" ? "wsl.title" : "remote.title")
  const Icon = visuals[kind].icon
  if (kind === "wsl" && !/Win/.test(navigator.platform)) return null
  return (
    <article
      data-testid={kind === "wsl" ? "extension-wsl" : "extension-remote-ssh"}
      className="overflow-hidden rounded-2xl border border-border/70 bg-card/80 shadow-sm transition-colors hover:border-border"
    >
      <div className="flex min-h-20 items-center gap-3 px-4 py-3">
        <span
          aria-hidden
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl ring-1 ${visuals[kind].color}`}
        >
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold text-foreground">{title}</h3>
            {connection && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${remoteStatusPill(connection.state)}`}
              >
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${remoteStatusDot(connection.state)}`}
                />
                {t(`remote.${connection.state}`)}
              </span>
            )}
            {!enabled && (
              <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {t("extensions.disabled")}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(kind === "wsl" ? "wsl.description" : "remote.description")}
          </p>
        </div>
        <span aria-hidden className="mx-1 h-8 w-px bg-border/70" />
        <label
          className={`relative inline-flex shrink-0 items-center ${active ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
        >
          <input
            type="checkbox"
            aria-label={`${title} · ${t("extensions.enabled")}`}
            checked={enabled}
            disabled={!!active}
            onChange={(event) =>
              update({
                pluginStates: {
                  ...preferences.pluginStates,
                  [plugin]: event.target.checked,
                },
              })
            }
            className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
          />
          <span className="h-5 w-9 rounded-full bg-muted-foreground/35 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
          <span className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 bg-background/30 px-4 py-3">
        <Button
          size="sm"
          variant="outline"
          disabled={!enabled}
          onClick={() =>
            window.dispatchEvent(new CustomEvent("envoi:open-remote", { detail: kind }))
          }
        >
          <Icon />
          {t(kind === "wsl" ? "wsl.manage" : "remote.manage")}
        </Button>
        {active && <p className="text-[11px] text-muted-foreground">{t("remote.disableHint")}</p>}
      </div>
    </article>
  )
}
export function RemoteExtensionTools({
  root,
  scope,
}: {
  root: string
  scope: "global" | "project"
}) {
  const { t } = useT()
  const { preferences, update } = usePreferences()
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
      {scope === "global" && (
        <>
          <RemoteSshSettings />
          <RemoteSshSettings kind="wsl" />
        </>
      )}
      <p className="text-xs text-muted-foreground">
        {t(scope === "global" ? "remote.globalScope" : "remote.projectScope")}
      </p>
      {languagePlugins.map((plugin) => (
        <label
          key={plugin.id}
          className="flex items-center justify-between rounded-lg border p-3 text-sm"
        >
          <span>{t(plugin.displayNameKey as MessageKey)}</span>
          <input
            type="checkbox"
            aria-label={t(plugin.displayNameKey as MessageKey)}
            checked={
              scope === "project"
                ? pluginEnabled(preferences, root, plugin.id)
                : preferences.pluginStates[plugin.id] !== false
            }
            onChange={(event) =>
              update(
                scope === "global"
                  ? {
                      pluginStates: {
                        ...preferences.pluginStates,
                        [plugin.id]: event.target.checked,
                      },
                    }
                  : {
                      pluginWorkspaces: {
                        ...preferences.pluginWorkspaces,
                        [root]: {
                          ...preferences.pluginWorkspaces[root],
                          [plugin.id]: event.target.checked,
                        },
                      },
                    },
              )
            }
          />
        </label>
      ))}
      <RtlProjectSettings />
      <AsmProjectSettings />
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
