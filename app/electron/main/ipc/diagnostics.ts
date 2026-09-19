import { BrowserWindow, dialog, ipcMain, shell } from "electron"
import { diagnostics } from "../diagnostics"
import type { MainServices } from "../runtime"
export function registerDiagnosticsIpc(services: Pick<MainServices, "handle">) {
  const { handle } = services
  handle("envoi:diagnostics-info", () => diagnostics.info())
  handle("envoi:diagnostics-open", async () => {
    const error = await shell.openPath(await diagnostics.open())
    if (error) throw Error("Unable to open log directory")
  })
  handle("envoi:diagnostics-export", async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    if (!owner) throw Error("Window unavailable")
    const result = await dialog.showSaveDialog(owner, {
      defaultPath: `Envoi-diagnostics-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "Diagnostic logs", extensions: ["json"] }],
    })
    if (result.canceled || !result.filePath) return false
    await diagnostics.export(result.filePath)
    return true
  })
  const limits = new WeakMap<Electron.WebContents, { start: number; count: number }>()
  ipcMain.on("envoi:diagnostics-log", (event, input: unknown) => {
    if (!BrowserWindow.fromWebContents(event.sender) || !input || typeof input !== "object") return
    const value = input as { level?: string; event?: string; error?: unknown }
    if (
      !["debug", "info", "warn", "error"].includes(value.level ?? "") ||
      !["renderer.error", "renderer.rejection", "react.error", "notification.shown"].includes(
        value.event ?? "",
      )
    )
      return
    let limit = limits.get(event.sender)
    if (!limit || Date.now() - limit.start > 60000) {
      limit = { start: Date.now(), count: 0 }
      limits.set(event.sender, limit)
    }
    if (++limit.count > 100) return
    diagnostics.write(value.level!, "renderer", value.event!, {}, value.error)
  })
}
