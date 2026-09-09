import { useProjectTrust } from "./useProjectTrust"
import { openDirectory } from "@/lib/desktop"
import { Notification } from "@/components/Notification"
import { restoreProjectSession } from "@/lib/projectSession"
import { bindProject } from "@/lib/agentClient"
import { ProjectManagement } from "./ProjectManagement"
import { BrandMark } from "@/components/BrandMark"
import { usePreferences } from "@/settings/context"
import { useCallback, useEffect, useState } from "react"
import { Folder, FolderOpen, ArrowUp, HardDrive, FilePlus2 } from "lucide-react"
import { createPaper, createTextFile, dirtyFiles, readProject } from "@/lib/projectFiles"
import {
  authorizedRoots,
  rememberRoot,
  recentProjects,
  rememberProject,
  type RecentProject,
} from "@/lib/recentProjects"
import { localGitRuntime, initializeLocalGit } from "@/lib/localGit"
import { envoi } from "@/lib/desktop"
import { paperTemplates } from "@/lib/paperTemplates"
import { useProject } from "./context"
import { useT } from "@/i18n/useT"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
export function ProjectMenu() {
  const { preferences } = usePreferences()
  const { t } = useT()
  const {
    saveAll,
    saving,
    project,
    setProject,
    navigationBusy: busy,
    busy: taskBusy,
    setBusy,
    message,
    setMessage,
  } = useProject()
  const trusted = useProjectTrust(project.rootPath)?.trusted
  const [gitStatus, setGitStatus] = useState(t("project.gitProbing"))
  const [gitAvailable, setGitAvailable] = useState(false)
  const [enableGit, setEnableGit] = useState(preferences.defaultGit)
  const [template, setTemplate] = useState("research")
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("全部")
  const [roots, setRoots] = useState<RecentProject[]>([])
  const [recent, setRecent] = useState<RecentProject[]>([])
  const [mode, setMode] = useState<"new" | "open" | "file" | null>(null)
  const [name, setName] = useState("")
  const [trail, setTrail] = useState<string[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [discard, setDiscard] = useState(false)
  useEffect(() => {
    if (mode !== "new") return
    if (project.rootPath && !trusted) {
      setGitAvailable(true)
      setGitStatus(t("trust.gitAfterTrust"))
      return
    }
    void localGitRuntime()
      .then((result) => {
        setGitAvailable(result.available)
        if (!result.available) setEnableGit(false)
        setGitStatus(
          result.available
            ? result.version!
            : t("project.gitDisabledSuffix", { error: result.error ?? "" }),
        )
      })
      .catch((error) => {
        setGitAvailable(false)
        setGitStatus(error.message)
      })
  }, [mode, t, trusted, project.rootPath])
  useEffect(() => {
    const open = () => setMode("open")
    window.addEventListener("envoi:open-project", open)
    return () => window.removeEventListener("envoi:open-project", open)
  }, [])
  useEffect(() => {
    const refresh = () => {
      void recentProjects()
        .then(setRecent)
        .catch((error) => setMessage(error.message))
      void authorizedRoots()
        .then(setRoots)
        .catch((error) => setMessage(error.message))
      setTrail([])
      setFolders([])
    }
    window.addEventListener("envoi:recent-updated", refresh)
    return () => window.removeEventListener("envoi:recent-updated", refresh)
  }, [setMessage])
  const changed = dirtyFiles(project).length
  const location = trail[trail.length - 1]
  useEffect(() => {
    void recentProjects()
      .then(setRecent)
      .catch(() => setMessage(t("project.recentStoreUnavailable")))
  }, [setMessage, t])
  const browse = async (next: string[]) => {
    const root = next[next.length - 1]
    await openDirectory(root)
    const listing = await envoi().fsChildren(root)
    const children = listing
      .filter((entry) => entry.kind === "directory")
      .map((entry) => entry.name)
      .filter((part) => part && !part.startsWith(".") && part !== "node_modules")
    setTrail(next)
    setFolders(children.sort((a, b) => a.localeCompare(b)))
  }
  useEffect(() => {
    let active = true
    void authorizedRoots()
      .then(async (items) => {
        if (!active) return
        setRoots(items)
        const first = items.find((item) => item.path)?.path
        if (!first) return
        try {
          const root = first
          const listing = await envoi().fsChildren(root)
          if (!active) return
          setTrail([root])
          setFolders(
            listing
              .filter((entry) => entry.kind === "directory")
              .map((entry) => entry.name)
              .filter((part) => part && !part.startsWith(".") && part !== "node_modules")
              .sort((a, b) => a.localeCompare(b)),
          )
        } catch {
          /* 上次位置不可用时留空，用户重新选择。 */
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  const run = useCallback(
    async (operation: () => Promise<void>) => {
      if (busy || saving) return
      setBusy(true)
      setMessage("")
      try {
        await operation()
      } catch (error) {
        setMessage((error as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [busy, saving, setBusy, setMessage],
  )
  const activate = useCallback(
    async (rootPath: string) => {
      const binding = await bindProject(rootPath)
      rootPath = binding.project.path
      window.dispatchEvent(new Event("envoi:connection-updated"))
      const next = await restoreProjectSession(await readProject(rootPath))
      let remembered = true
      try {
        await rememberProject(rootPath)
      } catch {
        remembered = false
      }
      setProject(next)
      setMessage(remembered ? "" : t("project.openedNoRecent", { name: next.name }))
    },
    [setProject, setMessage, t],
  )
  useEffect(() => {
    const create = () => {
      setMode("new")
      setName("")
      setDiscard(false)
      setEnableGit(preferences.defaultGit)
      setMessage("")
    }
    const recent = (event: Event) => {
      const directory = (event as CustomEvent<string>).detail
      if (typeof directory === "string") void run(() => activate(directory))
    }
    const example = () => {
      void run(async () => {
        await activate(await envoi().exampleDirectory())
      })
    }
    const note = () => {
      if (taskBusy || !project.rootPath) return
      setMode("file")
      setDiscard(false)
      setMessage("")
      let number = 1
      while (project.files.some((file) => file.path === `notes/note-${number}.md`)) number++
      setName(`notes/note-${number}.md`)
    }
    window.addEventListener("envoi:new-note", note)
    window.addEventListener("envoi:new-project", create)
    window.addEventListener("envoi:open-recent", recent)
    window.addEventListener("envoi:open-example", example)
    return () => {
      window.removeEventListener("envoi:new-note", note)
      window.removeEventListener("envoi:new-project", create)
      window.removeEventListener("envoi:open-recent", recent)
      window.removeEventListener("envoi:open-example", example)
    }
  }, [run, activate, preferences.defaultGit, setMessage, taskBusy, project.rootPath, project.files])
  const openDialog = (next: "new" | "open" | "file") => {
    setMode(next)
    if (next === "new") setEnableGit(preferences.defaultGit)
    setName("")
    setDiscard(false)
    setMessage("")
  }
  return (
    <>
      <ProjectManagement />
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t("project.menuAria")}
          className="flex items-center gap-2 rounded focus-visible:outline focus-visible:outline-primary"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <BrandMark className="h-4 w-4" />
          </span>
          <span className="font-serif text-[14px] font-semibold italic tracking-[0.02em]">
            Envoi
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>
            {t("project.menuLabel")} {changed ? t("project.unsavedSuffix", { count: changed }) : ""}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled={busy} onSelect={() => openDialog("new")}>
            {t("project.newProject")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={busy} onSelect={() => openDialog("open")}>
            {t("project.openProjectFolder")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={taskBusy || !project.rootPath}
            onSelect={() => openDialog("file")}
          >
            {t("project.newFile")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={taskBusy || saving || !changed}
            onSelect={() => void saveAll()}
          >
            {t("project.saveAll")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={taskBusy || saving || project.id === "empty"}
            onSelect={() => window.dispatchEvent(new Event("envoi:close-project"))}
          >
            {t("project.closeCurrentEllipsis")}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={busy || saving}
            onSelect={() => window.dispatchEvent(new Event("envoi:manage-projects"))}
          >
            {t("project.manageMenu")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => openDialog("open")}>
            {t("project.recentMenu", { count: recent.length })}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={mode !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setMode(null)
        }}
      >
        <DialogContent
          aria-describedby={mode === "file" ? undefined : "project-open-description"}
          className="gap-0 overflow-hidden p-0 max-h-[90vh] overflow-y-auto sm:max-w-[850px]"
        >
          <DialogHeader className="border-b border-border px-6 py-5">
            <DialogTitle>
              {mode === "new"
                ? t("project.dialogNewTitle")
                : mode === "file"
                  ? t("project.dialogFileTitle")
                  : t("project.dialogOpenTitle")}
            </DialogTitle>
            {mode !== "file" && (
              <DialogDescription id="project-open-description">
                {t("project.dialogOpenDesc")}
              </DialogDescription>
            )}
          </DialogHeader>
          <div className="flex min-h-72">
            <aside className="w-44 shrink-0 border-r border-border bg-background/40 p-3">
              <div className="mb-2 px-2 text-xs text-muted-foreground">
                {t("project.authorizedLocations")}
              </div>
              {roots.map((entry) => (
                <button
                  key={entry.id}
                  disabled={busy || mode === "file" || !entry.path}
                  className="mb-1 block w-full truncate rounded px-2 py-2 text-left text-xs hover:bg-secondary"
                  onClick={() =>
                    void run(async () => {
                      await rememberRoot(entry.path!)
                      await browse([entry.path!])
                    })
                  }
                >
                  {entry.name}
                </button>
              ))}
              {!project.rootPath && (
                <p className="mb-3 px-2 text-[10px] text-muted-foreground">
                  {t("project.notConnectedHint")}
                </p>
              )}
              <div className="mb-3 flex items-center gap-2 px-2 text-xs text-muted-foreground">
                <HardDrive className="h-3.5 w-3.5" />
                {t("project.recentHeading")}
              </div>
              {!recent.length && (
                <p className="px-2 text-xs text-muted-foreground">{t("project.noRecent")}</p>
              )}
              {recent.map((entry) => (
                <button
                  key={entry.id}
                  disabled={busy || mode === "file" || !entry.path}
                  className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary disabled:opacity-40"
                  onClick={() =>
                    void run(async () => {
                      await browse([entry.path!])
                    })
                  }
                >
                  <Folder className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </aside>
            <div className="min-w-0 flex-1 space-y-4 p-5">
              {mode !== "file" ? (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={busy || trail.length < 2}
                      aria-label={t("project.parentDirAria")}
                      className="rounded border border-border p-2 disabled:opacity-30"
                      onClick={() => void run(() => browse(trail.slice(0, -1)))}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <div
                      className="min-w-0 flex-1 truncate rounded border border-border bg-background px-3 py-2 text-xs"
                      title={location ?? ""}
                    >
                      {location ? location : t("project.noLocation")}
                    </div>
                  </div>
                  <div className="max-h-44 min-h-28 overflow-auto rounded-lg border border-border bg-background/40 p-2">
                    {!location ? (
                      <div className="flex flex-col items-center gap-2 py-5 text-xs text-muted-foreground">
                        <FolderOpen className="h-7 w-7" />
                        <span>{t("project.emptyFolderHint")}</span>
                      </div>
                    ) : !folders.length ? (
                      <p className="p-3 text-xs text-muted-foreground">
                        {t("project.noSubfolders")}
                      </p>
                    ) : (
                      folders.map((folder) => (
                        <button
                          key={folder}
                          className="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary"
                          disabled={busy}
                          onClick={() =>
                            void run(() => browse([...trail, `${location}/${folder}`]))
                          }
                        >
                          <Folder className="h-4 w-4 text-primary" />
                          {folder}
                        </button>
                      ))
                    )}
                  </div>
                  <button
                    disabled={busy}
                    className="rounded border border-border px-3 py-2 text-xs hover:bg-secondary"
                    onClick={() =>
                      void run(async () => {
                        const root = await envoi().pickDirectory()
                        if (!root) return
                        await browse([root])
                        await rememberRoot(root)
                        setRoots(await authorizedRoots())
                      })
                    }
                  >
                    {t("project.chooseLocation")}
                  </button>
                </>
              ) : (
                <div className="rounded border border-border bg-background p-3 text-xs">
                  <div className="mb-2 flex items-center gap-2">
                    <FilePlus2 className="h-4 w-4" />
                    {project.name}
                  </div>
                  <div className="max-h-32 overflow-auto text-muted-foreground">
                    {project.files.map((file) => (
                      <div key={file.id}>{file.path}</div>
                    ))}
                  </div>
                </div>
              )}
              {mode !== "open" && (
                <label className="block space-y-2 text-xs">
                  <span>{mode === "new" ? t("project.nameLabel") : t("project.pathLabel")}</span>
                  <input
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={mode === "new" ? "my-research-paper" : "chapters/method.tex"}
                    className="w-full rounded border border-input bg-background px-3 py-2 outline-none focus:border-primary"
                  />
                </label>
              )}
              {mode === "new" && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      aria-label={t("project.templateSearchAria")}
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("project.templateSearchPlaceholder")}
                      className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2 text-xs"
                    />
                    <select
                      aria-label={t("project.templateCategoryAria")}
                      value={category}
                      onChange={(event) => setCategory(event.target.value)}
                      className="rounded border border-input bg-background text-xs"
                    >
                      {["全部", "通用", "会议", "期刊"].map((item) => (
                        <option key={item}>{item}</option>
                      ))}
                    </select>
                  </div>
                  <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto">
                    {paperTemplates
                      .filter(
                        (item) =>
                          (category === "全部" || category === item.category) &&
                          `${item.name} ${item.family}`.toLowerCase().includes(query.toLowerCase()),
                      )
                      .map((item) => (
                        <button
                          key={item.id}
                          onClick={() => setTemplate(item.id)}
                          className={`rounded border p-3 text-left text-xs ${template === item.id ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                        >
                          <span className="block font-medium">{item.name}</span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {item.category} · {item.version}
                          </span>
                        </button>
                      ))}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {t("project.templateCurrent", {
                      name: paperTemplates.find((item) => item.id === template)?.name ?? "",
                    })}
                  </p>
                  {template !== "research" && (
                    <a
                      className="text-[10px] text-primary"
                      href={paperTemplates.find((item) => item.id === template)?.source}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("project.templateSource")}
                    </a>
                  )}
                </div>
              )}
              {mode === "new" && (
                <div className="space-y-1 text-xs">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={enableGit}
                      onChange={(event) => setEnableGit(event.target.checked && gitAvailable)}
                    />
                    {t("project.enableGit")}
                  </label>
                  <p role="status" className="text-[10px] text-muted-foreground">
                    {gitStatus}
                  </p>
                </div>
              )}
              {changed > 0 && mode !== "file" && (
                <div className="rounded border border-warning/30 p-3 text-xs text-warning">
                  <p>{t("project.unsavedFilesWarning", { count: changed })}</p>
                  <button className="my-2 underline" disabled={busy} onClick={() => void saveAll()}>
                    {t("project.saveAllFirst")}
                  </button>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={discard}
                      onChange={(event) => setDiscard(event.target.checked)}
                    />
                    {t("project.discardOnSwitch")}
                  </label>
                </div>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 border-t border-border bg-background/30 px-5 py-4">
            <button
              disabled={busy}
              onClick={() => setMode(null)}
              className="rounded border border-border px-4 py-2 text-xs"
            >
              {t("project.cancel")}
            </button>
            <button
              disabled={
                busy ||
                (mode === "file" && taskBusy) ||
                (mode === "new" && enableGit && !gitAvailable) ||
                (mode !== "file" && !location) ||
                (mode !== "open" && !name.trim()) ||
                (!!changed && mode !== "file" && !discard)
              }
              className="rounded bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-40"
              onClick={() =>
                void run(async () => {
                  if (mode === "file") {
                    if (!/\.(tex|bib|md|txt|csv|sty|cls)$/i.test(name.trim()))
                      throw new Error(t("project.errorFileExtension"))
                    await createTextFile(project.rootPath!, name.trim(), "")
                    const fresh = await readProject(project.rootPath!).catch((error) => {
                      throw new Error(t("project.errorRefreshFailed", { error: error.message }))
                    })
                    setProject((current) => ({
                      ...current,
                      ...fresh,
                      compiled: current.compiled,
                      id: current.id,
                      rootId: current.rootId || fresh.rootId,
                      files: fresh.files.map(
                        (file) => current.files.find((item) => item.id === file.id) ?? file,
                      ),
                    }))
                    setMode(null)
                    setMessage("")
                  } else {
                    const rootPath =
                      mode === "new"
                        ? await createPaper(location, name.trim(), template, enableGit)
                        : location
                    await activate(rootPath)
                    if (mode === "new" && enableGit) {
                      try {
                        const state = await envoi().projectTrust(await openDirectory(rootPath))
                        if (state.trusted) await initializeLocalGit(rootPath)
                      } catch (error) {
                        throw new Error(
                          t("project.errorGitIncomplete", { error: (error as Error).message }),
                        )
                      }
                    }
                    setMode(null)
                  }
                })
              }
            >
              {busy
                ? t("project.processing")
                : mode === "new"
                  ? t("project.createProject")
                  : mode === "file"
                    ? t("project.createFile")
                    : t("project.openCurrentDirectory")}
            </button>
          </div>
        </DialogContent>
      </Dialog>
      <Notification message={message} kind="warning" testId="project-notification" />
    </>
  )
}
