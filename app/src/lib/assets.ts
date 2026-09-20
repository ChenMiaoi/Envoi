import { maskLatex } from "./citations"
import { normalizePath, type SourceFile, type SourceLocation } from "./paperSources"
export interface AssetUse extends SourceLocation {
  target: string
}
export function findAssetUses(files: SourceFile[]): AssetUse[] {
  return files.flatMap((file) =>
    [
      ...maskLatex(file.text).matchAll(
        /\\(?:includegraphics\*?|includepdf|pgfplotstableread|csvreader)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}|\\addplot\+?\s*(?:\[[^\]]*\])?\s*table\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
      ),
    ].map((match) => ({
      fileId: file.id,
      path: file.path,
      start: match.index,
      end: match.index + match[0].length,
      target: (match[1] || match[2]).trim(),
    })),
  )
}
export function assetMatches(path: string, use: AssetUse, available?: string[]) {
  if (available) {
    const names = /\.[^/.]+$/.test(use.target)
      ? [use.target]
      : [
          use.target,
          ...[".pdf", ".png", ".jpg", ".jpeg", ".eps"].map((extension) => use.target + extension),
        ]
    for (const directory of ["", use.path.replace(/[^/]+$/, "")]) {
      for (const name of names) {
        const candidate = normalizePath(directory + name)
        if (available.includes(candidate)) return normalizePath(path) === candidate
      }
    }
    return false
  }
  const removeExtension = (value: string) => value.replace(/\.(png|jpe?g|pdf|gif|webp|csv)$/i, "")
  const explicit = /\.[^/.]+$/.test(use.target)
  const comparable = (value: string) =>
    explicit ? normalizePath(value) : removeExtension(normalizePath(value))
  const target = comparable(use.target)
  const asset = comparable(path)
  return asset === target || asset === comparable(use.path.replace(/[^/]+$/, "") + use.target)
}
