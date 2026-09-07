import { useProject } from "@/project/context"
import { usePreferences } from "./context"
import { effectivePreferences, projectConfiguration, type ProjectConfiguration } from "./model"
import { saveProjectConfiguration } from "./projectSettings"
import { projectConfigPath, legacyProjectConfigPath } from "@/lib/managementDir"
import { translate } from "@/i18n/runtime"
export function useSettings() {
  const { project, setProject, setMessage, busy, setBusy } = useProject()
  const { preferences } = usePreferences()
  const configuration = projectConfiguration(project.settings, project.engine)
  const save = async (overrides: ProjectConfiguration["overrides"], rootId = project.rootId) => {
    if (busy) return
    const id = project.id
    setBusy(true)
    try {
      const result = await saveProjectConfiguration(project, { version: 1, overrides }, rootId)
      setProject((current) =>
        current.id === id
          ? {
              ...current,
              compileStatus: current.rootId !== result.rootId ? undefined : current.compileStatus,
              compileLog: current.rootId !== result.rootId ? undefined : current.compileLog,
              settings: result.settings,
              engine: result.engine,
              rootId: result.rootId,
              files: current.files
                .filter(
                  (file) =>
                    ![projectConfigPath, legacyProjectConfigPath, ".gitignore"].includes(file.path),
                )
                .concat(
                  result.files.filter((file) =>
                    [projectConfigPath, ".gitignore"].includes(file.path),
                  ),
                ),
            }
          : current,
      )
      setMessage(translate("settings.project.saved"))
    } catch (error) {
      setMessage(
        (error as Error).name === "NotFoundError"
          ? translate("settings.project.dirMoved")
          : (error as Error).message,
      )
    } finally {
      setBusy(false)
    }
  }
  return { effective: effectivePreferences(preferences, configuration), configuration, save }
}
