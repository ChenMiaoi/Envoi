import { translate } from "@/i18n/runtime"
export type Scope = "global" | "reader" | "writer"
export type ViewTarget = "reader" | "writer" | "library" | "history" | "settings"
export interface Chord {
  mod: boolean
  shift: boolean
  alt: boolean
  key: string
}
export interface Command {
  id: string
  /** canonical action text stored after `=` in a binding line, e.g. "view reader" */
  action: string
  label: string
  scope: Scope
  event?: string
  detail?: string
  view?: ViewTarget
}
export const commands: Command[] = [
  {
    id: "save",
    action: "save",
    get label() {
      return translate("command.save")
    },
    scope: "global",
    event: "envoi:save",
  },
  {
    id: "palette",
    action: "palette",
    get label() {
      return translate("command.palette")
    },
    scope: "global",
  },
  {
    id: "view-reader",
    action: "view reader",
    get label() {
      return translate("command.view-reader")
    },
    scope: "global",
    view: "reader",
  },
  {
    id: "view-writer",
    action: "view writer",
    get label() {
      return translate("command.view-writer")
    },
    scope: "global",
    view: "writer",
  },
  {
    id: "view-library",
    action: "view library",
    get label() {
      return translate("command.view-library")
    },
    scope: "global",
    view: "library",
  },
  {
    id: "view-history",
    action: "view history",
    get label() {
      return translate("command.view-history")
    },
    scope: "global",
    view: "history",
  },
  {
    id: "view-settings",
    action: "view settings",
    get label() {
      return translate("command.view-settings")
    },
    scope: "global",
    view: "settings",
  },
  {
    id: "project-open",
    action: "project open",
    get label() {
      return translate("command.project-open")
    },
    scope: "global",
    event: "envoi:open-project",
  },
  {
    id: "project-manage",
    action: "project manage",
    get label() {
      return translate("command.project-manage")
    },
    scope: "global",
    event: "envoi:manage-projects",
  },
  {
    id: "project-close",
    action: "project close",
    get label() {
      return translate("command.project-close")
    },
    scope: "global",
    event: "envoi:close-project",
  },
  {
    id: "git",
    action: "git",
    get label() {
      return translate("command.git")
    },
    scope: "global",
    event: "envoi:show-git",
  },
  {
    id: "compile",
    action: "compile",
    get label() {
      return translate("command.compile")
    },
    scope: "global",
    event: "envoi:compile",
  },
  {
    id: "tab-close",
    action: "tab close",
    get label() {
      return translate("command.tab-close")
    },
    scope: "reader",
    event: "envoi:tab",
    detail: "close",
  },
  {
    id: "tab-prev",
    action: "tab prev",
    get label() {
      return translate("command.tab-prev")
    },
    scope: "reader",
    event: "envoi:tab",
    detail: "prev",
  },
  {
    id: "tab-next",
    action: "tab next",
    get label() {
      return translate("command.tab-next")
    },
    scope: "reader",
    event: "envoi:tab",
    detail: "next",
  },
  {
    id: "panel-tree",
    action: "panel tree",
    get label() {
      return translate("command.panel-tree")
    },
    scope: "reader",
    event: "envoi:panel",
    detail: "tree",
  },
  {
    id: "panel-chat",
    action: "panel chat",
    get label() {
      return translate("command.panel-chat")
    },
    scope: "reader",
    event: "envoi:panel",
    detail: "chat",
  },
  {
    id: "panel-outline",
    action: "panel outline",
    get label() {
      return translate("command.panel-outline")
    },
    scope: "writer",
    event: "envoi:panel",
    detail: "outline",
  },
  {
    id: "panel-refs",
    action: "panel refs",
    get label() {
      return translate("command.panel-refs")
    },
    scope: "writer",
    event: "envoi:panel",
    detail: "refs",
  },
  {
    id: "panel-assets",
    action: "panel assets",
    get label() {
      return translate("command.panel-assets")
    },
    scope: "writer",
    event: "envoi:panel",
    detail: "assets",
  },
]
// Modifier layering: Mod+Shift switches pages, Mod+Alt acts inside the current page, bare Mod keeps save/palette.
export const DEFAULT_BINDS = [
  "mod+s = save",
  "mod+k = palette",
  "mod+shift+1 = view reader",
  "mod+shift+2 = view writer",
  "mod+shift+3 = view library",
  "mod+shift+4 = view settings",
  "mod+shift+5 = view history",
  "mod+alt+o = project open",
  "mod+alt+g = git",
  "mod+alt+enter = compile",
  "mod+alt+w = tab close",
  "mod+alt+left = tab prev",
  "mod+alt+right = tab next",
  "mod+alt+e = panel tree",
  "mod+alt+a = panel chat",
  "mod+alt+1 = panel outline",
  "mod+alt+2 = panel refs",
  "mod+alt+3 = panel assets",
]
const byAction = new Map(commands.map((command) => [command.action, command]))
const MOD_ALIASES: Record<string, "mod" | "shift" | "alt"> = {
  mod: "mod",
  ctrl: "mod",
  control: "mod",
  cmd: "mod",
  meta: "mod",
  super: "mod",
  shift: "shift",
  alt: "alt",
  option: "alt",
}
const NAMED_KEYS = new Set([
  "enter",
  "escape",
  "tab",
  "space",
  "backspace",
  "delete",
  "left",
  "right",
  "up",
  "down",
  "home",
  "end",
  "pageup",
  "pagedown",
  ...Array.from({ length: 12 }, (_, index) => `f${index + 1}`),
])
const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  return: "enter",
  arrowleft: "left",
  arrowright: "right",
  arrowup: "up",
  arrowdown: "down",
  " ": "space",
}
export function parseChord(text: string): Chord | undefined {
  const chord: Chord = { mod: false, shift: false, alt: false, key: "" }
  for (const token of text
    .trim()
    .toLowerCase()
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)) {
    const modifier = MOD_ALIASES[token]
    if (modifier) {
      chord[modifier] = true
      continue
    }
    if (chord.key) return undefined
    const key = KEY_ALIASES[token] ?? token
    if (!/^[a-z0-9]$/.test(key) && !NAMED_KEYS.has(key)) return undefined
    chord.key = key
  }
  return chord.key ? chord : undefined
}
export function serializeChord(chord: Chord) {
  return [chord.mod ? "mod" : "", chord.shift ? "shift" : "", chord.alt ? "alt" : "", chord.key]
    .filter(Boolean)
    .join("+")
}
export function parseBinding(line: unknown): { command: Command; chord: Chord } | undefined {
  if (typeof line !== "string") return undefined
  const split = line.indexOf("=")
  if (split < 0) return undefined
  const chord = parseChord(line.slice(0, split))
  if (!chord) return undefined
  const command = byAction.get(
    line
      .slice(split + 1)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " "),
  )
  return command ? { command, chord } : undefined
}
export function serializeBinding(command: Command, chord: Chord) {
  return `${serializeChord(chord)} = ${command.action}`
}
const RESERVED_F = new Set(["f4", "f5", "f11", "f12"])
const RESERVED_LETTERS = "wtnrlqpjhufacvxzy0"
export function validateChord(chord: Chord, bindings: string[], exclude?: string): string {
  if (!chord.mod && !chord.shift && !chord.alt) return translate("shortcuts.noModifier")
  if (
    RESERVED_F.has(chord.key) ||
    (chord.mod && !chord.alt && chord.key.length === 1 && RESERVED_LETTERS.includes(chord.key))
  )
    return translate("shortcuts.reserved")
  const mine = serializeChord(chord)
  for (const line of bindings) {
    const parsed = parseBinding(line)
    if (parsed && parsed.command.id !== exclude && serializeChord(parsed.chord) === mine)
      return translate("shortcuts.conflict", { label: parsed.command.label })
  }
  return ""
}
export function normalizeBindings(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const line of raw) {
    const parsed = parseBinding(line)
    if (!parsed || validateChord(parsed.chord, result)) continue
    if (result.some((existing) => parseBinding(existing)?.command.id === parsed.command.id))
      continue
    result.push(serializeBinding(parsed.command, parsed.chord))
  }
  return result
}
/** An empty list means "factory defaults"; any saved list replaces the whole table. */
export function resolveBindings(bindings: string[]) {
  return bindings.length ? bindings : DEFAULT_BINDS
}
export function eventChord(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
): Chord | undefined {
  let key = ""
  const letter = /^Key([A-Z])$/.exec(event.code),
    digit = /^Digit([0-9])$/.exec(event.code)
  if (letter) key = letter[1].toLowerCase()
  else if (digit) key = digit[1]
  else {
    const named = KEY_ALIASES[event.key.toLowerCase()] ?? event.key.toLowerCase()
    if (!/^[a-z0-9]$/.test(named) && !NAMED_KEYS.has(named)) return undefined
    key = named
  }
  return { mod: event.ctrlKey || event.metaKey, shift: event.shiftKey, alt: event.altKey, key }
}
export function matchBinding(
  event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">,
  bindings: string[],
): Command | undefined {
  const chord = eventChord(event)
  if (!chord) return undefined
  const mine = serializeChord(chord)
  for (const line of bindings) {
    const parsed = parseBinding(line)
    if (parsed && serializeChord(parsed.chord) === mine) return parsed.command
  }
  return undefined
}
export function commandChord(commandId: string, bindings: string[]): Chord | undefined {
  for (const line of bindings) {
    const parsed = parseBinding(line)
    if (parsed && parsed.command.id === commandId) return parsed.chord
  }
  return undefined
}
const KEY_DISPLAY: Record<string, string> = {
  enter: "Enter",
  escape: "Esc",
  tab: "Tab",
  space: "Space",
  backspace: "⌫",
  delete: "Del",
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
}
export function chordLabel(chord: Chord, mac: boolean) {
  return [
    chord.mod ? (mac ? "⌘" : "Ctrl") : "",
    chord.shift ? (mac ? "⇧" : "Shift") : "",
    chord.alt ? (mac ? "⌥" : "Alt") : "",
    KEY_DISPLAY[chord.key] ?? chord.key.toUpperCase(),
  ]
    .filter(Boolean)
    .join("+")
}
export function commandChordLabel(commandId: string, bindings: string[], mac: boolean) {
  const chord = commandChord(commandId, bindings)
  return chord ? chordLabel(chord, mac) : ""
}
const LEGACY_IDS: Record<string, string> = {
  save: "save",
  commands: "palette",
  reader: "view-reader",
  writer: "view-writer",
  open: "project-open",
  compile: "compile",
}
/** Pre-DSL preferences stored per-command {key,shift,alt} overrides (Mod implied); migrate onto the default table. */
export function migrateLegacyBindings(raw: unknown): string[] | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const legacy = raw as Record<string, { key?: unknown; shift?: unknown; alt?: unknown }>
  if (!Object.keys(legacy).some((id) => id in LEGACY_IDS)) return undefined
  const result: string[] = []
  for (const line of DEFAULT_BINDS) {
    const parsed = parseBinding(line)!
    let chord = parsed.chord
    const legacyId = Object.keys(LEGACY_IDS).find((id) => LEGACY_IDS[id] === parsed.command.id)
    const candidate = legacyId ? legacy[legacyId] : undefined
    if (
      candidate &&
      typeof candidate.key === "string" &&
      typeof candidate.shift === "boolean" &&
      typeof candidate.alt === "boolean"
    ) {
      const mapped = parseChord(
        ["mod", candidate.shift ? "shift" : "", candidate.alt ? "alt" : "", candidate.key]
          .filter(Boolean)
          .join("+"),
      )
      if (mapped) chord = mapped
    }
    if (validateChord(chord, result)) continue
    result.push(serializeBinding(parsed.command, chord))
  }
  return result
}
