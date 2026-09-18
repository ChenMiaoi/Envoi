import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { ChevronDown, RefreshCw } from "lucide-react"
import { envoi } from "@/lib/desktop"
import { useLspStatus } from "@/lib/lspStatus"
import { useProject } from "@/project/context"
import { useT } from "@/i18n/useT"
import type { MessageKey } from "@/i18n/runtime"
import { usePreferences } from "./context"
import { languagePlugins } from "./pluginCatalog"
import { pluginEnabled } from "./model"

type Tool = {
  id: string
  label: string
  kind?: string
  languages?: string[]
  available: boolean
  path?: string
  version?: string
  error?: string
}
type ToolInfo = { groups?: Record<string, Tool[]> }

const appearance: Record<string, { mark: string; color: string }> = {
  cpp: { mark: "C++", color: "bg-sky-500/10 text-sky-400 ring-sky-400/20" },
  python: { mark: "Py", color: "bg-amber-500/10 text-amber-400 ring-amber-400/20" },
  rust: { mark: "Rs", color: "bg-orange-500/10 text-orange-400 ring-orange-400/20" },
}

export function ExtensionsSettings({ scope }: { scope: "global" | "project" }) {
  const { t } = useT()
  const { project } = useProject()
  const { preferences, update } = usePreferences()
  const lsp = useLspStatus()
  const [tools, setTools] = useState<ToolInfo | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const root = scope === "project" ? project.rootPath : undefined
  const load = useCallback(async (refresh: boolean) => {
    setRefreshing(true)
    try {
      setTools((await envoi().tools({ refresh })) as ToolInfo)
      setError("")
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setRefreshing(false)
    }
  }, [])
  useEffect(() => {
    void load(false)
  }, [load])

  function setEnabled(id: string, enabled: boolean) {
    if (scope === "project" && root) {
      update({
        pluginWorkspaces: {
          ...preferences.pluginWorkspaces,
          [root]: { ...preferences.pluginWorkspaces[root], [id]: enabled },
        },
      })
    } else update({ pluginStates: { ...preferences.pluginStates, [id]: enabled } })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1 text-xs text-muted-foreground">
        <span>{t("extensions.localEnvironment")}</span>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          <RefreshCw aria-hidden className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.tools.refresh")}
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {error}
        </p>
      )}
      {scope === "project" && !root && (
        <p className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
          {t("extensions.openProject")}
        </p>
      )}
      {languagePlugins.map((plugin) => {
        const id = plugin.id
        const group = id.slice("envoi.".length)
        const title = t(plugin.displayNameKey as MessageKey)
        const enabled = pluginEnabled(preferences, root, id)
        const candidates = (tools?.groups?.[group] ?? []).filter((tool) => tool.kind === "lsp")
        const selected = plugin.contributes.languages
          .map((entry) => preferences.lspServers[entry.id])
          .filter(Boolean)
        const missingSelection = selected.some(
          (toolId) => !candidates.find((tool) => tool.id === toolId)?.available,
        )
        const current =
          enabled && lsp?.pluginId === id && lsp.root === project.rootPath ? lsp : null
        const problem = current?.state === "unavailable" && current.reason === "failed"
        const missing =
          missingSelection || (tools !== null && !candidates.some((tool) => tool.available))
        const status = !enabled
          ? t("extensions.disabled")
          : current?.state === "ready"
            ? t("extensions.running")
            : current?.state === "starting"
              ? t("extensions.starting")
              : problem
                ? t("extensions.startFailed")
                : !tools
                  ? t("settings.tools.probing")
                  : missing
                    ? t("extensions.missingTool")
                    : t("extensions.toolReady")
        const open = expanded === id
        const visual = appearance[group]
        return (
          <article
            key={id}
            data-testid={`extension-${group}`}
            className={`overflow-hidden rounded-2xl border bg-card/80 transition-colors ${open ? "border-primary/30" : "border-border/70 hover:border-border"}`}
          >
            <div className="flex min-h-20 items-center gap-3 px-4 py-3">
              <span
                aria-hidden
                className={`flex size-11 shrink-0 items-center justify-center rounded-xl text-xs font-semibold tracking-tight ring-1 ${visual.color}`}
              >
                {visual.mark}
              </span>
              <button
                type="button"
                aria-label={t("extensions.configure", { name: title })}
                aria-expanded={open}
                aria-controls={`extension-details-${group}`}
                onClick={() => setExpanded(open ? null : id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-lg py-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-foreground">{title}</span>
                  <span className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <span
                      aria-hidden
                      className={`size-1.5 rounded-full ${!enabled ? "bg-muted-foreground/60" : problem || missing ? "bg-warning" : current?.state === "ready" ? "bg-primary" : "bg-muted-foreground"}`}
                    />
                    {status}
                  </span>
                </span>
                <ChevronDown
                  aria-hidden
                  className={`size-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                />
              </button>
              <span aria-hidden className="mx-1 h-8 w-px bg-border/70" />
              <label
                className={`relative inline-flex shrink-0 items-center ${scope === "project" && !root ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  aria-label={`${title} · ${t("extensions.enabled")}`}
                  checked={enabled}
                  disabled={scope === "project" && !root}
                  onChange={(event) => setEnabled(id, event.target.checked)}
                  className="peer absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
                />
                <span className="h-5 w-9 rounded-full bg-muted-foreground/35 transition-colors peer-checked:bg-primary peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary" />
                <span className="pointer-events-none absolute left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-4" />
              </label>
            </div>
            <div
              id={`extension-details-${group}`}
              hidden={!open}
              className="border-t border-border/60 bg-background/30 px-4 pb-4 pt-4"
            >
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
                {t(plugin.descriptionKey as MessageKey)}
              </p>
              <div className="space-y-3">
                {plugin.contributes.languages.map((entry) => (
                  <label
                    key={entry.id}
                    className="flex flex-wrap items-center justify-between gap-2 text-xs"
                  >
                    <span className="font-medium text-foreground">
                      {t("extensions.languageServer")} · {entry.id}
                    </span>
                    <select
                      className="min-w-36 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                      value={preferences.lspServers[entry.id] ?? ""}
                      onChange={(event) => {
                        const next = { ...preferences.lspServers }
                        if (event.target.value) next[entry.id] = event.target.value
                        else delete next[entry.id]
                        update({ lspServers: next })
                      }}
                    >
                      <option value="">{t("extensions.autoDetect")}</option>
                      {candidates
                        .filter((tool) => tool.languages?.includes(entry.id))
                        .map((tool) => (
                          <option key={tool.id} value={tool.id}>
                            {tool.label}
                          </option>
                        ))}
                    </select>
                  </label>
                ))}
              </div>
              <div className="mt-4 space-y-2 border-t border-border/50 pt-3">
                {candidates.map((tool) => (
                  <div
                    key={tool.id}
                    className="flex min-w-0 items-start justify-between gap-3 text-[11px]"
                  >
                    <span className="shrink-0 font-medium text-foreground">{tool.label}</span>
                    <span
                      title={tool.available ? tool.path : tool.error}
                      className="min-w-0 truncate text-right text-muted-foreground"
                    >
                      {tool.available
                        ? tool.path || tool.version || t("extensions.toolReady")
                        : tool.error || t("extensions.missingTool")}
                    </span>
                  </div>
                ))}
              </div>
              {scope === "project" && root && (
                <div className="mt-4 flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
                  <span>
                    {preferences.pluginWorkspaces[root]?.[id] === undefined
                      ? t("extensions.inherited")
                      : t("extensions.workspaceOverride")}
                  </span>
                  {preferences.pluginWorkspaces[root]?.[id] !== undefined && (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => {
                        const next = { ...preferences.pluginWorkspaces[root] }
                        delete next[id]
                        update({
                          pluginWorkspaces: { ...preferences.pluginWorkspaces, [root]: next },
                        })
                      }}
                    >
                      {t("extensions.reset")}
                    </button>
                  )}
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/50 pt-3 text-[11px]">
                <span className="text-muted-foreground">
                  {id} · v{plugin.version}
                </span>
                <Link to="/settings/global/compile" className="text-primary hover:underline">
                  {t("extensions.toolSettings")}
                </Link>
                <Link to="/settings/global/general" className="text-primary hover:underline">
                  {t("extensions.logs")}
                </Link>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}
