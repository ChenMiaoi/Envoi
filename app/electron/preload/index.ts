import { contextBridge, ipcRenderer, webUtils } from "electron"
import type { EnvoiBridge } from "./api"

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

// 契约第 1 节全量方法清单（自检对照）：
// pickDirectory bindProject compilerRuntime compile cancelCompile lint tools configureTools
// gitRuntime gitInit gitStatus gitLog gitShow dataGet dataPut
// agentStatus agentRequest agentChat onAgentEvent
// fsList fsRead fsWrite fsWriteFiles fsMkdir fsRemove fsRename fsTrashProject assetUrl
const bridge: EnvoiBridge = {
  projectTrust: (root) => invoke("envoi:project-trust", root),
  grantProjectTrust: (root) => invoke("envoi:grant-project-trust", root),
  restrictProject: (root) => invoke("envoi:restrict-project", root),
  onTrustChanged: (listener) => {
    const handler = () => listener()
    ipcRenderer.on("envoi:trust-changed", handler)
    return () => ipcRenderer.removeListener("envoi:trust-changed", handler)
  },
  diagnosticsInfo: () => invoke("envoi:diagnostics-info"),
  diagnosticsOpen: () => invoke("envoi:diagnostics-open"),
  diagnosticsExport: () => invoke("envoi:diagnostics-export"),
  diagnosticsLog: (entry) => ipcRenderer.send("envoi:diagnostics-log", entry),
  appVersion: () => invoke("envoi:app-version"),
  checkUpdate: (channel) => invoke("envoi:check-update", channel),
  downloadUpdate: () => invoke("envoi:download-update"),
  openDownloadedUpdate: () => invoke("envoi:open-downloaded-update"),
  restartUpdate: () => invoke("envoi:restart-update"),
  updateState: () => invoke("envoi:update-state"),
  library: (root, input) => invoke("envoi:library", root, input),
  workspaces: (root, input) => invoke("envoi:workspaces", root, input),
  windowColors: (colors) => invoke("envoi:window-colors", colors),
  exampleDirectory: () => invoke("envoi:example-directory"),
  canonicalDirectory: (directory) => invoke("envoi:canonical-directory", directory),
  trustDirectory: (directory) => invoke("envoi:trust-directory", directory),
  pickDirectory: () => invoke("envoi:pick-directory"),
  bindProject: (directory, opts) => invoke("envoi:bind-project", directory, opts),

  compilerRuntime: () => invoke("envoi:compiler-runtime"),
  compile: (input) => invoke("envoi:compile", input),
  cancelCompile: () => invoke("envoi:cancel-compile"),
  lint: (input) => invoke("envoi:lint", input),

  tools: (options) => invoke("envoi:tools", options),
  lspOpen: (root, path, text, token, preferredServer, preferredPath) =>
    invoke("envoi:lsp-open", root, path, text, token, preferredServer, preferredPath),
  probeLspPath: (id, path) => invoke("envoi:probe-lsp-path", id, path),
  probeToolPath: (id, path) => invoke("envoi:probe-tool-path", id, path),
  lspChange: (root, path, text) => invoke("envoi:lsp-change", root, path, text),
  lspQuery: (root, path, method, offset, text) =>
    invoke("envoi:lsp-query", root, path, method, offset, text),
  lspClose: (root, path, token) => invoke("envoi:lsp-close", root, path, token),
  pythonEnvironment: (root, manager) => invoke("envoi:python-environment", root, manager),
  installLsp: (language) => invoke("envoi:install-lsp", language),
  installTool: (id) => invoke("envoi:install-tool", id),
  languageTool: (root, path, text, kind, selectedPath) =>
    invoke("envoi:language-tool", root, path, text, kind, selectedPath),
  onLspStatus: (cb) => {
    const listener = (
      _event: unknown,
      payload: { root: string; path: string; token: string; state: "failed" },
    ) => cb(payload)
    ipcRenderer.on("envoi:lsp-status", listener)
    return () => ipcRenderer.removeListener("envoi:lsp-status", listener)
  },
  onLspDiagnostics: (cb) => {
    const listener = (
      _event: unknown,
      payload: { root: string; path?: string; diagnostics: unknown[] },
    ) => cb(payload)
    ipcRenderer.on("envoi:lsp-diagnostics", listener)
    return () => ipcRenderer.removeListener("envoi:lsp-diagnostics", listener)
  },
  configureTools: (input) => invoke("envoi:configure-tools", input),
  paperSearchConfig: () => invoke("envoi:paper-search-config"),
  configurePaperSearch: (input) => invoke("envoi:configure-paper-search", input),
  bindPaperBrowse: (root) => invoke("envoi:paper-browse", root),
  onBrowseImported: (cb) => {
    const listener = (_event: unknown, payload: { title?: string; error?: string }) => cb(payload)
    ipcRenderer.on("envoi:browse-imported", listener)
    return () => ipcRenderer.removeListener("envoi:browse-imported", listener)
  },

  gitRuntime: () => invoke("envoi:git-runtime"),
  gitInit: (directory) => invoke("envoi:git-init", directory),
  gitStatus: (directory) => invoke("envoi:git-status", directory),
  gitLog: (directory, extra) => invoke("envoi:git-log", directory, extra),
  gitShow: (directory, extra) => invoke("envoi:git-show", directory, extra),

  dataGet: (store, key) => invoke("envoi:data-get", store, key),
  dataPut: (store, value, key, opts) => invoke("envoi:data-put", store, value, key, opts),

  agentStatus: () => invoke("envoi:agent-status"),
  agentRequest: (route, body) => invoke("envoi:agent-request", route, body),
  agentChat: (params) => invoke("envoi:agent-chat", params),
  onAgentEvent: (cb) => {
    const listener = (_event: unknown, payload: { projectId: string; [k: string]: unknown }) =>
      cb(payload)
    ipcRenderer.on("envoi:agent-event", listener)
    return () => ipcRenderer.removeListener("envoi:agent-event", listener)
  },

  closeProject: (root) => invoke("envoi:close-project", root),
  watchProject: (root) => invoke("envoi:watch-project", root),
  onFilesChanged: (cb) => {
    const listener = (
      _event: unknown,
      payload: { root: string; paths: string[]; error?: string },
    ) => cb(payload)
    ipcRenderer.on("envoi:files-changed", listener)
    return () => ipcRenderer.removeListener("envoi:files-changed", listener)
  },
  fsChildren: (root) => invoke("envoi:fs-children", root),
  fsList: (root) => invoke("envoi:fs-list", root),
  fsRead: (root, relPath) => invoke("envoi:fs-read", root, relPath),
  fsSave: (root, changes) => invoke("envoi:fs-save", root, changes),
  fsWrite: (root, relPath, content) => invoke("envoi:fs-write", root, relPath, content),
  fsWriteFiles: (root, files) => invoke("envoi:fs-write-files", root, files),
  fsMkdir: (root, relPath) => invoke("envoi:fs-mkdir", root, relPath),
  fsRemove: (root, relPath) => invoke("envoi:fs-remove", root, relPath),
  fsRename: (root, from, to) => invoke("envoi:fs-rename", root, from, to),
  fsCopy: (root, from, to) => invoke("envoi:fs-copy", root, from, to),
  fsImport: (root, sources, directory) => invoke("envoi:fs-import", root, sources, directory),
  importTokenForFile: (file) => invoke("envoi:fs-import-token", webUtils.getPathForFile(file)),
  fsInspectDeletion: (root) => invoke("envoi:fs-inspect-deletion", root),
  fsTrashProject: (root, typedName) => invoke("envoi:fs-trash-project", root, typedName),
  assetUrl: (root, relPath) => invoke("envoi:asset-url", root, relPath),
}

contextBridge.exposeInMainWorld("envoi", bridge)
