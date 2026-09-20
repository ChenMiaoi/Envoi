import { AsmProjectSettings } from "./AsmProjectSettings"
import { RtlProjectSettings } from "./RtlProjectSettings"
import { useProject } from "@/project/context"
import { RemoteSshSettings, RemoteExtensionTools } from "./RemoteSshSettings"
import type { MessageKey } from "@/i18n/runtime"
import { useT } from "@/i18n/useT"
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Loader2,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react"
import { Link } from "react-router"
import { pathsOf } from "./extensionTools"
import { pluginEnabled } from "./model"
import { languagePlugins, pluginLoadErrors } from "./pluginCatalog"
import { useExtensionTools } from "./useExtensionTools"

const appearance: Record<string, { mark: string; color: string }> = {
  asm: { mark: "ASM", color: "bg-orange-500/10 text-orange-400 ring-orange-400/20" },
  cpp: { mark: "C++", color: "bg-sky-500/10 text-sky-400 ring-sky-400/20" },
  python: { mark: "Py", color: "bg-amber-500/10 text-amber-400 ring-amber-400/20" },
  rtl: { mark: "RTL", color: "bg-emerald-500/10 text-emerald-400 ring-emerald-400/20" },
  lean: { mark: "∀", color: "bg-violet-500/10 text-violet-400 ring-violet-400/20" },
  rust: { mark: "Rs", color: "bg-orange-500/10 text-orange-400 ring-orange-400/20" },
}

function StatusPill({ state, label }: { state: "ok" | "partial" | "off"; label: string }) {
  const tone =
    state === "ok"
      ? "bg-green-500/10 text-green-600 ring-green-500/25 dark:text-green-400"
      : state === "partial"
        ? "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400"
        : "bg-muted/60 text-muted-foreground ring-border/70"
  const dot =
    state === "ok"
      ? "bg-green-500"
      : state === "partial"
        ? "bg-amber-500"
        : "bg-muted-foreground/40"
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${tone}`}
    >
      <span aria-hidden className={`size-1.5 rounded-full ${dot}`} />
      {label}
    </span>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  ready,
  total,
}: {
  icon: LucideIcon
  title: string
  ready: number
  total: number
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon aria-hidden className="size-3.5 text-muted-foreground" />
      <span className="text-[11px] font-semibold text-muted-foreground">{title}</span>
      <span className="rounded-full bg-muted/60 px-1.5 py-px text-[10px] tabular-nums text-muted-foreground">
        {ready}/{total}
      </span>
      <span aria-hidden className="h-px flex-1 bg-border/50" />
    </div>
  )
}

export function ExtensionsSettings({ scope }: { scope: "global" | "project" }) {
  const root = useProject((state) => state.project.rootPath)
  return root && /^(ssh|wsl):\/\//.test(root) ? (
    <RemoteExtensionTools key={`${root}:${scope}`} root={root} scope={scope} />
  ) : (
    <LocalExtensionsSettings scope={scope} />
  )
}
function LocalExtensionsSettings({ scope }: { scope: "global" | "project" }) {
  const { t } = useT()
  const {
    preferences,
    update,
    tools,
    error,
    refreshing,
    expanded,
    setExpanded,
    manual,
    setManual,
    manualTool,
    setManualTool,
    manualOpen,
    setManualOpen,
    manualError,
    verified,
    verifiedTools,
    installing,
    root,
    load,
    saveManual,
    saveToolManual,
    installToolById,
    installLspFor,
    setEnabled,
  } = useExtensionTools(scope)
  return (
    <div className="space-y-3">
      <RemoteSshSettings />
      <RemoteSshSettings kind="wsl" />
      <div className="flex items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{t("extensions.localEnvironment")}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {t("extensions.localEnvironmentHint")}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          <RefreshCw aria-hidden className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {t("settings.tools.refresh")}
        </button>
      </div>
      {pluginLoadErrors.map((failure) => (
        <p
          key={failure.id}
          role="alert"
          className="rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive"
        >
          {t("extensions.loadFailed", { id: failure.id })}
        </p>
      ))}
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
        const lspReady = group === "asm" || choices.every((choice) => !!choice.selected)
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
        const formatReady = group === "asm" || formatChoices.some((choice) => !!choice.selected)
        const lintReady =
          group === "lean" ? lspReady : lintChoices.some((choice) => !!choice.selected)
        const capabilities = [lspReady, formatReady, lintReady]
        const partial = capabilities.some(Boolean) && !capabilities.every(Boolean)
        const open = !!expanded[id]
        const visual = appearance[group]
        const renderToolRows = (entries: typeof chainChoices) =>
          entries.map(({ tool, selected }) => {
            const options = [...pathsOf(tool)]
            if (selected && !options.some((candidate) => candidate.path === selected.path))
              options.unshift(selected)
            const remembered = preferences.toolPaths[tool.id]
            const stale = !!remembered && !selected
            return (
              <div
                key={tool.id}
                className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-xs"
              >
                <div className="flex items-center gap-2.5">
                  <span
                    aria-hidden
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                      selected ? "bg-green-500/10 text-green-500" : "bg-red-500/10 text-red-500"
                    }`}
                  >
                    {selected ? (
                      <Check aria-hidden className="size-3.5" />
                    ) : (
                      <X aria-hidden className="size-3.5" />
                    )}
                  </span>
                  <span className="w-24 shrink-0 font-medium text-foreground">{tool.label}</span>
                  {options.length > 1 ? (
                    <select
                      aria-label={`${tool.label} ${t("extensions.selectVersion")}`}
                      className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
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
                  ) : selected ? (
                    <span
                      className="min-w-0 flex-1 truncate text-muted-foreground"
                      title={selected.path}
                    >
                      {selected.version ?? ""}
                    </span>
                  ) : (
                    <span className="min-w-0 flex-1">
                      <StatusPill state="off" label={t("extensions.notFound")} />
                    </span>
                  )}
                  {!selected && tool.installable && (
                    <button
                      type="button"
                      disabled={!!installing[tool.id]}
                      aria-busy={!!installing[tool.id]}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                      onClick={() => void installToolById(tool)}
                    >
                      {installing[tool.id] && (
                        <Loader2 aria-hidden className="size-3 animate-spin" />
                      )}
                      {t("extensions.installAction")}
                    </button>
                  )}
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
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
                    className="mt-1.5 truncate pl-9 font-mono text-[11px] text-muted-foreground/80"
                    title={selected.path}
                  >
                    {selected.path}
                  </p>
                )}
                {stale && (
                  <p className="mt-1.5 truncate pl-9 text-[11px] text-amber-600 dark:text-amber-400">
                    {t("extensions.pathUnavailable")}：
                    <span className="font-mono" title={remembered}>
                      {remembered}
                    </span>
                  </p>
                )}
                {(manualOpen[tool.id] || !selected) && (
                  <div className="mt-2 space-y-2 pl-9">
                    <div className="flex gap-2">
                      <input
                        aria-label={`${tool.label} ${t("extensions.manualPath")}`}
                        className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-foreground focus:border-primary/50 focus:outline-none"
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
                        className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground transition-opacity hover:opacity-90"
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
            className={`overflow-hidden rounded-2xl border bg-card/80 shadow-sm transition-colors ${open ? "border-primary/30" : "border-border/70 hover:border-border"}`}
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
                onClick={() => setExpanded((previous) => ({ ...previous, [id]: !open }))}
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
                    {!enabled && (
                      <span className="rounded-full bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        {t("extensions.disabled")}
                      </span>
                    )}
                  </span>
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {tools ? (
                      <>
                        <StatusPill
                          state={lspReady ? "ok" : someLspReady ? "partial" : "off"}
                          label={t("extensions.languageServer")}
                        />
                        <StatusPill
                          state={formatReady ? "ok" : "off"}
                          label={t("extensions.format")}
                        />
                        <StatusPill state={lintReady ? "ok" : "off"} label={t("extensions.lint")} />
                      </>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {t("settings.tools.probing")}
                      </span>
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
              className="space-y-4 border-t border-border/60 bg-background/30 px-4 py-4"
            >
              {group === "rtl" && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">{t("extensions.rtl.hint")}</p>
                  <div className="flex gap-2">
                    {candidates
                      .filter((tool) => tool.installable)
                      .map((tool) => (
                        <button
                          key={tool.id}
                          type="button"
                          className="rounded-md border px-2 py-1 text-xs"
                          disabled={!!installing.systemverilog}
                          onClick={() => void installLspFor("systemverilog", tool.id)}
                        >
                          {t("extensions.installAction")} · {tool.label}
                        </button>
                      ))}
                  </div>
                </div>
              )}
              {group === "rtl" && <RtlProjectSettings />}
              {group === "asm" && <AsmProjectSettings />}
              {group === "lean" && (
                <p className="text-xs text-muted-foreground">{t("extensions.lean.hint")}</p>
              )}
              <section className="space-y-2">
                <SectionTitle
                  icon={Server}
                  title={t("extensions.languageServer")}
                  ready={choices.filter((choice) => !!choice.selected).length}
                  total={choices.length}
                />
                <div className="flex flex-wrap gap-1.5">
                  {candidates.map((tool) => (
                    <StatusPill
                      key={tool.id}
                      state={pathsOf(tool).length ? "ok" : "off"}
                      label={tool.label}
                    />
                  ))}
                </div>
                <div className="space-y-2">
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
                    const remembered = server ? preferences.lspPaths[server] : undefined
                    const stale = !!remembered && !selected
                    return (
                      <div
                        key={language}
                        className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span
                            aria-hidden
                            className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
                              selected
                                ? "bg-green-500/10 text-green-500"
                                : "bg-red-500/10 text-red-500"
                            }`}
                          >
                            {selected ? (
                              <Check aria-hidden className="size-3.5" />
                            ) : (
                              <X aria-hidden className="size-3.5" />
                            )}
                          </span>
                          <span className="w-24 shrink-0 font-medium text-foreground">
                            {language === "cpp" ? "C/C++" : language.toUpperCase()}
                          </span>
                          {options.length > 1 ? (
                            <select
                              aria-label={`${language} ${t("extensions.languageServer")}`}
                              className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
                              value={value}
                              onChange={(event) => {
                                const [id, path] = JSON.parse(event.target.value) as [
                                  string,
                                  string,
                                ]
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
                          ) : selected ? (
                            <span
                              className="min-w-0 flex-1 truncate text-muted-foreground"
                              title={selected.path}
                            >
                              {`${selected.tool.label} · ${selected.version ?? selected.path}`}
                            </span>
                          ) : (
                            <span className="min-w-0 flex-1">
                              <StatusPill state="off" label={t("extensions.notFound")} />
                            </span>
                          )}
                          {!selected &&
                            candidates
                              .filter((tool) => tool.languages?.includes(language))
                              .some((tool) => tool.installable) && (
                              <button
                                type="button"
                                disabled={!!installing[language]}
                                aria-busy={!!installing[language]}
                                className="inline-flex shrink-0 items-center gap-1 rounded-md border border-primary/40 px-2 py-1 text-[11px] text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
                                onClick={() => void installLspFor(language)}
                              >
                                {installing[language] && (
                                  <Loader2 aria-hidden className="size-3 animate-spin" />
                                )}
                                {t("extensions.installAction")}
                              </button>
                            )}
                          <button
                            type="button"
                            className="shrink-0 rounded-md border border-border/70 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
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
                            className="mt-1.5 truncate pl-9 font-mono text-[11px] text-muted-foreground/80"
                            title={selected.path}
                          >
                            {selected.path}
                          </p>
                        )}
                        {stale && (
                          <p className="mt-1.5 truncate pl-9 text-[11px] text-amber-600 dark:text-amber-400">
                            {t("extensions.pathUnavailable")}：
                            <span className="font-mono" title={remembered}>
                              {remembered}
                            </span>
                          </p>
                        )}
                        {(manualOpen[language] || !selected) && (
                          <div className="mt-2 space-y-2 pl-9">
                            {candidates.filter((tool) => tool.languages?.includes(language))
                              .length > 1 && (
                              <select
                                aria-label={`${language} ${t("extensions.languageServer")}`}
                                className="rounded-lg border border-input bg-background px-2 py-1.5 focus:border-primary/50 focus:outline-none"
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
                                className="min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-foreground focus:border-primary/50 focus:outline-none"
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
                                className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground transition-opacity hover:opacity-90"
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
              </section>
              {formatChoices.length > 0 && (
                <section className="space-y-2">
                  <SectionTitle
                    icon={Sparkles}
                    title={t("extensions.format")}
                    ready={formatChoices.filter((choice) => !!choice.selected).length}
                    total={formatChoices.length}
                  />
                  <div className="space-y-2">{renderToolRows(formatChoices)}</div>
                </section>
              )}
              {lintChoices.length > 0 && (
                <section className="space-y-2">
                  <SectionTitle
                    icon={ShieldCheck}
                    title={t("extensions.lint")}
                    ready={lintChoices.filter((choice) => !!choice.selected).length}
                    total={lintChoices.length}
                  />
                  <div className="space-y-2">{renderToolRows(lintChoices)}</div>
                </section>
              )}
              {toolchains.length > 0 && (
                <section className="space-y-2">
                  <SectionTitle
                    icon={Wrench}
                    title={t("extensions.toolchain")}
                    ready={chainChoices.filter((choice) => !!choice.selected).length}
                    total={chainChoices.length}
                  />
                  <div className="space-y-2">{renderToolRows(chainChoices)}</div>
                </section>
              )}
              {scope === "project" && root && (
                <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3 text-[11px] text-muted-foreground">
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
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border/50 pt-3 text-[11px]">
                <span className="rounded-full bg-muted/60 px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
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
