import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { envoi } from "@/lib/desktop"
import { useLspStatus } from "@/lib/lspStatus"
import { useProject } from "@/project/context"
import { usePreferences } from "./context"
import { languagePlugins } from "./pluginCatalog"
import { pluginEnabled } from "./model"
import { useT } from "@/i18n/useT"

type Tool = {
  id: string
  label: string
  binary?: string
  kind?: string
  languages?: string[]
  available: boolean
  path?: string
  version?: string
  error?: string
}
type ToolInfo = { groups?: Record<string, Tool[]>; configurationScope?: string }

export function ExtensionsSettings({ scope }: { scope: "global" | "project" }) {
  const { t } = useT()
  const { project } = useProject()
  const { preferences, update } = usePreferences()
  const lsp = useLspStatus()
  const [tools, setTools] = useState<ToolInfo | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
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
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>{t("extensions.localEnvironment")}</span>
        <button
          type="button"
          className="text-primary disabled:opacity-50"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          {t("settings.tools.refresh")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {scope === "project" && !root && (
        <p className="text-xs text-muted-foreground">{t("extensions.openProject")}</p>
      )}
      {languagePlugins.map((plugin) => {
        const id = plugin.id
        const enabled = pluginEnabled(preferences, root, id)
        const group = id.slice("envoi.".length)
        const candidates = (tools?.groups?.[group] ?? []).filter((tool) => tool.kind === "lsp")
        const selected = plugin.contributes.languages
          .map((entry) => preferences.lspServers[entry.id])
          .filter(Boolean)
        const missingSelection = selected.some(
          (id) => !candidates.find((tool) => tool.id === id)?.available,
        )
        const running =
          enabled && lsp?.state === "ready" && candidates.some((tool) => tool.binary === lsp.server)
        const status = !enabled
          ? t("extensions.disabled")
          : running
            ? t("extensions.running")
            : !tools
              ? t("settings.tools.probing")
              : missingSelection
                ? t("extensions.missingTool")
                : candidates.some((tool) => tool.available)
                  ? t("extensions.toolReady")
                  : t("extensions.missingTool")
        return (
          <article key={id} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">
                  {t(plugin.displayNameKey as "extensions.cpp.name")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t(plugin.descriptionKey as "extensions.cpp.description")}
                </p>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  {id} · v{plugin.version} · {status}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={scope === "project" && !root}
                  onChange={(event) => setEnabled(id, event.target.checked)}
                />
                {t("extensions.enabled")}
              </label>
            </div>
            {scope === "project" && root && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                {preferences.pluginWorkspaces[root]?.[id] === undefined
                  ? t("extensions.inherited")
                  : t("extensions.workspaceOverride")}
                {preferences.pluginWorkspaces[root]?.[id] !== undefined && (
                  <button
                    type="button"
                    className="ml-2 text-primary"
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
              </p>
            )}
            <div className="mt-4 space-y-2 border-t border-border pt-3 text-xs">
              {plugin.contributes.languages.map((entry) => (
                <label key={entry.id} className="flex flex-wrap items-center gap-2">
                  {t("extensions.languageServer")} · {entry.id}
                  <select
                    className="rounded border border-input bg-background px-2 py-1"
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
              {candidates.map((tool) => (
                <p key={tool.id} className="text-muted-foreground">
                  {tool.label}:{" "}
                  {tool.available
                    ? tool.path || t("extensions.toolReady")
                    : tool.error || t("extensions.missingTool")}
                  {tool.version ? ` · ${tool.version}` : ""}
                </p>
              ))}
              <Link to="/settings/global/compile" className="inline-block text-primary">
                {t("extensions.toolSettings")}
              </Link>
              <Link to="/settings/global/general" className="ml-4 inline-block text-primary">
                {t("extensions.logs")}
              </Link>
            </div>
          </article>
        )
      })}
    </div>
  )
}
