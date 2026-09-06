import { maskLatex } from "./citations";
import { normalizePath, type SourceFile, type SourceLocation } from "./paperSources";
export interface AssetUse extends SourceLocation { target: string }
export function findAssetUses(files: SourceFile[]): AssetUse[] {
  return files.flatMap((file) => [...maskLatex(file.text).matchAll(/\\(?:includegraphics\*?|includepdf|pgfplotstableread|csvreader)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}|\\addplot\+?\s*(?:\[[^\]]*\])?\s*table\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)].map((match) => ({ fileId: file.id, path: file.path, start: match.index, end: match.index + match[0].length, target: (match[1] || match[2]).trim() })));
}
export function assetMatches(path: string, use: AssetUse) {
  const removeExtension = (value: string) => value.replace(/\.(png|jpe?g|pdf|gif|webp|csv)$/i, "");
  const target = removeExtension(normalizePath(use.target));
  const asset = removeExtension(normalizePath(path));
  return (!target.includes("/") && asset.endsWith("/" + target)) || asset === target || asset === removeExtension(normalizePath(use.path.replace(/[^/]+$/, "") + use.target));
}
