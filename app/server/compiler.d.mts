import type { Plugin } from "vite"
export function compilerPlugin(): Plugin
export interface CompileInput {
  rootPath?: string
  main: string
  engine: string
  drafts?: { path: string; text: string }[]
  files?: { path: string; base64: string }[]
}
export interface CompileResult {
  ok: boolean
  pdf?: string
  synctex?: string | null
  log: string
  error?: string
}
export function compileSnapshot(
  input: CompileInput,
  options?: { signal?: AbortSignal; timeoutMs?: number; trustedRoot?: string; sourceRoot?: string },
): Promise<CompileResult>
export function runtimeInfo(options?: { trusted?: boolean }): {
  available: boolean
  error?: string
  [key: string]: unknown
}
