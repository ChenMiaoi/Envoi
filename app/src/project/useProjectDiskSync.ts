import { useEffect, type RefObject, type Dispatch, type SetStateAction } from "react"
import { envoi } from "@/lib/desktop"
import { readProject, mergeDiskProject } from "@/lib/projectFiles"
import type { PaperProject } from "./model"
export function useProjectDiskSync({
  root,
  restored,
  latest,
  closing,
  activity,
  setProject,
  setMessage,
}: {
  root?: string
  restored: boolean
  latest: RefObject<PaperProject>
  closing: RefObject<boolean>
  activity: RefObject<{ busy: boolean; saving: boolean }>
  setProject: Dispatch<SetStateAction<PaperProject>>
  setMessage: (message: string) => void
}) {
  useEffect(() => {
    if (!root || !restored) return
    let disposed = false,
      running = false,
      pending = false
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      if (disposed || running) return
      if (activity.current.busy || activity.current.saving) {
        timer = setTimeout(() => void refresh(), 200)
        return
      }
      running = true
      pending = false
      try {
        const paths = latest.current.files.map((file) => file.path).join("\0")
        const disk = await readProject(root)
        if (
          activity.current.busy ||
          activity.current.saving ||
          paths !== latest.current.files.map((file) => file.path).join("\0")
        ) {
          pending = true
          return
        }
        if (!disposed && !closing.current) setProject((current) => mergeDiskProject(current, disk))
      } catch (error) {
        if (!disposed) setMessage((error as Error).message)
      } finally {
        running = false
        if (pending && !disposed) timer = setTimeout(() => void refresh(), 200)
      }
    }
    const off = envoi().onFilesChanged((change) => {
      if (change.root !== root) return
      if (change.error) {
        setMessage(change.error)
        return
      }
      if (
        change.paths.length &&
        change.paths.every((p) => p === ".envoi/library" || p.startsWith(".envoi/library/"))
      )
        return
      pending = true
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 200)
    })
    void envoi()
      .watchProject(root)
      .then(() => {
        if (!disposed) void refresh()
      })
      .catch((error) => {
        if (!disposed) setMessage(error.message)
      })
    return () => {
      disposed = true
      clearTimeout(timer)
      off()
      void envoi()
        .watchProject(null)
        .catch(() => {})
    }
  }, [root, restored, setProject, latest, closing, activity, setMessage])
}
