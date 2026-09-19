import { GitStatusProvider } from "@/project/GitStatusProvider"
import { ProjectTrust, TrustRequired } from "@/project/ProjectTrust"
import { useProjectTrust } from "@/project/useProjectTrust"
import { WelcomePage } from "@/project/WelcomePage"
import { Toaster } from "@/components/ui/sonner"
import { usePreferences } from "@/settings/context"
import { envoi } from "@/lib/desktop"
import { ProjectIdentity } from "@/project/ProjectIdentity"
import { RemoteWorkspaceControls } from "@/project/RemoteWorkspaceControls"
import { WorkspaceBadge } from "@/project/WorkspaceBadge"
import { AgentProvider } from "@/agent/AgentProvider"
import {
  AiStatusControl,
  LspStatusControl,
  CompileStatusControl,
} from "@/components/StatusBarSettings"
import {
  commands,
  matchBinding,
  commandChordLabel,
  resolveBindings,
  type Command,
} from "@/navigation/shortcuts"
import { PreferencesProvider } from "@/settings/PreferencesProvider"
import { type MessageKey } from "@/i18n/runtime"
import { useT } from "@/i18n/useT"
import { I18nProvider } from "@/i18n"
import { useSettings } from "@/settings/useSettings"
import type { ProjectFile } from "@/lib/projectFiles"
import { ProjectProvider } from "@/project/ProjectProvider"
import { ProjectMenu } from "@/project/ProjectMenu"
import { useProject } from "@/project/context"
import { sameFileNavigation } from "@/lib/projectPerformance"
import { projectTree } from "@/lib/projectFiles"
import { useLspStatus } from "@/lib/lspStatus"
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ProblemsPanel, type ProblemTarget } from "@/project/ProblemsPanel"
import { GitStatusPanel } from "@/project/GitStatusPanel"
import {
  Search,
  BookMarked,
  FileText,
  FileCode2,
  FileType2,
  BookOpenText,
  PenLine,
  LibraryBig,
  History,
  Settings,
} from "lucide-react"
import { ActivityBar } from "@/components/ActivityBar"
import { viewPaths, resolvePage, type ViewId } from "@/navigation/routes"
import { Link, Navigate, useLocation, useNavigate } from "react-router"
import type { OpenFile } from "@/views/ReaderView"
import { type FileNode } from "@/data/workspace"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"

const ReaderView = lazy(() =>
  import("@/views/ReaderView").then((module) => ({ default: module.ReaderView })),
)
const WriterView = lazy(() =>
  import("@/views/WriterView").then((module) => ({ default: module.WriterView })),
)
const LibraryView = lazy(() =>
  import("@/views/LibraryView").then((module) => ({ default: module.LibraryView })),
)
const GitHistoryView = lazy(() =>
  import("@/views/GitHistoryView").then((module) => ({ default: module.GitHistoryView })),
)
const SettingsView = lazy(() =>
  import("@/views/SettingsView").then((module) => ({ default: module.SettingsView })),
)

const kindIcon: Record<string, typeof FileText> = {
  pdf: BookMarked,
  markdown: FileText,
  latex: FileCode2,
  bib: FileType2,
}

function flatten(nodes: FileNode[], prefix = ""): { node: FileNode; path: string }[] {
  return nodes.flatMap((n) =>
    n.kind === "folder"
      ? flatten(n.children ?? [], `${prefix}${n.name}/`)
      : [{ node: n, path: `${prefix}${n.name}` }],
  )
}

export default function App() {
  return (
    <PreferencesProvider>
      <I18nProvider>
        <Toaster />
        <ProjectProvider>
          <AgentProvider>
            <ProjectSession />
          </AgentProvider>
        </ProjectProvider>
      </I18nProvider>
    </PreferencesProvider>
  )
}
function ProjectSession() {
  const project = useProject((state) => ({ id: state.project.id })),
    navigate = useNavigate(),
    previous = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (previous.current === project.id) return
    previous.current = project.id
    void navigate("/reader", { replace: true })
  }, [project.id, navigate])
  return (
    <GitStatusProvider key={project.id}>
      <ProjectApp />
    </GitStatusProvider>
  )
}
function ProjectApp() {
  const { t } = useT()
  const { effective } = useSettings()
  const lspStatus = useLspStatus()
  const project = useProject(
    (state) => ({
      id: state.project.id,
      rootPath: state.project.rootPath,
      files: state.project.files,
      directories: state.project.directories,
    }),
    (left, right) =>
      left.id === right.id &&
      left.rootPath === right.rootPath &&
      left.directories === right.directories &&
      sameFileNavigation(left.files, right.files),
  )
  const trust = useProjectTrust(project.rootPath)
  const fileTree = useMemo(
    () => projectTree(project.files, project.directories),
    [project.files, project.directories],
  )
  const [problemTarget, setProblemTarget] = useState<ProblemTarget | undefined>()
  const location = useLocation(),
    navigate = useNavigate()
  const page = resolvePage(location.pathname),
    view = page.view
  const setView = useCallback(
    (next: ViewId) => {
      if (location.pathname !== viewPaths[next]) void navigate(viewPaths[next])
    },
    [location.pathname, navigate],
  )
  // The workspace stays mounted across URLs so editor buffers and in-flight tools survive.
  const [visited, setVisited] = useState<Set<ViewId>>(() => new Set(view ? [view] : []))
  if (view && !visited.has(view)) setVisited(new Set([...visited, view]))
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [libraryFiles] = useState<ProjectFile[]>([])
  const emptyWorkspace =
    project.id === "empty" && view !== "library" && view !== "settings" && !libraryFiles.length
  const [openFiles, setOpenFiles] = useState<OpenFile[]>([])
  const [writerFile, setWriterFile] = useState<{ id: string; request: number } | undefined>()
  const [codeTarget, setCodeTarget] = useState<
    { path: string; position: { line: number; character: number }; id: string } | undefined
  >()
  const openTex = (id: string) => {
    setWriterFile((previous) => ({ id, request: (previous?.request ?? 0) + 1 }))
    setView("writer")
  }
  const [activeId, setActiveId] = useState<string | null>(null)

  const allFiles = useMemo(() => flatten(fileTree), [fileTree])

  const mac = /Mac/.test(navigator.platform)
  const windows = /Win/.test(navigator.platform)
  const { preferences } = usePreferences()
  useEffect(() => {
    if (!windows) return
    const frame = requestAnimationFrame(() => {
      const style = getComputedStyle(document.documentElement),
        canvas = document.createElement("canvas").getContext("2d")
      if (!canvas) return
      const hex = (name: string) => {
        canvas.fillStyle = `hsl(${style.getPropertyValue(name)})`
        return canvas.fillStyle
      }
      void envoi()
        .windowColors({
          color: hex(emptyWorkspace ? "--background" : "--card"),
          symbolColor: hex("--foreground"),
        })
        .catch(() => {})
    })
    return () => cancelAnimationFrame(frame)
  }, [windows, preferences.theme, emptyWorkspace])
  const runCommand = useCallback(
    (command: Command) => {
      if (command.id === "palette") {
        setPaletteOpen((v) => !v)
        return
      }
      if (command.view) {
        setView(command.view)
        return
      }
      if (command.id === "compile") {
        setView("writer")
        setTimeout(() => window.dispatchEvent(new Event("envoi:compile")), 0)
        return
      }
      if (command.event)
        window.dispatchEvent(
          new CustomEvent(command.event, { detail: command.detail, cancelable: true }),
        )
    },
    [setView],
  )
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (e.target as HTMLElement)?.closest?.("[data-shortcut-recorder]")) return
      const command = matchBinding(e, resolveBindings(effective.bindings))
      if (!command || (command.scope !== "global" && command.scope !== view)) {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !e.shiftKey && !e.altKey)
          e.preventDefault()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      runCommand(command)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [runCommand, effective.bindings, view])

  const openFromPalette = (f: { node: FileNode; path: string }) => {
    setPaletteOpen(false)
    if (f.node.kind === "latex") {
      openTex(f.node.id)
      return
    }
    setView("reader")
    if (!openFiles.find((o) => o.id === f.node.id))
      setOpenFiles([...openFiles, { id: f.node.id, name: f.node.name, kind: f.node.kind }])
    setActiveId(f.node.id)
  }

  return (
    <div className="relative flex h-screen flex-col overflow-hidden text-foreground">
      {page.redirect && <Navigate to={page.redirect} replace />}
      {(mac || windows) && emptyWorkspace && (
        <div aria-hidden="true" className="window-drag fixed inset-x-0 top-0 z-40 h-10" />
      )}
      {/* The macOS traffic lights share the content area; keep controls clear of them. */}
      <div
        className={
          emptyWorkspace
            ? "hidden"
            : `relative flex h-11 shrink-0 items-center ${mac ? "window-drag pl-[80px]" : windows ? "window-drag pr-[150px]" : ""}`
        }
      >
        <div className="relative z-10 flex min-w-0 items-center gap-2 pl-3.5">
          <div className="shrink-0">
            <ProjectMenu />
          </div>
          <ProjectIdentity />
          <WorkspaceBadge />
          <RemoteWorkspaceControls />
        </div>
        <div className="absolute left-1/2 -translate-x-1/2">
          <ActivityBar view={view} />
        </div>
        <div className="min-w-0 flex-1" />
        <div className="flex shrink-0 items-center pr-3.5">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-7 w-44 max-w-full items-center gap-2 rounded-full border border-white/[0.08] bg-card/40 px-3 text-[11.5px] text-muted-foreground backdrop-blur-xl backdrop-saturate-150 transition-colors hover:border-primary/50"
          >
            <Search className="h-3 w-3" />
            <span className="hidden min-w-0 flex-1 truncate text-left lg:inline">
              {t("app.searchPlaceholder")}
            </span>
            <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1 font-editor text-[10px] lg:inline">
              {commandChordLabel("palette", resolveBindings(effective.bindings), mac)}
            </kbd>
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className={`flex min-h-0 flex-1 ${emptyWorkspace ? "" : "px-2.5 pb-12"}`}>
        <div className={`min-w-0 flex-1 ${emptyWorkspace ? "" : "overflow-hidden"}`}>
          <Suspense
            fallback={
              <div
                role="status"
                className="flex h-full items-center justify-center text-sm text-muted-foreground"
              >
                {t("project.processing")}
              </div>
            }
          >
            {emptyWorkspace && <WelcomePage />}
            {!emptyWorkspace && visited.has("reader") && (
              <section
                hidden={view !== "reader"}
                className="h-full motion-safe:animate-[view-in_160ms_ease-out]"
                aria-label={t("app.aria.reader")}
              >
                <ReaderView
                  libraryFiles={libraryFiles}
                  onTex={openTex}
                  openFiles={openFiles}
                  activeId={activeId}
                  onOpenFiles={setOpenFiles}
                  onActive={setActiveId}
                  codeTarget={codeTarget}
                />
              </section>
            )}
            {project.id !== "empty" && visited.has("writer") && (
              <section
                hidden={view !== "writer"}
                className="h-full motion-safe:animate-[view-in_160ms_ease-out]"
                aria-label={t("app.aria.writer")}
              >
                <WriterView requestedFile={writerFile} problemTarget={problemTarget} />
              </section>
            )}
            {visited.has("library") && (
              <section
                hidden={view !== "library"}
                className="h-full motion-safe:animate-[view-in_160ms_ease-out]"
                aria-label={t("app.aria.library")}
              >
                {project.rootPath && !trust?.trusted ? (
                  <div className="h-full p-1.5">
                    <div className="workspace-pane h-full">
                      <TrustRequired />
                    </div>
                  </div>
                ) : (
                  <LibraryView />
                )}
              </section>
            )}
            {project.id !== "empty" && visited.has("history") && (
              <section
                hidden={view !== "history"}
                className="h-full motion-safe:animate-[view-in_160ms_ease-out]"
                aria-label={t("app.aria.history")}
              >
                {trust?.trusted ? (
                  <GitHistoryView />
                ) : (
                  <div className="h-full p-1.5">
                    <div className="workspace-pane h-full">
                      <TrustRequired />
                    </div>
                  </div>
                )}
              </section>
            )}
            {visited.has("settings") && (
              <section
                hidden={view !== "settings"}
                className="h-full motion-safe:animate-[view-in_160ms_ease-out]"
                aria-label={t("app.aria.settings")}
              >
                <SettingsView />
              </section>
            )}
            {!view && !page.redirect && (
              <div className="flex h-full flex-col items-center justify-center gap-3">
                <h1 className="text-lg font-medium">{t("app.notFound.title")}</h1>
                <p className="text-sm text-muted-foreground">{t("app.notFound.body")}</p>
                <Link to="/writer" className="text-sm text-primary">
                  {t("app.notFound.back")}
                </Link>
              </div>
            )}
          </Suspense>
        </div>
      </div>

      {/* 状态栏 */}
      {!emptyWorkspace && (
        <div className="pointer-events-none absolute bottom-3.5 left-1/2 z-30 w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 text-[11px] text-muted-foreground">
          <div className="pointer-events-auto scrollbar-none flex h-7 max-w-full items-center gap-3 overflow-x-auto rounded-full border border-white/[0.08] bg-card/40 px-4 shadow-[0_8px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150 tabular-nums">
            {project.id !== "empty" && <ProjectTrust />}
            {project.id !== "empty" && <GitStatusPanel />}
            {project.id !== "empty" && (view === "reader" || view === "writer") && (
              <ProblemsPanel
                mode={view === "reader" ? "reader" : "writer"}
                activePath={project.files.find((file) => file.id === activeId)?.path}
                onNavigate={(target) => {
                  setProblemTarget(target)
                  setView("writer")
                }}
                onCodeNavigate={(path, position) => {
                  const file = project.files.find((item) => item.path === path)
                  if (!file) return
                  setView("reader")
                  if (!openFiles.find((o) => o.id === file.id))
                    setOpenFiles([...openFiles, { id: file.id, name: file.path, kind: file.kind }])
                  setActiveId(file.id)
                  setCodeTarget({ path, position, id: crypto.randomUUID() })
                }}
              />
            )}
            <span aria-hidden="true" className="h-3 w-px bg-border" />
            <AiStatusControl />
            {view === "reader" && lspStatus && (
              <LspStatusControl
                status={lspStatus}
                path={project.files.find((file) => file.id === activeId)?.path ?? ""}
              />
            )}
            <CompileStatusControl />
          </div>
        </div>
      )}

      {/* ⌘K 命令面板 */}
      <CommandDialog open={paletteOpen} onOpenChange={setPaletteOpen}>
        <CommandInput placeholder={t("app.palettePlaceholder")} />
        <CommandList>
          <CommandEmpty>{t("app.paletteEmpty")}</CommandEmpty>
          <CommandGroup heading={t("app.paletteViews")}>
            <CommandItem
              onSelect={() => {
                setView("reader")
                setPaletteOpen(false)
              }}
            >
              <BookOpenText className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t("view.reader")}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setView("writer")
                setPaletteOpen(false)
              }}
            >
              <PenLine className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t("view.writer")}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setView("library")
                setPaletteOpen(false)
              }}
            >
              <LibraryBig className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t("view.library")}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setView("history")
                setPaletteOpen(false)
              }}
            >
              <History className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t("view.history")}
            </CommandItem>
            <CommandItem
              onSelect={() => {
                setView("settings")
                setPaletteOpen(false)
              }}
            >
              <Settings className="mr-2 h-3.5 w-3.5 text-muted-foreground" /> {t("view.settings")}
            </CommandItem>
          </CommandGroup>
          <CommandGroup heading={t("app.paletteActions")}>
            {commands
              .filter((item) => item.event && item.scope === "global")
              .map((item) => (
                <CommandItem
                  key={item.id}
                  onSelect={() => {
                    setPaletteOpen(false)
                    setTimeout(() => runCommand(item), 0)
                  }}
                >
                  <span>{t(`command.${item.id}` as MessageKey)}</span>
                  <kbd className="ml-auto text-[10px] text-muted-foreground">
                    {commandChordLabel(item.id, resolveBindings(effective.bindings), mac)}
                  </kbd>
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandGroup heading={t("app.paletteFiles")}>
            {allFiles.map((f) => {
              const Icon = kindIcon[f.node.kind] ?? FileText
              return (
                <CommandItem key={f.node.id} value={f.path} onSelect={() => openFromPalette(f)}>
                  <Icon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                  <span>{f.path}</span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </div>
  )
}
