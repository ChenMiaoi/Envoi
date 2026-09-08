import { normalizeFont } from "./fonts"
import { migrateLegacyBindings, normalizeBindings } from "../navigation/shortcuts"
import { isLocaleId, type LocaleId } from "@/i18n/locales"
import type { MessageKey } from "@/i18n/messages/zh-CN"
export type Engine = "pdflatex" | "xelatex"
export type TextFont = string
export interface Preferences {
  version: 1
  language: LocaleId
  bindings: string[]
  uiFontFamily: TextFont
  uiFontSize: number
  previewFontFamily: TextFont
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
}
export interface ProjectConfiguration {
  version: 1
  overrides: { engine?: Engine; lintEnabled?: boolean; disabledRules?: number[] }
}
export const defaults: Preferences = {
  version: 1,
  language: "zh-CN",
  bindings: [],
  uiFontFamily: "system",
  uiFontSize: 13,
  previewFontFamily: "system",
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
    swatch: { bg: "#23272e", panel: "#2d333c" },
  },
  classic: { labelKey: "theme.classic", mode: "dark", swatch: { bg: "#18181b", panel: "#252526" } },
  midnight: {
    labelKey: "theme.midnight",
    mode: "dark",
    swatch: { bg: "#1a1e28", panel: "#262c3a" },
  },
  forest: { labelKey: "theme.forest", mode: "dark", swatch: { bg: "#1e231f", panel: "#293029" } },
  paper: { labelKey: "theme.paper", mode: "light", swatch: { bg: "#f7f5f1", panel: "#ece9e3" } },
  mist: { labelKey: "theme.mist", mode: "light", swatch: { bg: "#f2f4f7", panel: "#e6e9ee" } },
}
/** hsl 用于深色主题；浅色主题下改用 light 变体保证对比度。 */
export const accents = {
  lemon: { labelKey: "accent.lemon" as MessageKey, hsl: "57 62% 83%", light: "46 72.4% 28.4%" },
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
export function normalizePreferences(raw: unknown): Preferences {
  const value = raw && typeof raw === "object" ? (raw as Partial<Preferences>) : {}
  const legacy = "shortcuts" in value ? value.shortcuts : undefined
  return {
    version: 1,
    language: isLocaleId(value.language) ? value.language : defaults.language,
    bindings: normalizeBindings(
      Array.isArray(value.bindings) ? value.bindings : migrateLegacyBindings(legacy),
    ),
    uiFontFamily: normalizeFont(value.uiFontFamily, textFonts),
    uiFontSize: [12, 13, 14, 15, 16].includes(value.uiFontSize ?? 0) ? value.uiFontSize! : 13,
    previewFontFamily: normalizeFont(value.previewFontFamily, textFonts),
    previewFontSize: [12, 14, 16, 18, 20].includes(value.previewFontSize ?? 0)
      ? value.previewFontSize!
      : 14,
    theme: value.theme && value.theme in themes ? value.theme : defaults.theme,
    accent: value.accent && value.accent in accents ? value.accent : defaults.accent,
    fontSize:
      typeof value.fontSize === "number" && [11, 12.5, 14, 16, 18].includes(value.fontSize)
        ? value.fontSize
        : defaults.fontSize,
    fontFamily: normalizeFont(value.fontFamily, editorFonts),
    lineHeight: [1.5, 1.75, 2].includes(value.lineHeight ?? 0) ? value.lineHeight! : 1.75,
    tabSize: [2, 4, 8].includes(value.tabSize ?? 0) ? value.tabSize! : 4,
    disabledRules: normalizeRules(value.disabledRules),
    engine: value.engine === "xelatex" ? "xelatex" : "pdflatex",
    lintEnabled: typeof value.lintEnabled === "boolean" ? value.lintEnabled : defaults.lintEnabled,
    defaultGit: typeof value.defaultGit === "boolean" ? value.defaultGit : defaults.defaultGit,
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
