import { app, shell } from "electron"
import electronUpdater from "electron-updater"
import type { MainServices } from "../runtime"
import { checkUpdate, downloadReleaseInstaller } from "../updates.mjs"
export function registerUpdatesIpc(services: Pick<MainServices, "handle">) {
  const { handle } = services
  let updateInstaller: Awaited<ReturnType<typeof checkUpdate>>["installer"] = null
  let pendingUpdateDownload: Promise<{ path: string }> | undefined
  let downloadedUpdatePath: string | undefined
  let restartUpdateReady = false
  let updateSupportsRestart = false
  let checkedUpdate: { channel: "stable" | "preview"; latestVersion: string } | undefined
  const { autoUpdater } = electronUpdater
  autoUpdater.autoDownload = false
  handle("envoi:app-version", () => app.getVersion())
  handle("envoi:check-update", async (_event, channel: "stable" | "preview" = "stable") => {
    updateInstaller = null
    downloadedUpdatePath = undefined
    restartUpdateReady = false
    updateSupportsRestart = false
    checkedUpdate = undefined
    const result = await checkUpdate(app.getVersion(), fetch, { channel })
    updateInstaller = result.installer ?? null
    updateSupportsRestart = !!result.restartAvailable && app.isPackaged
    if (updateInstaller && result.latestVersion)
      checkedUpdate = { channel, latestVersion: result.latestVersion }
    return {
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      status: result.status,
      downloadAvailable: result.downloadAvailable ?? false,
      prerelease: result.prerelease ?? false,
      restartAvailable: updateSupportsRestart,
    }
  })
  handle("envoi:download-update", async () => {
    if (!updateInstaller) throw Error("No compatible update installer; check for updates first")
    if (updateSupportsRestart) {
      autoUpdater.allowPrerelease = /-rc\d+$/.test(updateInstaller.name)
      autoUpdater.allowDowngrade = autoUpdater.allowPrerelease
      const result = await autoUpdater.checkForUpdates()
      if (!result || !updateInstaller.name.includes(`.${result.updateInfo.version}.`))
        throw Error("Update metadata does not match the selected release")
      await autoUpdater.downloadUpdate()
      restartUpdateReady = true
      return { restartAvailable: true }
    }
    pendingUpdateDownload ??= downloadReleaseInstaller(updateInstaller, app.getPath("downloads"))
      .then((file: string) => {
        downloadedUpdatePath = file
        return { path: file }
      })
      .finally(() => {
        pendingUpdateDownload = undefined
      })
    return pendingUpdateDownload
  })
  handle("envoi:open-downloaded-update", async () => {
    if (!downloadedUpdatePath) throw Error("Download an update first")
    const error = await shell.openPath(downloadedUpdatePath)
    if (error) throw Error(error)
  })
  handle("envoi:restart-update", () => {
    if (!restartUpdateReady) throw Error("Download an update first")
    autoUpdater.quitAndInstall(false, true)
  })
  handle("envoi:update-state", () => ({
    ...checkedUpdate,
    downloaded: restartUpdateReady || !!downloadedUpdatePath,
    restartAvailable: restartUpdateReady,
  }))
}
