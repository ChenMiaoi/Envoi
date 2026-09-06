import { maskLatex, findCitations } from "./citations";
export interface SourceFile { id: string; path: string; text: string }
export interface SourceLocation { fileId: string; path: string; start: number; end: number }
export function normalizePath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) { if (part === "..") parts.pop(); else if (part && part !== ".") parts.push(part); }
  return parts.join("/");
}
export function collectPaper(files: SourceFile[], rootId: string) {
  const reachable: SourceFile[] = [], missing: string[] = [], visited = new Set<string>();
  const root = files.find((file) => file.id === rootId);
  function visit(file: SourceFile) {
    if (visited.has(file.id)) return;
    visited.add(file.id); reachable.push(file);
    for (const match of maskLatex(file.text).matchAll(/\\(?:input|include)\s*\{([^}]+)\}/g)) {
      const target = match[1].trim().replace(/\.tex$/, "") + ".tex";
      const candidates = [normalizePath(file.path.replace(/[^/]+$/, "") + target), normalizePath((root?.path.replace(/[^/]+$/, "") ?? "") + target), normalizePath(target)];
      const child = candidates.map((path) => files.find((candidate) => candidate.path === path)).find(Boolean);
      if (child) visit(child); else missing.push(`${file.path} → ${target}`);
    }
  }
  if (root) visit(root);
  return { files: reachable, missing, citations: reachable.flatMap((file) => findCitations(file.text).map((citation) => ({ ...citation, fileId: file.id, path: file.path }))) };
}
