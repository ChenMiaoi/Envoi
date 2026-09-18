import { translate } from "@/i18n/runtime"
import { dirtyFiles, saveProject, type PaperProject } from "./projectFiles"
export function createProjectSaver({
  getProject,
  setProject,
  message,
  saving,
  canSave = () => true,
  beforeSave,
}: {
  canSave?: () => boolean
  getProject: () => PaperProject
  setProject: (update: (project: PaperProject) => PaperProject) => void
  message: (text: string) => void
  saving: (value: boolean) => void
  beforeSave?: (project: PaperProject) => Promise<void>
}) {
  let running = false
  return async () => {
    if (running || !canSave()) return false
    let snapshot = getProject()
    running = true
    saving(true)
    message("")
    try {
      if (!snapshot.rootPath) throw Error(translate("project.notConnected"))
      await beforeSave?.(snapshot)
      if (getProject().id !== snapshot.id) return false
      snapshot = getProject()
      await saveProject(snapshot, (id, saved) =>
        setProject((current) =>
          current.id !== snapshot.id
            ? current
            : {
                ...current,
                files: current.files.map((file) => (file.id === id ? { ...file, saved } : file)),
              },
        ),
      )
      message(dirtyFiles(getProject()).length ? translate("project.savedWithDirty") : "")
      return dirtyFiles(getProject()).length === 0
    } catch (error) {
      message(translate("project.saveFailed", { message: (error as Error).message }))
      return false
    } finally {
      running = false
      saving(false)
    }
  }
}
