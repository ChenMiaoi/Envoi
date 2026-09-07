import { useState } from "react"
import { envoi } from "@/lib/desktop"
import { notify } from "@/lib/notifications"
import { useT } from "@/i18n/useT"
import { SettingsRow } from "./SettingsRow"

export function DiagnosticsSettings() {
  const { t } = useT()
  const [busy, setBusy] = useState(false)
  async function run(exportLogs: boolean) {
    setBusy(true)
    try {
      if (exportLogs) {
        if (await envoi().diagnosticsExport()) notify(t("settings.logs.exported"), "success")
      } else await envoi().diagnosticsOpen()
    } catch {
      notify(t("settings.logs.failed"), "error")
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-5 rounded-xl border border-border bg-card px-5">
      <SettingsRow label={t("settings.logs.title")}>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="min-h-9 rounded-lg border border-input px-3 py-2 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(false)}
          >
            {t("settings.logs.open")}
          </button>
          <button
            className="min-h-9 rounded-lg border border-input px-3 py-2 text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => void run(true)}
          >
            {t("settings.logs.export")}
          </button>
        </div>
      </SettingsRow>
    </div>
  )
}
