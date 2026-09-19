import { mkdir, readFile, readdir, stat } from "node:fs/promises"
import {
  atomicProjectWrite,
  saveProjectFiles,
  removeProjectFile,
  renameProjectFile,
} from "./file-service.mjs"
import { restrictedPath } from "./restricted-path.mjs"
import { copyIntoProject } from "./file-transfer.mjs"
import { fileKind, isTextPath } from "../../shared/file-rules.mjs"

export function decodeWorkspaceText(bytes) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    return text.includes("\0") ? undefined : text
  } catch {
    return undefined
  }
}

// The same file operations run beside the filesystem, locally or in the SSH agent.
export function workspaceFiles(root, resolve = (file) => restrictedPath(root, file), limits = {}) {
  const write = async (file, content) => {
    await resolve(file)
    return atomicProjectWrite(root, file, content)
  }
  return {
    async children() {
      return (await readdir(root, { withFileTypes: true })).map((entry) => ({
        name: entry.name,
        kind: entry.isDirectory() ? "directory" : "file",
      }))
    },
    async list() {
      const files = [],
        directories = []
      const skipped = new Set([
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
      ])
      let bytes = 0
      const walk = async (directory, prefix) => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          if (skipped.has(entry.name) || entry.isSymbolicLink()) continue
          const file = prefix + entry.name,
            target = await resolve(file)
          if (files.length + directories.length >= (limits.entries ?? Infinity))
            throw Error("Workspace exceeds 50,000 entries; open a smaller folder")
          if (entry.isDirectory()) {
            directories.push(file)
            await walk(target, file + "/")
          } else if (entry.isFile()) {
            const info = await stat(target)
            let text
            if (isTextPath(file)) {
              if (info.size > 5_000_000) throw Error(`Text file exceeds 5 MB: ${file}`)
              bytes += info.size
              if (bytes > (limits.textBytes ?? Infinity))
                throw Error("Workspace text exceeds 24 MB; open a smaller folder")
              text = decodeWorkspaceText(await readFile(target))
            }
            files.push({
              path: file,
              kind: fileKind(file),
              text,
              version: `${info.mtimeMs}:${info.size}`,
            })
          }
        }
      }
      await walk(root, "")
      files.sort((a, b) => a.path.localeCompare(b.path))
      return { files, directories }
    },
    async read(file) {
      const target = await resolve(file)
      if ((await stat(target)).size > (limits.fileBytes ?? Infinity))
        throw Error("File exceeds 32 MB")
      const bytes = await readFile(target),
        text = isTextPath(file) ? decodeWorkspaceText(bytes) : undefined
      return text === undefined ? { base64: bytes.toString("base64") } : { text }
    },
    async save(changes) {
      for (const file of changes) await resolve(file.path)
      return saveProjectFiles(root, changes)
    },
    write,
    async writeFiles(files) {
      for (const file of files) await write(file.path, file)
    },
    async mkdir(file) {
      await mkdir(await resolve(file), { recursive: true })
    },
    async remove(file) {
      await resolve(file)
      return removeProjectFile(root, file)
    },
    async rename(from, to) {
      await resolve(from)
      await resolve(to)
      return renameProjectFile(root, from, to)
    },
    async copy(from, to) {
      return copyIntoProject(root, await resolve(from), await resolve(to))
    },
  }
}
