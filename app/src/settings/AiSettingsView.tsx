import { SettingsRow as Row } from "./SettingsRow"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { useEffect, useState, useCallback } from "react"
import { Link, useSearchParams } from "react-router"
import { agentStatus, agentRequest, type AgentStatus, type AiConfig } from "@/lib/agentClient"
import { useProject } from "@/project/context"
import { saveProjectConfiguration } from "./projectSettings"
import { projectConfigPath, legacyProjectConfigPath } from "@/lib/managementDir"
import { projectConfiguration } from "./model"
import { ProviderConfigurationDialog } from "./ProviderConfiguration"
import { useT } from "@/i18n/useT"
const field =
  "min-h-9 rounded-lg border border-input bg-background px-3 py-2 text-xs text-foreground disabled:opacity-40"
export function AiSettingsView({ scope }: { scope: "global" | "project" }) {
  const [search] = useSearchParams(),
    { project, setProject, busy } = useProject(),
    [status, setStatus] = useState<AgentStatus | null>(null),
    [provider, setProvider] = useState(""),
    [configuring, setConfiguring] = useState<string | null>(null),
    [message, setMessage] = useState(""),
    [working, setWorking] = useState(false),
    [providerQuery, setProviderQuery] = useState(""),
    [providerOpen, setProviderOpen] = useState(false)
  const { t } = useT()
  const thinkingNames: Record<string, string> = {
    off: t("common.disabled"),
    minimal: t("settings.ai.thinkingMinimal"),
    low: t("settings.ai.thinkingLow"),
    medium: t("settings.ai.thinkingMedium"),
    high: t("settings.ai.thinkingHigh"),
    xhigh: t("settings.ai.thinkingXhigh"),
  }
  const [custom, setCustom] = useState({
    provider: "",
    baseUrl: "",
    model: "",
    name: "",
    api: "openai-completions",
    contextWindow: "",
    maxTokens: "",
  })
  const global = scope === "global"
  const refresh = useCallback(async () => {
    const result = await agentStatus()
    setStatus(result)
    setProvider(
      (current) =>
        current ||
        result.providers.find((item) => item.id === search.get("provider"))?.id ||
        result.providers.find((item) => item.auth.configured)?.id ||
        result.providers[0]?.id ||
        "",
    )
  }, [search])
  useEffect(() => {
    void refresh().catch((error) => setMessage(error.message))
  }, [refresh])
  const action = async (run: () => Promise<unknown>, success: string) => {
    setWorking(true)
    setMessage("")
    try {
      await run()
      await refresh()
      setMessage(success)
      window.dispatchEvent(new Event("envoi:ai-configured"))
    } catch (error) {
      setMessage((error as Error).message)
    } finally {
      setWorking(false)
    }
  }
  const record =
    project.files.find((file) => file.path === projectConfigPath) ??
    project.files.find((file) => file.path === legacyProjectConfigPath)
  let overrides: Partial<AiConfig> = {}
  try {
    overrides = JSON.parse(record?.text ?? "{}").ai ?? {}
  } catch {
    /* Saving reports invalid project configuration. */
  }
  const config = {
    ...(status?.settings ?? { model: null, context: "current", tools: "read" }),
    ...(!global ? overrides : {}),
  } as AiConfig
  async function save(patch: Partial<AiConfig>, inherit?: keyof AiConfig) {
    if (!status) return
    if (patch.model !== undefined) {
      patch = { ...patch, provider: patch.model?.split("/")[0] ?? null, thinking: null }
    }
    if (global) {
      await action(
        () => agentRequest("settings", { settings: { ...status.settings, ...patch } }),
        t("settings.ai.saved"),
      )
      return
    }
    if (!project.rootPath) {
      setMessage(t("settings.ai.connectFirst"))
      return
    }
    const next = { ...overrides, ...patch }
    if (inherit) delete next[inherit]
    if (inherit === "model") {
      delete next.provider
      delete next.thinking
    }
    await action(async () => {
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
                    ![projectConfigPath, legacyProjectConfigPath, ".gitignore"].includes(file.path),
                )
                .concat(
                  saved.files.filter((file) =>
                    [projectConfigPath, ".gitignore"].includes(file.path),
                  ),
                ),
            }
          : current,
      )
    }, t("settings.ai.projectSaved"))
  }
  const selected = status?.providers.find((item) => item.id === provider),
    models = status?.models.filter((model) => model.available) ?? [],
    active = models.find((model) => `${model.provider}/${model.id}` === config.model)
  const disabled = working || busy || !status || (!global && !project.rootPath)
  const inherited = (key: keyof AiConfig) => !global && overrides[key] === undefined
  if (!global && !project.rootPath)
    return (
      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        {t("settings.ai.notConnected")}
        <button
          className="mt-4 block text-xs text-primary"
          onClick={() => window.dispatchEvent(new Event("envoi:open-project"))}
        >
          {t("settings.general.openProject")}
        </button>
      </div>
    )
  return (
    <div className="space-y-5">
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {!status && <p className="text-xs text-muted-foreground">{t("settings.ai.loading")}</p>}
      {global ? (
        <section className="rounded-xl border border-border bg-card px-5">
          <Row label={t("settings.ai.providerAccount")} hint={t("settings.ai.providerAccountHint")}>
            <Popover open={providerOpen} onOpenChange={setProviderOpen}>
              <PopoverTrigger asChild>
                <button
                  aria-label={t("settings.ai.manageProvider")}
                  className={field + " max-w-56 truncate text-left"}
                >
                  {selected?.name || provider || t("common.selectProvider")}
                  {selected?.auth.configured ? ` · ${t("common.configured")}` : ""}
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-2">
                <input
                  aria-label={t("settings.ai.searchProvider")}
                  placeholder={t("settings.ai.searchProvider")}
                  value={providerQuery}
                  onChange={(event) => setProviderQuery(event.target.value)}
                  className={field + " mb-2 w-full"}
                />
                <div className="max-h-64 overflow-auto">
                  {[...(status?.providers ?? [])]
                    .filter((item) =>
                      `${item.name} ${item.id}`.toLowerCase().includes(providerQuery.toLowerCase()),
                    )
                    .sort(
                      (a, b) =>
                        Number(b.auth.configured) - Number(a.auth.configured) ||
                        (a.name || a.id).localeCompare(b.name || b.id),
                    )
                    .map((item) => (
                      <button
                        key={item.id}
                        className="block w-full rounded-lg px-3 py-2 text-left text-xs hover:bg-secondary"
                        onClick={() => {
                          setProvider(item.id)
                          setProviderOpen(false)
                          setProviderQuery("")
                        }}
                      >
                        {item.name || item.id}
                        {item.auth.configured ? (
                          <span className="ml-2 text-muted-foreground">
                            {t("common.configured")}
                          </span>
                        ) : null}
                      </button>
                    ))}
                </div>
              </PopoverContent>
            </Popover>
            <button
              disabled={!selected || working}
              className={field + " hover:bg-secondary"}
              onClick={() => setConfiguring(provider)}
            >
              {selected?.auth.configured ? t("common.manageConnection") : t("common.connect")}
            </button>
          </Row>
        </section>
      ) : (
        <section className="rounded-xl border border-border bg-card px-5">
          <Row
            label={t("settings.ai.providerAccount")}
            hint={t("settings.ai.providerAccountHintProject")}
          >
            <Link className="text-xs text-primary" to="/settings/global/ai">
              {t("settings.ai.manageGlobal")}
            </Link>
          </Row>
        </section>
      )}
      <section>
        <h3 className="mb-3 text-sm font-medium">
          {t(global ? "settings.ai.globalHeading" : "settings.ai.projectHeading")}
        </h3>
        <div className="rounded-xl border border-border bg-card px-5">
          <Row
            label={t("common.model")}
            hint={
              global
                ? t("settings.ai.modelHintGlobal")
                : inherited("model")
                  ? t("settings.ai.modelInherited")
                  : t("common.inheritanceOverride")
            }
          >
            <select
              aria-label={t("settings.ai.modelAria")}
              disabled={disabled}
              className={field + " max-w-full sm:max-w-xs"}
              value={inherited("model") ? "inherit" : (config.model ?? "")}
              onChange={(event) =>
                void (event.target.value === "inherit"
                  ? save({}, "model")
                  : save({ model: event.target.value || null }))
              }
            >
              {!global && <option value="inherit">{t("common.inheritGlobal")}</option>}
              <option value="">{t("common.noneSelected")}</option>
              {config.model && !active && (
                <option disabled value={config.model}>
                  {config.model} · {t("common.unavailableHere")}
                </option>
              )}
              {models.map((model) => (
                <option
                  key={model.provider + "/" + model.id}
                  value={model.provider + "/" + model.id}
                >
                  {model.provider} / {model.name}
                </option>
              ))}
            </select>
          </Row>
          <Row
            label={t("settings.ai.thinking")}
            hint={
              !config.model
                ? t("settings.ai.thinkingHintNoModel")
                : !active
                  ? t("settings.ai.thinkingHintUnavailable")
                  : active.thinkingLevels.length
                    ? t("settings.ai.thinkingHintLevels")
                    : t("settings.ai.thinkingHintNone")
            }
          >
            <select
              aria-label={t("settings.ai.thinkingAria")}
              disabled={disabled || !active?.thinkingLevels.length}
              className={field}
              value={inherited("thinking") ? "inherit" : (config.thinking ?? "")}
              onChange={(event) =>
                void (event.target.value === "inherit"
                  ? save({}, "thinking")
                  : save({ thinking: event.target.value || null }))
              }
            >
              {!global && <option value="inherit">{t("common.inheritGlobal")}</option>}
              <option value="">{t("settings.ai.thinkingDefault")}</option>
              {config.thinking && !active?.thinkingLevels.includes(config.thinking) && (
                <option disabled value={config.thinking}>
                  {config.thinking} · {t("common.unavailable")}
                </option>
              )}
              {active?.thinkingLevels.map((level) => (
                <option key={level} value={level}>
                  {thinkingNames[level] || level}
                </option>
              ))}
            </select>
          </Row>
          <Row label={t("settings.ai.context")} hint={t("settings.ai.contextHint")}>
            <select
              aria-label={t("settings.ai.contextAria")}
              disabled={disabled}
              className={field}
              value={inherited("context") ? "inherit" : config.context}
              onChange={(event) =>
                void (event.target.value === "inherit"
                  ? save({}, "context")
                  : save({ context: event.target.value as "none" | "current" }))
              }
            >
              {!global && <option value="inherit">{t("common.inheritGlobal")}</option>}
              <option value="none">{t("settings.ai.optionNone")}</option>
              <option value="current">{t("settings.ai.optionCurrentDoc")}</option>
            </select>
          </Row>
          <p className="py-4 text-xs text-muted-foreground">{t("settings.ai.workspaceTrust")}</p>
        </div>
      </section>
      {global && (
        <details id="manual-model" className="rounded-xl border border-border bg-background/40 p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("settings.ai.manualHeading")}
          </summary>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("settings.ai.manualHint")}
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {(["provider", "baseUrl", "model", "name", "contextWindow", "maxTokens"] as const).map(
              (key) => (
                <label className="text-xs" key={key}>
                  {t(
                    (
                      {
                        provider: "settings.ai.fieldProvider",
                        baseUrl: "settings.ai.fieldBaseUrl",
                        model: "settings.ai.fieldModel",
                        name: "settings.ai.fieldName",
                        contextWindow: "settings.ai.fieldContextWindow",
                        maxTokens: "settings.ai.fieldMaxTokens",
                      } as const
                    )[key],
                  )}
                  <input
                    value={custom[key]}
                    onChange={(event) =>
                      setCustom((current) => ({ ...current, [key]: event.target.value }))
                    }
                    className={field + " mt-1 w-full"}
                  />
                </label>
              ),
            )}
            <label className="text-xs">
              {t("settings.ai.apiType")}
              <select
                aria-label={t("settings.ai.apiTypeAria")}
                value={custom.api}
                onChange={(event) =>
                  setCustom((current) => ({ ...current, api: event.target.value }))
                }
                className={field + " mt-1 w-full"}
              >
                <option value="openai-completions">OpenAI Chat Completions</option>
                <option value="anthropic-messages">Anthropic Messages</option>
                <option value="google-generative-ai">Google Generative AI</option>
              </select>
            </label>
            <div className="flex items-end">
              <button
                disabled={
                  working ||
                  !custom.provider ||
                  !custom.baseUrl ||
                  !custom.model ||
                  !custom.contextWindow ||
                  !custom.maxTokens
                }
                className={field + " hover:bg-secondary"}
                onClick={() =>
                  void action(() => agentRequest("custom-provider", custom), t("settings.ai.added"))
                }
              >
                {t("settings.ai.addModel")}
              </button>
            </div>
          </div>
          {status && (
            <p className="mt-4 break-all text-xs text-muted-foreground">
              {t("settings.ai.localData", { dir: status.storage.dataDir })}
            </p>
          )}
        </details>
      )}
      <ProviderConfigurationDialog
        provider={status?.providers.find((item) => item.id === configuring) ?? null}
        onClose={() => setConfiguring(null)}
        onSaved={() => {
          void refresh().catch((error) => setMessage(error.message))
          window.dispatchEvent(new Event("envoi:ai-configured"))
        }}
      />
    </div>
  )
}
