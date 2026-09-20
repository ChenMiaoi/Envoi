import { BrowserWindow, app, ipcMain } from "electron"
import { randomUUID } from "node:crypto"
import path from "node:path"
import { dataDir } from "../../server/local-data.mjs"
import { toolDirectories } from "../../server/tool-config.mjs"
import { safePathParts } from "../../shared/file-rules.mjs"
import { BackendHost } from "./backend-host"
import { diagnostics, operationContext } from "./diagnostics"
import { LspService } from "./lsp-service.mjs"
import { restrictedPath } from "./restricted-path.mjs"
import { createAssetProtocol } from "./services/asset-protocol"
import { setupPaperBrowse } from "./services/paper-browser"
import { ProjectSessionManager } from "./services/project-sessions"
import { createWorkspaceTrust } from "./workspace-trust.mjs"
import { RemoteWorkspaces } from "./remote/connection.mjs"
import { routeRemoteWorkspace, isRemoteRoot } from "./remote/workspace-routing.mjs"
export function createMainServices() {
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

  function decodeText(bytes: Buffer): string | undefined {
    try {
      const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
      return text.includes("\0") ? undefined : text
    } catch {
      return undefined // 非 UTF-8 或二进制内容按 base64 处理
    }
  }

  // ── 已绑定项目根与 envoi:// token 映射（仅存主进程内存）──

  const sessions = new ProjectSessionManager((owner, root) => lspService.dispose(owner, root))
  const remote = new RemoteWorkspaces({
    directory: path.join(dataDir, "remote-ssh"),
    binaryDirectory: import.meta.dirname,
    executable: process.execPath,
    sessions,
    send: (owner: number, channel: string, payload?: unknown) => {
      const sender = BrowserWindow.getAllWindows().find(
        (window) => window.webContents.id === owner,
      )?.webContents
      if (sender && !sender.isDestroyed()) sender.send(channel, payload)
    },
  })
  const droppedFiles = new Map<string, string>()
  async function requireBoundRoot(root: string): Promise<string> {
    const resolved = await workspaceTrust.requireTrust(root)
    sessions.bindRoot(resolved)
    return resolved
  }

  async function requireOpenRoot(root: string): Promise<string> {
    const resolved = await workspaceTrust.requireOpen(root)
    sessions.bindRoot(resolved)
    return resolved
  }

  async function resolveInside(root: string, relPath: string): Promise<string> {
    if (!(await workspaceTrust.isTrusted(root))) return restrictedPath(root, relPath)
    return path.join(root, ...safePathParts(relPath))
  }

  const handleAsset = createAssetProtocol(sessions, resolveInside, async (root, file) => {
    if (!isRemoteRoot(root)) return undefined
    const entry = [...remote.entries.values()].find(
      (entry) => entry.root === root && entry.state === "connected",
    )
    if (!entry) throw Error("Workspace connection is disconnected")
    const result = await remote.call(entry.owner, root, "fs-read", [file])
    return typeof result.text === "string"
      ? Buffer.from(result.text)
      : Buffer.from(result.base64, "base64")
  })
  // ── 编译单飞（对应当前服务端 running 语义；lint 不支持取消，见契约 §3）──

  const compilerBackend = new BackendHost("Compiler")
  const toolsBackend = new BackendHost("Tools")
  const agentBackend = new BackendHost("AI")
  const backends = [compilerBackend, toolsBackend, agentBackend]

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
    const root = sessions.activeRoot(event.sender.id)
    if (root) await workspaceTrust.requireTrust(root)
  }
  async function agentRoot(body: unknown) {
    const id = (body as { projectId?: string } | null)?.projectId
    if (!id) return undefined
    const root = sessions.projectRoot(id)
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
          const routed = await routeRemoteWorkspace(
            remote,
            sessions,
            event.sender.id,
            channel,
            args,
          )
          const result = routed ? routed.value : await listener(event, ...args)
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

  // ── 内置论文浏览：独立持久会话（persist:paperbrowse），PDF 下载直接入库 ──

  return {
    remote,
    workspaceTrust,
    decodeText,
    droppedFiles,
    requireBoundRoot,
    requireOpenRoot,
    resolveInside,
    handleAsset,
    compilerBackend,
    toolsBackend,
    agentBackend,
    backends,
    managedLspDirectory,
    managedToolsDirectory,
    lspService,
    requireToolContext,
    agentRoot,
    handle,
    setupPaperBrowse: () => setupPaperBrowse({ sessions, requireBoundRoot, remote }),
    sessions,
  }
}
export type MainServices = ReturnType<typeof createMainServices>
