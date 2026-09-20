import { useProjectTrust } from "./useProjectTrust"
import { openDirectory, ipcError } from "@/lib/desktop"
import { locationLabel } from "@/lib/workspaceLocation"
import { Notification } from "@/components/Notification"
import { restoreProjectSession, saveOutgoingSession } from "@/lib/projectSession"
import { bindProject } from "@/lib/agentClient"
import { ProjectManagement } from "./ProjectManagement"
import { BrandMark } from "@/components/BrandMark"
import { usePreferences } from "@/settings/context"
import { useCallback, useEffect, useRef, useState } from "react"
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ArrowUp,
  HardDrive,
  FilePlus2,
  Network,
  Save,
  Search,
  SquareTerminal,
  Check,
} from "lucide-react"
import {
  createPaper,
  createTextFile,
  dirtyFiles,
  readProject,
  isTextPath,
} from "@/lib/projectFiles"
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
export function ProjectMenu() {
  const operationPending = useRef(false)
  const { preferences } = usePreferences()
  const { t } = useT()
  const {
    saveAll,
    saving,
    project,
    getProject,
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
      if (busy || saving || operationPending.current) return
      operationPending.current = true
      setBusy(true)
      setMessage("")
      try {
        await operation()
      } catch (error) {
        setMessage(ipcError(error).message)
      } finally {
        operationPending.current = false
        setBusy(false)
      }
    },
    [busy, saving, setBusy, setMessage],
  )
  const activate = useCallback(
    async (rootPath: string, discard = false) => {
      let next
      let outgoing: ReturnType<typeof getProject> | undefined
      try {
        const prepared = await envoi().bindProject(rootPath, { prepare: true })
        rootPath = prepared.project.path
        const fresh = await readProject(rootPath)
        outgoing = getProject()
        await saveOutgoingSession(outgoing, discard)
        next = await restoreProjectSession(fresh)
        await bindProject(rootPath)
      } catch (error) {
        await envoi()
          .cancelProjectOpen()
          .catch(() => {})
        if (discard && outgoing) {
          try {
            await saveOutgoingSession(outgoing, false)
          } catch {
            throw Error(`${ipcError(error).message}\n${t("project.recoverySaveFailed")}`)
          }
        }
        throw error
      }
      let remembered = true
      try {
        await rememberProject(rootPath)
      } catch {
        remembered = false
      }
      setProject(next)
      window.dispatchEvent(new Event("envoi:recent-updated"))
      setMessage(remembered ? "" : t("project.openedNoRecent", { name: next.name }))
    },
    [getProject, setProject, setMessage, t],
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
  const pick = () =>
    void run(async () => {
      const root = await envoi().pickDirectory()
      if (!root) return
      await browse([root])
      await rememberRoot(root)
      setRoots(await authorizedRoots())
    })
  return (
    <>
      <ProjectManagement />
      <DropdownMenu
        onOpenChange={(open) => {
          if (open)
            void recentProjects()
              .then(setRecent)
              .catch((error) => setMessage(error.message))
        }}
      >
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
        <DropdownMenuContent align="start" className="w-72">
          <div className="mx-1 mb-1.5 flex items-center gap-2.5 rounded-lg border border-border/60 bg-secondary/40 px-2.5 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FolderOpen className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium leading-5">
                {project.id === "empty" ? t("project.notOpened") : project.name}
              </span>
              {project.rootPath && (
                <span
                  className="block truncate text-[11px] leading-4 text-muted-foreground"
                  title={project.rootPath}
                >
                  {project.rootPath}
                </span>
              )}
            </span>
            {changed > 0 && (
              <span className="shrink-0 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                {t("project.unsavedBadge", { count: changed })}
              </span>
            )}
          </div>
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground/70">
              {t("project.groupWorkspace")}
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={busy} onSelect={() => openDialog("new")}>
              <FolderPlus />
              {t("project.newProject")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={busy} onSelect={() => openDialog("open")}>
              <FolderOpen />
              {t("project.openProjectFolder")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={busy}
              onSelect={() => window.dispatchEvent(new Event("envoi:open-remote"))}
            >
              <Network />
              {t("remote.manage")}
            </DropdownMenuItem>
            {/Win/.test(navigator.platform) && (
              <DropdownMenuItem
                disabled={busy}
                onSelect={() =>
                  window.dispatchEvent(new CustomEvent("envoi:open-remote", { detail: "wsl" }))
                }
              >
                <SquareTerminal />
                {t("wsl.title")}…
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground/70">
              {t("project.groupCurrent")}
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={taskBusy || !project.rootPath}
              onSelect={() => openDialog("file")}
            >
              <FilePlus2 />
              {t("project.newFile")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={taskBusy || saving || !changed}
              onSelect={() => void saveAll()}
            >
              <Save />
              {t("project.saveAll")}
              {changed > 0 && (
                <span className="ml-auto text-[11px] font-medium text-warning">{changed}</span>
              )}
            </DropdownMenuItem>
          </DropdownMenuGroup>
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
          className={`max-h-[90vh] gap-0 overflow-hidden overflow-y-auto p-0 ${
            mode === "open" ? "sm:max-w-[860px]" : "sm:max-w-[600px]"
          }`}
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
            {mode === "open" && (
              <aside className="w-44 shrink-0 border-r border-border bg-background/40 p-3">
                <div className="mb-2 px-2 text-xs text-muted-foreground">
                  {t("project.authorizedLocations")}
                </div>
                {roots.map((entry) => (
                  <button
                    key={entry.id}
                    disabled={busy || !entry.path}
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
                    disabled={busy || !entry.path}
                    title={locationLabel(entry)}
                    className="mb-1 flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs hover:bg-secondary disabled:opacity-40"
                    onClick={() =>
                      void run(async () => {
                        await activate(entry.path!)
                        setMode(null)
                      })
                    }
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                ))}
              </aside>
            )}
            <div className="min-w-0 flex-1 space-y-5 p-6">
              {mode === "open" ? (
                <>
                  <div className="flex items-stretch overflow-hidden rounded-md border border-border bg-background">
                    <button
                      disabled={busy || trail.length < 2}
                      aria-label={t("project.parentDirAria")}
                      className="border-r border-border px-2.5 text-muted-foreground transition hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      onClick={() => void run(() => browse(trail.slice(0, -1)))}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <div
                      className="min-w-0 flex-1 truncate px-3 py-2 text-xs"
                      title={location ?? ""}
                    >
                      {location ? location : t("project.noLocation")}
                    </div>
                  </div>
                  <div className="max-h-52 min-h-36 overflow-auto rounded-lg border border-border bg-background/40 p-1.5">
                    {!location ? (
                      <div className="flex min-h-32 flex-col items-center justify-center gap-2 py-5 text-xs text-muted-foreground">
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
                          className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-secondary"
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
                  <div className="flex justify-end">
                    <Button variant="outline" size="sm" disabled={busy} onClick={pick}>
                      {t("project.chooseLocation")}
                    </Button>
                  </div>
                </>
              ) : mode === "new" ? (
                <div className="space-y-2">
                  <Label className="text-xs">{t("project.locationLabel")}</Label>
                  <div className="flex items-center gap-2">
                    <div
                      className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-background px-3"
                      title={location ?? ""}
                    >
                      <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span
                        className={`truncate text-xs ${location ? "" : "text-muted-foreground"}`}
                      >
                        {location ? location : t("project.noLocation")}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={busy}
                      onClick={pick}
                    >
                      {t("project.chooseLocation")}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-background p-3 text-xs">
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
                <div className="space-y-2">
                  <Label htmlFor="project-entry-name" className="text-xs">
                    {mode === "new" ? t("project.nameLabel") : t("project.pathLabel")}
                  </Label>
                  <Input
                    id="project-entry-name"
                    autoFocus
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={mode === "new" ? "my-research-paper" : "chapters/method.tex"}
                    className="text-xs"
                  />
                </div>
              )}
              {mode === "new" && (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-xs">{t("project.templateLabel")}</Label>
                    <div className="flex items-center gap-2">
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        size="sm"
                        value={category}
                        onValueChange={(value) => value && setCategory(value)}
                        aria-label={t("project.templateCategoryAria")}
                      >
                        {["全部", "通用", "会议", "期刊"].map((item) => (
                          <ToggleGroupItem
                            key={item}
                            value={item}
                            className="h-7 px-2.5 text-[11px]"
                          >
                            {item}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          aria-label={t("project.templateSearchAria")}
                          value={query}
                          onChange={(event) => setQuery(event.target.value)}
                          placeholder={t("project.templateSearchPlaceholder")}
                          className="h-8 w-44 pl-7 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid max-h-56 grid-cols-2 gap-2 overflow-auto">
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
                          className={`relative rounded-lg border p-3 text-left transition ${
                            template === item.id
                              ? "border-primary bg-primary/10 shadow-[0_0_18px_-6px_hsl(var(--primary)/0.7)]"
                              : "border-border bg-background hover:border-primary/40 hover:bg-secondary/40"
                          }`}
                        >
                          <span className="block pr-4 text-xs font-medium">{item.name}</span>
                          <span className="mt-1 block text-[10px] text-muted-foreground">
                            {item.category} · {item.version}
                          </span>
                          {template === item.id && (
                            <Check className="absolute right-2.5 top-2.5 h-3.5 w-3.5 text-primary" />
                          )}
                        </button>
                      ))}
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[10px] text-muted-foreground">
                      {t("project.templateCurrent", {
                        name: paperTemplates.find((item) => item.id === template)?.name ?? "",
                      })}
                    </p>
                    {template !== "research" && (
                      <a
                        className="shrink-0 text-[10px] text-primary"
                        href={paperTemplates.find((item) => item.id === template)?.source}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("project.templateSource")}
                      </a>
                    )}
                  </div>
                </div>
              )}
              {mode === "new" && (
                <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-background/40 px-3 py-2.5">
                  <div className="space-y-0.5">
                    <Label htmlFor="project-git-toggle" className="text-xs font-medium">
                      {t("project.enableGit")}
                    </Label>
                    <p role="status" className="text-[10px] text-muted-foreground">
                      {gitStatus}
                    </p>
                  </div>
                  <Switch
                    id="project-git-toggle"
                    checked={enableGit}
                    disabled={!gitAvailable}
                    onCheckedChange={(value) => setEnableGit(value && gitAvailable)}
                  />
                </div>
              )}
              {changed > 0 && mode !== "file" && (
                <div className="rounded-lg border border-warning/30 p-3 text-xs text-warning">
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
          <div className="flex justify-end gap-2 border-t border-border bg-background/30 px-6 py-4">
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setMode(null)}>
              {t("project.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={
                busy ||
                (mode === "file" && taskBusy) ||
                (mode === "new" && enableGit && !gitAvailable) ||
                (mode !== "file" && !location) ||
                (mode !== "open" && !name.trim()) ||
                (!!changed && mode !== "file" && !discard)
              }
              className="shadow-[0_0_12px_-2px_hsl(var(--primary)/0.5)]"
              onClick={() =>
                void run(async () => {
                  if (mode === "file") {
                    if (!isTextPath(name.trim())) throw new Error(t("project.errorFileExtension"))
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
                    const created = fresh.files.find((file) => file.path === name.trim())
                    if (created)
                      window.dispatchEvent(
                        new CustomEvent("envoi:file-created", { detail: created }),
                      )
                  } else {
                    const rootPath =
                      mode === "new"
                        ? await createPaper(location, name.trim(), template, enableGit)
                        : location
                    setMode(null)
                    await activate(rootPath, discard)
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
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Notification message={message} kind="warning" testId="project-notification" />
    </>
  )
}
