import { useProjectTrust } from "./useProjectTrust"
import { useSettings } from "@/settings/useSettings"
import { translate } from "@/i18n/runtime"
import { envoi, ipcError } from "@/lib/desktop"
import { useEffect } from "react"
import type { Diagnostic } from "@/lib/diagnostics"
import { useProject } from "./context"
export function useEditorLint(fileId: string | undefined, path: string | undefined, text: string) {
  const { effective } = useSettings()
  const rules = JSON.stringify(effective.disabledRules)
  const { project, setProject } = useProject()
  const trusted = useProjectTrust(project.rootPath)?.trusted
  const enabled = effective.lintEnabled && !!trusted
  const projectId = project.id
  useEffect(() => {
    if (!fileId || !path?.endsWith(".tex")) return
    const controller = new AbortController()
    let active = true
    const timer = setTimeout(
      () =>
        void (async () => {
          if (!enabled) {
            if (active)
              setProject((current) =>
                current.id === projectId
                  ? { ...current, lint: { fileId, text, status: "disabled", items: [] } }
                  : current,
              )
            return
          }
          setProject((current) =>
            current.id === projectId
              ? { ...current, lint: { fileId, text, status: "checking", items: [] } }
              : current,
          )
          try {
            await envoi()
              .compilerRuntime()
              .catch(() => {
                throw Error(translate("lint.serviceNotConnected"))
              })
            const result = await envoi()
              .lint({ rootPath: project.rootPath, path, text, disabledRules: JSON.parse(rules) })
              .catch((error) => {
                throw ipcError(error)
              })
            if (!result.available) throw Error(result.error ?? translate("lint.unavailable"))
            if (active)
              setProject((current) =>
                current.id === projectId
                  ? {
                      ...current,
                      lint: {
                        fileId,
                        text,
                        status: "ready",
                        items: ((result.items ?? []) as Diagnostic[]).map((item) => ({
                          ...item,
                          source: "lint" as const,
                        })),
                      },
                    }
                  : current,
              )
          } catch (error) {
            if (active && !controller.signal.aborted)
              setProject((current) =>
                current.id === projectId
                  ? {
                      ...current,
                      lint: {
                        fileId,
                        text,
                        status: "unavailable",
                        items: [],
                        message: (error as Error).message,
                      },
                    }
                  : current,
              )
          }
        })(),
      700,
    )
    return () => {
      active = false
      clearTimeout(timer)
      controller.abort()
    }
  }, [fileId, path, text, project.rootPath, projectId, setProject, enabled, rules])
}
