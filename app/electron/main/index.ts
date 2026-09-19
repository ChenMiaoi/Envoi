import { BrowserWindow, Menu, app, dialog, protocol, shell } from "electron"
import path from "node:path"
import { diagnostics } from "./diagnostics"
import { registerAgentIpc } from "./ipc/agent"
import { registerDataIpc } from "./ipc/data"
import { registerDiagnosticsIpc } from "./ipc/diagnostics"
import { registerFilesIpc } from "./ipc/files"
import { registerLanguageIpc } from "./ipc/language"
import { registerProjectsIpc } from "./ipc/projects"
import { registerResearchIpc } from "./ipc/research"
import { registerToolsIpc } from "./ipc/tools"
import { registerUpdatesIpc } from "./ipc/updates"
import { registerRemoteIpc } from "./ipc/remote"
import { createMainServices } from "./runtime"
const services = createMainServices()
const { handleAsset, backends, lspService, sessions, setupPaperBrowse } = services
// ── 窗口 ──

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Envoi",
    show: process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1",
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 16, y: 14 } }
      : {}),
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: { color: "#23272e", symbolColor: "#c8cdd5", height: 40 },
        }
      : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1",
    },
  })
  window.webContents.on("render-process-gone", (_event, details) =>
    diagnostics.write("error", "renderer", "process.gone", {
      reason: details.reason,
      exitCode: details.exitCode,
    }),
  )
  const owner = window.webContents.id
  window.webContents.once("destroyed", () => {
    services.remote.disconnect(owner)
    sessions.close(owner)
    for (const backend of backends) void backend.cancel(owner).catch(() => {})
  })
  window.webContents.on("will-prevent-unload", (event) => {
    const response = dialog.showMessageBoxSync(window, {
      type: "question",
      message: "当前项目有未保存的更改",
      detail: "返回编辑器保存，或放弃未保存的更改并退出。",
      buttons: ["返回编辑器", "不保存并退出"],
      defaultId: 0,
      cancelId: 0,
    })
    if (response === 1) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: "deny" }
  })
  window.webContents.on("will-navigate", (event, url) => {
    const current = window.webContents.getURL().split("#")[0]
    if (url.split("#")[0] !== current) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"))
}
void app.whenReady().then(() => {
  if (process.platform !== "darwin") Menu.setApplicationMenu(null)
  protocol.handle("envoi", handleAsset)
  setupPaperBrowse()
  registerRemoteIpc(services)
  registerLanguageIpc(services)
  registerDiagnosticsIpc(services)
  registerUpdatesIpc(services)
  registerResearchIpc(services)
  registerProjectsIpc(services)
  registerToolsIpc(services)
  registerDataIpc(services)
  registerAgentIpc(services)
  registerFilesIpc(services)
  diagnostics.write("info", "main", "app.started")
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cleanedUp = false
app.on("will-quit", (event) => {
  if (cleanedUp) return
  event.preventDefault()
  for (const window of BrowserWindow.getAllWindows()) {
    services.remote.disconnect(window.webContents.id)
    lspService.dispose(window.webContents.id)
  }
  const owners = new Set([...services.remote.entries.values()].map((entry) => entry.owner))
  void Promise.allSettled([
    ...backends.map((backend) => backend.dispose()),
    ...[...owners].map((owner) => services.remote.disconnect(owner)),
  ]).then(() => {
    diagnostics.write("info", "main", "app.stopped")
    cleanedUp = true
    app.quit()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

process.on("uncaughtExceptionMonitor", (error) =>
  diagnostics.write("error", "main", "uncaught.exception", {}, error),
)
