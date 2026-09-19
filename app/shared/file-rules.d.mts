export type FileKind =
  "latex" | "bib" | "pdf" | "image" | "csv" | "tsv" | "markdown" | "text" | "binary"
export function fileKind(path: string): FileKind
export function isTextPath(path: string): boolean
export function safePathParts(path: string, message?: string): string[]
