import { openDirectory } from "@/lib/desktop"
import { nativeBasename } from "@/lib/nativePath"
import { translate } from "@/i18n/runtime"
import { projectConfiguration, type ProjectConfiguration } from "../settings/model"
import { parseDiagnostics } from "./diagnostics"
import { projectSignature } from "./compileClient"
import { verifyPreview } from "./pdfSync"
import type { CompileDiagnostics, Diagnostic } from "./diagnostics"
import {
  managementDirName,
  legacyDirName,
  projectConfigPath,
  legacyProjectConfigPath,
  projectConfigFile,
} from "./managementDir"
import { envoi } from "./desktop"
import { templateFiles } from "./paperTemplates"
import type { FileKind, FileNode } from "@/data/workspace"
export interface ProjectFile {
  version?: string
  file?: File
  id: string
  path: string
  kind: FileKind
  text?: string
  saved?: string
  url?: string
}
export interface PaperProject {
  settings?: ProjectConfiguration
  lint?: {
    fileId: string
    text: string
    status: "checking" | "ready" | "unavailable" | "disabled"
    message?: string
    items: Diagnostic[]
  }
  diagnostics?: CompileDiagnostics
  engine?: "pdflatex" | "xelatex"
  compiled?: { file: File; signature: string; synctex?: Uint8Array<ArrayBuffer> }
  compileStatus?: string
  compileLog?: string
  id: string
  name: string
  files: ProjectFile[]
  directories: string[]
  rootId: string
  rootPath?: string
}
export function fileKind(path: string): FileKind {
  const extension = path.split(".").pop()?.toLowerCase()
  return extension === "tex"
    ? "latex"
    : extension === "bib"
      ? "bib"
      : extension === "pdf"
        ? "pdf"
        : ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "ico"].includes(
              extension ?? "",
            )
          ? "image"
          : extension === "csv"
            ? "csv"
            : extension === "tsv"
              ? "tsv"
              : ["md", "markdown"].includes(extension ?? "")
                ? "markdown"
                : isTextPath(path)
                  ? "text"
                  : "binary"
}
export function isTextPath(path: string) {
  return (
    /\.(tex|bib|md|markdown|txt|csv|tsv|json|sty|cls|bst|log|yaml|yml|toml|ini|cfg|py|r|js|ts|jsx|tsx|css|html|xml|sh|sql|c|h|cpp|rs|go|jl)$/i.test(
      path,
    ) || /(^|\/)(README|LICENSE|Makefile|Dockerfile|\.gitignore)$/i.test(path)
  )
}
export function safePath(path: string) {
  const parts = path.trim().split("/")
  if (
    !parts.length ||
    parts.some(
      (part) =>
        !part ||
        part === "." ||
        part === ".." ||
        /[\\:]/.test(part) ||
        [...part].some((character) => character.charCodeAt(0) < 32),
    )
  )
    throw new Error(translate("project.invalidPath"))
  return parts
}
export function isWritingPath(path: string) {
  return (
    !path
      .split("/")
      .some(
        (part) =>
          part.startsWith(".") || ["build", "output", "node_modules", "__pycache__"].includes(part),
      ) &&
    !/\.(aux|log|bbl|blg|bcf|fls|fdb_latexmk|toc|out|lof|lot|nav|snm|xdv|dvi|pyc)$|\.synctex\.gz$|\.run\.xml$/i.test(
      path,
    ) &&
    !["paperdesk.json", "TEMPLATE.md"].includes(path)
  )
}
export function projectTree(files: ProjectFile[], directories: string[] = []): FileNode[] {
  const roots: FileNode[] = []
  function folder(parts: string[]) {
    let nodes = roots,
      path = ""
    for (const part of parts) {
      path += (path ? "/" : "") + part
      let node = nodes.find((item) => item.id === path)
      if (!node) {
        node = { id: path, name: part, kind: "folder", children: [] }
        nodes.push(node)
      }
      nodes = node.children!
    }
    return nodes
  }
  for (const path of directories.filter(isWritingPath)) folder(path.split("/"))
  for (const file of files.filter((file) => isWritingPath(file.path))) {
    const parts = file.path.split("/")
    const name = parts.pop()!
    folder(parts).push({ id: file.id, name, kind: file.kind })
  }
  return roots
}
const skippedParts: Record<string, true> = {
  ".git": true,
  [managementDirName]: true,
  [legacyDirName]: true,
  node_modules: true,
}
export async function readProject(rootPath: string): Promise<PaperProject> {
  const listing = await envoi().fsList(rootPath)
  const files: ProjectFile[] = [],
    directories: string[] = []
  for (const path of listing.directories)
    if (!path.split("/").some((part) => skippedParts[part])) directories.push(path)
  for (const entry of listing.files) {
    const parts = entry.path.split("/")
    if (parts.some((part) => skippedParts[part]) || parts.at(-1) === ".DS_Store") continue
    let text = isTextPath(entry.path) ? entry.text : undefined
    if (isTextPath(entry.path) && text !== undefined && text.length > 5_000_000)
      throw new Error(translate("project.textTooLarge", { path: entry.path }))
    if (text?.includes("\0")) text = undefined
    files.push({
      id: entry.path,
      path: entry.path,
      kind: fileKind(entry.path),
      version: entry.version,
      text,
      saved: text,
    })
  }
  const config = await projectConfigFile(rootPath)
  if (config)
    files.push({
      id: config.path,
      path: config.path,
      kind: "text",
      text: config.text,
      saved: config.text,
    })
  files.sort((a, b) => a.path.localeCompare(b.path))
  let metadata: {
    projectId?: string
    settings?: ProjectConfiguration
    main?: string
    engine?: "pdflatex" | "xelatex"
  } = {}
  try {
    metadata = JSON.parse(
      (
        files.find((file) => file.path === projectConfigPath) ??
        files.find((file) => file.path === legacyProjectConfigPath) ??
        files.find((file) => file.path === "paperdesk.json")
      )?.text ?? "{}",
    )
    if (!metadata || Array.isArray(metadata) || typeof metadata !== "object") throw Error()
  } catch {
    throw Error(translate("project.configInvalid"))
  }
  let diagnostics: CompileDiagnostics | undefined
  try {
    const record = JSON.parse(
      files.find((file) => file.path === "build/diagnostics.json")?.text ?? "null",
    )
    if (
      record &&
      Array.isArray(record.items) &&
      typeof record.signature === "string" &&
      ["success", "failed", "cancelled"].includes(record.status)
    )
      diagnostics = record
  } catch {
    /* Optional last-build diagnostics. */
  }
  const root =
    files.find((file) => file.path === metadata.main) ??
    files.find((file) => /(^|\/)main\.tex$/i.test(file.path)) ??
    files.find((file) => file.kind === "latex")
  const withUrls = await Promise.all(
    files.map(async (file) =>
      file.text === undefined
        ? {
            ...file,
            url: await envoi()
              .assetUrl(rootPath, file.path)
              .then((url) =>
                file.version === undefined ? url : url + "?v=" + encodeURIComponent(file.version),
              )
              .catch(() => undefined),
          }
        : file,
    ),
  )
  const project: PaperProject = {
    settings: projectConfiguration(metadata.settings, metadata.engine),
    diagnostics,
    compileLog: diagnostics?.log,
    compileStatus: diagnostics
      ? translate("compile.restoredRecord", {
          status: translate(
            diagnostics.status === "success"
              ? "compile.statusSuccess"
              : diagnostics.status === "failed"
                ? "compile.statusFailed"
                : "compile.statusCancelled",
          ),
        })
      : undefined,
    engine: ["pdflatex", "xelatex"].includes(metadata.engine ?? "") ? metadata.engine : undefined,
    id: listing.projectId ?? metadata.projectId ?? crypto.randomUUID(),
    name: listing.name ?? nativeBasename(rootPath),
    rootPath,
    files: withUrls,
    directories,
    rootId: root?.id ?? "",
  }
  if (!diagnostics) {
    const log = files.find((file) => file.path === "build/compile.log"),
      pdf = project.files.find((file) => file.path === "build/main.pdf")
    if (log?.text && pdf) {
      const verified = await verifyPreview(project, pdf)
      diagnostics = {
        items: parseDiagnostics(log.text, files),
        signature: verified ? projectSignature(project) : "legacy-unverified",
        rootId: project.rootId,
        status: "success",
        log: log.text,
        engine: project.engine,
      }
      project.diagnostics = diagnostics
      project.compileLog = log.text
      project.compileStatus = translate("compile.restoredDisk")
    }
  }
  return project
}
export async function createTextFile(rootPath: string, path: string, text: string) {
  const parts = safePath(path)
  const exists = await envoi()
    .fsRead(rootPath, path)
    .then(
      () => true,
      () => false,
    )
  if (exists) throw new Error(translate("project.fileExists", { path }))
  for (let depth = 1; depth < parts.length; depth++)
    await envoi().fsMkdir(rootPath, parts.slice(0, depth).join("/"))
  const result = await envoi().fsSave(rootPath, [{ path, text, expectedText: null }])
  if (result.error) throw new Error(result.error)
}
export async function createPaper(
  parentRootPath: string,
  name: string,
  template = "article",
  enableGit = true,
): Promise<string> {
  if (safePath(name).length !== 1) throw new Error(translate("project.nameNoPath"))
  parentRootPath = await openDirectory(parentRootPath)
  const listing = await envoi().fsChildren(parentRootPath)
  if (listing.some((entry) => entry.name === name))
    throw new Error(translate("project.directoryExists", { name }))
  const parent = parentRootPath.replace(/\/+$/, ""),
    rootPath = `${parent}/${name}`
  try {
    const templates = Object.entries(templateFiles(template, enableGit))
    const folders = [
      ...new Set(
        templates.flatMap(([path]) =>
          safePath(path)
            .slice(0, -1)
            .map((_, depth, parts) => `${name}/${parts.slice(0, depth + 1).join("/")}`),
        ),
      ),
    ]
    await envoi().fsMkdir(parent, name)
    for (const folder of folders) await envoi().fsMkdir(parent, folder)
    await envoi().fsWriteFiles(
      parent,
      templates.map(([path, text]) => ({ path: `${name}/${path}`, text })),
    )
    await envoi().fsMkdir(parent, `${name}/assets`)
    await envoi().fsMkdir(parent, `${name}/build`)
  } catch (error) {
    throw new Error(translate("project.initIncomplete", { message: (error as Error).message }))
  }
  return rootPath
}
export async function saveProject(
  project: PaperProject,
  onSaved: (id: string, text: string) => void,
) {
  if (!project.rootPath) throw new Error(translate("project.notConnected"))
  const changes = dirtyFiles(project)
  const result = await envoi().fsSave(
    project.rootPath,
    changes.map((file) => ({
      path: file.path,
      text: file.text!,
      expectedText: file.saved ?? null,
    })),
  )
  for (const file of changes) if (result.saved.includes(file.path)) onSaved(file.id, file.text!)
  if (result.error) throw new Error(result.error)
}
function encodeBase64(bytes: Uint8Array) {
  let binary = ""
  for (let index = 0; index < bytes.length; index += 32768)
    binary += String.fromCharCode(...bytes.subarray(index, index + 32768))
  return btoa(binary)
}
export async function persistBuild(
  rootPath: string,
  pdf: File,
  log: string,
  manifest?: string,
  synctex?: Uint8Array<ArrayBuffer>,
) {
  await envoi().fsMkdir(rootPath, "build")
  const files: { path: string; text?: string; base64?: string }[] = [
    { path: "build/main.pdf", base64: encodeBase64(new Uint8Array(await pdf.arrayBuffer())) },
    { path: "build/compile.log", text: log },
  ]
  if (manifest) files.push({ path: "build/preview.json", text: manifest })
  if (synctex) files.push({ path: "build/main.synctex.gz", base64: encodeBase64(synctex) })
  await envoi().fsWriteFiles(rootPath, files)
}

export async function persistDiagnostics(rootPath: string, diagnostics: CompileDiagnostics) {
  await envoi().fsMkdir(rootPath, "build")
  await envoi().fsWriteFiles(rootPath, [
    { path: "build/diagnostics.json", text: JSON.stringify(diagnostics, null, 2) },
    { path: "build/compile.log", text: diagnostics.log ?? "" },
  ])
}

export function dirtyFiles(project: PaperProject) {
  return project.files.filter((file) => file.text !== undefined && file.text !== file.saved)
}

// Preserve the current draft and its original disk baseline when external edits arrive.
export function mergeDiskProject(current: PaperProject, disk: PaperProject): PaperProject {
  if (current.rootPath !== disk.rootPath) return current
  const drafts = new Map(dirtyFiles(current).map((file) => [file.path, file]))
  const files = disk.files.map((file) => {
    const draft = drafts.get(file.path)
    drafts.delete(file.path)
    return draft ?? file
  })
  files.push(...drafts.values())
  files.sort((a, b) => a.path.localeCompare(b.path))
  const same =
    files.length === current.files.length &&
    files.every((file, index) => {
      const previous = current.files[index]
      return (
        file.path === previous.path &&
        file.text === previous.text &&
        file.saved === previous.saved &&
        (file.text !== undefined || file.version === previous.version)
      )
    })
  if (
    same &&
    JSON.stringify(disk.directories) === JSON.stringify(current.directories) &&
    JSON.stringify(disk.settings) === JSON.stringify(current.settings)
  )
    return current
  return { ...current, files, directories: disk.directories, settings: disk.settings }
}
