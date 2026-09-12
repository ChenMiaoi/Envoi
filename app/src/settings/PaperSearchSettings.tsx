import { useEffect, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { notify } from "@/lib/notifications"
import { useT } from "@/i18n/useT"
import { SettingsRow } from "./SettingsRow"
const field =
  "min-h-9 py-2 rounded-lg border border-input bg-background px-3 text-xs text-foreground"
const searchSources = [
  { id: "openalex", name: "OpenAlex" },
  { id: "semanticscholar", name: "Semantic Scholar" },
  { id: "crossref", name: "Crossref" },
  { id: "arxiv", name: "arXiv" },
] as const
type SourceId = (typeof searchSources)[number]["id"]
type SourceWeights = Record<SourceId, number>
const defaultWeights = (): SourceWeights => ({
  openalex: 1,
  semanticscholar: 1,
  crossref: 1,
  arxiv: 1,
})
export function PaperSearchSettings() {
  const { t } = useT()
  const [key, setKey] = useState(""),
    [email, setEmail] = useState(""),
    [weights, setWeights] = useState<SourceWeights>(defaultWeights),
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
        setWeights(config.sourceWeights)
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
        sourceWeights: weights,
      })
      setKey(config.semanticScholarKey)
      setEmail(config.contactEmail)
      setWeights(config.sourceWeights)
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
          <div className="mt-1 rounded-lg border border-border/70 p-3">
            <p className="text-xs font-medium">{t("settings.search.priorityTitle")}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {t("settings.search.priorityHint")}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {searchSources.map((source) => (
                <label key={source.id} className="flex items-center justify-between gap-3 text-xs">
                  <span>{source.name}</span>
                  <select
                    aria-label={t("settings.search.priorityAria", { source: source.name })}
                    className="min-h-8 rounded-md border border-input bg-background px-2 text-xs"
                    value={weights[source.id]}
                    onChange={(event) =>
                      setWeights((value) => ({
                        ...value,
                        [source.id]: Number(event.target.value),
                      }))
                    }
                  >
                    <option value={0}>{t("settings.search.priorityLow")}</option>
                    <option value={1}>{t("settings.search.priorityNormal")}</option>
                    <option value={2}>{t("settings.search.priorityHigh")}</option>
                    <option value={3}>{t("settings.search.priorityHighest")}</option>
                  </select>
                </label>
              ))}
            </div>
          </div>
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
