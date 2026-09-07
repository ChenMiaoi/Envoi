// window.envoi 桥接类型（契约第 1 节唯一事实来源）。
// preload/index.ts 实现此接口；src 侧经 app/src/lib/desktop.ts re-export 消费。
export interface EnvoiBridge {
  diagnosticsInfo(): Promise<{
    directory: string
    maxFileBytes: number
    files: number
    available: boolean
  }>
  diagnosticsOpen(): Promise<void>
  diagnosticsExport(): Promise<boolean>
  diagnosticsLog(entry: import("../../shared/log-record").RendererLog): void
  appVersion(): Promise<string>
  checkUpdate(): Promise<{
    currentVersion: string
    latestVersion?: string
    status: "inaccessible" | "available" | "current"
  }>
  downloadUpdate(): Promise<void>
  library(root: string, input: Record<string, unknown>): Promise<unknown>
  workspaces(root: string, input: Record<string, unknown>): Promise<unknown>
  windowColors(colors: { color: string; symbolColor: string }): Promise<void>
  // 目录与项目绑定（无 proof；directory 为绝对路径）
  exampleDirectory(): Promise<string>
  canonicalDirectory(directory: string): Promise<string>
  trustDirectory(directory: string): Promise<string>
  pickDirectory(): Promise<string | null>
  bindProject(
    directory: string,
    opts?: { copy?: boolean },
  ): Promise<{ ok: boolean; project: { id: string; path: string; name: string } }>

  // 编译（形状 = compileSnapshot 输入/输出；files 为 [{path, base64}]）
  compilerRuntime(): Promise<Record<string, unknown>>
  compile(input: {
    rootPath: string
    main: string
    engine: string
    files?: { path: string; base64: string }[]
    drafts?: { path: string; text: string }[]
  }): Promise<{ ok: boolean; pdf?: string; synctex?: string | null; log: string; error?: string }>
  cancelCompile(): Promise<void>
  lint(input: {
    rootPath?: string
    path: string
    text: string
    disabledRules?: number[]
  }): Promise<{ available: boolean; items?: unknown[]; error?: string }>

  // 工具
  tools(): Promise<Record<string, unknown>>
  configureTools(input: { chktexPath: string | null }): Promise<Record<string, unknown>>

  // Git（directory 为绝对路径；返回形状同原 HTTP 处理器）
  gitRuntime(): Promise<{ available: boolean; version?: string; error?: string }>
  gitInit(directory: string): Promise<unknown>
  gitStatus(directory: string): Promise<unknown>
  gitLog(directory: string, extra?: Record<string, unknown>): Promise<unknown>
  gitShow(directory: string, extra: Record<string, unknown>): Promise<unknown>

  // 本地数据存储（镜像原 nativeGet/nativePut；value 已经过 renderer 端 encodeNative）
  dataGet(store: string, key?: string): Promise<unknown>
  dataPut(
    store: string,
    value: unknown,
    key?: string,
    opts?: { migrate?: boolean; expectedRevision?: number },
  ): Promise<unknown>

  // AI agent
  agentStatus(): Promise<Record<string, unknown>>
  agentRequest(route: string, body: unknown): Promise<unknown>
  agentChat(params: {
    projectId: string
    sessionId?: string
    paperId?: string
    context?: string
    dirty: boolean
    message: string
  }): Promise<{ ok: boolean }>
  onAgentEvent(cb: (event: { projectId: string; [k: string]: unknown }) => void): () => void

  // 项目文件服务（root 必须是已 bindProject 的项目根；relPath 需通过 safePath 规则，主进程二次校验）
  closeProject(root: string): Promise<void>
  watchProject(root: string | null): Promise<void>
  onFilesChanged(cb: (event: { root: string; paths: string[]; error?: string }) => void): () => void
  fsChildren(root: string): Promise<{ name: string; kind: "directory" | "file" }[]>
  fsList(root: string): Promise<{
    name?: string
    projectId?: string
    files: { path: string; kind: string; text?: string; version?: string }[]
    directories: string[]
  }>
  fsRead(root: string, relPath: string): Promise<{ text?: string; base64?: string }>
  fsSave(
    root: string,
    changes: { path: string; text: string; expectedText: string | null }[],
  ): Promise<{ saved: string[]; error?: string }>
  fsWrite(root: string, relPath: string, content: { text?: string; base64?: string }): Promise<void>
  fsWriteFiles(
    root: string,
    files: { path: string; text?: string; base64?: string }[],
  ): Promise<void>
  fsMkdir(root: string, relPath: string): Promise<void>
  fsRemove(root: string, relPath: string): Promise<void>
  fsRename(root: string, from: string, to: string): Promise<void>
  fsInspectDeletion(root: string): Promise<{
    path: string
    name: string
    label: string
    kind: "project" | "worktree"
    related: string[]
    blocked?: string
  }>
  fsTrashProject(root: string, typedName: string): Promise<{ warnings: string[] }>
  assetUrl(root: string, relPath: string): Promise<string>
}
