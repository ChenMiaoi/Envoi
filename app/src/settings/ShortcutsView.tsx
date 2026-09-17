import { Notification } from "@/components/Notification"
import { useState } from "react"
import { Link } from "react-router"
import { usePreferences } from "./context"
import {
  commands,
  DEFAULT_BINDS,
  parseBinding,
  serializeBinding,
  commandChord,
  chordLabel,
  validateChord,
  eventChord,
  resolveBindings,
  type Chord,
  type Command,
  type Scope,
} from "@/navigation/shortcuts"
import { useT } from "@/i18n/useT"

export function ShortcutsView() {
  const { preferences, update, error } = usePreferences()
  const { t } = useT()
  const scopeNames: Record<Scope, string> = {
    global: t("settings.shortcuts.scopeGlobal"),
    reader: t("command.view-reader"),
    writer: t("command.view-writer"),
  }
  const [query, setQuery] = useState("")
  const [scope, setScope] = useState("")
  const [recording, setRecording] = useState<string | null>(null)
  const [message, setMessage] = useState("")
  const mac = /Mac|iPhone|iPad/.test(navigator.platform)
  const bindings = resolveBindings(preferences.bindings)
  const without = (command: Command) =>
    bindings.filter((line) => parseBinding(line)?.command.id !== command.id)
  const save = (command: Command, chord: Chord) => {
    const next = without(command)
    const invalid = validateChord(chord, next)
    if (invalid) {
      setMessage(invalid)
      return
    }
    update({ bindings: [...next, serializeBinding(command, chord)] })
    setRecording(null)
    setMessage(t("settings.shortcuts.saved"))
  }
  const reset = (command: Command) => {
    const next = without(command)
    const fallback = DEFAULT_BINDS.find((line) => parseBinding(line)?.command.id === command.id)
    if (!fallback) {
      update({ bindings: next })
      setMessage(t("settings.shortcuts.resetNoDefault"))
      return
    }
    const invalid = validateChord(parseBinding(fallback)!.chord, next)
    if (invalid) {
      setMessage(t("settings.shortcuts.defaultConflict", { reason: invalid }))
      return
    }
    update({ bindings: [...next, fallback] })
    setMessage(t("settings.shortcuts.resetDone"))
  }
  const visible = commands.filter(
    (item) => (!scope || item.scope === scope) && item.label.includes(query),
  )
  return (
    <div className="h-full p-1.5">
      <div className="workspace-pane h-full overflow-auto bg-background p-7">
        <div className="mx-auto max-w-3xl">
          <Link className="text-xs text-primary" to="/settings/global/general">
            {t("settings.shortcuts.back")}
          </Link>
          <h1 className="mt-4 text-xl font-semibold">{t("settings.general.shortcuts")}</h1>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("settings.shortcuts.description")}
          </p>
          <div className="my-5 flex gap-3">
            <input
              aria-label={t("settings.shortcuts.searchAria")}
              placeholder={t("settings.shortcuts.searchPlaceholder")}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="min-w-0 flex-1 rounded border border-input bg-card p-2 text-xs"
            />
            <select
              aria-label={t("settings.shortcuts.scopeAria")}
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="rounded border border-input bg-card p-2 text-xs"
            >
              <option value="">{t("settings.shortcuts.allScopes")}</option>
              {(Object.keys(scopeNames) as Scope[]).map((name) => (
                <option key={name} value={name}>
                  {scopeNames[name]}
                </option>
              ))}
            </select>
            <button
              className="text-xs text-primary"
              onClick={() => {
                update({ bindings: [] })
                setRecording(null)
                setMessage(t("settings.shortcuts.allReset"))
              }}
            >
              {t("settings.shortcuts.resetAll")}
            </button>
          </div>
          <Notification message={error || message} kind={error ? "error" : "success"} />
          <div className="rounded-xl border border-border bg-card px-5">
            {visible.map((item) => {
              const chord = commandChord(item.id, bindings)
              return (
                <div
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4 last:border-0"
                >
                  <div>
                    <h2 className="text-sm">{item.label}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {scopeNames[item.scope]} · {item.action}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    {recording === item.id ? (
                      <input
                        data-shortcut-recorder
                        autoFocus
                        readOnly
                        aria-label={t("settings.shortcuts.recordAria", { label: item.label })}
                        placeholder={t("settings.shortcuts.recordPlaceholder")}
                        className="w-52 rounded border border-primary bg-background p-2 text-xs"
                        onKeyDown={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          if (event.key === "Escape") {
                            setRecording(null)
                            return
                          }
                          if (["Control", "Meta", "Shift", "Alt"].includes(event.key)) return
                          const next = eventChord(event)
                          if (next) save(item, next)
                        }}
                      />
                    ) : (
                      <button
                        className="rounded border border-border px-3 py-2 text-xs"
                        aria-label={t("settings.shortcuts.modifyAria", { label: item.label })}
                        onClick={() => {
                          setMessage("")
                          setRecording(item.id)
                        }}
                      >
                        <kbd>
                          {chord ? chordLabel(chord, mac) : t("settings.shortcuts.unbound")}
                        </kbd>
                      </button>
                    )}
                    <button className="text-xs text-muted-foreground" onClick={() => reset(item)}>
                      {t("settings.shortcuts.reset")}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
