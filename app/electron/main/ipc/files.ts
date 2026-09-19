import { app, shell } from "electron"
import { randomUUID } from "node:crypto"
import { stat } from "node:fs/promises"
import path from "node:path"
import { dataDir } from "../../../server/local-data.mjs"
import {
  inspectProjectDeletion,
  trashProjectDirectory,
  workspaceProjectName,
} from "../../../server/workspaces.mjs"
import { safePathParts } from "../../../shared/file-rules.mjs"
import { createLocalWorkspaceEnvironment } from "../workspace-environment.mjs"
import { copyIntoProject } from "../file-transfer.mjs"
import { watchProjectDirectory } from "../project-watch.mjs"
import type { MainServices } from "../runtime"
export function registerFilesIpc(
  services: Pick<
    MainServices,
    | "workspaceTrust"
    | "decodeText"
    | "droppedFiles"
    | "requireBoundRoot"
    | "requireOpenRoot"
    | "resolveInside"
    | "backends"
    | "handle"
    | "sessions"
  >,
) {
  const {
    workspaceTrust,
    droppedFiles,
    requireBoundRoot,
    requireOpenRoot,
    resolveInside,
    backends,
    handle,
    sessions,
  } = services
  handle("envoi:close-project", async (event, root: string) => {
    const owner = event.sender.id
    sessions.close(owner)
    await Promise.all(backends.map((backend) => backend.cancel(owner, root)))
  })
  handle("envoi:watch-project", async (event, directory: string | null) => {
    const owner = event.sender.id,
      generation = sessions.beginWatch(owner)
    if (!directory) return
    const root = await requireOpenRoot(directory)
    if (event.sender.isDestroyed() || !sessions.isCurrentWatch(owner, generation)) return
    sessions.attachWatch(
      owner,
      generation,
      watchProjectDirectory(root, (change: { root: string; paths: string[]; error?: string }) => {
        if (!event.sender.isDestroyed()) event.sender.send("envoi:files-changed", change)
      }),
    )
  })
  const provider = async (root: string) => {
    const base = await requireOpenRoot(root)
    return {
      base,
      files: createLocalWorkspaceEnvironment(base, {
        resolveFile: (file: string) => resolveInside(base, file),
      }).files,
    }
  }
  handle("envoi:fs-children", async (_event, root: string) =>
    (await provider(root)).files.children(),
  )
  handle("envoi:fs-list", async (_event, root: string) => {
    const { base, files } = await provider(root)
    return {
      ...(await files.list()),
      name: (await workspaceTrust.isTrusted(base))
        ? await workspaceProjectName(base).catch(() => undefined)
        : undefined,
      projectId: sessions.projectId(base),
    }
  })
  for (const [channel, method] of Object.entries({
    "fs-read": "read",
    "fs-save": "save",
    "fs-write": "write",
    "fs-write-files": "writeFiles",
    "fs-mkdir": "mkdir",
    "fs-remove": "remove",
    "fs-rename": "rename",
    "fs-copy": "copy",
  })) {
    handle(`envoi:${channel}`, async (_event, root: string, ...args: unknown[]) => {
      const { files } = await provider(root)
      return (files as unknown as Record<string, (...values: unknown[]) => Promise<unknown>>)[
        method
      ](...args)
    })
  }
  handle("envoi:fs-import-token", async (_event, source: string) => {
    if (typeof source !== "string" || !path.isAbsolute(source)) throw Error("无效来源路径")
    await stat(source)
    const token = randomUUID()
    droppedFiles.set(token, source)
    setTimeout(() => droppedFiles.delete(token), 60_000).unref()
    return token
  })
  handle("envoi:fs-import", async (_event, root: string, tokens: string[], directory: string) => {
    const base = await requireOpenRoot(root)
    if (!Array.isArray(tokens) || !tokens.length || tokens.length > 100)
      throw Error("无效导入文件列表")
    if (directory) await resolveInside(base, directory)
    for (const token of tokens) {
      const source = droppedFiles.get(token)
      droppedFiles.delete(token)
      if (!source) throw Error("拖入文件已失效，请重试")
      const name = path.basename(source)
      await copyIntoProject(
        base,
        source,
        await resolveInside(base, directory ? `${directory}/${name}` : name),
      )
    }
  })
  const deletionProtected = [
    app.getPath("home"),
    app.getAppPath(),
    dataDir,
    app.getPath("userData"),
  ]
  handle("envoi:fs-inspect-deletion", async (_event, root: string) => {
    await requireBoundRoot(root)
    return inspectProjectDeletion(root, deletionProtected)
  })
  handle("envoi:fs-trash-project", async (_event, root: string, typedName: string) => {
    const base = await requireBoundRoot(root)
    const plan = await inspectProjectDeletion(root, deletionProtected)
    if (plan.blocked) throw Error(plan.blocked)
    if (typedName !== plan.name) throw Error("请输入完整目录名确认。")
    await Promise.all(backends.map((backend) => backend.cancel(undefined, base)))
    // Windows cannot rename a watched directory while ReadDirectoryChangesW
    // still owns a handle to it. Close matching watchers before moving the
    // project to the trash; the state cleanup below removes their ownership.
    sessions.stopRootWatches(base)
    const trash = async (directory: string) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await shell.trashItem(directory)
        } catch (error) {
          if (
            process.platform !== "win32" ||
            (error as NodeJS.ErrnoException).code !== "EBUSY" ||
            attempt >= 4
          )
            throw error
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
    }
    const result = await trashProjectDirectory(root, typedName, trash, deletionProtected)
    // A trashed root must not remain the permission context for runtime probes.
    // Clear every window using it, not just the window that requested deletion.
    sessions.forget(base)
    return result
  })
  handle("envoi:asset-url", async (_event, root: string, relPath: string) => {
    const base = await requireOpenRoot(root)
    const parts = safePathParts(relPath)
    return `envoi://${sessions.token(base)}/${parts.map(encodeURIComponent).join("/")}`
  })
}
