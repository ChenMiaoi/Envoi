import { createProjectSaver } from "@/lib/projectSaver"
import { useCallback, useMemo, useEffect, useRef, useState, type ReactNode } from "react"
import { assertCanClose } from "@/lib/projectManagement"
import { initialProject, emptyProject } from "@/lib/initialProject"
import { envoi } from "@/lib/desktop"
import { readProject, mergeDiskProject, dirtyFiles, type PaperProject } from "@/lib/projectFiles"
import { restoreSession, saveSession, closeProjectSession } from "@/lib/projectSession"
import { ProjectContext } from "./context"
import { useT } from "@/i18n/useT"
import { usePreferences } from "@/settings/context"
import { pluginEnabled } from "@/settings/model"
import { pluginForLanguage } from "@/settings/pluginCatalog"
import { lspLanguageForPath } from "@/lib/lspLanguage"
import { toast } from "sonner"

const formatters: Record<string, string> = {
  c: "clangFormat",
  cpp: "clangFormat",
  python: "ruffFormat",
  rust: "rustfmt",
}

export function ProjectProvider({ children }: { children: ReactNode }) {
  const { t } = useT()
  const { preferences } = usePreferences()
  const [project, setProjectState] = useState<PaperProject>(() =>
    initialProject(import.meta.hot?.data.project),
  )
  const latest = useRef(project)
  const closing = useRef(false)
  const setProject = useCallback<React.Dispatch<React.SetStateAction<PaperProject>>>((action) => {
    if (closing.current) return
    const next = typeof action === "function" ? action(latest.current) : action
    latest.current = next
    setProjectState(next)
  }, [])
  const [saving, setSaving] = useState(false)
  const [recoverable, setRecoverable] = useState<PaperProject | undefined>()
  const [restored, setRestored] = useState(
    !!import.meta.hot?.data.project && import.meta.hot.data.project.id !== "demo",
  )
  const [message, setMessage] = useState("")
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(""), 6000)
    return () => clearTimeout(timer)
  }, [message])
  const [busy, setBusy] = useState(false)
  const [agentWrites, setAgentWrites] = useState<Record<string, boolean>>({})
  const agentWriting = useRef(new Set<string>())
  const setAgentBusy = useCallback((id: string, value: boolean) => {
    if (value) agentWriting.current.add(id)
    else agentWriting.current.delete(id)
    setAgentWrites((current) => ({ ...current, [id]: value }))
  }, [])
  const projectBusy = busy || !!agentWrites[project.id]
  useEffect(() => {
    const listener = (event: Event) => setMessage((event as CustomEvent<string>).detail)
    window.addEventListener("envoi:storage-warning", listener)
    return () => window.removeEventListener("envoi:storage-warning", listener)
  }, [])
  const activity = useRef({ busy, saving })
  useEffect(() => {
    activity.current = { busy, saving }
  }, [busy, saving])
  useEffect(() => {
    const root = project.rootPath
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
        const disk = await readProject(root)
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
  }, [project.rootPath, restored, setProject])
  // createProjectSaver stores this getter; it reads the ref only when a save is requested.
  const saveAll = useMemo(
    () =>
      createProjectSaver({
        getProject: () => latest.current,
        canSave: () => !agentWriting.current.has(latest.current.id),
        setProject,
        message: setMessage,
        saving: setSaving,
        beforeSave: async (snapshot) => {
          if (!snapshot.rootPath) return
          for (const file of dirtyFiles(snapshot)) {
            const language = lspLanguageForPath(file.path)
            const formatter = formatters[language ?? ""]
            if (
              !formatter ||
              !pluginEnabled(preferences, snapshot.rootPath, pluginForLanguage(language) ?? "")
            )
              continue
            try {
              const result = await envoi().languageTool(
                snapshot.rootPath,
                file.path,
                file.text ?? "",
                "format",
                preferences.toolPaths[formatter],
              )
              if (typeof result.text !== "string" || result.text === file.text) continue
              setProject((current) =>
                current.id !== snapshot.id
                  ? current
                  : {
                      ...current,
                      files: current.files.map((entry) =>
                        entry.id === file.id &&
                        entry.text === file.text &&
                        entry.saved === file.saved
                          ? { ...entry, text: result.text }
                          : entry,
                      ),
                    },
              )
            } catch (error) {
              if (!(error instanceof Error) || !error.message.endsWith(" is not installed"))
                toast.error(error instanceof Error ? error.message : String(error))
            }
          }
        },
      }),
    [setProject, preferences],
  )
  const closeProject = useCallback(
    async (discard = false) => {
      const current = latest.current
      assertCanClose(current, projectBusy || closing.current, saving, discard)
      closing.current = true
      activity.current = { busy: true, saving }
      setBusy(true)
      try {
        if (current.rootPath) await envoi().closeProject(current.rootPath)
        await closeProjectSession(current, discard)
        const empty = emptyProject()
        if (import.meta.hot) import.meta.hot.data.project = empty
        latest.current = empty
        setProjectState(empty)
        setRecoverable(undefined)
        setMessage("")
      } catch (error) {
        if (current.rootPath)
          void envoi()
            .watchProject(current.rootPath)
            .catch(() => {})
        throw error
      } finally {
        closing.current = false
        activity.current = { busy: false, saving }
        setBusy(false)
      }
    },
    [projectBusy, saving],
  )
  useEffect(() => {
    const save = (event: Event) => {
      if (!event.defaultPrevented) void saveAll()
    }
    window.addEventListener("envoi:save", save)
    return () => window.removeEventListener("envoi:save", save)
  }, [saveAll])
  useEffect(() => {
    if (restored) return
    let active = true
    void restoreSession()
      .then((result) => {
        if (!active) return
        if (result.project) setProject(result.project)
        if (result.recoverable) setRecoverable(result.recoverable)
        if (result.warning) setMessage(result.warning)
        setRestored(true)
      })
      .catch((error) => {
        if (active) {
          setMessage(t("project.restoreUnavailable", { error: error.message }))
          setRestored(true)
        }
      })
    return () => {
      active = false
    }
  }, [restored, setProject, t])
  useEffect(() => {
    if (!restored) return
    if (import.meta.hot) import.meta.hot.data.project = project
    if (project.id === "empty" || closing.current) return
    void saveSession(project).catch(() => setMessage(t("project.recoverySaveFailed")))
  }, [project, restored, t])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyFiles(project).length) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", beforeUnload)
    return () => window.removeEventListener("beforeunload", beforeUnload)
  }, [project])
  if (!restored)
    return (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        {t("project.restoring")}
      </div>
    )
  return (
    <ProjectContext.Provider
      value={{
        getProject: () => latest.current,
        closeProject,
        saveAll,
        saving,
        message,
        setMessage,
        project,
        setProject,
        busy: projectBusy,
        agentWriting: Object.values(agentWrites).some(Boolean),
        navigationBusy: busy,
        setAgentBusy,
        setBusy,
        edit: (id, text) =>
          setProject((current) => ({
            ...current,
            files: current.files.map((file) => (file.id === id ? { ...file, text } : file)),
          })),
      }}
    >
      {recoverable && (
        <div className="fixed bottom-9 right-3 z-50 flex max-w-lg items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-lg">
          <span>{t("project.recoverableFound")}</span>
          <button
            disabled={busy || saving || dirtyFiles(project).length > 0}
            title={t("project.recoverableTitle")}
            className="text-primary disabled:opacity-40"
            onClick={() => {
              setProject({
                ...recoverable,
                id: "recovered:" + recoverable.id,
                name: t("project.recoveredDraftName"),
              })
              setRecoverable(undefined)
            }}
          >
            {t("project.recoverOldSession")}
          </button>
        </div>
      )}
      {children}
    </ProjectContext.Provider>
  )
}
