import type { FileKind } from "@/data/workspace"
import type { ProjectConfiguration } from "@/settings/model"
import type { CompileDiagnostics, Diagnostic } from "@/lib/diagnostics"
export interface ProjectFile {
  version?: string
  file?: File
  id: string
  path: string
  kind: FileKind
  text?: string
  saved?: string
  url?: string
}
export interface PaperProject {
  settings?: ProjectConfiguration
  lint?: {
    fileId: string
    text: string
    status: "checking" | "ready" | "unavailable" | "disabled"
    message?: string
    items: Diagnostic[]
  }
  diagnostics?: CompileDiagnostics
  engine?: "pdflatex" | "xelatex"
  compiled?: { file: File; signature: string; synctex?: Uint8Array<ArrayBuffer> }
  compileStatus?: string
  compileLog?: string
  id: string
  name: string
  files: ProjectFile[]
  directories: string[]
  rootId: string
  rootPath?: string
}
