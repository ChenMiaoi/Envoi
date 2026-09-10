import { useEffect, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"
import { SettingsRow } from "./SettingsRow"
import { notify } from "@/lib/notifications"

export function UpdateSettings() {
  const { t } = useT()
  const [version, setVersion] = useState("—")
  const [status, setStatus] = useState<"idle" | "inaccessible" | "available" | "current">("idle")
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => envoi().appVersion())
      .then((value) => {
        if (active) setVersion(value)
      })
      .catch((error) => {
        if (active) notify(ipcError(error).message, "error", "app-version")
      })
    return () => {
      active = false
    }
  }, [])
  async function run(download = false) {
    setBusy(true)
    try {
      if (download) await envoi().downloadUpdate()
      else {
        setStatus("idle")
        const result = await envoi().checkUpdate()
        setVersion(result.currentVersion)
        setStatus(result.status)
        notify(
          `${t(`settings.update.${result.status}`)}${result.status === "available" ? ` ${result.latestVersion}` : ""}`,
          result.status === "inaccessible"
            ? "warning"
            : result.status === "current"
              ? "success"
              : "info",
          "app-update",
        )
      }
    } catch (error) {
      notify(`${t("settings.update.error")}: ${ipcError(error).message}`, "error", "app-update")
    } finally {
      setBusy(false)
    }
  }
  const button = "min-h-9 rounded-lg border border-input px-3 py-2 text-xs disabled:opacity-50"
  return (
    <div className="mt-5 rounded-xl border border-border bg-card px-5">
      <SettingsRow label={t("settings.update.title")}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs">{version}</span>
          <button className={button} disabled={busy} onClick={() => void run()}>
            {t(busy ? "settings.update.busy" : "settings.update.check")}
          </button>
          {status === "available" && (
            <button
              className={button + " bg-primary text-primary-foreground"}
              disabled={busy}
              onClick={() => void run(true)}
            >
              {t("settings.update.download")}
            </button>
          )}
        </div>
      </SettingsRow>
    </div>
  )
}
