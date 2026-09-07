import { translate } from "@/i18n/runtime"
import type { ProjectFile } from "./projectFiles"
export interface Diagnostic {
  id: string
  column?: number
  source?: "compile" | "lint"
  severity: "error" | "warning"
  message: string
  path?: string
  line?: number
}
export interface CompileDiagnostics {
  items: Diagnostic[]
  timestamp?: number
  engine?: string
  signature: string
  rootId: string
  status: "running" | "success" | "failed" | "cancelled"
  log: string
}
export function safeDiagnosticText(text: string) {
  return text
    .replace(/(?:\/(?:[^\s()]+\/)*envoi-tex-[^/\s]+\/project\/)/g, "")
    .replace(/\/(?:[^\s()]+\/)+([^\s()]+)/g, "$1")
}
export function parseDiagnostics(
  log: string,
  files: Pick<ProjectFile, "path" | "text">[],
  failed = false,
): Diagnostic[] {
  log = log.replace(/\r+\n/g, "\n")
  const parts = log.split(/\n\[(pdflatex|xelatex|bibtex|xdvipdfmx)\]\n/)
  let lastTex = "",
    bib = ""
  for (let i = 1; i < parts.length; i += 2) {
    if (["pdflatex", "xelatex"].includes(parts[i])) lastTex = parts[i + 1]
    if (parts[i] === "bibtex") bib += parts[i + 1] + "\n"
  }
  let text = lastTex ? lastTex + "\n" + bib : log
  for (let pass = 0; pass < 6; pass++)
    text = text.replace(
      /(\((?:[a-z]:[\\/]|\/|\.\/)[^()\s]*)\n([^\s()]+)/gi,
      (whole, left: string, right: string) =>
        /\.(?:tex|bib|sty|cls|def|aux|clo)$/.test(left) ? whole : left + right,
    )
  text = text.replace(
    /(^(?:[a-z]:[\\/]|\/)[^\s()]*?)\n([^\s()]+\.(?:tex|bib|sty|cls):\d+:)/gim,
    "$1$2",
  )
  const lines = text.split("\n"),
    stack: (string | undefined)[] = [],
    items: Diagnostic[] = []
  const mapPath = (raw: string) => {
    const normalized = raw
      .replace(/\\/g, "/")
      .replace(/^.*\/project\//, "")
      .replace(/^\.\//, "")
    return files.find((file) => file.path === normalized)?.path
  }
  const add = (severity: Diagnostic["severity"], message: string, path?: string, line?: number) => {
    const file = files.find((f) => f.path === path)
    const validLine =
      line && file?.text !== undefined && line <= file.text.split("\n").length ? line : undefined
    const clean = safeDiagnosticText(message).trim()
    if (
      !items.some(
        (i) =>
          i.severity === severity && i.message === clean && i.path === path && i.line === validLine,
      )
    )
      items.push({ id: String(items.length), severity, message: clean, path, line: validLine })
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const priorFile = [...stack].reverse().find(Boolean)
    for (const match of line.matchAll(/\(([^\s()]+\.(?:tex|bib|sty|cls))?|\)/g)) {
      if (match[0] === ")") stack.pop()
      else stack.push(match[1] ? mapPath(match[1]) : undefined)
    }
    const current = /(?:Warning:|^Warning--|^!|^(?:Overfull|Underfull))/.test(line)
      ? (priorFile ?? [...stack].reverse().find(Boolean))
      : [...stack].reverse().find(Boolean)
    const located = /^(.+?\.(?:tex|bib|sty|cls)):(\d+):\s*(.+)$/.exec(line)
    if (located) {
      if (
        /Fatal error occurred/.test(located[3]) &&
        items.some((item) => item.severity === "error")
      )
        continue
      add("error", located[3], mapPath(located[1]), Number(located[2]))
      continue
    }
    if (/^!\s/.test(line)) {
      const next = lines.slice(i + 1, i + 8).join("\n"),
        position = /^l\.(\d+)/m.exec(next)
      add("error", line.replace(/^!\s*/, ""), current, position ? Number(position[1]) : undefined)
      continue
    }
    if (
      /(?:LaTeX|Package \S+|Class \S+) Warning:|^Warning--|^(?:Overfull|Underfull) \\[hv]box/.test(
        line,
      )
    ) {
      let message = line
      for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
        const next = lines[j]
        if (!next.trim() || /Warning:|^\[|^\(|^\)|^!|^<|^Output/.test(next)) break
        if (
          /^(?:on |n input|input |at lines|[a-z].*\.$)/.test(next) ||
          /input line|--line \d+/.test(next)
        )
          message += (message.length >= 70 ? "" : " ") + next.trim()
        else break
      }
      const position = /(?:input line|at lines?|--line)\s+(\d+)/.exec(message),
        bibFile = /of file\s+(\S+\.bib)/.exec(message)
      add(
        "warning",
        message,
        bibFile ? mapPath(bibFile[1]) : current,
        position ? Number(position[1]) : undefined,
      )
    }
  }
  if (failed && !items.some((item) => item.severity === "error"))
    add(
      "error",
      log.split("\n").find((line) => line.trim() && !line.startsWith("[")) ??
        translate("compile.toolFailed"),
    )
  return items
}
export function diagnosticLocation(item: Diagnostic, files: ProjectFile[]) {
  const file = files.find((file) => file.path === item.path)
  if (!file || file.text === undefined || !item.line) return undefined
  const lines = file.text.split("\n")
  if (item.line < 1 || item.line > lines.length) return undefined
  const start = lines.slice(0, item.line - 1).reduce((n, line) => n + line.length + 1, 0)
  return {
    fileId: file.id,
    path: file.path,
    start,
    end: start + lines[item.line - 1].length,
    severity: item.severity,
  }
}
