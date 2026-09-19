import { app, shell } from "electron"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { dataDir } from "../../../server/local-data.mjs"
import {
  inspectProjectDeletion,
  trashProjectDirectory,
  workspaceProjectName,
} from "../../../server/workspaces.mjs"
import { fileKind, isTextPath, safePathParts } from "../../../shared/file-rules.mjs"
import {
  atomicProjectWrite,
  removeProjectFile,
  renameProjectFile,
  saveProjectFiles,
} from "../file-service.mjs"
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
    decodeText,
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
  handle("envoi:fs-children", async (_event, root: string) => {
    const entries = await readdir(await requireOpenRoot(root), { withFileTypes: true })
    return entries.map((entry) => ({
      name: entry.name,
      kind: entry.isDirectory() ? "directory" : "file",
    }))
  })
  handle("envoi:fs-list", async (_event, root: string) => {
    const base = await requireOpenRoot(root)
    const files: { path: string; kind: string; text?: string; version: string }[] = []
    const directories: string[] = []
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (
          [
            ".git",
            ".envoi",
            ".paperdesk",
            "node_modules",
            ".DS_Store",
            ".venv",
            "venv",
            "__pycache__",
            "target",
            "cmake-build-debug",
            "cmake-build-release",
          ].includes(entry.name) ||
          entry.isSymbolicLink()
        )
          continue
        const rel = prefix + entry.name
        await resolveInside(base, rel)
        if (entry.isDirectory()) {
          directories.push(rel)
          await walk(path.join(directory, entry.name), rel + "/")
        } else if (entry.isFile()) {
          const kind = fileKind(rel)
          let text: string | undefined
          if (isTextPath(rel)) {
            const bytes = await readFile(path.join(directory, entry.name))
            if (bytes.length > 5_000_000) throw new Error(`文本文件超过大小限制（5MB）：${rel}`)
            text = decodeText(bytes)
          }
          const info = await stat(path.join(directory, entry.name))
          files.push({ path: rel, kind, text, version: `${info.mtimeMs}:${info.size}` })
        }
      }
    }
    await walk(base, "")
    files.sort((a, b) => a.path.localeCompare(b.path))
    return {
      files,
      directories,
      name: (await workspaceTrust.isTrusted(base))
        ? await workspaceProjectName(base).catch(() => undefined)
        : undefined,
      projectId: sessions.projectId(base),
    }
  })

  handle("envoi:fs-read", async (_event, root: string, relPath: string) => {
    const target = await resolveInside(await requireOpenRoot(root), relPath)
    const bytes = await readFile(await realpath(target))
    const text = isTextPath(relPath) ? decodeText(bytes) : undefined
    return text !== undefined ? { text } : { base64: bytes.toString("base64") }
  })

  const writeOne = async (
    base: string,
    file: { path: string; text?: string; base64?: string },
  ): Promise<void> => {
    await resolveInside(base, file.path)
    await atomicProjectWrite(base, file.path, file)
  }
  handle(
    "envoi:fs-save",
    async (
      _event,
      root: string,
      changes: { path: string; text: string; expectedText: string | null }[],
    ) => {
      const base = await requireOpenRoot(root)
      for (const file of changes) await resolveInside(base, file.path)
      return saveProjectFiles(base, changes)
    },
  )
  handle(
    "envoi:fs-write",
    async (_event, root: string, relPath: string, content: { text?: string; base64?: string }) => {
      await writeOne(await requireOpenRoot(root), { path: relPath, ...content })
    },
  )
  handle(
    "envoi:fs-write-files",
    async (_event, root: string, files: { path: string; text?: string; base64?: string }[]) => {
      const base = await requireOpenRoot(root)
      for (const file of files) await writeOne(base, file)
    },
  )
  handle("envoi:fs-mkdir", async (_event, root: string, relPath: string) => {
    await mkdir(await resolveInside(await requireOpenRoot(root), relPath), { recursive: true })
  })
  handle("envoi:fs-remove", async (_event, root: string, relPath: string) => {
    const base = await requireOpenRoot(root)
    await resolveInside(base, relPath)
    await removeProjectFile(base, relPath)
  })
  handle("envoi:fs-rename", async (_event, root: string, from: string, to: string) => {
    const base = await requireOpenRoot(root)
    await resolveInside(base, from)
    await resolveInside(base, to)
    await renameProjectFile(base, from, to)
  })
  handle("envoi:fs-copy", async (_event, root: string, from: string, to: string) => {
    const base = await requireOpenRoot(root)
    await copyIntoProject(base, await resolveInside(base, from), await resolveInside(base, to))
  })
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
