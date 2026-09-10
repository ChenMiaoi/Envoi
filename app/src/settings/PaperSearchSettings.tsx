import { useEffect, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { notify } from "@/lib/notifications"
import { useT } from "@/i18n/useT"
import { SettingsRow } from "./SettingsRow"
const field =
  "min-h-9 py-2 rounded-lg border border-input bg-background px-3 text-xs text-foreground"
export function PaperSearchSettings() {
  const { t } = useT()
  const [key, setKey] = useState(""),
    [email, setEmail] = useState(""),
    [loaded, setLoaded] = useState(false),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void envoi()
      .paperSearchConfig()
      .then((config) => {
        if (!active) return
        setKey(config.semanticScholarKey)
        setEmail(config.contactEmail)
        setLoaded(true)
      })
      .catch((error) => notify(ipcError(error).message, "error", "paper-search-settings"))
    return () => {
      active = false
    }
  }, [])
  const save = async () => {
    setBusy(true)
    try {
      const config = await envoi().configurePaperSearch({
        semanticScholarKey: key,
        contactEmail: email,
      })
      setKey(config.semanticScholarKey)
      setEmail(config.contactEmail)
      notify(t("settings.search.saved"), "success", "paper-search-settings")
    } catch (error) {
      notify(ipcError(error).message, "error", "paper-search-settings")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div
      className="mt-5 rounded-xl border border-border bg-card px-5"
      data-testid="paper-search-settings"
    >
      <SettingsRow label={t("settings.search.title")} hint={t("settings.search.hint")}>
        <span />
      </SettingsRow>
      {loaded && (
        <div className="flex flex-col gap-2 pb-4">
          <input
            aria-label={t("settings.search.keyAria")}
            type="password"
            autoComplete="off"
            placeholder={t("settings.search.keyPlaceholder")}
            value={key}
            onChange={(event) => setKey(event.target.value)}
            className={field}
          />
          <input
            aria-label={t("settings.search.emailAria")}
            type="email"
            autoComplete="off"
            placeholder={t("settings.search.emailPlaceholder")}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={field}
          />
          <div className="flex justify-end">
            <button
              className="min-h-9 rounded-lg border border-input px-3 py-2 text-xs disabled:opacity-50"
              disabled={busy}
              onClick={() => void save()}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
