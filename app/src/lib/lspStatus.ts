import { useSyncExternalStore } from "react"

// 当前代码编辑器（CodeEditor，随 ReaderView 活动文件挂载）发布其 LSP 状态，状态栏订阅。
// null 表示打开的文件没有对应语言服务；"unavailable" 表示有服务器但启动失败。
export type LspStatus =
  | { state: "starting"; pluginId?: string; root?: string }
  | { state: "ready"; server: string; pluginId?: string; root?: string }
  | { state: "unavailable"; reason?: "missing" | "failed"; pluginId?: string; root?: string }
  | null

let current: LspStatus = null
const listeners = new Set<() => void>()

export function publishLspStatus(status: LspStatus) {
  current = status
  for (const listener of listeners) listener()
}

export interface LspProblem {
  severity: "error" | "warning"
  message: string
  line: number
  column: number
}
export interface LspFileDiagnostics {
  server: string
  items: LspProblem[]
}
let diagnostics = new Map<string, LspFileDiagnostics>()
const emit = () => {
  for (const listener of listeners) listener()
}
export function publishLspDiagnostics(path: string, server: string, items: LspProblem[]) {
  diagnostics = new Map(diagnostics).set(path, { server, items })
  emit()
}
export function clearLspDiagnostics(path: string) {
  if (!diagnostics.has(path)) return
  diagnostics = new Map(diagnostics)
  diagnostics.delete(path)
  emit()
}
export function useLspDiagnostics() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => diagnostics,
  )
}

export function useLspStatus() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
