import { useEffect, useState, useCallback, useRef, type ReactNode } from "react"
import { useProject } from "./context"
import { useProjectTrust } from "./useProjectTrust"
import { GitStatusContext } from "./gitStatusContext"
import { localGitStatus, type GitStatus } from "@/lib/localGit"
import { envoi } from "@/lib/desktop"

export function GitStatusProvider({ children }: { children: ReactNode }) {
  const { project } = useProject()
  const root = project.rootPath
  const trusted = useProjectTrust(root)?.trusted
  const [result, setResult] = useState<{
    root?: string
    status: GitStatus | null
    message: string
  }>({ status: null, message: "" })
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const refresh = useCallback(async () => {
    const current = ++generation.current
    if (!root || !trusted) return
    setBusy(true)
    try {
      const status = await localGitStatus(root)
      if (generation.current === current)
        setResult({
          root,
          status,
          message: "",
        })
    } catch (error) {
      if (generation.current === current)
        setResult({ root, status: null, message: (error as Error).message })
    } finally {
      if (generation.current === current) setBusy(false)
    }
  }, [root, trusted])
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const revision = JSON.stringify(project.files.map((file) => [file.path, file.saved]))
  useEffect(() => {
    if (!root || !trusted) return
    const timer = setTimeout(() => void refresh(), 150)
    return () => {
      clearTimeout(timer)
      invalidate()
    }
  }, [refresh, revision, root, trusted, invalidate])
  useEffect(() => {
    if (!root || !trusted) return
    let timer: ReturnType<typeof setTimeout>
    const changed = () => {
      clearTimeout(timer)
      timer = setTimeout(() => void refresh(), 250)
    }
    const off = envoi().onFilesChanged((event) => {
      if (event.root === root) changed()
    })
    window.addEventListener("envoi:connection-updated", changed)
    window.addEventListener("envoi:workspaces-updated", changed)
    window.addEventListener("focus", changed)
    return () => {
      off()
      clearTimeout(timer)
      window.removeEventListener("envoi:connection-updated", changed)
      window.removeEventListener("envoi:workspaces-updated", changed)
      window.removeEventListener("focus", changed)
    }
  }, [root, trusted, refresh])
  const visible = trusted && result.root === root
  return (
    <GitStatusContext.Provider
      value={{
        status: visible ? result.status : null,
        message: visible ? result.message : "",
        busy: !!trusted && busy,
        refresh,
      }}
    >
      {children}
    </GitStatusContext.Provider>
  )
}
