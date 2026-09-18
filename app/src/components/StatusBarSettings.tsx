import { useAgent } from "@/agent/context"
import { agentRequest, agentStatus, type AgentStatus, type AiConfig } from "@/lib/agentClient"
import { envoi } from "@/lib/desktop"
import { lspLanguageForPath } from "@/lib/lspLanguage"
import type { LspStatus } from "@/lib/lspStatus"
import { projectConfigPath, legacyProjectConfigPath } from "@/lib/managementDir"
import { useProject } from "@/project/context"
import { usePreferences } from "@/settings/context"
import { type Engine, projectConfiguration } from "@/settings/model"
import { saveProjectConfiguration } from "@/settings/projectSettings"
import { useSettings } from "@/settings/useSettings"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useT } from "@/i18n/useT"
import { Check } from "lucide-react"
import { useState } from "react"

const trigger =
  "-mx-1 flex items-center gap-1.5 rounded px-1 transition-colors hover:bg-white/[0.06] hover:text-foreground"
const choice =
  "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs hover:bg-accent disabled:opacity-40"

function Choice({
  label,
  selected,
  disabled,
  onClick,
}: {
  label: string
  selected?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" className={choice} disabled={disabled} onClick={onClick}>
      <span className="min-w-0 flex-1 break-words">{label}</span>
      {selected && <Check className="size-3.5 shrink-0 text-primary" />}
    </button>
  )
}

export function AiStatusControl() {
  const { t } = useT()
  const agent = useAgent((state) => ({
    status: state.status,
    config: state.config,
    busy: state.busy,
    refresh: state.refresh,
  }))
  const { projectId, getProject, setProject, busy } = useProject((state) => ({
    projectId: state.project.id,
    getProject: state.getProject,
    setProject: state.setProject,
    busy: state.busy,
  }))
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<AgentStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const available = (status ?? agent.status)?.models.filter((model) => model.available) ?? []
  const selected = available.find(
    (model) => `${model.provider}/${model.id}` === agent.config?.model,
  )

  async function save(patch: Partial<AiConfig>, inherit = false) {
    if (saving || busy || agent.busy) return
    const project = getProject()
    setSaving(true)
    setError("")
    try {
      if (project.id === "empty") {
        const current = status ?? (await agentStatus())
        const next = { ...current.settings, ...patch }
        await agentRequest("settings", { settings: next })
        setStatus({ ...current, settings: next })
        window.dispatchEvent(new Event("envoi:ai-configured"))
      } else {
        const file =
          project.files.find((file) => file.path === projectConfigPath) ??
          project.files.find((file) => file.path === legacyProjectConfigPath)
        const overrides = JSON.parse(file?.text ?? "{}").ai ?? {}
        const next = { ...overrides, ...patch }
        if (inherit) {
          delete next.provider
          delete next.model
          delete next.thinking
        }
        const saved = await saveProjectConfiguration(
          project,
          projectConfiguration(project.settings, project.engine),
          project.rootId,
          next,
        )
        setProject((current) =>
          current.id === project.id
            ? {
                ...current,
                files: current.files
                  .filter(
                    (file) =>
                      ![projectConfigPath, legacyProjectConfigPath, ".gitignore"].includes(
                        file.path,
                      ),
                  )
                  .concat(
                    saved.files.filter((file) =>
                      [projectConfigPath, ".gitignore"].includes(file.path),
                    ),
                  ),
              }
            : current,
        )
      }
      await agent.refresh()
      setOpen(false)
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) {
          setError("")
          void agentStatus()
            .then(setStatus)
            .catch((error) => setError((error as Error).message))
        }
      }}
    >
      <PopoverTrigger asChild>
        <button type="button" title={t("settings.category.ai")} className={trigger}>
          <span
            className={`inline-block size-1.5 rounded-full ${agent.status?.runtime ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.9)]" : "bg-muted-foreground"}`}
          />
          {!agent.status?.runtime
            ? t("app.statusbar.disconnected")
            : agent.busy
              ? t("chat.awaitingResponse")
              : selected
                ? `${t("app.statusbar.runtime")} · ${selected.name}`
                : t("common.selectModel")}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="w-72 p-2">
        <p className="px-2.5 py-1 text-xs font-medium">{t("common.selectModel")}</p>
        <div className="max-h-56 overflow-y-auto">
          {projectId !== "empty" && (
            <Choice
              label={t("settings.ai.modelInherited")}
              disabled={saving || busy || agent.busy}
              onClick={() => void save({}, true)}
            />
          )}
          {available.map((model) => (
            <Choice
              key={`${model.provider}/${model.id}`}
              label={`${model.provider} / ${model.name}`}
              selected={`${model.provider}/${model.id}` === agent.config?.model}
              disabled={saving || busy || agent.busy}
              onClick={() =>
                void save({
                  provider: model.provider,
                  model: `${model.provider}/${model.id}`,
                  thinking: null,
                })
              }
            />
          ))}
          {!available.length && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">{t("ai.noOptions")}</p>
          )}
        </div>
        {selected?.thinkingLevels.length ? (
          <div className="mt-1 border-t border-border pt-1">
            <p className="px-2.5 py-1 text-xs font-medium">{t("ai.thinking")}</p>
            {selected.thinkingLevels.map((level) => (
              <Choice
                key={level}
                label={level === "off" ? t("common.disabled") : level}
                selected={agent.config?.thinking === level}
                disabled={saving || busy || agent.busy}
                onClick={() => void save({ thinking: level })}
              />
            ))}
          </div>
        ) : null}
        {error && (
          <p role="alert" className="px-2.5 py-2 text-xs text-warning">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface LspTool {
  id: string
  label: string
  kind?: string
  languages?: string[]
  available: boolean
  path?: string
}

export function LspStatusControl({ status, path }: { status: LspStatus; path: string }) {
  const { t } = useT()
  const project = useProject((state) => ({ rootPath: state.project.rootPath }))
  const { preferences, update } = usePreferences()
  const [open, setOpen] = useState(false)
  const [tools, setTools] = useState<LspTool[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const language = lspLanguageForPath(path)
  const options = tools.filter(
    (tool) => tool.kind === "lsp" && tool.languages?.includes(language ?? ""),
  )
  const preferred = language ? preferences.lspServers[language] : undefined
  const load = async (refresh = false) => {
    setLoading(true)
    try {
      const result = (await envoi().tools({ refresh, root: project.rootPath ?? undefined })) as {
        groups?: Record<string, LspTool[]>
      }
      setTools(Object.values(result.groups ?? {}).flat())
      setError("")
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setLoading(false)
    }
  }
  const choose = (server?: string) => {
    if (!language) return
    const next = { ...preferences.lspServers }
    if (server) next[language] = server
    else delete next[language]
    update({ lspServers: next })
    setOpen(false)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value)
        if (value) void load()
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("settings.tools.heading")}
          className={`${trigger} font-editor`}
        >
          <span
            className={`inline-block size-1.5 rounded-full ${status?.state === "ready" ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.9)]" : "bg-warning"}`}
          />
          {status?.state === "ready"
            ? status.server
            : status?.state === "starting"
              ? t("extensions.starting")
              : t("app.statusbar.lspUnavailable")}
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="w-64 p-2">
        <p className="px-2.5 py-1 text-xs font-medium">LSP · {language ?? path}</p>
        <Choice
          label={t("settings.tools.restoreAutoDetect")}
          selected={!preferred}
          onClick={() => choose()}
        />
        {options.map((tool) => (
          <Choice
            key={tool.id}
            label={tool.label}
            selected={preferred === tool.id}
            disabled={!tool.available}
            onClick={() => choose(tool.id)}
          />
        ))}
        {!options.length && !error && (
          <p className="px-2.5 py-2 text-xs text-muted-foreground">
            {t(loading ? "settings.tools.probing" : "common.unavailable")}
          </p>
        )}
        {error && (
          <p role="alert" className="px-2.5 py-2 text-xs text-warning">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void load(true)}
          className="px-2.5 py-2 text-xs text-primary"
        >
          {t("settings.tools.refresh")}
        </button>
      </PopoverContent>
    </Popover>
  )
}

export function CompileStatusControl() {
  const { t } = useT()
  const { projectId, busy } = useProject((state) => ({
    projectId: state.project.id,
    busy: state.busy,
  }))
  const { preferences, update } = usePreferences()
  const { effective, configuration, save } = useSettings()
  const [open, setOpen] = useState(false)
  const projectOpen = projectId !== "empty"
  const choose = (engine?: Engine) => {
    if (projectOpen) void save({ ...configuration.overrides, engine })
    else if (engine) update({ engine })
    setOpen(false)
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("settings.category.compile")}
          className={`${trigger} gap-2 font-editor`}
        >
          <span>{effective.engine === "xelatex" ? "XeLaTeX" : "pdfLaTeX"}</span>
          <span>UTF-8</span>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" sideOffset={10} className="w-56 p-2">
        <p className="px-2.5 py-1 text-xs font-medium">
          {t(projectOpen ? "settings.compile.engine" : "settings.compile.defaultEngine")}
        </p>
        {projectOpen && (
          <Choice
            label={t("settings.compile.inheritEngine", { engine: preferences.engine })}
            selected={!configuration.overrides.engine}
            disabled={busy}
            onClick={() => choose()}
          />
        )}
        {(["pdflatex", "xelatex"] as const).map((engine) => (
          <Choice
            key={engine}
            label={engine === "pdflatex" ? "pdfLaTeX" : "XeLaTeX"}
            selected={
              projectOpen
                ? configuration.overrides.engine === engine
                : preferences.engine === engine
            }
            disabled={busy}
            onClick={() => choose(engine)}
          />
        ))}
      </PopoverContent>
    </Popover>
  )
}
