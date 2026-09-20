import type { PaperProject, ProjectFile } from "@/project/model"
import { maskLatex } from "./citations"
import { normalizePath } from "./paperSources"
import { findAssetUses } from "./assets"

/** Resolve literal project inputs; macro-generated paths conservatively invalidate. */
export function paperDependencies(project: PaperProject) {
  const selected = new Set<ProjectFile>()
  const root = project.files.find((file) => file.id === project.rootId)
  const rootDirectory = root?.path.replace(/[^/]+$/, "") ?? ""
  let dynamic = false
  const visit = (file: ProjectFile) => {
    if (selected.has(file)) return
    selected.add(file)
    if (file.text === undefined || !/\.(tex|sty|cls)$/i.test(file.path)) return
    const source = maskLatex(file.text)
    const graphics = [
      ...(maskLatex(root?.text ?? "") + source).matchAll(
        /\\graphicspath\s*\{((?:\s*\{[^}]*\}\s*)+)\}/g,
      ),
    ].flatMap((match) => [...match[1].matchAll(/\{([^}]*)\}/g)].map((part) => part[1]))
    if (
      graphics.some((directory) => /[\\#]/.test(directory)) ||
      /\\DeclareGraphicsExtensions\b/.test(source)
    )
      dynamic = true
    const resolve = (target: string, extensions: string[], asset = false) => {
      target = target.trim()
      if (/[\\#]/.test(target)) {
        dynamic = true
        return
      }
      const names = /\.[^/.]+$/.test(target)
        ? [target]
        : [target, ...extensions.map((extension) => target + extension)]
      const directories = [
        rootDirectory,
        file.path.replace(/[^/]+$/, ""),
        "",
        ...(asset ? graphics.flatMap((directory) => [rootDirectory + directory, directory]) : []),
      ]
      for (const directory of directories) {
        for (const name of names) {
          const found = project.files.find(
            (candidate) => candidate.path === normalizePath(directory + name),
          )
          if (found) {
            visit(found)
            return
          }
        }
      }
    }
    for (const match of source.matchAll(
      /\\(input|include|bibliography|addbibresource|bibliographystyle|usepackage|RequirePackage|documentclass|LoadClass|lstinputlisting|verbatiminput)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g,
    )) {
      const extension = /bibliography$|addbibresource/.test(match[1])
        ? ".bib"
        : match[1] === "bibliographystyle"
          ? ".bst"
          : /package|Package/.test(match[1])
            ? ".sty"
            : /class|Class/.test(match[1])
              ? ".cls"
              : ".tex"
      for (const target of match[2].split(",")) resolve(target, [extension])
    }
    for (const use of findAssetUses([{ id: file.id, path: file.path, text: file.text }]))
      resolve(use.target, [".pdf", ".png", ".jpg", ".jpeg", ".eps"], true)
    // Nonstandard TeX macros may read project files; include literal braced paths.
    for (const match of source.matchAll(
      /\{([^{}\n]+\.(?:csv|txt|dat|otf|ttf|pdf|png|jpg|tex|bib))\}/gi,
    ))
      resolve(match[1], [])
    if (/\\(?:input|include)\s+[^\s{]|\\(?:directlua|openin|read|csname)\b/.test(source))
      dynamic = true
  }
  if (root) visit(root)
  return dynamic
    ? project.files.filter(
        (file) =>
          !file.path.split("/").some((part) => part.startsWith(".")) &&
          /\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(file.path),
      )
    : [...selected]
}
