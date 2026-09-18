import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router"
import { AlertTriangle, Check, ChevronDown, RefreshCw, X } from "lucide-react"
import { envoi } from "@/lib/desktop"
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
  candidates?: { path: string; version?: string }[]
}
type ToolInfo = { groups?: Record<string, Tool[]> }
function pathsOf(tool: Tool) {
  if (tool.id === "rustAnalyzer" && !tool.version && !tool.candidates?.some((item) => item.version))
    return []
  return (
    tool.candidates ??
    (tool.available && tool.path ? [{ path: tool.path, version: tool.version }] : [])
  )
}

const appearance: Record<string, { mark: string; color: string }> = {
  cpp: { mark: "C++", color: "bg-sky-500/10 text-sky-400 ring-sky-400/20" },
  python: { mark: "Py", color: "bg-amber-500/10 text-amber-400 ring-amber-400/20" },
  rust: { mark: "Rs", color: "bg-orange-500/10 text-orange-400 ring-orange-400/20" },
}

export function ExtensionsSettings({ scope }: { scope: "global" | "project" }) {
  const { t } = useT()
  const { project } = useProject()
  const { preferences, update } = usePreferences()
  const [tools, setTools] = useState<ToolInfo | null>(null)
  const [error, setError] = useState("")
  const [refreshing, setRefreshing] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [manual, setManual] = useState<Record<string, string>>({})
  const [manualTool, setManualTool] = useState<Record<string, string>>({})
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({})
  const [manualError, setManualError] = useState<Record<string, string>>({})
  const [verified, setVerified] = useState<Record<string, { path: string; version?: string }>>({})
  const [verifiedTools, setVerifiedTools] = useState<
    Record<string, { path: string; version?: string }>
  >({})
  const root = scope === "project" ? project.rootPath : undefined
  const load = useCallback(
    async (refresh: boolean) => {
      setRefreshing(true)
      try {
        setTools((await envoi().tools({ refresh, root })) as ToolInfo)
        setError("")
      } catch (cause) {
        setError((cause as Error).message)
      } finally {
        setRefreshing(false)
      }
    },
    [root],
  )
  useEffect(() => {
    void load(false)
  }, [load])
  useEffect(() => {
    if (!tools) return
    const next = { ...preferences.lspServers }
    let changed = false
    for (const plugin of languagePlugins) {
      const group = plugin.id.slice("envoi.".length)
      const available = (tools.groups?.[group] ?? []).filter(
        (tool) => tool.kind === "lsp" && pathsOf(tool).length,
      )
      const valid = (id?: string) =>
        !!id && (available.some((tool) => tool.id === id) || !!preferences.lspPaths[id])
      if (group === "cpp") {
        const chosen = [next.cpp, next.c].find(valid) ?? available[0]?.id
        if (chosen)
          for (const language of ["c", "cpp"])
            if (next[language] !== chosen) {
              next[language] = chosen
              changed = true
            }
      } else
        for (const entry of plugin.contributes.languages) {
          const chosen = valid(next[entry.id]) ? next[entry.id] : available[0]?.id
          if (chosen && next[entry.id] !== chosen) {
            next[entry.id] = chosen
            changed = true
          }
        }
    }
    if (changed) update({ lspServers: next })
  }, [tools, preferences.lspServers, preferences.lspPaths, update])
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      Object.entries(preferences.lspPaths).map(async ([id, selected]) => {
        try {
          return [id, await envoi().probeLspPath(id, selected)] as const
        } catch {
          return [id, null] as const
        }
      }),
    ).then((entries) => {
      if (!cancelled)
        setVerified(
          Object.fromEntries(
            entries.filter(
              (entry): entry is readonly [string, { path: string; version?: string }] =>
                entry[1] !== null,
            ),
          ),
        )
    })
    return () => {
      cancelled = true
    }
  }, [preferences.lspPaths])
  useEffect(() => {
    let cancelled = false
    void Promise.all(
      Object.entries(preferences.toolPaths).map(async ([id, selected]) => {
        try {
          return [id, await envoi().probeToolPath(id, selected)] as const
        } catch {
          return [id, null] as const
        }
      }),
    ).then((entries) => {
      if (!cancelled)
        setVerifiedTools(
          Object.fromEntries(
            entries.filter(
              (entry): entry is readonly [string, { path: string; version?: string }] =>
                entry[1] !== null,
            ),
          ),
        )
    })
    return () => {
      cancelled = true
    }
  }, [preferences.toolPaths])

  async function saveManual(language: string, server: string) {
    try {
      const result = await envoi().probeLspPath(server, manual[language]?.trim() ?? "")
      setVerified((previous) => ({ ...previous, [server]: result }))
      const servers = { ...preferences.lspServers, [language]: server }
      if (language === "cpp") servers.c = server
      update({
        lspServers: servers,
        lspPaths: { ...preferences.lspPaths, [server]: result.path },
      })
      setManualOpen((previous) => ({ ...previous, [language]: false }))
      setManualError((previous) => ({ ...previous, [language]: "" }))
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [language]: (cause as Error).message }))
    }
  }

  async function saveToolManual(id: string) {
    try {
      const result = await envoi().probeToolPath(id, manual[id]?.trim() ?? "")
      setVerifiedTools((previous) => ({ ...previous, [id]: result }))
      update({ toolPaths: { ...preferences.toolPaths, [id]: result.path } })
      setManualOpen((previous) => ({ ...previous, [id]: false }))
      setManualError((previous) => ({ ...previous, [id]: "" }))
    } catch (cause) {
      setManualError((previous) => ({ ...previous, [id]: (cause as Error).message }))
    }
  }

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
        const groupTools = tools?.groups?.[group] ?? []
        const candidates = groupTools.filter((tool) => tool.kind === "lsp")
        const toolchains = groupTools.filter(
          (tool) => !["lsp", "format", "lint"].includes(tool.kind ?? ""),
        )
        const chainChoices = toolchains.map((tool) => {
          const selectedPath = preferences.toolPaths[tool.id]
          const selected = selectedPath
            ? (pathsOf(tool).find((candidate) => candidate.path === selectedPath) ??
              verifiedTools[tool.id])
            : pathsOf(tool)[0]
          return { tool, selected }
        })
        const languages = group === "cpp" ? [{ id: "cpp" }] : plugin.contributes.languages
        const choices = languages.map((entry) => {
          const available = candidates
            .filter((tool) => tool.languages?.includes(entry.id))
            .flatMap((tool) => pathsOf(tool).map((candidate) => ({ ...candidate, tool })))
          const server =
            preferences.lspServers[entry.id] ??
            (entry.id === "cpp" ? preferences.lspServers.c : undefined)
          const selectedPath = server ? preferences.lspPaths[server] : undefined
          const selected = selectedPath
            ? (available.find(
                (choice) => choice.tool.id === server && choice.path === selectedPath,
              ) ??
              (verified[server] && candidates.some((tool) => tool.id === server)
                ? { ...verified[server], tool: candidates.find((tool) => tool.id === server)! }
                : undefined))
            : (available.find((choice) => choice.tool.id === server) ?? available[0])
          return { language: entry.id, available, selected }
        })
        const lspReady = choices.every((choice) => !!choice.selected)
        const someLspReady = choices.some((choice) => !!choice.selected)
        const formatChoices = groupTools
          .filter((tool) => tool.kind === "format")
          .map((tool) => ({
            tool,
            selected: preferences.toolPaths[tool.id]
              ? (pathsOf(tool).find(
                  (candidate) => candidate.path === preferences.toolPaths[tool.id],
                ) ?? verifiedTools[tool.id])
              : pathsOf(tool)[0],
          }))
        const lintChoices = groupTools
          .filter((tool) => tool.kind === "lint")
          .map((tool) => ({
            tool,
            selected: preferences.toolPaths[tool.id]
              ? (pathsOf(tool).find(
                  (candidate) => candidate.path === preferences.toolPaths[tool.id],
                ) ?? verifiedTools[tool.id])
              : pathsOf(tool)[0],
          }))
        const formatReady = formatChoices.some((choice) => !!choice.selected)
        const lintReady = lintChoices.some((choice) => !!choice.selected)
        const capabilities = [lspReady, formatReady, lintReady]
        const partial = capabilities.some(Boolean) && !capabilities.every(Boolean)
        const open = expanded === id
        const visual = appearance[group]
        const renderToolRows = (entries: typeof chainChoices) =>
          entries.map(({ tool, selected }) => {
            const options = [...pathsOf(tool)]
            if (selected && !options.some((candidate) => candidate.path === selected.path))
              options.unshift(selected)
            return (
              <div key={tool.id} className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  {selected ? (
                    <Check aria-hidden className="size-4 shrink-0 text-green-500" />
                  ) : (
                    <X aria-hidden className="size-4 shrink-0 text-red-500" />
                  )}
                  <span className="w-24 shrink-0 font-medium text-foreground">{tool.label}</span>
                  {options.length > 1 ? (
                    <select
                      aria-label={`${tool.label} ${t("extensions.selectVersion")}`}
                      className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                      value={selected?.path ?? ""}
                      onChange={(event) =>
                        update({
                          toolPaths: {
                            ...preferences.toolPaths,
                            [tool.id]: event.target.value,
                          },
                        })
                      }
                    >
                      {!selected && (
                        <option value="" disabled>
                          {t("extensions.selectVersion")}
                        </option>
                      )}
                      {options.map((candidate) => (
                        <option key={candidate.path} value={candidate.path}>
                          {candidate.version ?? candidate.path}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span
                      className="min-w-0 flex-1 truncate text-muted-foreground"
                      title={selected?.path}
                    >
                      {selected?.version ?? ""}
                    </span>
                  )}
                  <button
                    type="button"
                    className="shrink-0 text-primary hover:underline"
                    onClick={() =>
                      setManualOpen((previous) => ({
                        ...previous,
                        [tool.id]: !previous[tool.id],
                      }))
                    }
                  >
                    {t("extensions.manualPath")}
                  </button>
                </div>
                {selected && (
                  <p
                    className="truncate pl-6 text-[11px] text-muted-foreground"
                    title={selected.path}
                  >
                    {selected.path}
                  </p>
                )}
                {(manualOpen[tool.id] || !selected) && (
                  <div className="space-y-2 pl-6">
                    <div className="flex gap-2">
                      <input
                        aria-label={`${tool.label} ${t("extensions.manualPath")}`}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-foreground"
                        placeholder={t("extensions.pathPlaceholder")}
                        value={manual[tool.id] ?? ""}
                        onChange={(event) =>
                          setManual((previous) => ({
                            ...previous,
                            [tool.id]: event.target.value,
                          }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void saveToolManual(tool.id)
                        }}
                      />
                      <button
                        type="button"
                        className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground"
                        onClick={() => void saveToolManual(tool.id)}
                      >
                        {t("extensions.usePath")}
                      </button>
                    </div>
                    {manualError[tool.id] && (
                      <p role="alert" className="text-destructive">
                        {manualError[tool.id]}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )
          })
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
                  <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground">
                    {title}
                    {tools && partial && (
                      <AlertTriangle
                        aria-label={t("extensions.partial")}
                        className="size-3.5 text-amber-500"
                      />
                    )}
                  </span>
                  <span className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                    {tools ? (
                      <>
                        <span className="inline-flex items-center gap-1">
                          {lspReady ? (
                            <Check aria-hidden className="size-3 text-green-500" />
                          ) : someLspReady ? (
                            <AlertTriangle aria-hidden className="size-3 text-amber-500" />
                          ) : (
                            <X aria-hidden className="size-3 text-red-500" />
                          )}
                          {t("extensions.languageServer")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {formatReady ? (
                            <Check aria-hidden className="size-3 text-green-500" />
                          ) : (
                            <X aria-hidden className="size-3 text-red-500" />
                          )}
                          {t("extensions.format")}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          {lintReady ? (
                            <Check aria-hidden className="size-3 text-green-500" />
                          ) : (
                            <X aria-hidden className="size-3 text-red-500" />
                          )}
                          {t("extensions.lint")}
                        </span>
                      </>
                    ) : (
                      t("settings.tools.probing")
                    )}
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
              <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                {t("extensions.format")}
              </p>
              <div className="space-y-2">{renderToolRows(formatChoices)}</div>
              <p className="mb-2 mt-4 border-t border-border/50 pt-3 text-[11px] font-semibold text-muted-foreground">
                {t("extensions.lint")}
              </p>
              <div className="space-y-2">{renderToolRows(lintChoices)}</div>
              <p className="mb-2 mt-4 border-t border-border/50 pt-3 text-[11px] font-semibold text-muted-foreground">
                {t("extensions.toolchain")}
              </p>
              <div className="space-y-2">{renderToolRows(chainChoices)}</div>
              <p className="mb-2 mt-4 border-t border-border/50 pt-3 text-[11px] font-semibold text-muted-foreground">
                {t("extensions.languageServer")}
              </p>
              <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                {candidates.map((tool) => (
                  <span key={tool.id} className="inline-flex items-center gap-1">
                    {pathsOf(tool).length ? (
                      <Check aria-hidden className="size-3 text-green-500" />
                    ) : (
                      <X aria-hidden className="size-3 text-red-500" />
                    )}
                    {tool.label}
                  </span>
                ))}
              </div>
              <div className="space-y-3">
                {choices.map(({ language, available, selected }) => {
                  const options = [...available]
                  if (
                    selected &&
                    !options.some(
                      (choice) =>
                        choice.tool.id === selected.tool.id && choice.path === selected.path,
                    )
                  )
                    options.unshift(selected)
                  const value = selected ? JSON.stringify([selected.tool.id, selected.path]) : ""
                  const server =
                    manualTool[language] ??
                    preferences.lspServers[language] ??
                    candidates.find((tool) => tool.languages?.includes(language))?.id ??
                    ""
                  return (
                    <div key={language} className="space-y-2 text-xs">
                      <div className="flex items-center gap-2">
                        {selected ? (
                          <Check aria-hidden className="size-4 shrink-0 text-green-500" />
                        ) : (
                          <X aria-hidden className="size-4 shrink-0 text-red-500" />
                        )}
                        <span className="w-12 shrink-0 font-medium text-foreground">
                          {language === "cpp" ? "C/C++" : language.toUpperCase()}
                        </span>
                        {options.length > 1 ? (
                          <select
                            aria-label={`${language} ${t("extensions.languageServer")}`}
                            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground"
                            value={value}
                            onChange={(event) => {
                              const [id, path] = JSON.parse(event.target.value) as [string, string]
                              const servers = { ...preferences.lspServers, [language]: id }
                              if (language === "cpp") servers.c = id
                              update({
                                lspServers: servers,
                                lspPaths: { ...preferences.lspPaths, [id]: path },
                              })
                            }}
                          >
                            {!selected && (
                              <option value="" disabled>
                                {t("extensions.selectVersion")}
                              </option>
                            )}
                            {options.map((choice) => (
                              <option
                                key={`${choice.tool.id}:${choice.path}`}
                                value={JSON.stringify([choice.tool.id, choice.path])}
                              >
                                {choice.tool.label} · {choice.version ?? choice.path}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span
                            className="min-w-0 flex-1 truncate text-muted-foreground"
                            title={selected?.path}
                          >
                            {selected
                              ? `${selected.tool.label} · ${selected.version ?? selected.path}`
                              : ""}
                          </span>
                        )}
                        <button
                          type="button"
                          className="shrink-0 text-primary hover:underline"
                          onClick={() =>
                            setManualOpen((previous) => ({
                              ...previous,
                              [language]: !previous[language],
                            }))
                          }
                        >
                          {t("extensions.manualPath")}
                        </button>
                      </div>
                      {selected && (
                        <p
                          className="truncate pl-6 text-[11px] text-muted-foreground"
                          title={selected.path}
                        >
                          {selected.path}
                        </p>
                      )}
                      {(manualOpen[language] || !selected) && (
                        <div className="space-y-2 pl-6">
                          {candidates.filter((tool) => tool.languages?.includes(language)).length >
                            1 && (
                            <select
                              aria-label={`${language} ${t("extensions.languageServer")}`}
                              className="rounded-lg border border-input bg-background px-2 py-1.5"
                              value={server}
                              onChange={(event) =>
                                setManualTool((previous) => ({
                                  ...previous,
                                  [language]: event.target.value,
                                }))
                              }
                            >
                              {candidates
                                .filter((tool) => tool.languages?.includes(language))
                                .map((tool) => (
                                  <option key={tool.id} value={tool.id}>
                                    {tool.label}
                                  </option>
                                ))}
                            </select>
                          )}
                          <div className="flex gap-2">
                            <input
                              aria-label={`${language} ${t("extensions.manualPath")}`}
                              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-foreground"
                              placeholder={t("extensions.pathPlaceholder")}
                              value={manual[language] ?? ""}
                              onChange={(event) =>
                                setManual((previous) => ({
                                  ...previous,
                                  [language]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") void saveManual(language, server)
                              }}
                            />
                            <button
                              type="button"
                              className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground"
                              onClick={() => void saveManual(language, server)}
                            >
                              {t("extensions.usePath")}
                            </button>
                          </div>
                          {manualError[language] && (
                            <p role="alert" className="text-destructive">
                              {manualError[language]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
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
