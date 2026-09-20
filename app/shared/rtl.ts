export interface RtlConfiguration {
  version: 1
  files: string[]
  filelist: string
  includeDirs: string[]
  defines: string[]
  parameters: string[]
  top: string
  libraries: Record<string, string>
  systemVerilogFiles: string[]
}
export interface RtlDiagnostic {
  path: string
  line: number
  column: number
  message: string
  severity: string
  source: string
}
export type RtlRequest =
  | { action: "load" }
  | { action: "save"; configuration: RtlConfiguration }
  | { action: "check"; tool: "verilator" | "vivado"; toolPath?: string }
  | { action: "importVivado"; projectFile: string; toolPath?: string }
export interface RtlResult {
  configuration?: RtlConfiguration
  diagnostics?: RtlDiagnostic[]
  ok?: boolean
  log?: string
  files?: number
}
