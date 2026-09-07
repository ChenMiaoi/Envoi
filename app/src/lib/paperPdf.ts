import type { PaperProject } from "./projectFiles"
export function paperPdf(project: PaperProject) {
  if (project.compiled && JSON.parse(project.compiled.signature)[0] === project.rootId)
    return { id: "compiled", path: "build/main.pdf", file: project.compiled.file, url: undefined }
  const root = project.files.find((file) => file.id === project.rootId)?.path
  if (!root) return undefined
  let manifestMain: string | undefined
  try {
    manifestMain = JSON.parse(
      project.files.find((file) => file.path === "build/preview.json")?.text ?? "null",
    )?.main
  } catch {
    /* An unverified output is never assigned to another root. */
  }
  const candidates =
    manifestMain === root
      ? ["build/main.pdf"]
      : root === "main.tex" && !manifestMain
        ? ["build/main.pdf", "output/main.pdf", "main.pdf"]
        : [`build/${root.replace(/\.tex$/i, ".pdf")}`, root.replace(/\.tex$/i, ".pdf")]
  return candidates
    .map((path) =>
      project.files.find(
        (file) => file.path === path && file.kind === "pdf" && (file.url || file.file),
      ),
    )
    .find(Boolean)
}
