import type {
  LibraryAction,
  LibraryInput,
  LibraryResults,
  WorkspaceAction,
  WorkspaceInput,
  WorkspaceResults,
  AgentRoute,
  AgentInput,
  AgentResults,
} from "./contracts"
import type { AgentStatus } from "./agent-model"
// Platform-neutral contract implemented by the Electron preload bridge.
export interface EnvoiBridge {
  wslDirectories(
    host: string,
    input?: string,
  ): Promise<{ home: string; directory: string; directories: string[] }>
  wslDistributions(): Promise<string[]>
  remoteList(): Promise<import("./remote").RemoteState[]>
  remoteConnect(
    target: import("./remote").SshTarget,
    requestId?: string,
  ): Promise<import("./remote").RemoteState>
  remoteReconnect(root: string, requestId?: string): Promise<import("./remote").RemoteState>
  remoteCancel(requestId: string): Promise<void>
  remoteDisconnect(root?: string): Promise<void>
  remoteAnswer(id: string, answer: string): Promise<void>
  onRemoteEvent(listener: (event: import("./remote").RemoteEvent) => void): () => void
  terminalOpen(root?: string): Promise<{ output: string }>
  terminalInput(
    input: { data: string; root?: string } | { cols: number; rows: number; root?: string },
  ): Promise<void>
  terminalClose(root?: string): Promise<void>
  projectTrust(root: string): Promise<{ trusted: boolean; decided: boolean }>
  grantProjectTrust(root: string): Promise<{ trusted: boolean; decided: boolean }>
  restrictProject(root: string): Promise<{ trusted: boolean; decided: boolean }>
  onTrustChanged(listener: () => void): () => void
  diagnosticsInfo(): Promise<{
    directory: string
    maxFileBytes: number
    files: number
    available: boolean
  }>
  diagnosticsOpen(): Promise<void>
  diagnosticsExport(): Promise<boolean>
  diagnosticsLog(entry: import("./log-record").RendererLog): void
  appVersion(): Promise<string>
  checkUpdate(channel?: "stable" | "preview"): Promise<{
    currentVersion: string
    latestVersion?: string
    status: "inaccessible" | "available" | "current" | "unpublished"
    downloadAvailable: boolean
    prerelease: boolean
    restartAvailable: boolean
  }>
  downloadUpdate(): Promise<{ path?: string; restartAvailable?: boolean }>
  openDownloadedUpdate(): Promise<void>
  restartUpdate(): Promise<void>
  updateState(): Promise<{
    channel?: "stable" | "preview"
    latestVersion?: string
    downloaded: boolean
    restartAvailable: boolean
  }>
  library<A extends LibraryAction>(root: string, input: LibraryInput<A>): Promise<LibraryResults[A]>
  workspaces<A extends WorkspaceAction>(
    root: string,
    input: WorkspaceInput<A>,
  ): Promise<WorkspaceResults[A]>
  windowColors(colors: { color: string; symbolColor: string }): Promise<void>
  // 目录与项目绑定（无 proof；directory 为绝对路径）
  exampleDirectory(): Promise<string>
  canonicalDirectory(directory: string): Promise<string>
  trustDirectory(directory: string): Promise<string>
  pickDirectory(): Promise<string | null>
  bindProject(
    directory: string,
    opts?: { copy?: boolean; prepare?: boolean },
  ): Promise<{ ok: boolean; project: { id: string; path: string; name: string } }>
  cancelProjectOpen(): Promise<void>

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
  tools(options?: { refresh?: boolean; root?: string }): Promise<Record<string, unknown>>
  lspOpen(
    root: string,
    path: string,
    text: string,
    token: string,
    preferredServer?: string,
    preferredPath?: string,
  ): Promise<{ available: boolean; server?: string; error?: string }>
  probeLspPath(id: string, path: string): Promise<{ path: string; version?: string }>
  probeToolPath(id: string, path: string): Promise<{ path: string; version?: string }>
  lspChange(root: string, path: string, text: string): Promise<void>
  lspQuery(
    root: string,
    path: string,
    method: string,
    offset: number,
    text: string,
  ): Promise<unknown>
  lspClose(root: string, path: string, token: string): Promise<void>
  pythonEnvironment(root: string, manager?: "venv" | "uv"): Promise<{ path: string | null }>
  installLsp(language: string): Promise<{ id: string; path: string; version: string }>
  installTool(id: string): Promise<{ id: string; path: string; version?: string }>
  languageTool(
    root: string,
    path: string,
    text: string,
    kind: "format" | "lint",
    selectedPath?: string,
  ): Promise<{
    text?: string
    diagnostics?: {
      line: number
      column: number
      message: string
      severity: string
      source: string
    }[]
    tool: string
  }>
  onLspStatus(
    cb: (event: { root: string; path: string; token: string; state: "failed" }) => void,
  ): () => void
  onLspDiagnostics(
    cb: (event: { root: string; path?: string; diagnostics: unknown[] }) => void,
  ): () => void
  configureTools(input: { chktexPath: string | null }): Promise<Record<string, unknown>>
  paperSearchConfig(): Promise<{
    semanticScholarKey: string
    contactEmail: string
    sourceWeights: Record<"openalex" | "semanticscholar" | "crossref" | "arxiv", number>
  }>
  configurePaperSearch(input: {
    semanticScholarKey: string
    contactEmail: string
    sourceWeights: Record<"openalex" | "semanticscholar" | "crossref" | "arxiv", number>
  }): Promise<{
    semanticScholarKey: string
    contactEmail: string
    sourceWeights: Record<"openalex" | "semanticscholar" | "crossref" | "arxiv", number>
  }>
  // 内置论文浏览：绑定当前论文库（PDF 下载直接入库），下载完成事件
  bindPaperBrowse(root: string): Promise<unknown>
  onBrowseImported(cb: (event: { title?: string; error?: string }) => void): () => void

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
  agentStatus(): Promise<AgentStatus>
  agentRequest<R extends AgentRoute>(route: R, body: AgentInput<R>): Promise<AgentResults[R]>
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
  fsCopy(root: string, from: string, to: string): Promise<void>
  fsImport(root: string, tokens: string[], directory: string): Promise<void>
  importTokenForFile(file: File): Promise<string>
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
