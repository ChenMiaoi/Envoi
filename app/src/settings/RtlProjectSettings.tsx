import { useEffect, useRef, useState } from "react"
import { useT } from "@/i18n/useT"
import { envoi, ipcError } from "@/lib/desktop"
import { useProject } from "@/project/context"
import { usePreferences } from "./context"
import type { MessageKey } from "@/i18n/runtime"
import type { RtlConfiguration, RtlResult } from "../../shared/rtl"

const empty = (): RtlConfiguration => ({
  version: 1,
  files: [],
  filelist: "",
  includeDirs: [],
  defines: [],
  parameters: [],
  top: "",
  libraries: {},
  systemVerilogFiles: [],
})
const fields: {
  key: "files" | "includeDirs" | "defines" | "parameters"
  label: MessageKey
  placeholder: string
}[] = [
  { key: "files", label: "extensions.rtl.files", placeholder: "rtl/package.sv\nrtl/top.sv" },
  { key: "includeDirs", label: "extensions.rtl.includes", placeholder: "rtl/include" },
  { key: "defines", label: "extensions.rtl.defines", placeholder: "SYNTHESIS\nDATA_WIDTH=32" },
  { key: "parameters", label: "extensions.rtl.parameters", placeholder: "WIDTH=32" },
]
export function RtlProjectSettings() {
  const { t } = useT()
  const { preferences } = usePreferences()
  const { project, saveAll } = useProject()
  const root = project.rootPath
  const current = useRef(root)
  current.current = root
  const alive = useRef(false)
  const [config, setConfig] = useState<RtlConfiguration>(empty)
  const [vivadoProject, setVivadoProject] = useState("")
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [result, setResult] = useState<RtlResult | null>(null)
  const valid = (value: string) => alive.current && current.current === value
  useEffect(() => {
    alive.current = true
    setReady(false)
    setBusy(false)
    setError("")
    setMessage("")
    setResult(null)
    setConfig(empty())
    setVivadoProject("")
    let cancelled = false
    if (root)
      void envoi()
        .rtlProject(root, { action: "load" })
        .then((value) => {
          if (cancelled) return
          setConfig(value.configuration ?? empty())
          setReady(true)
        })
        .catch((cause) => {
          if (!cancelled) setError(ipcError(cause).message)
        })
    return () => {
      cancelled = true
      alive.current = false
    }
  }, [root])
  async function run(action: "save" | "verilator" | "vivado" | "importVivado") {
    if (!root || busy || !ready) return
    const target = root
    setBusy(true)
    setError("")
    setMessage("")
    setResult(null)
    const remote = /^(ssh|wsl):\/\//.test(target)
    try {
      if (action === "importVivado") {
        const response = await envoi().rtlProject(target, {
          action,
          projectFile: vivadoProject,
          toolPath: remote ? undefined : preferences.toolPaths.vivado,
        })
        if (!valid(target)) return
        if (response.configuration) setConfig(response.configuration)
        setMessage(t("extensions.rtl.imported"))
      } else {
        if (action !== "save" && !(await saveAll())) throw Error(t("extensions.rtl.saveFailed"))
        if (!valid(target)) return
        await envoi().rtlProject(target, { action: "save", configuration: config })
        if (!valid(target)) return
        if (action === "save") setMessage(t("extensions.rtl.saved"))
        else {
          const toolPath = remote
            ? undefined
            : action === "vivado"
              ? (preferences.toolPaths.xvlog ?? preferences.toolPaths.vivado)
              : preferences.toolPaths.verilator
          const response = await envoi().rtlProject(target, {
            action: "check",
            tool: action,
            toolPath,
          })
          if (!valid(target)) return
          setResult(response)
        }
      }
    } catch (cause) {
      if (valid(target)) setError(ipcError(cause).message)
    } finally {
      if (valid(target)) setBusy(false)
    }
  }
  const control = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs"
  return (
    <section
      data-testid="rtl-project-settings"
      className="space-y-3 rounded-xl border border-border/60 p-3"
    >
      <p className="text-xs font-semibold">{t("extensions.rtl.project")}</p>
      {!root ? (
        <p className="text-xs text-muted-foreground">{t("extensions.openProject")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("extensions.rtl.projectHint")}</p>
          <fieldset disabled={busy || !ready} className="space-y-3 disabled:opacity-60">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs">
                {t("extensions.rtl.top")}
                <input
                  className={control}
                  value={config.top}
                  onChange={(event) => setConfig({ ...config, top: event.target.value })}
                  placeholder="top"
                />
              </label>
              <label className="space-y-1 text-xs">
                {t("extensions.rtl.filelist")}
                <input
                  className={control}
                  value={config.filelist}
                  onChange={(event) => setConfig({ ...config, filelist: event.target.value })}
                  placeholder="rtl/files.f"
                />
              </label>
              {fields.map(({ key, label, placeholder }) => (
                <label key={key} className="space-y-1 text-xs">
                  {t(label)}
                  <textarea
                    className={`${control} min-h-20 font-mono`}
                    value={config[key].join("\n")}
                    onChange={(event) =>
                      setConfig({ ...config, [key]: event.target.value.split(/\r?\n/) })
                    }
                    placeholder={placeholder}
                  />
                </label>
              ))}
            </div>
            <label className="block space-y-1 text-xs">
              {t("extensions.rtl.vivadoProject")}
              <input
                className={control}
                value={vivadoProject}
                onChange={(event) => setVivadoProject(event.target.value)}
                placeholder="project/design.xpr"
              />
            </label>
            <div className="flex flex-wrap gap-2 text-xs">
              <button
                type="button"
                className="rounded-md border px-2 py-1.5"
                disabled={!vivadoProject.trim()}
                onClick={() => void run("importVivado")}
              >
                {t("extensions.rtl.importVivado")}
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1.5"
                onClick={() => void run("save")}
              >
                {t("extensions.rtl.save")}
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1.5"
                onClick={() => void run("verilator")}
              >
                {t("extensions.rtl.checkVerilator")}
              </button>
              <button
                type="button"
                className="rounded-md border px-2 py-1.5"
                onClick={() => void run("vivado")}
              >
                {t("extensions.rtl.checkVivado")}
              </button>
            </div>
          </fieldset>
          {busy && (
            <p role="status" className="text-xs">
              {t("extensions.rtl.running")}
            </p>
          )}
          {message && (
            <p role="status" className="text-xs text-muted-foreground">
              {message}
            </p>
          )}
          {result && (
            <div className="space-y-2 text-xs" role="status">
              <p className={result.ok ? "text-green-600" : "text-destructive"}>
                {t(result.ok ? "extensions.rtl.passed" : "extensions.rtl.failed")}
              </p>
              <ul className="max-h-64 space-y-1 overflow-auto">
                {result.diagnostics?.map((issue, index) => (
                  <li key={index} className="break-words">
                    <span className="font-mono">
                      {issue.path}:{issue.line}:{issue.column}
                    </span>{" "}
                    · {issue.message}
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer">{t("extensions.rtl.log")}</summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all">
                  {result.log}
                </pre>
              </details>
            </div>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
