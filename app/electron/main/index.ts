import { createPythonEnvironment, pythonEnvironmentStatus } from "./python-environment.mjs"
import { downloadPaper } from "../../server/paper-download.mjs"
import { searchPapers } from "../../server/paper-search.mjs"
import { restrictedPath } from "./restricted-path.mjs"
import { diagnostics, operationContext } from "./diagnostics"
import { randomUUID } from "node:crypto"
import { libraryRequest, researchRoot } from "../../server/research-library.mjs"
import { createExampleProject } from "./example-project.mjs"
import { checkUpdate, downloadReleaseInstaller } from "./updates.mjs"
import electronUpdater from "electron-updater"
import {
  inspectProjectDeletion,
  trashProjectDirectory,
  listWorkspaces,
  createWorkspace,
  commitWorkspace,
  workspaceTarget,
  saveWorkspaceResult,
  listWorkspaceResults,
  renameWorkspace,
  workspaceProjectName,
} from "../../server/workspaces.mjs"
import {
  detectTool,
  toolDirectories,
  paperSearchConfig,
  configurePaperSearch,
  probeLanguageServerPath,
  probeToolPath,
} from "../../server/tool-config.mjs"
import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell } from "electron"
import { randomBytes } from "node:crypto"
import { mkdir, readdir, readFile, writeFile, stat, realpath, rm } from "node:fs/promises"
import path from "node:path"

import type { CompileInput } from "../../server/compiler.mjs"
import { dataStore, registerProject, dataDir } from "../../server/local-data.mjs"
import { watchProjectDirectory } from "./project-watch.mjs"
import { BackendHost } from "./backend-host"
import {
  atomicProjectWrite,
  saveProjectFiles,
  renameProjectFile,
  removeProjectFile,
} from "./file-service.mjs"
import { copyIntoProject } from "./file-transfer.mjs"
import { LspService, lspLanguage } from "./lsp-service.mjs"
import { installLanguageServer, installedServer, lspInstallable } from "./lsp-installer.mjs"
import { installedTool, installTool, toolInstallPlan } from "./tool-installer.mjs"
import { runLanguageTool } from "./language-tools.mjs"

import { createWorkspaceTrust } from "./workspace-trust.mjs"
// Desktop launchers may omit installed tools from PATH; share discovery with workers and AI.
process.env.PATH = [
  ...new Set(
    [...toolDirectories(), ...(process.env.PATH ?? "").split(path.delimiter)].filter(Boolean),
  ),
].join(path.delimiter)
const workspaceTrust = createWorkspaceTrust(
  path.join(dataDir, "workspace-trust.json"),
  async () => true,
)

// ── 与 src/lib/projectFiles.ts 等价的纯函数副本（主进程不跨边界 import src）──

function isTextPath(value: string): boolean {
  return (
    /\.(tex|bib|md|markdown|txt|csv|tsv|json|sty|cls|bst|log|yaml|yml|toml|ini|cfg|py|pyi|pyw|r|js|ts|jsx|tsx|css|html|xml|sh|sql|c|h|cc|cpp|cxx|c\+\+|hh|hpp|hxx|h\+\+|inl|tpp|rs|go|jl|cmake|mk|mak|meson)$/i.test(
      value,
    ) ||
    /(^|\/)(README|LICENSE|GNUmakefile|Makefile|makefile|CMakeLists\.txt|meson\.build|meson\.options|meson_options\.txt|Cargo\.lock|uv\.lock|Dockerfile|\.gitignore|\.clangd|\.clang-format|\.python-version)$/i.test(
      value,
    )
  )
}

function fileKind(value: string): string {
  const extension = value.split(".").pop()?.toLowerCase()
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
                : isTextPath(value)
                  ? "text"
                  : "binary"
}

// 与 src 侧 safePath 等价的二次校验：拒绝 ..、绝对路径、反斜杠/冒号与控制字符。
function safePathParts(relPath: string): string[] {
  if (typeof relPath !== "string") throw new Error("无效文件路径")
  const parts = relPath.trim().split("/")
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
    throw new Error("无效文件路径")
  return parts
}

function decodeText(bytes: Buffer): string | undefined {
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
    return text.includes("\0") ? undefined : text
  } catch {
    return undefined // 非 UTF-8 或二进制内容按 base64 处理
  }
}

// ── 已绑定项目根与 envoi:// token 映射（仅存主进程内存）──

const tokensByRoot = new Map<string, string>()
const rootsByToken = new Map<string, string>()
const droppedFiles = new Map<string, string>()

function bindRoot(root: string): void {
  if (!tokensByRoot.has(root)) {
    const token = randomBytes(16).toString("hex")
    tokensByRoot.set(root, token)
    rootsByToken.set(token, root)
  }
}

function unbindRoot(root: string): void {
  const token = tokensByRoot.get(root)
  if (token) {
    tokensByRoot.delete(root)
    rootsByToken.delete(token)
  }
}

async function requireBoundRoot(root: string): Promise<string> {
  const resolved = await workspaceTrust.requireTrust(root)
  bindRoot(resolved)
  return resolved
}

async function requireOpenRoot(root: string): Promise<string> {
  const resolved = await workspaceTrust.requireOpen(root)
  bindRoot(resolved)
  return resolved
}

async function resolveInside(root: string, relPath: string): Promise<string> {
  if (!(await workspaceTrust.isTrusted(root))) return restrictedPath(root, relPath)
  return path.join(root, ...safePathParts(relPath))
}

// ── envoi:// 自定义协议（契约第 2 节）──

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
  ico: "image/x-icon",
  json: "application/json",
  css: "text/css",
  html: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xml: "application/xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eps: "application/postscript",
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "envoi",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
])

async function handleAsset(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const root = rootsByToken.get(url.host)
  if (!root) return new Response("未授权的资源访问", { status: 403 })
  let target: string
  try {
    target = await resolveInside(root, decodeURIComponent(url.pathname).replace(/^\/+/, ""))
  } catch {
    return new Response("无效资源路径", { status: 400 })
  }
  const real = await realpath(target).catch(() => null)
  if (!real) return new Response("资源不存在", { status: 404 })
  const data = await readFile(real)
  const mime = MIME[path.extname(real).slice(1).toLowerCase()] ?? "application/octet-stream"
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  })
}

// ── 编译单飞（对应当前服务端 running 语义；lint 不支持取消，见契约 §3）──

const compileRequests = new Map<number, Set<{ cancelled: boolean; root?: string }>>()
const compilerBackend = new BackendHost("Compiler")
const toolsBackend = new BackendHost("Tools")
const agentBackend = new BackendHost("AI")
const backends = [compilerBackend, toolsBackend, agentBackend]
const watchers = new Map<number, () => void>()
const watchGenerations = new Map<number, number>()
const projectRoots = new Map<string, string>()
const activeRoots = new Map<number, string>()
const managedLspDirectory = () => path.join(app.getPath("userData"), "language-servers")
const managedToolsDirectory = () => path.join(app.getPath("userData"), "tools")
const lspService = new LspService(
  (owner: number, payload: unknown) => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.webContents.id === owner && !window.webContents.isDestroyed())
        window.webContents.send("envoi:lsp-diagnostics", payload)
  },
  undefined,
  managedLspDirectory,
  (owner, payload) => {
    for (const window of BrowserWindow.getAllWindows())
      if (window.webContents.id === owner && !window.webContents.isDestroyed())
        window.webContents.send("envoi:lsp-status", payload)
  },
)
async function requireToolContext(event: Electron.IpcMainInvokeEvent) {
  const root = activeRoots.get(event.sender.id)
  if (root) await workspaceTrust.requireTrust(root)
}
async function agentRoot(body: unknown) {
  const id = (body as { projectId?: string } | null)?.projectId
  if (!id) return undefined
  const root = projectRoots.get(id)
  if (!root) throw Error("请先打开项目。")
  return requireBoundRoot(root)
}

// ── IPC 通道（契约第 1 节；错误消息沿用中文风格）──

function handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, async (event, ...args) => {
    const operationId = randomUUID(),
      started = Date.now()
    return operationContext.run(operationId, async () => {
      try {
        const result = await listener(event, ...args)
        diagnostics.write("debug", "ipc", "operation.completed", {
          operationId,
          method: channel,
          durationMs: Date.now() - started,
        })
        return result
      } catch (error) {
        diagnostics.write(
          "error",
          "ipc",
          "operation.failed",
          { operationId, method: channel, durationMs: Date.now() - started },
          error,
        )
        throw error
      }
    })
  })
}

function registerIpc(): void {
  handle(
    "envoi:lsp-open",
    async (
      event,
      root: string,
      file: string,
      text: string,
      token: string,
      preferredServer?: string,
      preferredPath?: string,
    ) => {
      const preferences = (await dataStore({
        store: "preferences",
        key: "default",
        action: "get",
      })) as { body: { value?: unknown; revision?: number } | null }
      lspService.configurePreferences(preferences.body?.value, preferences.body?.revision ?? 0)
      root = await requireBoundRoot(root)
      if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
      if (typeof file !== "string" || !lspLanguage(file))
        return { available: false, error: "No language server for this file" }
      safePathParts(file)
      if (typeof token !== "string" || !/^[0-9a-f-]{36}$/i.test(token))
        throw Error("Invalid editor token")
      return lspService.open(
        event.sender.id,
        root,
        file,
        text,
        token,
        preferredServer,
        preferredPath,
      )
    },
  )
  handle("envoi:lsp-change", async (event, root: string, file: string, text: string) => {
    root = await requireBoundRoot(root)
    if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
    safePathParts(file)
    lspService.change(event.sender.id, root, file, text)
  })
  handle(
    "envoi:lsp-query",
    async (event, root: string, file: string, method: string, offset: number, text: string) => {
      root = await requireBoundRoot(root)
      if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
      safePathParts(file)
      if (!Number.isInteger(offset) || offset < 0 || offset > text.length) return null
      return lspService.query(event.sender.id, root, file, method, offset, text)
    },
  )
  handle("envoi:lsp-close", (event, root: string, file: string, token: string) => {
    if (typeof root === "string" && typeof file === "string" && typeof token === "string")
      lspService.close(event.sender.id, root, file, token)
  })
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
  handle("envoi:library", async (event, root: string, input: Record<string, unknown>) => {
    root = await requireBoundRoot(root)
    await requireBoundRoot(await researchRoot(root))
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
      const archive = await libraryRequest(root, { action: "export" })
      await writeFile(result.filePath, JSON.stringify(archive, null, 2), { mode: 0o600 })
      return { saved: true, path: result.filePath }
    }
    return libraryRequest(root, input)
  })
  handle("envoi:paper-browse", async (event, root: string) => {
    root = await requireBoundRoot(root)
    await requireBoundRoot(await researchRoot(root))
    if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
    if (browseRoots.get(event.sender.id)?.root !== root) {
      cancelPaperBrowse(event.sender.id)
      browseRoots.set(event.sender.id, { root, controller: new AbortController() })
    }
    return { ok: true }
  })
  handle(
    "envoi:workspaces",
    async (
      _event,
      root: string,
      input: { action: string; source?: string; target?: string; name?: string; message?: string },
    ) => {
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
    },
  )
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
    bindRoot(root)
    projectRoots.set(project.id, root)
    if (activeRoots.get(event.sender.id) !== root) {
      cancelPaperBrowse(event.sender.id)
      lspService.dispose(event.sender.id)
    }
    activeRoots.set(event.sender.id, root)
    return { ok: true, project: { id: project.id, path: root, name: project.name } }
  })

  handle("envoi:canonical-directory", (_event, directory: string) => {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw Error("需要绝对目录路径")
    return realpath(directory)
  })
  handle("envoi:trust-directory", async (_event, directory: string) => {
    const root = await workspaceTrust.open(directory)
    bindRoot(root)
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
    const affected = [...new Set([...projectRoots.values()])].filter((candidate) => {
      const relative = path.relative(root, candidate)
      return (
        !relative ||
        (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
      )
    })
    for (const requests of compileRequests.values()) {
      for (const request of requests) {
        if (
          request.root &&
          affected.some((candidate) => path.relative(candidate, path.resolve(request.root!)) === "")
        )
          request.cancelled = true
      }
    }
    for (const window of BrowserWindow.getAllWindows()) {
      for (const candidate of affected) lspService.dispose(window.webContents.id, candidate)
      const binding = browseRoots.get(window.webContents.id)
      if (binding && affected.includes(binding.root)) cancelPaperBrowse(window.webContents.id)
    }
    await Promise.all(
      affected.flatMap((candidate) =>
        backends.map((backend) => backend.cancel(undefined, candidate)),
      ),
    )
    broadcastTrust()
    return workspaceTrust.status(root)
  })
  handle("envoi:compiler-runtime", async (event) => {
    await requireToolContext(event)
    return compilerBackend.call("runtime")
  })
  handle("envoi:compile", async (event, input: CompileInput) => {
    const owner = event.sender.id,
      request = { cancelled: false, root: input.rootPath }
    const requests = compileRequests.get(owner) ?? new Set<{ cancelled: boolean; root?: string }>()
    requests.add(request)
    compileRequests.set(owner, requests)
    try {
      const root = await requireBoundRoot(input.rootPath!)
      if (request.cancelled || event.sender.isDestroyed()) throw Error("编译已取消")
      return await compilerBackend.call("compile", [input], { owner, root })
    } finally {
      requests.delete(request)
      if (!requests.size) compileRequests.delete(owner)
    }
  })
  handle("envoi:cancel-compile", (event) => {
    for (const request of compileRequests.get(event.sender.id) ?? []) request.cancelled = true
    return compilerBackend.cancel(event.sender.id)
  })
  handle(
    "envoi:lint",
    async (
      event,
      input: { rootPath?: string; path: string; text: string; disabledRules?: number[] },
    ) =>
      toolsBackend.call("lint", [input], {
        owner: event.sender.id,
        root: await requireBoundRoot(input.rootPath ?? ""),
      }),
  )
  handle("envoi:tools", async (event, options?: { refresh?: boolean; root?: string }) => {
    await requireToolContext(event)
    const root = options?.root ? await requireBoundRoot(options.root) : undefined
    const info = (await toolsBackend.call("tools", [{ refresh: options?.refresh, root }])) as {
      groups?: Record<
        string,
        {
          id: string
          available: boolean
          path?: string
          version?: string
          candidates?: { path: string; version?: string }[]
        }[]
      >
    }
    const mergeInstalled = (
      row: {
        available: boolean
        path?: string
        version?: string
        candidates?: { path: string; version?: string }[]
      },
      installed: { path: string; version?: string },
    ) => {
      const candidates = row.candidates ?? []
      Object.assign(row, {
        available: true,
        path: installed.path,
        version: installed.version,
        candidates: candidates.some((candidate) => candidate.path === installed.path)
          ? candidates
          : [{ path: installed.path, version: installed.version }, ...candidates],
      })
    }
    const brew = detectTool("brew")
    const rustup = detectTool("rustup")
    for (const rows of Object.values(info.groups ?? {}))
      for (const row of rows) {
        const installed = await installedTool(managedToolsDirectory(), row.id)
        if (installed) mergeInstalled(row, installed)
        Object.assign(row, {
          installable:
            (row as { kind?: string }).kind === "lsp"
              ? lspInstallable(row.id)
              : !!toolInstallPlan(row.id, { brew: !!brew, rustup: !!rustup }),
        })
      }
    for (const language of ["cpp", "python", "rust"]) {
      const installed = await installedServer(managedLspDirectory(), language)
      const group = info.groups?.[language]
      const row = group?.find((entry) => entry.id === installed?.id)
      if (row && installed) mergeInstalled(row, installed)
    }
    return info
  })
  handle("envoi:python-environment", async (event, root: string, manager?: string) => {
    root = await requireBoundRoot(root)
    if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
    if (manager === undefined) return pythonEnvironmentStatus(root)
    await requireToolContext(event)
    return createPythonEnvironment(root, manager)
  })
  handle("envoi:install-lsp", async (event, language: string) => {
    await requireToolContext(event)
    const installed = await installLanguageServer(managedLspDirectory(), language)
    if (!installed) throw Error("Language server installation failed")
    return { id: installed.id, path: installed.path, version: installed.version }
  })
  handle("envoi:install-tool", async (event, id: string) => {
    await requireToolContext(event)
    return installTool(managedToolsDirectory(), id)
  })
  handle(
    "envoi:language-tool",
    async (
      event,
      root: string,
      file: string,
      text: string,
      kind: string,
      selectedPath?: string,
    ) => {
      root = await requireBoundRoot(root)
      if (activeRoots.get(event.sender.id) !== root) throw Error("Project is not active")
      safePathParts(file)
      return runLanguageTool(root, file, text, kind, selectedPath)
    },
  )
  handle("envoi:probe-lsp-path", async (event, id: string, value: string) => {
    await requireToolContext(event)
    return probeLanguageServerPath(id, value)
  })
  handle("envoi:probe-tool-path", async (event, id: string, value: string) => {
    await requireToolContext(event)
    return probeToolPath(id, value)
  })
  handle("envoi:paper-search-config", () => paperSearchConfig())
  handle("envoi:configure-paper-search", (_event, input: unknown) => configurePaperSearch(input))
  handle("envoi:configure-tools", async (event, input: { chktexPath: string | null }) => {
    await requireToolContext(event)
    return toolsBackend.call("configureTools", [input])
  })
  handle("envoi:git-runtime", async (event) => {
    await requireToolContext(event)
    return toolsBackend.call("gitRuntime")
  })
  for (const [channel, method] of [
    ["git-init", "gitInit"],
    ["git-status", "gitStatus"],
    ["git-log", "gitLog"],
    ["git-show", "gitShow"],
  ]) {
    handle(`envoi:${channel}`, async (_event, directory: string, extra?: Record<string, unknown>) =>
      toolsBackend.call(method, [await requireBoundRoot(directory), extra]),
    )
  }

  // dataStore 返回 {status, body}（镜像 HTTP，含 409 revision 冲突）；>=400 抛错，语义同原 HTTP client。
  const store = async (input: Parameters<typeof dataStore>[0]): Promise<unknown> => {
    const result = (await dataStore(input)) as { status: number; body: { error?: string } }
    if (result.status >= 400) throw new Error(result.body?.error ?? "本机数据操作失败")
    return result.body
  }
  handle("envoi:data-get", (_event, name: string, key?: string) =>
    store({ store: name, key: key ?? "default", action: "get" }),
  )
  handle(
    "envoi:data-put",
    async (
      _event,
      name: string,
      value: unknown,
      key?: string,
      opts?: { migrate?: boolean; expectedRevision?: number },
    ) => {
      const result = await store({
        store: name,
        key: key ?? "default",
        action: "put",
        value,
        migrate: opts?.migrate,
        expectedRevision: opts?.expectedRevision,
      })
      if (name === "preferences" && (key ?? "default") === "default") {
        const saved = result as { value: unknown; revision: number }
        lspService.configurePreferences(saved.value, saved.revision)
      }
      return result
    },
  )

  handle("envoi:agent-status", () => agentBackend.call("agentStatus"))
  handle("envoi:agent-request", async (event, route: string, body: unknown) => {
    if (["sessions", "session", "new", "history/delete"].includes(route))
      await requireToolContext(event)
    if (route === "bind") throw Error("请通过打开项目连接目录。")
    const result = (await agentBackend.call("agentRequest", [route, body], {
      root: await agentRoot(body),
    })) as { status: number; body: { error?: string } }
    if (result.status >= 400) throw new Error(result.body?.error ?? "AI 操作失败")
    return result.body
  })
  handle(
    "envoi:agent-chat",
    async (
      event,
      params: {
        projectId: string
        sessionId?: string
        context?: string
        dirty: boolean
        message: string
      },
    ) => {
      const sender = event.sender
      const root = await agentRoot(params)
      if (!root) throw Error("请先打开并信任项目。")
      void agentBackend
        .call("agentChat", [params], {
          owner: sender.id,
          root,
          onEvent: (chatEvent: Record<string, unknown>) => {
            if (!sender.isDestroyed())
              sender.send("envoi:agent-event", { projectId: params.projectId, ...chatEvent })
          },
        })
        .catch((error: Error) => {
          if (!sender.isDestroyed())
            sender.send("envoi:agent-event", {
              projectId: params.projectId,
              type: "error",
              message: error.message,
            })
        })
      return { ok: true }
    },
  )

  handle("envoi:close-project", async (event, root: string) => {
    const owner = event.sender.id
    lspService.dispose(owner)
    cancelPaperBrowse(owner)
    activeRoots.delete(owner)
    watchGenerations.set(owner, (watchGenerations.get(owner) ?? 0) + 1)
    watchers.get(owner)?.()
    watchers.delete(owner)
    for (const request of compileRequests.get(owner) ?? []) request.cancelled = true
    await Promise.all(backends.map((backend) => backend.cancel(owner, root)))
  })
  handle("envoi:watch-project", async (event, directory: string | null) => {
    const owner = event.sender.id,
      generation = (watchGenerations.get(owner) ?? 0) + 1
    watchGenerations.set(owner, generation)
    watchers.get(owner)?.()
    watchers.delete(owner)
    if (!directory) return
    const root = await requireOpenRoot(directory)
    if (event.sender.isDestroyed() || watchGenerations.get(owner) !== generation) return
    watchers.set(
      owner,
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
      projectId: [...projectRoots].find(([, directory]) => directory === base)?.[0],
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
    for (const [owner, active] of activeRoots) {
      if (active !== base) continue
      watchers.get(owner)?.()
      watchers.delete(owner)
    }
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
    for (const [owner, active] of activeRoots) {
      if (active !== base) continue
      activeRoots.delete(owner)
      watchGenerations.set(owner, (watchGenerations.get(owner) ?? 0) + 1)
      watchers.get(owner)?.()
      watchers.delete(owner)
      for (const request of compileRequests.get(owner) ?? []) request.cancelled = true
    }
    for (const [id, directory] of projectRoots) if (directory === base) projectRoots.delete(id)
    unbindRoot(base)
    return result
  })
  handle("envoi:asset-url", async (_event, root: string, relPath: string) => {
    const base = await requireOpenRoot(root)
    const parts = safePathParts(relPath)
    return `envoi://${tokensByRoot.get(base)}/${parts.map(encodeURIComponent).join("/")}`
  })
}

// ── 内置论文浏览：独立持久会话（persist:paperbrowse），PDF 下载直接入库 ──
const browseRoots = new Map<number, { root: string; controller: AbortController }>()
function cancelPaperBrowse(owner: number): void {
  browseRoots.get(owner)?.controller.abort()
  browseRoots.delete(owner)
}
function setupPaperBrowse(): void {
  const browse = session.fromPartition("persist:paperbrowse")
  const origin = (contents: Electron.WebContents) => {
    const owner = contents.hostWebContents ?? contents
    const binding = browseRoots.get(owner.id)
    if (!binding || activeRoots.get(owner.id) !== binding.root) return undefined
    return {
      owner,
      binding,
      current: () =>
        !owner.isDestroyed() &&
        !contents.isDestroyed() &&
        browseRoots.get(owner.id) === binding &&
        activeRoots.get(owner.id) === binding.root &&
        !binding.controller.signal.aborted,
    }
  }
  type Origin = NonNullable<ReturnType<typeof origin>>
  const notify = (source: Origin, payload: { title?: string; error?: string }) => {
    if (source.current()) source.owner.send("envoi:browse-imported", payload)
  }
  const importFile = async (source: Origin, name: string, base64: string) => {
    if (!source.current()) return
    const root = await requireBoundRoot(source.binding.root)
    await requireBoundRoot(await researchRoot(root))
    if (!source.current()) return
    await libraryRequest(
      root,
      {
        action: "import",
        papers: [{ title: pdfName(name), attachment: { $blob: base64 } }],
      },
      source.current,
    )
    notify(source, { title: name })
  }
  const pdfName = (name: string) =>
    name
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "网页下载论文"
  const pdfUrl = (url: string) => /^https:\/\/[^\s]+\.pdf([?#].*)?$/i.test(url)
  app.on("web-contents-created", (_event, contents) => {
    if (contents.session !== browse) return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => {
      const source = origin(contents)
      if (!pdfUrl(url) || !source) return
      event.preventDefault()
      void downloadPaper(url, fetch, { signal: source.binding.controller.signal })
        .then((file) => importFile(source, file.name, file.base64))
        .catch((error: Error) => notify(source, { error: error.message }))
    })
  })
  browse.on("will-download", (_event, item, contents) => {
    const name = item.getFilename() || "paper.pdf"
    if (item.getMimeType() !== "application/pdf" && !/\.pdf$/i.test(name)) return
    const source = origin(contents)
    if (!source) {
      item.cancel()
      return
    }
    const savePath = path.join(app.getPath("temp"), `envoi-browse-${randomUUID()}.pdf`)
    const cancel = () => item.cancel()
    source.binding.controller.signal.addEventListener("abort", cancel, { once: true })
    item.setSavePath(savePath)
    item.once("done", (_done, state) => {
      void (async () => {
        try {
          if (state !== "completed" || !source.current()) return
          const bytes = await readFile(savePath)
          if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
            throw Error("下载内容不是 PDF")
          await importFile(source, name, bytes.toString("base64"))
        } catch (error) {
          notify(source, { error: (error as Error).message })
        } finally {
          source.binding.controller.signal.removeEventListener("abort", cancel)
          await rm(savePath, { force: true }).catch(() => {})
        }
      })()
    })
  })
}
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
    cancelPaperBrowse(owner)
    lspService.dispose(owner)
    watchers.get(owner)?.()
    watchers.delete(owner)
    watchGenerations.delete(owner)
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
  registerIpc()
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
  for (const window of BrowserWindow.getAllWindows()) lspService.dispose(window.webContents.id)
  void Promise.allSettled(backends.map((backend) => backend.dispose())).then(() => {
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
