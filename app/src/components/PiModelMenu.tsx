import { useT } from "@/i18n/useT"
import { Tooltip, TooltipTrigger, TooltipContent } from "./ui/tooltip"
import { ModelCatalogInfo } from "./ModelCatalogInfo"
import { useState, useEffect, useRef, type ReactNode } from "react"
import { Link } from "react-router"
import { Check, ChevronDown, Settings2, Building2 } from "lucide-react"
import { useAgent } from "@/agent/context"
import { useProject } from "@/project/context"
import { ProviderConfigurationDialog } from "@/settings/ProviderConfiguration"
import { providerGroups } from "@/lib/aiChoices"
import { refreshModelCatalog, type AiConfig } from "@/lib/agentClient"
import { saveProjectConfiguration } from "@/settings/projectSettings"
import { projectConfigPath, legacyProjectConfigPath } from "@/lib/managementDir"
import { projectConfiguration } from "@/settings/model"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

export function PiModelMenu() {
  const { t } = useT()
  const levels: Record<string, string> = {
    off: t("common.disabled"),
    minimal: t("ai.thinkingMinimal"),
    low: t("ai.thinkingLow"),
    medium: t("ai.thinkingMedium"),
    high: t("ai.thinkingHigh"),
    xhigh: t("ai.thinkingXhigh"),
  }

  const agent = useAgent()
  const providerButton = useRef<HTMLButtonElement>(null),
    providerMeasure = useRef<HTMLSpanElement>(null),
    modelMeasure = useRef<HTMLSpanElement>(null),
    [providerFull, setProviderFull] = useState(false)
  useEffect(() => {
    const button = providerButton.current,
      row = button?.parentElement
    if (!button || !row) return
    const observer = new ResizeObserver(() => {
      const others = [...row.children]
        .filter((element) => element !== button && element.getAttribute("data-picker") !== "model")
        .reduce((width, element) => width + element.getBoundingClientRect().width, 0)
      setProviderFull(
        row.clientWidth - others >=
          (providerMeasure.current?.scrollWidth ?? 0) +
            (modelMeasure.current?.scrollWidth ?? 0) +
            64,
      )
    })
    observer.observe(row)
    return () => observer.disconnect()
  }, [agent.status, agent.config?.provider, agent.config?.model])
  const [configuring, setConfiguring] = useState<string | null>(null)
  const { project, setProject, busy } = useProject()
  const [open, setOpen] = useState("")
  const [catalogLoading, setCatalogLoading] = useState(false)
  const requested = useRef(""),
    refreshAgent = useRef(agent.refresh)
  useEffect(() => {
    refreshAgent.current = agent.refresh
  }, [agent.refresh])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const allModels = agent.status?.models.filter((model) => model.available) ?? []
  const selected = allModels.find(
    (model) => `${model.provider}/${model.id}` === agent.config?.model,
  )
  const providerId = agent.config?.provider ?? selected?.provider
  const groups = providerGroups(agent.status?.providers ?? [])
  const providers = groups.flatMap((group) => group.providers)
  const provider = providers.find((provider) => provider.id === providerId)
  const models = (agent.status?.models ?? []).filter((model) => model.provider === providerId)
  const disabled = saving || busy || agent.busy || !agent.ready
  useEffect(() => {
    if (open !== "model") {
      requested.current = ""
      setCatalogLoading(false)
      return
    }
    if (!providerId || !provider?.auth.configured) return
    const fresh = provider.catalog?.checkedAt && Date.now() - provider.catalog.checkedAt < 300000
    if (models.length && (fresh || provider.catalog?.state === "manual")) return
    if (requested.current === providerId) return
    requested.current = providerId
    setCatalogLoading(true)
    setError("")
    void refreshModelCatalog(providerId)
      .then(() => refreshAgent.current())
      .catch((error) => {
        if (requested.current === providerId) setError(error.message)
      })
      .finally(() => {
        if (requested.current === providerId) setCatalogLoading(false)
      })
  }, [
    open,
    providerId,
    models.length,
    provider?.auth.configured,
    provider?.catalog?.state,
    provider?.catalog?.checkedAt,
  ])

  async function save(patch: Partial<AiConfig>, next = "") {
    if (disabled || !project.rootPath) return
    setSaving(true)
    setError("")
    try {
      const file =
        project.files.find((file) => file.path === projectConfigPath) ??
        project.files.find((file) => file.path === legacyProjectConfigPath)
      const overrides = JSON.parse(file?.text ?? "{}").ai ?? {}
      const saved = await saveProjectConfiguration(
        project,
        projectConfiguration(project.settings, project.engine),
        project.rootId,
        { ...overrides, ...patch },
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
      await agent.refresh()
      setOpen(next)
    } catch {
      setError(t("ai.saveFailed"))
    } finally {
      setSaving(false)
    }
  }

  function item(
    id: string,
    label: string,
    selected: boolean,
    action: () => void,
    unavailable = false,
  ) {
    return (
      <button
        key={id}
        disabled={!unavailable && disabled}
        onClick={action}
        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-accent disabled:opacity-40"
      >
        <span className="min-w-0 flex-1 whitespace-normal break-words" title={label}>
          {label}
        </span>
        {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
      </button>
    )
  }
  function picker(id: string, label: string, title: string, content: ReactNode, inactive = false) {
    return (
      <Popover
        open={open === id}
        onOpenChange={(value) => {
          setOpen(value ? id : "")
          setError("")
          if (value) void agent.refresh()
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                disabled={inactive}
                aria-label={id === "provider" ? `${title}：${label}` : title}
                title={label}
                data-picker={id}
                ref={id === "provider" ? providerButton : undefined}
                className={
                  "relative flex min-w-0 items-center gap-0.5 rounded-full px-1 py-1 text-[11px] hover:bg-muted disabled:opacity-40 " +
                  (id === "provider" ? "shrink-0" : id === "model" ? "flex-1" : "max-w-20")
                }
              >
                {id === "provider" ? (
                  <>
                    <Building2 className="h-3.5 w-3.5 shrink-0" />
                    <span
                      ref={providerMeasure}
                      aria-hidden="true"
                      className="pointer-events-none invisible absolute whitespace-nowrap"
                    >
                      {label}
                    </span>
                    {providerFull && <span className="whitespace-nowrap">{label}</span>}
                  </>
                ) : (
                  <>
                    <span
                      ref={id === "model" ? modelMeasure : undefined}
                      aria-hidden="true"
                      className="pointer-events-none invisible absolute whitespace-nowrap"
                    >
                      {label}
                    </span>
                    <span className="truncate">{label}</span>
                  </>
                )}
                <ChevronDown className="h-2.5 w-2.5 shrink-0" />
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="top">{label}</TooltipContent>
        </Tooltip>
        <PopoverContent side="top" align="end" sideOffset={10} className="w-56 rounded-xl p-2">
          <div className="max-h-52 overflow-y-auto">{content}</div>
          {error && (
            <p role="status" className="px-2.5 py-2 text-xs text-muted-foreground">
              {error}
            </p>
          )}
          <ModelCatalogInfo
            key={id === "model" ? provider?.id : id}
            provider={id === "model" ? provider?.id : undefined}
            catalog={id === "model" ? provider?.catalog : undefined}
            onRefresh={async () => {
              setError("")
              await agent.refresh()
            }}
          >
            <Link
              aria-label={t("ai.settings")}
              title={t("ai.settings")}
              to="/settings/global/ai"
              onClick={() => setOpen("")}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent"
            >
              <Settings2 className="h-3.5 w-3.5" />
            </Link>
          </ModelCatalogInfo>
        </PopoverContent>
      </Popover>
    )
  }
  const empty = <p className="px-2.5 py-3 text-xs text-muted-foreground">{t("ai.noOptions")}</p>
  return (
    <>
      <ProviderConfigurationDialog
        provider={providers.find((provider) => provider.id === configuring) ?? null}
        onClose={() => setConfiguring(null)}
        onSaved={() => {
          void agent.refresh()
          window.dispatchEvent(new Event("envoi:ai-configured"))
        }}
      />
      {picker(
        "agent",
        "Pi",
        t("ai.selectAgent"),
        <div className="flex items-center justify-between px-2.5 py-2 text-xs">
          Pi
          <Check className="h-3.5 w-3.5" />
        </div>,
      )}
      {picker(
        "provider",
        provider?.name || providerId || t("ai.provider"),
        t("common.selectProvider"),
        providers.length
          ? groups.map(({ configured, providers: group }) => {
              return group.length ? (
                <div key={String(configured)}>
                  <p className="px-2.5 pb-1 pt-2 text-[10px] text-muted-foreground">
                    {configured ? t("common.configured") : t("common.unconfigured")}
                  </p>
                  {group.map((provider) =>
                    item(
                      provider.id,
                      provider.name || provider.id,
                      provider.id === providerId,
                      () => {
                        if (configured)
                          void save({ provider: provider.id, model: null, thinking: null }, "model")
                        else {
                          setOpen("")
                          setConfiguring(provider.id)
                        }
                      },
                      !configured,
                    ),
                  )}
                </div>
              ) : null
            })
          : empty,
      )}
      {picker(
        "model",
        selected?.name ||
          (agent.config?.model?.startsWith(providerId + "/")
            ? agent.config.model.slice((providerId?.length ?? 0) + 1) +
              " · " +
              t("common.unavailable")
            : t("common.model")),
        t("common.selectModel"),
        catalogLoading && !models.length ? (
          <p role="status" className="px-2.5 py-3 text-xs text-muted-foreground">
            {t("ai.loadingCatalog")}
          </p>
        ) : models.length ? (
          models.map((model) =>
            model.available ? (
              item(
                model.id,
                model.name,
                model.id === selected?.id,
                () =>
                  void save({
                    provider: model.provider,
                    model: `${model.provider}/${model.id}`,
                    thinking: null,
                  }),
              )
            ) : (
              <button
                key={model.id}
                disabled
                title={model.unavailableReason}
                className="block w-full px-2.5 py-2 text-left text-xs opacity-40"
              >
                {model.name} · {t("common.capabilityPending")}
              </button>
            ),
          )
        ) : (
          empty
        ),
      )}
      {picker(
        "thinking",
        agent.config?.thinking
          ? levels[agent.config.thinking] || agent.config.thinking
          : t("ai.thinking"),
        t("ai.selectThinking"),
        selected?.thinkingLevels?.map((level) =>
          item(
            level,
            levels[level] || level,
            level === agent.config?.thinking,
            () => void save({ thinking: level }),
          ),
        ),
        !selected?.thinkingLevels?.length,
      )}
    </>
  )
}
