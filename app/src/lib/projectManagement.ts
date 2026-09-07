import { nativeBasename } from "@/lib/nativePath"
import { translate } from "@/i18n/runtime"
import { dirtyFiles, safePath, type PaperProject } from "./projectFiles"
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
}
export async function verifyDeletionTarget(path: string): Promise<DeletionTarget> {
  const name = nativeBasename(path)
  if (!name || name === "." || name === "..") throw Error(translate("project.deleteInvalidName"))
  const listing = await envoi().fsList(path)
  // This interface deletes paper directories, never the application/code repository root.
  if (listing.files.some((file) => file.path === "package.json"))
    throw Error(translate("project.deletePackageJson"))
  let paper = listing.files.some((file) => !file.path.includes("/") && /\.tex$/i.test(file.path))
  if (!paper) {
    for (const configuration of [
      ".envoi/project.json",
      ".paperdesk/project.json",
      "paperdesk.json",
    ]) {
      const marker =
        listing.files.find((file) => file.path === configuration) ??
        (await envoi()
          .fsRead(path, configuration)
          .catch(() => undefined))
      if (!marker?.text) continue
      try {
        const metadata = JSON.parse(marker.text)
        if (typeof metadata.main !== "string" || !/\.tex$/i.test(metadata.main)) continue
        if (listing.files.some((file) => file.path === safePath(metadata.main).join("/"))) {
          paper = true
          break
        }
      } catch {
        /* An invalid/missing project marker never authorizes deletion. */
      }
    }
  }
  if (!paper) throw Error(translate("project.deleteNoMainTex"))
  return { path, name, label: path }
}
export async function deleteVerifiedProject(plan: DeletionTarget, typed: string) {
  if (typed !== plan.name) throw Error(translate("project.deleteConfirmName"))
  await verifyDeletionTarget(plan.path)
  try {
    await envoi().fsRemoveTree(plan.path)
  } catch (error) {
    throw Error(translate("project.deleteIncomplete", { message: (error as Error).message }))
  }
  const gone = await envoi()
    .fsList(plan.path)
    .then(
      () => false,
      () => true,
    )
  if (!gone) throw Error(translate("project.deleteStillExists"))
}
