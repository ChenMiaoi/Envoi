import { nativeBasename } from "@/lib/nativePath"
import { translate } from "@/i18n/runtime"
import { dirtyFiles, type PaperProject } from "./projectFiles"
import { envoi } from "./desktop"
export function assertCanClose(
  project: PaperProject,
  busy: boolean,
  saving: boolean,
  discard: boolean,
) {
  if (busy || saving) throw Error(translate("project.closeBusy"))
  if (dirtyFiles(project).length && !discard) throw Error(translate("project.closeUnsaved"))
}
export interface DeletionTarget {
  path: string
  name: string
  label: string
  kind?: "project" | "worktree"
  related?: string[]
  blocked?: string
}
export async function verifyDeletionTarget(path: string): Promise<DeletionTarget> {
  const name = nativeBasename(path)
  if (!name || name === "." || name === "..") throw Error(translate("project.deleteInvalidName"))
  const bridge = envoi()
  if (typeof bridge.fsInspectDeletion !== "function" || typeof bridge.fsTrashProject !== "function")
    throw Error(translate("project.restartForTrash"))
  try {
    return await bridge.fsInspectDeletion(path)
  } catch (error) {
    if (String(error).includes("No handler registered"))
      throw Error(translate("project.restartForTrash"))
    throw error
  }
}

export async function deleteVerifiedProject(plan: DeletionTarget, typed: string) {
  if (typed !== plan.name) throw Error(translate("project.deleteConfirmName"))
  const current = await verifyDeletionTarget(plan.path)
  if (current.blocked) throw Error(current.blocked)
  if (current.path !== plan.path || current.kind !== plan.kind)
    throw Error(translate("project.deletionChanged"))
  try {
    const result = await envoi().fsTrashProject(plan.path, typed)
    return result.warnings
  } catch (error) {
    throw Error(translate("project.deleteIncomplete", { message: (error as Error).message }))
  }
}
