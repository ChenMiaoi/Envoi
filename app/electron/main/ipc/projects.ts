import { BrowserWindow, app, dialog } from "electron"
import { realpath } from "node:fs/promises"
import path from "node:path"
import { dataDir, registerProject } from "../../../server/local-data.mjs"
import { createExampleProject } from "../example-project.mjs"
import { restrictedPath } from "../restricted-path.mjs"
import type { MainServices } from "../runtime"
export function registerProjectsIpc(
  services: Pick<
    MainServices,
    "workspaceTrust" | "requireOpenRoot" | "backends" | "handle" | "sessions"
  >,
) {
  const { workspaceTrust, requireOpenRoot, backends, handle, sessions } = services
  handle("envoi:window-colors", (event, colors: { color: string; symbolColor: string }) => {
    if (
      !colors ||
      !/^#[\da-f]{6}$/i.test(colors.color) ||
      !/^#[\da-f]{6}$/i.test(colors.symbolColor)
    )
      throw Error("Invalid window colors")
    if (process.platform === "win32")
      BrowserWindow.fromWebContents(event.sender)?.setTitleBarOverlay({ ...colors, height: 40 })
  })
  handle("envoi:example-directory", () =>
    createExampleProject({
      source: app.isPackaged
        ? path.join(process.resourcesPath, "demo")
        : path.resolve(import.meta.dirname, "../../../examples/demo"),
      dataDirectory: dataDir,
    }),
  )

  handle("envoi:pick-directory", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, {
      properties: ["openDirectory", "createDirectory"],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle("envoi:bind-project", async (event, directory: string, opts?: { copy?: boolean }) => {
    const root = await workspaceTrust.open(directory)
    const trusted = await workspaceTrust.isTrusted(root)
    let ignoreConfig = false
    if (!trusted) {
      for (const rel of [".envoi/project.json", ".paperdesk/project.json", "paperdesk.json"]) {
        try {
          await restrictedPath(root, rel)
        } catch {
          ignoreConfig = true
        }
      }
    }
    const project = await registerProject(root, {
      copy: opts?.copy ?? false,
      readOnly: !trusted,
      ignoreConfig,
    })
    sessions.bindProject(event.sender.id, project.id, root)
    return { ok: true, project: { id: project.id, path: root, name: project.name } }
  })

  handle("envoi:canonical-directory", (_event, directory: string) => {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw Error("需要绝对目录路径")
    return realpath(directory)
  })
  handle("envoi:trust-directory", async (_event, directory: string) => {
    const root = await workspaceTrust.open(directory)
    sessions.bindRoot(root)
    return root
  })
  handle("envoi:project-trust", (_event, root: string) => workspaceTrust.status(root))
  const broadcastTrust = () => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send("envoi:trust-changed")
  }
  handle("envoi:grant-project-trust", async (_event, directory: string) => {
    const root = await requireOpenRoot(directory)
    await workspaceTrust.trust(root)
    broadcastTrust()
    return workspaceTrust.status(root)
  })
  handle("envoi:restrict-project", async (_event, directory: string) => {
    const root = await workspaceTrust.restrict(directory)
    const affected = sessions.restrict(root)
    await Promise.all(
      affected.flatMap((candidate) =>
        backends.map((backend) => backend.cancel(undefined, candidate)),
      ),
    )
    broadcastTrust()
    return workspaceTrust.status(root)
  })
}
