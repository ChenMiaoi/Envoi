import { NumberSetting } from "@/settings/NumberSetting"
import { FontPicker } from "@/settings/FontPicker"
import { SettingsRow as Row } from "@/settings/SettingsRow"
import { AiSettingsView } from "@/settings/AiSettingsView"
import { UpdateSettings } from "@/settings/UpdateSettings"
import { DiagnosticsSettings } from "@/settings/DiagnosticsSettings"
import { notify } from "@/lib/notifications"
import { Notification } from "@/components/Notification"
import { ShortcutsView } from "@/settings/ShortcutsView"
import { useEffect, useState } from "react"
import { NavLink, useLocation, Link } from "react-router"
import { useProject } from "@/project/context"
import { usePreferences } from "@/settings/context"
import { useSettings } from "@/settings/useSettings"
import { useT } from "@/i18n/useT"
import { envoi, ipcError } from "@/lib/desktop"
import { locales, type LocaleId } from "@/i18n/locales"
import {
  defaults,
  accents,
  themes,
  projectConfiguration,
  settingCategories,
  type SettingsCategory,
  type SettingsScope,
  type Engine,
  type ThemeId,
} from "@/settings/model"
const input =
  "min-h-9 py-2 rounded-lg border border-input bg-background px-3 text-xs text-foreground"
function TextAppearance({ kind }: { kind: "ui" | "preview" }) {
  const { preferences, update } = usePreferences()
  const { t } = useT()
  const ui = kind === "ui",
    family = ui ? "uiFontFamily" : "previewFontFamily",
    size = ui ? "uiFontSize" : "previewFontSize",
    fontLabel = t(ui ? "settings.appearance.uiFont" : "settings.appearance.previewFont"),
    sizeLabel = t(ui ? "settings.appearance.uiSize" : "settings.appearance.previewSize")
  return (
    <>
      <Row label={fontLabel}>
        <FontPicker
          label={fontLabel}
          value={preferences[family]}
          onChange={(value) => update({ [family]: value })}
        />
      </Row>
      <Row label={sizeLabel} hint={ui ? undefined : t("settings.appearance.previewSizeHint")}>
        <NumberSetting
          label={sizeLabel}
          value={preferences[size]}
          onChange={(value) => update({ [size]: value })}
          min={ui ? 10 : 8}
          max={ui ? 24 : 40}
          step={ui ? 1 : 0.5}
          defaultValue={defaults[size]}
          unit="px"
        />
      </Row>
      {!ui && (
        <Row label={t("settings.appearance.previewLineHeight")}>
          <NumberSetting
            label={t("settings.appearance.previewLineHeight")}
            value={preferences.previewLineHeight}
            onChange={(value) => update({ previewLineHeight: value })}
            min={1}
            max={3}
            step={0.1}
            defaultValue={defaults.previewLineHeight}
            unit="×"
          />
        </Row>
      )}
    </>
  )
}
function Rules({
  value,
  onSave,
  disabled,
}: {
  value: number[]
  onSave: (rules: number[]) => void
  disabled?: boolean
}) {
  const { t } = useT()
  const [text, setText] = useState(value.join(", ")),
    [error, setError] = useState("")
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          aria-label={t("settings.editor.rulesAria")}
          value={text}
          disabled={disabled}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("settings.editor.rulesPlaceholder")}
          className={input + " w-60"}
        />
        <button
          disabled={disabled}
          className={input}
          onClick={() => {
            const values = text.trim() ? text.split(",").map((v) => Number(v.trim())) : []
            if (values.some((v) => !Number.isInteger(v) || v < 1 || v > 42)) {
              setError(t("settings.editor.rulesError"))
              return
            }
            setError("")
            onSave([...new Set(values)].sort((a, b) => a - b))
          }}
        >
          {t("common.apply")}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-warning">
          {error}
        </p>
      )}
    </div>
  )
}
interface Tools {
  system?: { platform: string; release: string; arch: string; machine: string }
  git?: { available: boolean; path: string; version?: string; error?: string }
  biber?: { available: boolean; path: string; version?: string; error?: string }
  chktex: { available: boolean; path: string; configured: boolean; error: string }
  texlab: { available: boolean; path: string; integrationAvailable: boolean }
  latex: { available: boolean; error?: string; root?: string }
}
function LocalTools() {
  const { t } = useT()
  const [tools, setTools] = useState<Tools | null>(null),
    [path, setPath] = useState(""),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => envoi().tools() as unknown as Tools)
      .then((result) => {
        if (active) {
          setTools(result)
          setPath(result.chktex.path)
        }
      })
      .catch((error) => {
        if (active) notify(ipcError(error).message, "error", "local-tools")
      })
    return () => {
      active = false
    }
  }, [t])
  async function save(value: string | null) {
    if (!tools) return
    setBusy(true)
    try {
      const result = (await envoi().configureTools({ chktexPath: value })) as unknown as Tools
      setTools(result)
      setPath(result.chktex.path)
      notify(t("settings.tools.validatedSaved"), "success", "local-tools")
    } catch (error) {
      notify(ipcError(error).message, "error", "local-tools")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-6 rounded-xl border border-border bg-background/40 p-4">
      <h3 className="text-sm font-medium">{t("settings.tools.heading")}</h3>
      {!tools && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          {t("settings.tools.probing")}
        </p>
      )}
      {tools && (
        <>
          {tools.system && (
            <Row label={t("settings.tools.system")} hint={tools.system.release}>
              <span className="text-xs">
                {tools.system.platform === "win32"
                  ? "Windows"
                  : tools.system.platform === "darwin"
                    ? "macOS"
                    : tools.system.platform}{" "}
                · {tools.system.machine} ({tools.system.arch})
              </span>
            </Row>
          )}
          {(["git", "biber"] as const).map(
            (name) =>
              tools[name] && (
                <Row
                  key={name}
                  label={name === "git" ? "Git" : "Biber"}
                  hint={tools[name]?.path || tools[name]?.error}
                >
                  <span className="text-xs">
                    {tools[name]?.available
                      ? tools[name]?.version || t("common.available")
                      : t("common.unavailable")}
                  </span>
                </Row>
              ),
          )}
          <Row
            label="LaTeX"
            hint={tools.latex.available ? tools.latex.root || undefined : tools.latex.error}
          >
            <span className="text-xs">
              {tools.latex.available ? t("common.available") : t("common.unavailable")}
            </span>
          </Row>
          <Row label={t("settings.tools.chktexProgram")} hint={t("settings.tools.chktexHint")}>
            <span className="text-xs">
              {tools.chktex.available ? t("common.available") : t("common.unavailable")}
            </span>
          </Row>
          <div className="flex flex-wrap gap-2">
            <input
              aria-label={t("settings.tools.chktexPathAria")}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              className={input + " min-w-0 flex-1 font-editor"}
            />
            <button disabled={busy} className={input} onClick={() => void save(path)}>
              {t("settings.tools.validateSave")}
            </button>
            <button disabled={busy} className={input} onClick={() => void save(null)}>
              {t("settings.tools.restoreAutoDetect")}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
export function SettingsView() {
  const { project, busy } = useProject(),
    { preferences, update, error } = usePreferences(),
    { configuration, effective, save } = useSettings()
  const { t } = useT()
  const parts = useLocation().pathname.split("/")
  const scope = (parts[2] ?? "global") as SettingsScope,
    category = (parts[3] ?? "general") as SettingsCategory
  const global = scope === "global"
  const [access, setAccess] = useState<{ id: string; ok: boolean; reason: string } | null>(null)
  useEffect(() => {
    let active = true
    if (scope === "project")
      void (async () => {
        if (!project.rootPath) {
          if (active)
            setAccess({
              id: project.id,
              ok: false,
              reason: t("settings.general.accessNotConnected"),
            })
          return
        }
        try {
          await envoi().fsList(project.rootPath)
          if (active) setAccess({ id: project.id, ok: true, reason: "" })
        } catch (error) {
          if (active)
            setAccess({
              id: project.id,
              ok: false,
              reason:
                (error as Error).name === "NotFoundError"
                  ? t("settings.general.accessMoved")
                  : (error as Error).message,
            })
        }
      })()
    return () => {
      active = false
    }
  }, [scope, project.id, project.rootPath, t])
  const available = access?.id === project.id && access.ok
  const override = (key: "engine" | "lintEnabled" | "disabledRules", value: unknown) =>
    void save(
      projectConfiguration({ version: 1, overrides: { ...configuration.overrides, [key]: value } })
        .overrides,
    )
  const inheritance = (key: keyof typeof configuration.overrides) =>
    configuration.overrides[key] === undefined
      ? t("common.inheritanceGlobal")
      : t("common.inheritanceOverride")
  if ((category as string) === "shortcuts") return <ShortcutsView />
  return (
    <div className="flex h-full flex-col bg-background">
      <header className="border-b border-border px-7 py-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">{t("view.settings")}</h1>
          </div>
          <div className="flex rounded-lg border border-border bg-card p-1">
            {(["global", "project"] as const).map((value) => (
              <NavLink
                key={value}
                to={`/settings/${value}/${category}`}
                className={`rounded-md px-4 py-2 text-xs ${scope === value ? "bg-accent text-primary" : "text-muted-foreground"}`}
              >
                {t(value === "global" ? "settings.header.global" : "settings.header.project")}
              </NavLink>
            ))}
          </div>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav
          aria-label={t("settings.navAria")}
          className="w-44 shrink-0 space-y-1 border-r border-border bg-card/50 p-3"
        >
          {Object.entries(settingCategories).map(([id, labelKey]) => (
            <NavLink
              end
              key={id}
              to={`/settings/${scope}/${id}`}
              className={({ isActive }) =>
                `block rounded-lg px-3 py-2.5 text-xs ${isActive ? "bg-accent text-primary" : "text-muted-foreground hover:bg-secondary"}`
              }
            >
              {t(labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0 flex-1 overflow-auto p-7">
          <div className="mx-auto max-w-3xl">
            <h2 className="mb-3 text-base font-medium">{t(settingCategories[category])}</h2>
            {error && <Notification message={error} kind="error" />}
            {category === "ai" ? (
              <AiSettingsView scope={scope} />
            ) : (
              <>
                {!global && !available ? (
                  <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
                    {access?.id === project.id ? access.reason : t("settings.general.accessCheck")}
                    <button
                      className="mt-4 block text-xs text-primary"
                      onClick={() => window.dispatchEvent(new Event("envoi:open-project"))}
                    >
                      {t("settings.general.openProject")}
                    </button>
                  </div>
                ) : (
                  <div className="rounded-xl border border-border bg-card px-5">
                    {category === "general" &&
                      (global ? (
                        <>
                          <Row label={t("settings.general.language")}>
                            <select
                              aria-label={t("settings.general.language")}
                              className={input}
                              value={preferences.language}
                              onChange={(e) => update({ language: e.target.value as LocaleId })}
                            >
                              {locales.map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.native}
                                </option>
                              ))}
                            </select>
                          </Row>
                          <TextAppearance kind="ui" />
                          <Row label={t("settings.general.theme")}>
                            <div className="flex flex-wrap gap-2">
                              {Object.entries(themes).map(([id, theme]) => (
                                <button
                                  key={id}
                                  aria-label={t("settings.general.themeAria", {
                                    name: t(theme.labelKey),
                                  })}
                                  aria-pressed={preferences.theme === id}
                                  title={
                                    theme.mode === "dark" ? t("common.dark") : t("common.light")
                                  }
                                  onClick={() => update({ theme: id as ThemeId })}
                                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${preferences.theme === id ? "border-primary text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}
                                >
                                  <span
                                    aria-hidden
                                    className="flex h-5 w-8 overflow-hidden rounded-sm border border-border"
                                  >
                                    <span
                                      className="flex-1"
                                      style={{ background: theme.swatch.bg }}
                                    />
                                    <span
                                      className="w-3"
                                      style={{ background: theme.swatch.panel }}
                                    />
                                  </span>
                                  {t(theme.labelKey)}
                                </button>
                              ))}
                            </div>
                          </Row>
                          <Row label={t("settings.general.accent")}>
                            {Object.entries(accents).map(([id, color]) => (
                              <button
                                key={id}
                                aria-label={t("settings.general.accentAria", {
                                  name: t(color.labelKey),
                                })}
                                aria-pressed={preferences.accent === id}
                                title={t(color.labelKey)}
                                onClick={() => update({ accent: id as keyof typeof accents })}
                                className={`h-7 w-7 rounded-full border-2 ${preferences.accent === id ? "border-foreground" : "border-transparent"}`}
                                style={{
                                  backgroundColor: `hsl(${themes[preferences.theme].mode === "dark" ? color.hsl : color.light})`,
                                }}
                              />
                            ))}
                          </Row>
                          <h3 className="mt-6 text-sm font-medium">
                            {t("settings.general.readerPreviewHeading")}
                          </h3>
                          <TextAppearance kind="preview" />
                        </>
                      ) : (
                        <>
                          <Row
                            label={project.name}
                            hint={t("settings.general.projectConnectionHint")}
                          >
                            <span
                              className="text-xs text-muted-foreground"
                              title={project.rootPath}
                            >
                              {project.rootPath}
                            </span>
                          </Row>
                          <Row
                            label={t("settings.general.movedHeading")}
                            hint={t("settings.general.movedHint")}
                          >
                            <button
                              className={input}
                              onClick={() => window.dispatchEvent(new Event("envoi:open-project"))}
                            >
                              {t("settings.general.openProject")}
                            </button>
                          </Row>
                        </>
                      ))}
                    {category === "editor" && (
                      <>
                        {global ? (
                          <>
                            <Row label={t("settings.editor.font")}>
                              <FontPicker
                                editor
                                label={t("settings.editor.font")}
                                value={preferences.fontFamily}
                                onChange={(value) => update({ fontFamily: value })}
                              />
                            </Row>
                            <Row label={t("settings.editor.fontSize")}>
                              <NumberSetting
                                label={t("settings.editor.fontSizeAria")}
                                value={preferences.fontSize}
                                onChange={(value) => update({ fontSize: value })}
                                min={8}
                                max={40}
                                step={0.5}
                                defaultValue={defaults.fontSize}
                                unit="px"
                              />
                            </Row>
                            <Row label={t("settings.editor.lineHeight")}>
                              <NumberSetting
                                label={t("settings.editor.lineHeightAria")}
                                value={preferences.lineHeight}
                                onChange={(value) => update({ lineHeight: value })}
                                min={1}
                                max={3}
                                step={0.1}
                                defaultValue={defaults.lineHeight}
                                unit="×"
                              />
                            </Row>
                            <Row label={t("settings.editor.tabWidth")}>
                              <select
                                aria-label={t("settings.editor.tabWidth")}
                                className={input}
                                value={preferences.tabSize}
                                onChange={(e) => update({ tabSize: Number(e.target.value) })}
                              >
                                {[2, 4, 8].map((n) => (
                                  <option key={n}>{n}</option>
                                ))}
                              </select>
                            </Row>
                          </>
                        ) : (
                          <p className="py-4 text-xs text-muted-foreground">
                            {t("settings.editor.inheritNote")}
                            <Link className="ml-2 text-primary" to="/settings/global/editor">
                              {t("settings.editor.editGlobalAppearance")}
                            </Link>
                          </p>
                        )}
                        <Row
                          label={t("settings.editor.liveChktex")}
                          hint={
                            global
                              ? t("settings.editor.liveChktexHint")
                              : t("settings.editor.liveChktexInherited", {
                                  inheritance: inheritance("lintEnabled"),
                                  state: t(
                                    effective.lintEnabled ? "common.enabled" : "common.disabled",
                                  ),
                                })
                          }
                        >
                          <select
                            disabled={busy}
                            aria-label={t("settings.editor.liveChktexAria")}
                            className={input}
                            value={
                              global
                                ? String(preferences.lintEnabled)
                                : configuration.overrides.lintEnabled === undefined
                                  ? "inherit"
                                  : String(configuration.overrides.lintEnabled)
                            }
                            onChange={(e) =>
                              global
                                ? update({ lintEnabled: e.target.value === "true" })
                                : override(
                                    "lintEnabled",
                                    e.target.value === "inherit"
                                      ? undefined
                                      : e.target.value === "true",
                                  )
                            }
                          >
                            {!global && (
                              <option value="inherit">{t("common.inheritGlobal")}</option>
                            )}
                            <option value="true">{t("common.enabled")}</option>
                            <option value="false">{t("common.disabled")}</option>
                          </select>
                        </Row>
                        <Row
                          label={t("settings.editor.disabledRules")}
                          hint={
                            global
                              ? undefined
                              : t("settings.editor.disabledRulesInherited", {
                                  inheritance: inheritance("disabledRules"),
                                  rules:
                                    effective.disabledRules.join(", ") ||
                                    t("settings.editor.noDisabledRules"),
                                })
                          }
                        >
                          <div>
                            {!global && configuration.overrides.disabledRules !== undefined && (
                              <button
                                className="mb-2 block text-xs text-primary"
                                onClick={() => override("disabledRules", undefined)}
                              >
                                {t("settings.editor.restoreInheritance")}
                              </button>
                            )}
                            <Rules
                              key={`${scope}:${effective.disabledRules.join(",")}`}
                              disabled={busy}
                              value={effective.disabledRules}
                              onSave={(rules) =>
                                global
                                  ? update({ disabledRules: rules })
                                  : override("disabledRules", rules)
                              }
                            />
                          </div>
                        </Row>
                      </>
                    )}
                    {category === "compile" && (
                      <>
                        <Row
                          label={t(
                            global ? "settings.compile.defaultEngine" : "settings.compile.engine",
                          )}
                          hint={
                            global
                              ? undefined
                              : t("settings.compile.engineHintProject", {
                                  inheritance: inheritance("engine"),
                                  engine: effective.engine,
                                })
                          }
                        >
                          <select
                            disabled={busy}
                            aria-label={t("settings.compile.engineAria")}
                            className={input}
                            value={
                              global
                                ? preferences.engine
                                : (configuration.overrides.engine ?? "inherit")
                            }
                            onChange={(e) =>
                              global
                                ? update({ engine: e.target.value as Engine })
                                : override(
                                    "engine",
                                    e.target.value === "inherit" ? undefined : e.target.value,
                                  )
                            }
                          >
                            {!global && (
                              <option value="inherit">
                                {t("settings.compile.inheritEngine", {
                                  engine: preferences.engine,
                                })}
                              </option>
                            )}
                            <option value="pdflatex">pdfLaTeX</option>
                            <option value="xelatex">XeLaTeX</option>
                          </select>
                          {!global && configuration.overrides.engine && (
                            <button
                              className="text-xs text-primary"
                              onClick={() => override("engine", undefined)}
                            >
                              {t("settings.editor.restoreInheritance")}
                            </button>
                          )}
                        </Row>
                        {!global && (
                          <Row label={t("settings.compile.mainTex")}>
                            <select
                              disabled={busy}
                              aria-label={t("settings.compile.mainTexAria")}
                              className={input + " max-w-xs"}
                              value={project.rootId}
                              onChange={(e) => void save(configuration.overrides, e.target.value)}
                            >
                              {project.files
                                .filter((f) => f.kind === "latex")
                                .map((file) => (
                                  <option key={file.id} value={file.id}>
                                    {file.path}
                                  </option>
                                ))}
                            </select>
                          </Row>
                        )}
                      </>
                    )}
                    {category === "references" &&
                      (global ? (
                        <Row label={t("settings.references.defaultGit")}>
                          <input
                            aria-label={t("settings.references.defaultGit")}
                            type="checkbox"
                            checked={preferences.defaultGit}
                            onChange={(e) => update({ defaultGit: e.target.checked })}
                          />
                        </Row>
                      ) : (
                        <>
                          <Row label={t("settings.references.management")}>
                            <button
                              className={input}
                              onClick={() => window.dispatchEvent(new Event("envoi:show-git"))}
                            >
                              {t("settings.references.viewGitStatus")}
                            </button>
                          </Row>
                          <Row label={t("settings.references.bibFiles")}>
                            <div className="text-right text-xs text-muted-foreground">
                              {project.files
                                .filter((file) => file.kind === "bib")
                                .map((file) => (
                                  <p key={file.id}>{file.path}</p>
                                ))}
                            </div>
                          </Row>
                        </>
                      ))}
                  </div>
                )}
                {global && category === "general" && (
                  <div className="mt-5 rounded-xl border border-border bg-card px-5">
                    <Row label={t("settings.general.shortcuts")}>
                      <Link className="text-xs text-primary" to="/settings/global/shortcuts">
                        {t("settings.general.openShortcuts")}
                      </Link>
                    </Row>
                  </div>
                )}
                {global && category === "compile" && <LocalTools />}
                {global && category === "general" && <UpdateSettings />}
                {global && category === "general" && <DiagnosticsSettings />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
