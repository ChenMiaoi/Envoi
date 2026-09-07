import { contextBridge, ipcRenderer } from "electron"
import type { EnvoiBridge } from "./api"

function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args) as Promise<T>
}

// 契约第 1 节全量方法清单（自检对照）：
// pickDirectory bindProject compilerRuntime compile cancelCompile lint tools configureTools
// gitRuntime gitInit gitStatus gitLog gitShow dataGet dataPut
// agentStatus agentRequest agentChat onAgentEvent
// fsList fsRead fsWrite fsWriteFiles fsMkdir fsRemove fsRename fsRemoveTree assetUrl
const bridge: EnvoiBridge = {
  trustDirectory: (directory) => invoke("envoi:trust-directory", directory),
  pickDirectory: () => invoke("envoi:pick-directory"),
  bindProject: (directory, opts) => invoke("envoi:bind-project", directory, opts),

  compilerRuntime: () => invoke("envoi:compiler-runtime"),
  compile: (input) => invoke("envoi:compile", input),
  cancelCompile: () => invoke("envoi:cancel-compile"),
  lint: (input) => invoke("envoi:lint", input),

  tools: () => invoke("envoi:tools"),
  configureTools: (input) => invoke("envoi:configure-tools", input),

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
    const listener = (_event: unknown, payload: { projectId: string; [k: string]: unknown }) => cb(payload)
    ipcRenderer.on("envoi:agent-event", listener)
    return () => ipcRenderer.removeListener("envoi:agent-event", listener)
  },

  watchProject: root => invoke('envoi:watch-project', root),
  onFilesChanged: cb => {
    const listener = (_event: unknown, payload: {root: string; paths: string[]; error?: string}) => cb(payload)
    ipcRenderer.on('envoi:files-changed', listener)
    return () => ipcRenderer.removeListener('envoi:files-changed', listener)
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
  fsRemoveTree: (root) => invoke("envoi:fs-remove-tree", root),
  assetUrl: (root, relPath) => invoke("envoi:asset-url", root, relPath),
}

contextBridge.exposeInMainWorld("envoi", bridge)
