import { nativeMigrate, nativePut, nativeGet } from "@/lib/localData"
import { useEffect, useState, useRef, type ReactNode } from "react"
import { PreferencesContext } from "./context"
import { accents, themes, textFonts, normalizePreferences, type Preferences } from "./model"
import { translate } from "@/i18n/runtime"
const key = "envoi.preferences.v1",
  legacyKey = "paperdesk.preferences.v1"
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const edits = useRef(0)
  const revision = useRef<number | undefined>(undefined),
    writes = useRef(Promise.resolve())
  const [preferences, setPreferences] = useState(() => {
      let initial
      try {
        initial = normalizePreferences(
          JSON.parse(localStorage.getItem(key) ?? localStorage.getItem(legacyKey) ?? "null"),
        )
      } catch {
        initial = normalizePreferences(null)
      }
      document.documentElement.dataset.theme = initial.theme
      return initial
    }),
    [error, setError] = useState("")
  const initialPreferences = useRef(preferences)
  useEffect(() => {
    let active = true
    const version = edits.current
    writes.current = nativeMigrate("preferences", initialPreferences.current)
      .then((result) => {
        if (active) {
          revision.current = result.revision
          if (edits.current === version) setPreferences(normalizePreferences(result.value))
        }
      })
      .catch(() => {
        if (active) setError(translate("settings.preferences.serviceDisconnected"))
      })
    return () => {
      active = false
    }
  }, [])
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = preferences.theme
    const dark = themes[preferences.theme].mode === "dark"
    const accent = accents[preferences.accent],
      color = dark ? accent.hsl : accent.light,
      on = dark ? "240 6% 10%" : "0 0% 98%"
    for (const name of ["--primary", "--ring", "--sidebar-primary", "--sidebar-ring"])
      root.style.setProperty(name, color)
    for (const name of ["--primary-foreground", "--sidebar-primary-foreground"])
      root.style.setProperty(name, on)
  }, [preferences.theme, preferences.accent])
  useEffect(() => {
    const style = document.documentElement.style
    style.setProperty("--ui-font", textFonts[preferences.uiFontFamily].css)
    style.setProperty("--ui-font-size", `${preferences.uiFontSize}px`)
    style.setProperty("--ui-scale", String(preferences.uiFontSize / 13))
  }, [preferences.uiFontFamily, preferences.uiFontSize])
  const update = (patch: Partial<Preferences>) => {
    edits.current++
    const next = normalizePreferences({ ...preferences, ...patch })
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setError("")
    } catch {
      setError(translate("settings.preferences.browserStorageUnavailable"))
    }
    setPreferences(next)
    writes.current = writes.current
      .catch(() => {})
      .then(async () => {
        try {
          if (revision.current === undefined)
            revision.current = (await nativeGet("preferences"))?.revision ?? 0
          const result = await nativePut("preferences", next, "default", {
            expectedRevision: revision.current,
          })
          revision.current = result.revision
          setError("")
        } catch (error) {
          setError(
            translate("settings.preferences.nativeSaveFailed", { error: (error as Error).message }),
          )
        }
      })
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key || event.key === legacyKey) {
        void nativeGet("preferences")
          .then((result) => {
            if (result) {
              revision.current = result.revision
              setPreferences(normalizePreferences(result.value))
            }
          })
          .catch(() => setError(translate("settings.preferences.syncUnavailable")))
      }
    }
    window.addEventListener("storage", sync)
    return () => window.removeEventListener("storage", sync)
  }, [])
  return (
    <PreferencesContext.Provider value={{ preferences, update, error }}>
      {children}
    </PreferencesContext.Provider>
  )
}
