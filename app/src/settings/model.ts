import { normalizeFont } from "./fonts"
import {
  DEFAULT_BINDS,
  migrateLegacyBindings,
  normalizeBindings,
  parseBinding,
  validateChord,
} from "../navigation/shortcuts"
import { isLocaleId, type LocaleId } from "@/i18n/locales"
import type { MessageKey } from "@/i18n/messages/zh-CN"
export type Engine = "pdflatex" | "xelatex"
export type TextFont = string
export interface Preferences {
  version: 2
  language: LocaleId
  bindings: string[]
  uiFontFamily: TextFont
  uiFontSize: number
  previewFontFamily: TextFont
  previewLineHeight: number
  previewFontSize: number
  theme: ThemeId
  accent: "lemon" | "blue" | "green" | "rose"
  fontSize: number
  fontFamily: string
  lineHeight: number
  tabSize: number
  disabledRules: number[]
  engine: Engine
  lintEnabled: boolean
  defaultGit: boolean
  lspServers: Record<string, string>
}
export interface ProjectConfiguration {
  version: 1
  overrides: { engine?: Engine; lintEnabled?: boolean; disabledRules?: number[] }
}
export const defaults: Preferences = {
  version: 2,
  language: "zh-CN",
  bindings: [],
  uiFontFamily: "system",
  uiFontSize: 13,
  previewFontFamily: "system",
  previewLineHeight: 1.85,
  previewFontSize: 14,
  theme: "graphite",
  accent: "lemon",
  fontSize: 12.5,
  fontFamily: "system",
  lineHeight: 1.75,
  tabSize: 4,
  disabledRules: [],
  engine: "pdflatex",
  lintEnabled: true,
  defaultGit: true,
  lspServers: {},
}
/** 主题完整色板定义在 index.css 的 [data-theme] 块中；这里只保存元数据与设置页预览色。 */
export type ThemeId = "graphite" | "classic" | "midnight" | "forest" | "paper" | "mist"
export const themes: Record<
  ThemeId,
  { labelKey: MessageKey; mode: "dark" | "light"; swatch: { bg: string; panel: string } }
> = {
  graphite: {
    labelKey: "theme.graphite",
    mode: "dark",
    swatch: { bg: "#282a2e", panel: "#313337" },
  },
  classic: { labelKey: "theme.classic", mode: "dark", swatch: { bg: "#2a2a2d", panel: "#323236" } },
  midnight: {
    labelKey: "theme.midnight",
    mode: "dark",
    swatch: { bg: "#262931", panel: "#2e323b" },
  },
  forest: { labelKey: "theme.forest", mode: "dark", swatch: { bg: "#292e2a", panel: "#313732" } },
  paper: { labelKey: "theme.paper", mode: "light", swatch: { bg: "#f7f5f1", panel: "#ece9e3" } },
  mist: { labelKey: "theme.mist", mode: "light", swatch: { bg: "#f2f4f7", panel: "#e6e9ee" } },
}
/** hsl 用于深色主题；浅色主题下改用 light 变体保证对比度。 */
export const accents = {
  lemon: { labelKey: "accent.lemon" as MessageKey, hsl: "66 88% 64%", light: "66 72% 30%" },
  blue: { labelKey: "accent.blue" as MessageKey, hsl: "208 58% 71%", light: "215 56.3% 42.2%" },
  green: { labelKey: "accent.green" as MessageKey, hsl: "120 34% 72%", light: "127 33.3% 35.9%" },
  rose: { labelKey: "accent.rose" as MessageKey, hsl: "338 51% 75%", light: "335 48.7% 44.3%" },
}
export const editorFonts = {
  system: {
    labelKey: "font.editor.system" as MessageKey,
    css: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  menlo: { labelKey: "font.editor.menlo" as MessageKey, css: "Menlo, ui-monospace, monospace" },
  monaco: { labelKey: "font.editor.monaco" as MessageKey, css: "Monaco, ui-monospace, monospace" },
}
export const textFonts = {
  system: {
    labelKey: "font.ui.system" as MessageKey,
    css: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  sans: {
    labelKey: "font.ui.sans" as MessageKey,
    css: 'Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  serif: { labelKey: "font.ui.serif" as MessageKey, css: 'Georgia, "Songti SC", "SimSun", serif' },
}
export function normalizeRules(raw: unknown) {
  return Array.isArray(raw)
    ? [...new Set(raw.filter((n) => Number.isInteger(n) && n >= 1 && n <= 42))].sort(
        (a, b) => a - b,
      )
    : []
}
function range(value: unknown, min: number, max: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    ? Math.round(value * 100) / 100
    : fallback
}
export function normalizePreferences(raw: unknown): Preferences {
  const value =
    raw && typeof raw === "object"
      ? (raw as Omit<Partial<Preferences>, "version"> & { version?: number })
      : {}
  const legacy = "shortcuts" in value ? value.shortcuts : undefined
  const bindings = normalizeBindings(
    Array.isArray(value.bindings) ? value.bindings : migrateLegacyBindings(legacy),
  )
  if (value.version === 1 && bindings.length) {
    const added = DEFAULT_BINDS.find(
      (line) => parseBinding(line)?.command.id === "reader-read-only",
    )!
    if (
      !bindings.some((line) => parseBinding(line)?.command.id === "reader-read-only") &&
      !validateChord(parseBinding(added)!.chord, bindings)
    )
      bindings.push(added)
  }
  return {
    version: 2,
    language: isLocaleId(value.language) ? value.language : defaults.language,
    bindings,
    uiFontFamily: normalizeFont(value.uiFontFamily, textFonts),
    uiFontSize: range(value.uiFontSize, 10, 24, defaults.uiFontSize),
    previewFontFamily: normalizeFont(value.previewFontFamily, textFonts),
    previewFontSize: range(value.previewFontSize, 8, 40, defaults.previewFontSize),
    previewLineHeight: range(value.previewLineHeight, 1, 3, defaults.previewLineHeight),
    theme: value.theme && value.theme in themes ? value.theme : defaults.theme,
    accent: value.accent && value.accent in accents ? value.accent : defaults.accent,
    fontSize: range(value.fontSize, 8, 40, defaults.fontSize),
    fontFamily: normalizeFont(value.fontFamily, editorFonts),
    lineHeight: range(value.lineHeight, 1, 3, defaults.lineHeight),
    tabSize: [2, 4, 8].includes(value.tabSize ?? 0) ? value.tabSize! : 4,
    disabledRules: normalizeRules(value.disabledRules),
    engine: value.engine === "xelatex" ? "xelatex" : "pdflatex",
    lintEnabled: typeof value.lintEnabled === "boolean" ? value.lintEnabled : defaults.lintEnabled,
    defaultGit: typeof value.defaultGit === "boolean" ? value.defaultGit : defaults.defaultGit,
    lspServers:
      value.lspServers && typeof value.lspServers === "object" && !Array.isArray(value.lspServers)
        ? Object.fromEntries(
            Object.entries(value.lspServers).filter(
              ([language, server]) =>
                /^[a-z]+$/.test(language) && typeof server === "string" && /^[\w-]+$/.test(server),
            ),
          )
        : {},
  }
}
export function projectConfiguration(raw: unknown, legacyEngine?: string): ProjectConfiguration {
  const value =
    raw && typeof raw === "object"
      ? (raw as { version?: number; overrides?: ProjectConfiguration["overrides"] })
      : undefined
  const candidate = value?.version === 1 ? (value.overrides ?? {}) : { engine: legacyEngine }
  const overrides: ProjectConfiguration["overrides"] = {}
  if (candidate.engine === "pdflatex" || candidate.engine === "xelatex")
    overrides.engine = candidate.engine
  if ("lintEnabled" in candidate && typeof candidate.lintEnabled === "boolean")
    overrides.lintEnabled = candidate.lintEnabled
  if ("disabledRules" in candidate && Array.isArray(candidate.disabledRules))
    overrides.disabledRules = normalizeRules(candidate.disabledRules)
  return { version: 1, overrides }
}
export function effectivePreferences(global: Preferences, project: ProjectConfiguration) {
  return { ...global, ...project.overrides }
}
export const settingCategories: Record<string, MessageKey> = {
  general: "settings.category.general",
  editor: "settings.category.editor",
  compile: "settings.category.compile",
  references: "settings.category.references",
  ai: "settings.category.ai",
}
export type SettingsCategory = keyof typeof settingCategories
export type SettingsScope = "global" | "project"
