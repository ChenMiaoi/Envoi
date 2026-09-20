import { parseLibraryInput, parseWorkspaceInput } from "../../../shared/contracts"
import { BrowserWindow, dialog } from "electron"
import { writeFile } from "node:fs/promises"
import path from "node:path"
import { downloadPaper } from "../../../server/paper-download.mjs"
import { searchPapers } from "../../../server/paper-search.mjs"
import { libraryRequest, researchRoot } from "../../../server/research-library.mjs"
import {
  commitWorkspace,
  createWorkspace,
  listWorkspaceResults,
  listWorkspaces,
  renameWorkspace,
  saveWorkspaceResult,
  workspaceTarget,
} from "../../../server/workspaces.mjs"
import type { MainServices } from "../runtime"
import { isRemoteRoot } from "../remote/workspace-routing.mjs"
export function registerResearchIpc(
  services: Pick<MainServices, "requireBoundRoot" | "handle" | "sessions" | "remote">,
) {
  const { requireBoundRoot, handle, sessions, remote } = services
  handle("envoi:library", async (event, root: string, raw: unknown) => {
    const input = parseLibraryInput(raw)
    const remoteRoot = isRemoteRoot(root)
    if (!remoteRoot) {
      root = await requireBoundRoot(root)
      await requireBoundRoot(await researchRoot(root))
    }
    const request = (input: ReturnType<typeof parseLibraryInput>) => {
      if (!remoteRoot) return libraryRequest(root, input)
      if (
        sessions.activeRoot(event.sender.id) !== root ||
        !remote.get(event.sender.id, root).trusted
      )
        throw Error("Remote research project is no longer active or trusted")
      return remote
        .call(event.sender.id, root, "library", [input])
        .then((result: unknown) =>
          input.action === "list" ? { ...(result as object), root } : result,
        )
    }
    if (input.action === "download-pdf") return downloadPaper(input.url)
    if (input.action === "paper-search") return searchPapers(input)
    if (input.action === "export-file") {
      const owner = BrowserWindow.fromWebContents(event.sender)
      if (!owner) throw Error("Window unavailable")
      const result = await dialog.showSaveDialog(owner, {
        defaultPath: `${path.basename(root)}-research-library.json`,
        filters: [{ name: "研究资料（文献、PDF、笔记与会话）", extensions: ["json"] }],
      })
      if (result.canceled || !result.filePath) return { saved: false }
      const archive = await request({ action: "export" })
      await writeFile(result.filePath, JSON.stringify(archive, null, 2), { mode: 0o600 })
      return { saved: true, path: result.filePath }
    }
    return request(input)
  })
  handle("envoi:paper-browse", async (event, root: string) => {
    if (!isRemoteRoot(root)) {
      root = await requireBoundRoot(root)
      await requireBoundRoot(await researchRoot(root))
    }
    if (sessions.activeRoot(event.sender.id) !== root) throw Error("Project is not active")
    sessions.bindBrowse(event.sender.id, root)
    return { ok: true }
  })
  handle("envoi:workspaces", async (_event, root: string, raw: unknown) => {
    const input = parseWorkspaceInput(raw)
    root = await requireBoundRoot(root)
    if (input.action === "list") return listWorkspaces(root)
    if (input.action === "create") return createWorkspace(root, input)
    if (input.action === "commit") return commitWorkspace(root, input)
    if (input.action === "rename") return renameWorkspace(root, input)
    if (input.action === "target") return workspaceTarget(root, input.target)
    if (input.action === "results") {
      await requireBoundRoot((await listWorkspaces(root)).main)
      return listWorkspaceResults(root)
    }
    if (input.action === "save") {
      await requireBoundRoot(await workspaceTarget(root, input.source))
      await requireBoundRoot((await listWorkspaces(root)).main)
      return saveWorkspaceResult(root, input)
    }
    throw Error("未知工作区操作")
  })
}
