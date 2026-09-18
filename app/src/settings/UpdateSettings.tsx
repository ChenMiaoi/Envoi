import { useEffect, useState } from "react"
import { envoi, ipcError } from "@/lib/desktop"
import { useT } from "@/i18n/useT"
import { SettingsRow } from "./SettingsRow"
import { notify } from "@/lib/notifications"

export function UpdateSettings() {
  const { t } = useT()
  const [version, setVersion] = useState("—")
  const [channel, setChannel] = useState<"stable" | "preview">("stable")
  const [status, setStatus] = useState<
    "idle" | "inaccessible" | "available" | "current" | "unpublished"
  >("idle")
  const [latestVersion, setLatestVersion] = useState<string>()
  const [downloadAvailable, setDownloadAvailable] = useState(false)
  const [restartAvailable, setRestartAvailable] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [downloading, setDownloading] = useState(false)
  useEffect(() => {
    let active = true
    void Promise.resolve()
      .then(() => Promise.all([envoi().appVersion(), envoi().updateState()]))
      .then(([value, update]) => {
        if (!active) return
        setVersion(value)
        if (update.downloaded && update.latestVersion) {
          setChannel(update.channel ?? "stable")
          setStatus("available")
          setLatestVersion(update.latestVersion)
          setDownloadAvailable(true)
          setRestartAvailable(update.restartAvailable)
          setDownloaded(true)
        }
      })
      .catch((error) => {
        if (active) notify(ipcError(error).message, "error", "app-version")
      })
    return () => {
      active = false
    }
  }, [])
  async function run(action: "check" | "download" | "open" | "restart" = "check") {
    setBusy(true)
    setDownloading(action === "download")
    try {
      if (action === "restart") {
        await envoi().restartUpdate()
      } else if (action === "open") {
        await envoi().openDownloadedUpdate()
      } else if (action === "download") {
        const result = await envoi().downloadUpdate()
        setDownloaded(true)
        notify(
          result.restartAvailable
            ? t("settings.update.readyToRestart")
            : `${t("settings.update.downloaded")} ${result.path}`,
          "success",
          "app-update",
        )
      } else {
        setStatus("idle")
        setDownloadAvailable(false)
        setDownloaded(false)
        const result = await envoi().checkUpdate(channel)
        setVersion(result.currentVersion)
        setStatus(result.status)
        setLatestVersion(result.latestVersion)
        setDownloadAvailable(result.downloadAvailable)
        setRestartAvailable(result.restartAvailable)
        notify(
          result.status === "unpublished"
            ? t("settings.update.noPreview")
            : result.status === "available" && !result.downloadAvailable
              ? t("settings.update.noInstaller")
              : `${t(result.prerelease && result.status === "available" ? "settings.update.previewAvailable" : `settings.update.${result.status}`)}${result.status === "available" ? ` ${result.latestVersion}` : ""}`,
          result.status === "inaccessible" ||
            result.status === "unpublished" ||
            (result.status === "available" && !result.downloadAvailable)
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
      setDownloading(false)
    }
  }
  const button = "min-h-9 rounded-lg border border-input px-3 py-2 text-xs disabled:opacity-50"
  return (
    <div className="mt-5 rounded-xl border border-border bg-card px-5">
      <SettingsRow label={t("settings.update.title")}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-xs">{version}</span>
          <select
            aria-label={t("settings.update.channel")}
            className="min-h-9 rounded-lg border border-input bg-background px-2 text-xs"
            value={channel}
            disabled={busy}
            onChange={(event) => {
              setChannel(event.target.value as "stable" | "preview")
              setStatus("idle")
              setLatestVersion(undefined)
              setDownloadAvailable(false)
              setRestartAvailable(false)
              setDownloaded(false)
            }}
          >
            <option value="stable">{t("settings.update.stable")}</option>
            <option value="preview">{t("settings.update.preview")}</option>
          </select>
          <button className={button} disabled={busy} onClick={() => void run()}>
            {t(busy ? "settings.update.busy" : "settings.update.check")}
          </button>
          {status === "available" && downloadAvailable && (
            <span className="text-xs text-muted-foreground">v{latestVersion}</span>
          )}
          {status === "available" && downloadAvailable && !downloaded && (
            <button
              className={button + " bg-primary text-primary-foreground"}
              disabled={busy}
              onClick={() => void run("download")}
            >
              {t(
                downloading
                  ? "settings.update.downloading"
                  : channel === "preview"
                    ? "settings.update.downloadPreview"
                    : "settings.update.download",
              )}
            </button>
          )}
          {downloaded && (
            <button
              className={button + " bg-primary text-primary-foreground"}
              disabled={busy}
              onClick={() => void run(restartAvailable ? "restart" : "open")}
            >
              {t(restartAvailable ? "settings.update.restart" : "settings.update.openInstaller")}
            </button>
          )}
        </div>
      </SettingsRow>
    </div>
  )
}
