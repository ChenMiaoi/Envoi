import { useState } from "react"
import { useT } from "@/i18n/useT"
import { CircleAlert, TriangleAlert } from "lucide-react"
import { useProject } from "./context"
import { projectSignature } from "@/lib/compileClient"
import { useLspDiagnostics, useToolDiagnostics } from "@/lib/lspStatus"
import { lspLanguageForPath } from "@/lib/lspLanguage"
import { diagnosticLocation, safeDiagnosticText, parseDiagnostics } from "@/lib/diagnostics"
import type { SourceLocation } from "@/lib/paperSources"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
export type ProblemTarget = SourceLocation & { severity: "error" | "warning"; id: number }
export function ProblemsPanel({
  onNavigate,
  onCodeNavigate,
  activePath,
  mode,
}: {
  onNavigate: (target: ProblemTarget) => void
  onCodeNavigate: (path: string, position: { line: number; character: number }) => void
  activePath?: string
  mode: "reader" | "writer"
}) {
  const { t } = useT()
  const { project } = useProject()
  const [open, setOpen] = useState(false),
    [logOpen, setLogOpen] = useState(false)
  const diagnostics =
    project.diagnostics?.rootId === project.rootId ? project.diagnostics : undefined
  const compiledItems = (
    diagnostics
      ? parseDiagnostics(diagnostics.log, project.files, diagnostics.status === "failed")
      : []
  ).map((item) => ({ ...item, source: "compile" as const }))
  const lint = project.lint
  const lintCurrent =
    lint && project.files.find((file) => file.id === lint.fileId)?.text === lint.text
  const lintItems = lintCurrent
    ? lint.items.filter(
        (item) =>
          !compiledItems.some(
            (other) =>
              other.path === item.path &&
              other.line === item.line &&
              other.message === item.message,
          ),
      )
    : []
  const lsp = useLspDiagnostics()
  const tools = useToolDiagnostics()
  const lspItems = [...lsp, ...tools].flatMap(([path, file]) =>
    file.items.map((item, index) => ({
      id: `code:${path}:${file.server}:${index}`,
      severity: item.severity,
      message: item.message,
      path,
      line: item.line,
      column: item.column,
      source: "lsp" as const,
      server: file.server,
    })),
  )
  const visibleItems =
    mode === "reader"
      ? lspItems.filter((item) => item.path === activePath)
      : [...compiledItems, ...lintItems]
  const items = visibleItems.filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.path === item.path &&
            candidate.line === item.line &&
            candidate.column === item.column &&
            candidate.message === item.message &&
            candidate.severity === item.severity,
        ) === index,
    ),
    errors = items.filter((i) => i.severity === "error").length,
    warnings = items.length - errors
  const stale = diagnostics && diagnostics.signature !== projectSignature(project)
  const compileLabel = project.compileStatus?.startsWith(t("compile.compiling"))
    ? t("compile.compilingStale")
    : project.compileStatus === t("compile.cancelled") ||
        project.compileStatus === t("compile.interrupted")
      ? t("compile.cancelledOrInterrupted")
      : !diagnostics
        ? t("compile.neverCompiled")
        : diagnostics.status === "running"
          ? t("compile.compilingStale")
          : diagnostics.status === "cancelled"
            ? t("compile.cancelled")
            : diagnostics.status === "failed"
              ? t("compile.lastFailed")
              : t("compile.lastSucceeded")
  const groups = new Map<string, typeof items>()
  for (const item of items) {
    const key = item.path ?? t("compile.globalGroup")
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const language = lspLanguageForPath(activePath ?? "")
  const contextLabel =
    mode === "writer"
      ? "LaTeX"
      : ({ c: "C", cpp: "C++", python: "Python", rust: "Rust" }[language ?? ""] ??
        (activePath?.split(".").at(-1)?.toUpperCase() || "—"))
  const hasResults = mode === "reader" || !!diagnostics || !!lint
  return (
    <>
      <button
        className="flex items-center gap-1 hover:text-foreground"
        aria-label={t("compile.openProblemsAria")}
        title={mode === "reader" ? activePath : compileLabel}
        onClick={() => setOpen(true)}
      >
        <span className="font-medium text-foreground">{contextLabel}</span>
        <CircleAlert className={`h-3 w-3 ${errors ? "text-danger" : ""}`} />
        {hasResults ? errors : "—"}
        <TriangleAlert className={`ml-1 h-3 w-3 ${warnings ? "text-warning" : ""}`} />
        {hasResults ? warnings : "—"}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("compile.problemsTitle")}</DialogTitle>
            <DialogDescription>
              {mode === "reader"
                ? activePath
                : t("compile.problemsDesc", {
                    label: compileLabel + (stale ? t("compile.staleSuffix") : ""),
                  })}
            </DialogDescription>
          </DialogHeader>
          {mode === "writer" && diagnostics?.timestamp && (
            <p className="text-[10px] text-muted-foreground">
              {diagnostics.engine} · {new Date(diagnostics.timestamp).toLocaleString()} ·{" "}
              {t("compile.keptRecord")}
            </p>
          )}
          {mode === "writer" && lint && (
            <p className="text-xs text-muted-foreground">
              {t("compile.lintPrefix")} ·{" "}
              {lint.status === "disabled"
                ? t("compile.lintDisabled")
                : lint.status === "checking"
                  ? t("compile.lintChecking")
                  : lint.status === "unavailable"
                    ? lint.message
                    : lintCurrent
                      ? t("compile.lintChecked")
                      : t("compile.lintWaiting")}
            </p>
          )}
          <div className="max-h-[55vh] overflow-auto">
            {!items.length ? (
              <p className="p-5 text-center text-xs text-muted-foreground">
                {mode === "reader"
                  ? t("compile.emptyNone")
                  : !diagnostics
                    ? t("compile.emptyNever")
                    : diagnostics.status === "cancelled"
                      ? t("compile.emptyCancelled")
                      : t("compile.emptyNone")}
              </p>
            ) : (
              [...groups].map(([path, entries]) => (
                <section key={path} className="mb-3">
                  <h3 className="mb-1 break-all text-xs font-medium text-muted-foreground">
                    {path}
                  </h3>
                  {entries.map((item) => (
                    <button
                      key={item.id}
                      className="flex w-full items-start gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary"
                      onClick={() => {
                        if (item.source === "lsp") {
                          setOpen(false)
                          onCodeNavigate(item.path ?? "", {
                            line: (item.line ?? 1) - 1,
                            character: (item.column ?? 1) - 1,
                          })
                          return
                        }
                        const location =
                          !stale || item.source === "lint"
                            ? diagnosticLocation(item, project.files)
                            : undefined
                        if (location) {
                          setOpen(false)
                          onNavigate({ ...location, id: Date.now() })
                        } else setLogOpen(true)
                      }}
                    >
                      {item.severity === "error" ? (
                        <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" />
                      ) : (
                        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      )}
                      <span className="min-w-0 break-words">
                        <span className="mr-1 text-[10px] text-muted-foreground">
                          {item.source === "lint"
                            ? "ChkTeX"
                            : item.source === "lsp"
                              ? item.server
                              : t("compile.sourceCompile")}
                        </span>
                        {item.message}
                        <span className="mt-1 block text-[10px] text-muted-foreground">
                          {item.line
                            ? t("compile.lineN", { line: item.line })
                            : t("compile.noLocation")}
                          {stale && item.source === "compile" ? t("compile.staleLogOnly") : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </section>
              ))
            )}
          </div>
          {mode === "writer" && diagnostics && (
            <button onClick={() => setLogOpen(!logOpen)} className="text-left text-xs text-primary">
              {logOpen ? t("compile.hideLog") : t("compile.showLog")}
            </button>
          )}
          {mode === "writer" && logOpen && diagnostics && (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-3 text-[10px] text-muted-foreground">
              {safeDiagnosticText(diagnostics.log)}
            </pre>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
