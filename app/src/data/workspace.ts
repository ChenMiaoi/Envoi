export type FileKind =
  "folder" | "pdf" | "markdown" | "latex" | "bib" | "image" | "csv" | "tsv" | "text" | "binary"

export interface FileNode {
  id: string
  name: string
  kind: FileKind
  children?: FileNode[]
}
