import { useProjectTrust } from "./useProjectTrust"
import { useSettings } from "@/settings/useSettings"
import { translate } from "@/i18n/runtime"
import { useT } from "@/i18n/useT"
import { parseDiagnostics, safeDiagnosticText } from "@/lib/diagnostics"
import { useCallback, useEffect, useRef, useState } from "react"
import { compileProject, projectSignature } from "@/lib/compileClient"
import { previewManifest } from "@/lib/pdfSync"
import { persistBuild, persistDiagnostics } from "@/lib/projectFiles"
import { useProject } from "./context"
export function CompileControls({ hasPdf = false }: { hasPdf?: boolean }) {
  const { t } = useT()
  const { project, getProject, setProject, busy, setBusy, saveAll, saving } = useProject()
  const { effective, configuration, save } = useSettings()
  const trusted = useProjectTrust(project.rootPath)?.trusted
  const engine = effective.engine
  const [running, setRunning] = useState(false)
  const [open, setOpen] = useState(false)
  const [queuedSave, setQueuedSave] = useState(false)
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const run = useCallback(
    async (saveFirst = false) => {
      if (!trusted) {
        if (saveFirst) await saveAll()
        else window.dispatchEvent(new Event("envoi:show-trust"))
        return
      }
      if (request.current || busy || saving) return
      const controller = new AbortController()
      request.current = controller
      setRunning(true)
      if (saveFirst) {
        let saved = false
        try {
          saved = await saveAll()
        } catch {
          /* Save reports its own error. */
        }
        if (!saved || controller.signal.aborted) {
          request.current = null
          setRunning(false)
          setQueuedSave(false)
          return
        }
      }
      const project = getProject()
      if (controller.signal.aborted) {
        request.current = null
        setRunning(false)
        return
      }
      setBusy(true)
      const signature = projectSignature(project),
        id = project.id
      setProject((current) => ({
        ...current,
        compileStatus: translate("compile.compiling"),
        compileLog: translate("compile.compilingSnapshot"),
      }))
      try {
        const result = await compileProject(project, engine, controller.signal)
        const diagnostics = {
          items: parseDiagnostics(
            result.ok ? result.log : `${result.error}\n${result.log}`,
            project.files,
            !result.ok,
          ),
          signature,
          rootId: project.rootId,
          status: result.ok ? ("success" as const) : ("failed" as const),
          log: result.ok ? result.log : `${result.error}\n${result.log}`,
          engine,
          timestamp: Date.now(),
        }
        let diagnosticSaveWarning = ""
        if (project.rootPath)
          await persistDiagnostics(project.rootPath, diagnostics).catch(() => {
            diagnosticSaveWarning = translate("compile.diagCacheOnly")
          })
        let successStatus = translate("compile.successCacheOnly")
        if (result.ok && project.rootPath) {
          try {
            await persistBuild(
              project.rootPath,
              result.file,
              result.log,
              JSON.stringify(await previewManifest(project, result.file)),
              result.synctex,
            )
            successStatus = translate("compile.successSaved")
          } catch (error) {
            successStatus = translate("compile.successPartial", { error: (error as Error).message })
          }
        }
        setProject((current) =>
          current.id !== id
            ? current
            : result.ok
              ? {
                  ...current,
                  diagnostics,
                  compiled: { file: result.file, signature, synctex: result.synctex },
                  compileStatus: successStatus + diagnosticSaveWarning,
                  compileLog: result.log,
                }
              : {
                  ...current,
                  diagnostics,
                  compileStatus: translate("compile.failed") + diagnosticSaveWarning,
                  compileLog: `${result.error}\n${result.log}`,
                },
        )
      } catch (error) {
        setProject((current) =>
          current.id !== id
            ? current
            : {
                ...current,
                diagnostics:
                  controller.signal.aborted && current.diagnostics
                    ? current.diagnostics
                    : {
                        items: controller.signal.aborted
                          ? []
                          : parseDiagnostics((error as Error).message, project.files, true),
                        signature,
                        rootId: project.rootId,
                        status: controller.signal.aborted ? "cancelled" : "failed",
                        log: (error as Error).message,
                      },
                compileStatus: controller.signal.aborted
                  ? translate("compile.cancelled")
                  : translate("compile.failed"),
                compileLog: (error as Error).message,
              },
        )
      } finally {
        setBusy(false)
        setRunning(false)
        request.current = null
      }
    },
    [busy, saving, getProject, setProject, setBusy, saveAll, engine, trusted],
  )
  useEffect(() => {
    const compile = () => {
      void run()
    }
    window.addEventListener("envoi:compile", compile)
    return () => window.removeEventListener("envoi:compile", compile)
  })
  useEffect(() => {
    const save = () => setQueuedSave(true)
    window.addEventListener("envoi:save-compile", save)
    return () => window.removeEventListener("envoi:save-compile", save)
  }, [])
  useEffect(() => {
    if (queuedSave && !running && !busy && !saving) {
      setQueuedSave(false)
      void run(true)
    }
  }, [queuedSave, running, busy, saving, run])
  return (
    <div className="shrink-0 border-b border-border bg-card text-[11px]">
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <button
          className="text-muted-foreground hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {project.compileStatus ?? (hasPdf ? t("compile.hasPdfLog") : t("compile.waitingFirst"))}{" "}
          {open ? "▴" : "▾"}
        </button>
        <div className="flex gap-2">
          <select
            aria-label={t("compile.engineAria")}
            className="bg-card"
            value={engine}
            disabled={running || !project.rootId}
            onChange={(event) => {
              const engine = event.target.value as "pdflatex" | "xelatex"
              if (project.rootPath) void save({ ...configuration.overrides, engine })
              else
                setProject((current) => ({
                  ...current,
                  engine,
                  settings: { version: 1, overrides: { ...configuration.overrides, engine } },
                }))
            }}
          >
            <option value="pdflatex">pdfLaTeX</option>
            <option value="xelatex">XeLaTeX</option>
          </select>
          {queuedSave && (
            <span role="status" className="self-center text-muted-foreground">
              已排队：保存并编译
            </span>
          )}
          {running ? (
            <button
              onClick={() => {
                setQueuedSave(false)
                request.current?.abort()
              }}
              className="rounded border border-border px-2 py-1"
            >
              {t("compile.cancel")}
            </button>
          ) : (
            <button
              disabled={busy || saving || !project.rootId}
              className="rounded bg-primary px-2 py-1 text-primary-foreground disabled:opacity-40"
              onClick={() => void run()}
            >
              {t("compile.runCurrent")}
            </button>
          )}
        </div>
      </div>
      {open && (
        <pre className="envoi-scrollbar max-h-36 overflow-auto whitespace-pre-wrap break-all border-t border-border p-3 text-[10px] text-muted-foreground">
          {project.compileLog ? safeDiagnosticText(project.compileLog) : t("compile.logHint")}
        </pre>
      )}
    </div>
  )
}
