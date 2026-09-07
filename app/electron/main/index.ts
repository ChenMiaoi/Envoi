import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from "electron"
import { randomBytes } from "node:crypto"
import { cp, mkdtemp, mkdir, readdir, readFile, stat, realpath, rename, rm } from "node:fs/promises"
import path from "node:path"

import type { CompileInput } from "../../server/compiler.mjs"
import { dataStore, registerProject, dataDir } from "../../server/local-data.mjs"
import {watchProjectDirectory} from './project-watch.mjs'
import {BackendHost} from './backend-host'
import {atomicProjectWrite, saveProjectFiles} from './file-service.mjs'

import {createWorkspaceTrust} from './workspace-trust.mjs'
// Finder does not inherit a terminal's PATH. Include common local tool locations.
if (process.platform === 'darwin') process.env.PATH = [...new Set([...(process.env.PATH ?? '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/Library/TeX/texbin', '/usr/bin', '/bin'].filter(Boolean))].join(path.delimiter)
const workspaceTrust = createWorkspaceTrust(path.join(dataDir, 'workspace-trust.json'), async (root: string) => {
  const result = await dialog.showMessageBox({type: 'question', title: '信任此目录？', message: '是否信任此目录中的文件？', detail: `${root}\n\n信任后，此目录及子目录的 Git、LaTeX、AI 和文件操作将全部启用，可以运行本机工具和修改文件。以后打开不再询问。`, buttons: ['信任并打开', '取消'], defaultId: 0, cancelId: 1, noLink: true})
  return result.response === 0
})

// ── 与 src/lib/projectFiles.ts 等价的纯函数副本（主进程不跨边界 import src）──

function isTextPath(value: string): boolean {
  return /\.(tex|bib|md|markdown|txt|csv|tsv|json|sty|cls|bst|log|yaml|yml|toml|ini|cfg|py|r|js|ts|jsx|tsx|css|html|xml|sh|sql|c|h|cpp|rs|go|jl)$/i.test(value) || /(^|\/)(README|LICENSE|Makefile|Dockerfile|\.gitignore)$/i.test(value)
}

function fileKind(value: string): string {
  const extension = value.split(".").pop()?.toLowerCase()
  return extension === "tex" ? "latex" : extension === "bib" ? "bib" : extension === "pdf" ? "pdf"
    : ["png", "jpg", "jpeg", "webp", "gif", "svg", "avif", "bmp", "ico"].includes(extension ?? "") ? "image"
    : extension === "csv" ? "csv" : extension === "tsv" ? "tsv"
    : ["md", "markdown"].includes(extension ?? "") ? "markdown" : isTextPath(value) ? "text" : "binary"
}

// 与 src 侧 safePath 等价的二次校验：拒绝 ..、绝对路径、反斜杠/冒号与控制字符。
function safePathParts(relPath: string): string[] {
  if (typeof relPath !== "string") throw new Error("无效文件路径")
  const parts = relPath.trim().split("/")
  if (!parts.length || parts.some((part) => !part || part === "." || part === ".." || /[\\:]/.test(part) || [...part].some((character) => character.charCodeAt(0) < 32))) throw new Error("无效文件路径")
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

async function resolveInside(root: string, relPath: string): Promise<string> {
  return path.join(root, ...safePathParts(relPath))
}

// ── envoi:// 自定义协议（契约第 2 节）──

const MIME: Record<string, string> = {
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp", ico: "image/x-icon",
  json: "application/json", css: "text/css", html: "text/html", js: "text/javascript", mjs: "text/javascript",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", tsv: "text/tab-separated-values", xml: "application/xml",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eps: "application/postscript",
}

protocol.registerSchemesAsPrivileged([
  { scheme: "envoi", privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
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
  return new Response(new Uint8Array(data), { headers: { "Content-Type": mime, "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" } })
}

// ── 编译单飞（对应当前服务端 running 语义；lint 不支持取消，见契约 §3）──

const compileRequests = new Map<number, Set<{cancelled: boolean}>>()
const compilerBackend = new BackendHost('Compiler')
const toolsBackend = new BackendHost('Tools')
const agentBackend = new BackendHost('AI')
const backends = [compilerBackend, toolsBackend, agentBackend]
const watchers = new Map<number, () => void>()
const watchGenerations = new Map<number, number>()
const projectRoots = new Map<string, string>()
async function agentRoot(body: unknown) {
  const id = (body as {projectId?: string} | null)?.projectId
  if (!id) return undefined
  const root = projectRoots.get(id)
  if (!root) throw Error('请先打开项目。')
  return requireBoundRoot(root)
}

// ── IPC 通道（契约第 1 节；错误消息沿用中文风格）──

let exampleCreation: Promise<string> | undefined
function registerIpc(): void {
  ipcMain.handle('envoi:example-directory', () => {
    exampleCreation ??= (async () => {
      const source=app.isPackaged?path.join(process.resourcesPath,'demo'):path.resolve(import.meta.dirname,'../../../examples/demo')
      if(!app.isPackaged)return realpath(source)
      const parent=path.join(app.getPath('userData'),'examples'),target=path.join(parent,'demo')
      try{return await realpath(target)}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
      await mkdir(parent,{recursive:true})
      const staging=await mkdtemp(path.join(parent,'.demo-'))
      try{await cp(source,staging,{recursive:true,filter:entry=>!['.git','.envoi','.paperdesk'].includes(path.basename(entry))});await rename(staging,target);return await realpath(target)}
      finally{await rm(staging,{recursive:true,force:true})}
    })().finally(()=>{exampleCreation=undefined})
    return exampleCreation
  })

  ipcMain.handle("envoi:pick-directory", async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await dialog.showOpenDialog(window!, { properties: ["openDirectory", "createDirectory"] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle("envoi:bind-project", async (_event, directory: string, opts?: { copy?: boolean }) => {
    const root = await workspaceTrust.trust(directory)
    const project = await registerProject(root, { copy: opts?.copy ?? true })
    bindRoot(root)
    projectRoots.set(project.id, root)
    return { ok: true, project: { id: project.id, path: root, name: project.name } }
  })

  ipcMain.handle('envoi:canonical-directory', (_event, directory: string) => {
    if(typeof directory!=='string'||!path.isAbsolute(directory))throw Error('需要绝对目录路径')
    return realpath(directory)
  })
  ipcMain.handle("envoi:trust-directory", async (_event, directory: string) => {
    const root = await workspaceTrust.trust(directory)
    bindRoot(root)
    return root
  })
  ipcMain.handle("envoi:compiler-runtime", () => compilerBackend.call('runtime'))
  ipcMain.handle("envoi:compile", async (event, input: CompileInput) => {
    const owner = event.sender.id, request = {cancelled: false}
    const requests = compileRequests.get(owner) ?? new Set<{cancelled: boolean}>()
    requests.add(request); compileRequests.set(owner, requests)
    try {
      const root = await requireBoundRoot(input.rootPath!)
      if (request.cancelled || event.sender.isDestroyed()) throw Error('编译已取消')
      return await compilerBackend.call('compile', [input], {owner, root})
    } finally {requests.delete(request); if (!requests.size) compileRequests.delete(owner)}
  })
  ipcMain.handle("envoi:cancel-compile", event => {
    for (const request of compileRequests.get(event.sender.id) ?? []) request.cancelled = true
    return compilerBackend.cancel(event.sender.id)
  })
  ipcMain.handle("envoi:lint", async (event, input: {rootPath?: string; path: string; text: string; disabledRules?: number[]}) =>
    toolsBackend.call('lint', [input], {owner: event.sender.id, root: input.rootPath ? await requireBoundRoot(input.rootPath) : undefined}))
  ipcMain.handle("envoi:tools", () => toolsBackend.call('tools'))
  ipcMain.handle("envoi:configure-tools", (_event, input: {chktexPath: string | null}) => toolsBackend.call('configureTools', [input]))
  ipcMain.handle("envoi:git-runtime", () => toolsBackend.call('gitRuntime'))
  for (const [channel, method] of [['git-init','gitInit'], ['git-status','gitStatus'], ['git-log','gitLog'], ['git-show','gitShow']]) {
    ipcMain.handle(`envoi:${channel}`, async (_event, directory: string, extra?: Record<string, unknown>) =>
      toolsBackend.call(method, [await requireBoundRoot(directory), extra]))
  }

  // dataStore 返回 {status, body}（镜像 HTTP，含 409 revision 冲突）；>=400 抛错，语义同原 HTTP client。
  const store = async (input: Parameters<typeof dataStore>[0]): Promise<unknown> => {
    const result = (await dataStore(input)) as { status: number; body: { error?: string } }
    if (result.status >= 400) throw new Error(result.body?.error ?? "本机数据操作失败")
    return result.body
  }
  ipcMain.handle("envoi:data-get", (_event, name: string, key?: string) => store({ store: name, key: key ?? "default", action: "get" }))
  ipcMain.handle("envoi:data-put", (_event, name: string, value: unknown, key?: string, opts?: { migrate?: boolean; expectedRevision?: number }) =>
    store({ store: name, key: key ?? "default", action: "put", value, migrate: opts?.migrate, expectedRevision: opts?.expectedRevision }))

  ipcMain.handle("envoi:agent-status", () => agentBackend.call('agentStatus'))
  ipcMain.handle("envoi:agent-request", async (_event, route: string, body: unknown) => {
    if (route === 'bind') throw Error('请通过打开项目连接目录。')
    const result = (await agentBackend.call('agentRequest', [route, body], {root: await agentRoot(body)})) as { status: number; body: { error?: string } }
    if (result.status >= 400) throw new Error(result.body?.error ?? "AI 操作失败")
    return result.body
  })
  ipcMain.handle("envoi:agent-chat", async (event, params: { projectId: string; sessionId?: string; context?: string; dirty: boolean; message: string }) => {
    const sender = event.sender
    const root = await agentRoot(params)
    void agentBackend.call('agentChat', [params], {owner: sender.id, root,
      onEvent: (chatEvent: Record<string, unknown>) => {
        if (!sender.isDestroyed()) sender.send("envoi:agent-event", { projectId: params.projectId, ...chatEvent })
      },
    }).catch((error: Error) => { if (!sender.isDestroyed()) sender.send("envoi:agent-event", {projectId: params.projectId, type: "error", message: error.message}) })
    return { ok: true }
  })

  ipcMain.handle('envoi:close-project', async (event, root: string) => {
    const owner = event.sender.id
    watchGenerations.set(owner, (watchGenerations.get(owner) ?? 0) + 1)
    watchers.get(owner)?.(); watchers.delete(owner)
    for (const request of compileRequests.get(owner) ?? []) request.cancelled = true
    await Promise.all(backends.map(backend => backend.cancel(owner, root)))
  })
  ipcMain.handle('envoi:watch-project', async (event, directory: string | null) => {
    const owner = event.sender.id, generation = (watchGenerations.get(owner) ?? 0) + 1
    watchGenerations.set(owner, generation)
    watchers.get(owner)?.(); watchers.delete(owner)
    if (!directory) return
    const root = await requireBoundRoot(directory)
    if (event.sender.isDestroyed() || watchGenerations.get(owner) !== generation) return
    watchers.set(owner, watchProjectDirectory(root, (change: {root: string; paths: string[]; error?: string}) => {
      if (!event.sender.isDestroyed()) event.sender.send('envoi:files-changed', change)
    }))
  })
  ipcMain.handle("envoi:fs-children", async (_event, root: string) => {
    const entries = await readdir(await requireBoundRoot(root), {withFileTypes: true})
    return entries.map(entry => ({name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file'}))
  })
  ipcMain.handle("envoi:fs-list", async (_event, root: string) => {
    const base = await requireBoundRoot(root)
    const files: { path: string; kind: string; text?: string; version: string }[] = []
    const directories: string[] = []
    const walk = async (directory: string, prefix: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if ([".git", ".envoi", ".paperdesk", "node_modules", ".DS_Store"].includes(entry.name) || entry.isSymbolicLink()) continue
        const rel = prefix + entry.name
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
    return { files, directories }
  })

  ipcMain.handle("envoi:fs-read", async (_event, root: string, relPath: string) => {
    const target = await resolveInside(await requireBoundRoot(root), relPath)
    const bytes = await readFile(await realpath(target))
    const text = isTextPath(relPath) ? decodeText(bytes) : undefined
    return text !== undefined ? { text } : { base64: bytes.toString("base64") }
  })

  const writeOne = async (base: string, file: { path: string; text?: string; base64?: string }): Promise<void> => {
    await atomicProjectWrite(base, file.path, file)
  }
  ipcMain.handle("envoi:fs-save", async (_event, root: string, changes: {path: string; text: string; expectedText: string | null}[]) =>
    saveProjectFiles(await requireBoundRoot(root), changes))
  ipcMain.handle("envoi:fs-write", async (_event, root: string, relPath: string, content: { text?: string; base64?: string }) => {
    await writeOne(await requireBoundRoot(root), { path: relPath, ...content })
  })
  ipcMain.handle("envoi:fs-write-files", async (_event, root: string, files: { path: string; text?: string; base64?: string }[]) => {
    const base = await requireBoundRoot(root)
    for (const file of files) await writeOne(base, file)
  })
  ipcMain.handle("envoi:fs-mkdir", async (_event, root: string, relPath: string) => {
    await mkdir(await resolveInside(await requireBoundRoot(root), relPath), { recursive: true })
  })
  ipcMain.handle("envoi:fs-remove", async (_event, root: string, relPath: string) => {
    const target = await resolveInside(await requireBoundRoot(root), relPath)
    await rm(target)
  })
  ipcMain.handle("envoi:fs-rename", async (_event, root: string, from: string, to: string) => {
    const base = await requireBoundRoot(root)
    await rename(await resolveInside(base, from), await resolveInside(base, to))
  })
  ipcMain.handle("envoi:fs-remove-tree", async (_event, root: string) => {
    const base = await requireBoundRoot(root)
    await Promise.all(backends.map(backend => backend.cancel(undefined, base)))
    await rm(base, { recursive: true, force: true })
    unbindRoot(base)
  })
  ipcMain.handle("envoi:asset-url", async (_event, root: string, relPath: string) => {
    const base = await requireBoundRoot(root)
    const parts = safePathParts(relPath)
    return `envoi://${tokensByRoot.get(base)}/${parts.map(encodeURIComponent).join("/")}`
  })
}

// ── 窗口 ──

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    title: "Envoi",
    ...(process.platform === 'darwin' ? {titleBarStyle: 'hidden' as const, trafficLightPosition: {x: 16, y: 14}} : {}),
    webPreferences: {
      preload: path.join(import.meta.dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })
  const owner = window.webContents.id
  window.webContents.once('destroyed', () => {watchers.get(owner)?.(); watchers.delete(owner); watchGenerations.delete(owner); for (const backend of backends) void backend.cancel(owner).catch(() => {})})
  window.webContents.on('will-prevent-unload', event => {
    const response = dialog.showMessageBoxSync(window, {type: 'question', message: '当前项目有未保存的更改', detail: '返回编辑器保存，或放弃未保存的更改并退出。', buttons: ['返回编辑器', '不保存并退出'], defaultId: 0, cancelId: 0})
    if (response === 1) event.preventDefault()
  })
  window.webContents.setWindowOpenHandler(({url}) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return {action: 'deny'}
  })
  window.webContents.on('will-navigate', (event, url) => {
    const current = window.webContents.getURL().split('#')[0]
    if (url.split('#')[0] !== current) {
      event.preventDefault()
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    }
  })
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(path.join(import.meta.dirname, "../renderer/index.html"))
}

void app.whenReady().then(() => {
  protocol.handle("envoi", handleAsset)
  registerIpc()
  createWindow()
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

let cleanedUp = false
app.on('will-quit', event => {
  if (cleanedUp) return
  event.preventDefault()
  void Promise.allSettled(backends.map(backend => backend.dispose())).then(() => {cleanedUp = true; app.quit()})
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})
