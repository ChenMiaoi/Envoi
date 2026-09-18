import { translate } from "@/i18n/runtime"
import { projectSignature } from "./compileClient"
import type { PaperProject } from "./projectFiles"
export interface PreviewManifest {
  main: string
  pdfSha256: string
  files: Record<string, string>
}
export const snapshotInput = (path: string) =>
  !path.split("/").some((p) => p.startsWith(".") || ["build", "output"].includes(p)) &&
  /\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(path)
async function digest(bytes: Uint8Array) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("")
}
export async function previewBytes(
  file: { text?: string; url?: string; file?: File },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted()
  if (file.text !== undefined) return new TextEncoder().encode(file.text)
  if (file.file) return new Uint8Array(await file.file.arrayBuffer())
  if (file.url) {
    const response = await fetch(file.url, { signal, cache: "no-store" })
    if (!response.ok) throw Error(translate("preview.resourceUnavailable"))
    return new Uint8Array(await response.arrayBuffer())
  }
  throw Error(translate("preview.missingFile"))
}
// Immutable File/ProjectFile objects retain their digest across editor updates.
// URL-only resources can change outside React, so always re-read those.
const inputDigests = new WeakMap<object, Promise<string>>()
async function inputDigest(file: { text?: string; url?: string; file?: File }) {
  const key = file.text !== undefined ? file : file.file
  if (!key) return digest(await previewBytes(file))
  let pending = inputDigests.get(key)
  if (!pending) {
    pending = previewBytes(file).then(digest)
    inputDigests.set(key, pending)
    void pending.catch(() => inputDigests.delete(key))
  }
  return pending
}
export async function previewManifest(project: PaperProject, pdf: File): Promise<PreviewManifest> {
  const files: Record<string, string> = {}
  for (const file of project.files.filter((f) => snapshotInput(f.path)))
    files[file.path] = await inputDigest(file)
  return {
    main: project.files.find((f) => f.id === project.rootId)!.path,
    pdfSha256: await inputDigest({ file: pdf }),
    files,
  }
}
export async function verifyPreview(
  project: PaperProject,
  pdf: { id: string; url?: string; file?: File },
) {
  if (pdf.id === "compiled") return project.compiled?.signature === projectSignature(project)
  try {
    const manifest: PreviewManifest = JSON.parse(
      project.files.find((f) => f.path === "build/preview.json")?.text ?? "null",
    )
    if (!manifest || manifest.main !== project.files.find((f) => f.id === project.rootId)?.path)
      return false
    const inputs = project.files.filter((f) => snapshotInput(f.path))
    if (inputs.length !== Object.keys(manifest.files).length) return false
    for (const file of inputs)
      if ((await inputDigest(file)) !== manifest.files[file.path]) return false
    return (await inputDigest(pdf)) === manifest.pdfSha256
  } catch {
    return false
  }
}
export function normalizeBookmark(title: string) {
  return title
    .normalize("NFKC")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
}
export function matchBookmark<T extends { title: string; items?: T[] }>(
  items: T[],
  title: string,
): T | undefined {
  const found: T[] = []
  function visit(nodes: T[]) {
    for (const node of nodes) {
      if (normalizeBookmark(node.title) === normalizeBookmark(title)) found.push(node)
      if (node.items) visit(node.items)
    }
  }
  visit(items)
  return found.length === 1 ? found[0] : undefined
}
