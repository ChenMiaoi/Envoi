import { usePreferences } from "@/settings/context"
import { useEffect, useMemo, useState } from "react"
import {
  ResizablePanelGroup as PanelGroup,
  ResizablePanel as Panel,
  ResizableHandle as PanelResizeHandle,
} from "@/components/ui/resizable"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  X,
  BookMarked,
  FileText,
  FileCode2,
  FileType2,
  Image as ImageIcon,
  FolderTree,
  MessageSquareText,
  Pin,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fileIconUrl } from "@/lib/fileIcons"
import { type FileNode } from "@/data/workspace"
import { useProject } from "@/project/context"
import { createTextFile, fileKind, projectTree } from "@/lib/projectFiles"
import { TexCompilePreview } from "@/components/TexCompilePreview"
import { FileTree, type TreeMenuAction } from "@/components/FileTree"
import { ChatPanel } from "@/components/ChatPanel"
import { DelimitedEditor } from "@/components/DelimitedEditor"
import { MarkdownEditor } from "@/components/MarkdownEditor"
import { CodeEditor } from "@/components/CodeEditor"
import { MarkdownViewer, LatexViewer, BibViewer, ViewerBadge } from "@/components/viewers"
import { commandChordLabel, resolveBindings } from "@/navigation/shortcuts"
import { envoi } from "@/lib/desktop"
import { researchLibrary } from "@/lib/researchLibrary"
import { importLibraryFiles } from "@/lib/paperLibrary"
import { encodeNative } from "@/lib/localData"
import { useNavigate } from "react-router"
import { extractPdfText } from "@/lib/metadataLookup"
import { useT } from "@/i18n/useT"

const tabIcon: Record<string, typeof FileText> = {
  pdf: BookMarked,
  markdown: FileText,
  latex: FileCode2,
  bib: FileType2,
  image: ImageIcon,
}

export interface OpenFile {
  id: string
  name: string
  kind: string
}

export function ReaderView({
  openFiles,
  activeId,
  onOpenFiles,
  onActive,
  onTex,
  codeTarget,
  libraryFiles,
}: {
  openFiles: OpenFile[]
  activeId: string | null
  onOpenFiles: (f: OpenFile[]) => void
  libraryFiles: import("@/lib/projectFiles").ProjectFile[]
  onActive: (id: string) => void
  onTex: (id: string) => void
  codeTarget?: { path: string; position: { line: number; character: number }; id: string }
}) {
  const { preferences } = usePreferences()
  const { project, edit, busy, setMessage } = useProject()
  const navigate = useNavigate()
  const [importing, setImporting] = useState(false)
  const [readOnlyFiles, setReadOnlyFiles] = useState<string[]>([])
  const [codeJump, setCodeJump] = useState<{
    path: string
    position: { line: number; character: number }
    id: string
  }>()
  const [lastCodeTarget, setLastCodeTarget] = useState(codeTarget)
  if (codeTarget && codeTarget !== lastCodeTarget) {
    setLastCodeTarget(codeTarget)
    setCodeJump(codeTarget)
  }
  const { t } = useT()
  const fileTree = useMemo(
    () => projectTree(project.files, project.directories),
    [project.files, project.directories],
  )
  const fileContents = Object.fromEntries(project.files.map((file) => [file.id, file.text]))
  const activeData = [...project.files, ...libraryFiles].find((file) => file.id === activeId)
  const kind = activeData ? fileKind(activeData.path) : undefined
  const canToggleReadOnly =
    kind === "markdown" || kind === "csv" || kind === "tsv" || kind === "text"
  const readOnly = Boolean(activeId && readOnlyFiles.includes(activeId))
  const toggleReadOnly = () => {
    if (!activeId || !canToggleReadOnly) return
    setReadOnlyFiles((files) =>
      files.includes(activeId) ? files.filter((id) => id !== activeId) : [...files, activeId],
    )
  }
  const [showChat, setShowChat] = useState(true)
  const [showTree, setShowTree] = useState(true)
  const active = openFiles.find((f) => f.id === activeId)
  const [pdfContext, setPdfContext] = useState<{ id: string; text: string } | null>(null)
  useEffect(() => {
    const file = kind === "pdf" ? activeData?.file : undefined
    if (!file || !activeId) return
    let live = true
    extractPdfText(file, 2)
      .then((text) => {
        if (live) setPdfContext({ id: activeId, text: text.slice(0, 4000) })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [activeId, kind, activeData?.file])

  const openNode = (n: FileNode) => {
    if (n.kind === "latex") {
      onTex(n.id)
      return
    }
    if (!openFiles.find((f) => f.id === n.id))
      onOpenFiles([...openFiles, { id: n.id, name: n.name, kind: n.kind }])
    onActive(n.id)
  }

  const [pinned, setPinned] = useState<string[]>([])
  const [treeAction, setTreeAction] = useState<{ action: TreeMenuAction; node: FileNode } | null>(
    null,
  )
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const close = (id: string) => {
    setReadOnlyFiles((files) => files.filter((item) => item !== id))
    setPinned((list) => list.filter((item) => item !== id))
    const rest = openFiles.filter((f) => f.id !== id)
    onOpenFiles(rest)
    if (activeId === id && rest.length) onActive(rest[rest.length - 1].id)
  }

  const [actionName, setActionName] = useState("")
  const togglePin = (id: string) => {
    const target = openFiles.find((f) => f.id === id)
    if (!target) return
    const pinning = !pinned.includes(id),
      nextPinned = pinning ? [...pinned, id] : pinned.filter((item) => item !== id),
      rest = openFiles.filter((f) => f.id !== id)
    onOpenFiles([
      ...rest.filter((f) => nextPinned.includes(f.id)),
      target,
      ...rest.filter((f) => !nextPinned.includes(f.id)),
    ])
    setPinned(nextPinned)
  }
  const closeOthers = (keepId: string) => {
    onOpenFiles(openFiles.filter((f) => f.id === keepId || pinned.includes(f.id)))
    onActive(keepId)
  }
  const closeAll = () => {
    const rest = openFiles.filter((f) => pinned.includes(f.id))
    onOpenFiles(rest)
    if (activeId && !rest.some((f) => f.id === activeId) && rest.length)
      onActive(rest[rest.length - 1].id)
  }

  const treePath = (node: FileNode) => (node.id === "project-root" ? "" : node.id)
  const pasteNode = async (node: FileNode) => {
    if (!project.rootPath || !copiedPath || busy) return
    const directory = treePath(node)
    const name = copiedPath.split("/").at(-1)!
    const target = directory ? `${directory}/${name}` : name
    try {
      await envoi().fsCopy(project.rootPath, copiedPath, target)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  const importFiles = async (files: File[], node: FileNode) => {
    if (!project.rootPath || busy) return
    try {
      const tokens = await Promise.all(files.map((file) => envoi().importTokenForFile(file)))
      await envoi().fsImport(project.rootPath, tokens, treePath(node))
    } catch (error) {
      setMessage((error as Error).message)
    }
  }
  const onTreeMenu = (action: TreeMenuAction, node: FileNode) => {
    if (action === "copy") {
      setCopiedPath(treePath(node))
      return
    }
    if (action === "paste") {
      void pasteNode(node)
      return
    }
    setActionName(action === "rename" ? node.name : "")
    setTreeAction({ action, node })
  }
  const runTreeAction = async () => {
    if (!treeAction || !project.rootPath) return
    const { action, node } = treeAction,
      path = treePath(node),
      rootPath = project.rootPath
    try {
      if (action === "delete") {
        await envoi().fsRemove(rootPath, path)
        const rest = openFiles.filter((f) => f.id !== path && !f.id.startsWith(path + "/"))
        onOpenFiles(rest)
        if (activeId && (activeId === path || activeId.startsWith(path + "/")) && rest.length)
          onActive(rest[rest.length - 1].id)
      } else {
        const name = actionName.trim()
        if (!name || /[/\\]/.test(name) || name === "." || name === "..") {
          setMessage(t("tree.invalidName"))
          return
        }
        const dir =
            action === "rename"
              ? path.split("/").slice(0, -1).join("/")
              : node.kind === "folder"
                ? path
                : path.split("/").slice(0, -1).join("/"),
          target = dir ? `${dir}/${name}` : name
        if (action === "new-file") {
          await createTextFile(rootPath, target, "")
          openNode({ id: target, name, kind: fileKind(target) })
        } else if (action === "new-folder") {
          await envoi().fsMkdir(rootPath, target)
        } else {
          await envoi().fsRename(rootPath, path, target)
          onOpenFiles(
            openFiles.map((f) =>
              f.id === path
                ? { ...f, id: target, name }
                : f.id.startsWith(path + "/")
                  ? { ...f, id: target + f.id.slice(path.length) }
                  : f,
            ),
          )
          if (activeId === path) onActive(target)
          else if (activeId?.startsWith(path + "/")) onActive(target + activeId.slice(path.length))
        }
      }
      setTreeAction(null)
    } catch (error) {
      setMessage((error as Error).message)
    }
  }

  useEffect(() => {
    const onReadOnly = () => {
      if (!activeId || !["markdown", "csv", "tsv", "text"].includes(kind ?? "")) return
      setReadOnlyFiles((files) =>
        files.includes(activeId) ? files.filter((id) => id !== activeId) : [...files, activeId],
      )
    }
    const onTab = (event: Event) => {
      const action = (event as CustomEvent<string>).detail
      const index = openFiles.findIndex((f) => f.id === activeId)
      if (action === "close") {
        if (!activeId) return
        const rest = openFiles.filter((f) => f.id !== activeId)
        onOpenFiles(rest)
        if (rest.length) onActive(rest[rest.length - 1].id)
      } else if ((action === "prev" || action === "next") && openFiles.length > 1) {
        const next =
          openFiles[
            ((index < 0 ? 0 : index) + (action === "next" ? 1 : openFiles.length - 1)) %
              openFiles.length
          ]
        if (next) onActive(next.id)
      }
    }
    const onPanel = (event: Event) => {
      const panel = (event as CustomEvent<string>).detail
      if (panel === "tree") setShowTree((v) => !v)
      else if (panel === "chat") setShowChat((v) => !v)
    }
    window.addEventListener("envoi:tab", onTab)
    window.addEventListener("envoi:panel", onPanel)
    window.addEventListener("envoi:reader-read-only", onReadOnly)
    return () => {
      window.removeEventListener("envoi:tab", onTab)
      window.removeEventListener("envoi:panel", onPanel)
      window.removeEventListener("envoi:reader-read-only", onReadOnly)
    }
  }, [openFiles, activeId, kind, onOpenFiles, onActive])

  return (
    <>
      <PanelGroup orientation="horizontal" className="h-full">
        {/* 左：目录树 */}
        {showTree && (
          <Panel defaultSize="18%" minSize="14%" maxSize="30%" className="bg-card">
            <div className="flex h-full flex-col">
              <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[11px] uppercase tracking-widest text-muted-foreground">
                <span>{t("reader.explorer")}</span>
                <button
                  disabled={busy || !project.rootPath}
                  className="rounded px-2 py-1 normal-case tracking-normal hover:bg-secondary disabled:opacity-40"
                  onClick={() => window.dispatchEvent(new Event("envoi:new-note"))}
                >
                  新建笔记
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <FileTree
                  rootName={project.id === "empty" ? undefined : project.name}
                  nodes={fileTree}
                  activeId={activeId}
                  onOpen={openNode}
                  onMenu={project.rootPath ? onTreeMenu : undefined}
                  onPaste={(node) => void pasteNode(node)}
                  onImport={(files, node) => void importFiles(files, node)}
                />
              </div>
            </div>
          </Panel>
        )}
        {showTree && (
          <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />
        )}

        {/* 中：编辑/预览区 */}
        <Panel minSize="30%">
          <div className="flex h-full flex-col bg-background">
            {/* 标签栏 */}
            <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-card">
              <div className="scrollbar-none flex min-w-0 flex-1 items-stretch overflow-x-auto">
                {openFiles.map((f) => {
                  const Icon = tabIcon[f.kind] ?? FileText
                  const isActive = f.id === activeId
                  return (
                    <ContextMenu key={f.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          onClick={() => (f.kind === "latex" ? onTex(f.id) : onActive(f.id))}
                          ref={(el) => {
                            if (isActive)
                              el?.scrollIntoView({ block: "nearest", inline: "nearest" })
                          }}
                          className={cn(
                            "group flex cursor-pointer select-none items-center gap-1.5 border-r border-border px-3 text-[12px]",
                            isActive
                              ? "bg-background text-foreground shadow-[inset_0_2px_0_0_hsl(var(--primary))]"
                              : "text-muted-foreground hover:bg-secondary/60",
                          )}
                        >
                          {fileIconUrl(f.name) ? (
                            <img src={fileIconUrl(f.name)} className="h-3.5 w-3.5" alt="" />
                          ) : (
                            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                          )}
                          <span className="whitespace-nowrap">
                            {f.name}
                            {project.files.find((file) => file.id === f.id)?.text !==
                            project.files.find((file) => file.id === f.id)?.saved
                              ? " · " + t("reader.unsaved")
                              : ""}
                          </span>
                          {pinned.includes(f.id) ? (
                            <Pin
                              aria-label={t("tab.pinned")}
                              className="h-3 w-3 shrink-0 text-muted-foreground"
                            />
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                close(f.id)
                              }}
                              className="rounded p-0.5 opacity-0 transition-opacity hover:bg-accent group-hover:opacity-100"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="w-44">
                        <ContextMenuItem onSelect={() => close(f.id)}>
                          {t("tab.close")}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={openFiles.length <= pinned.length + 1}
                          onSelect={() => closeOthers(f.id)}
                        >
                          {t("tab.closeOthers")}
                        </ContextMenuItem>
                        <ContextMenuItem
                          disabled={openFiles.length <= pinned.length}
                          onSelect={closeAll}
                        >
                          {t("tab.closeAll")}
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        <ContextMenuItem onSelect={() => togglePin(f.id)}>
                          {pinned.includes(f.id) ? t("tab.unpin") : t("tab.pin")}
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  )
                })}
              </div>
              <div className="flex shrink-0 items-center border-l border-border">
                {kind === "pdf" &&
                  activeData &&
                  project.files.some((file) => file.id === activeId) && (
                    <button
                      disabled={importing || busy}
                      className="shrink-0 px-3 text-xs disabled:opacity-40"
                      onClick={async () => {
                        if (!project.rootPath) return
                        setImporting(true)
                        try {
                          const data =
                            activeData.file ??
                            new File(
                              [
                                Uint8Array.from(
                                  atob(
                                    (await envoi().fsRead(project.rootPath, activeData.path))
                                      .base64 ?? "",
                                  ),
                                  (c) => c.charCodeAt(0),
                                ),
                              ],
                              activeData.path.split("/").pop() ?? "paper.pdf",
                              { type: "application/pdf" },
                            )
                          const papers = await importLibraryFiles([data])
                          await researchLibrary(project.rootPath, {
                            action: "import",
                            papers: await encodeNative(papers),
                          })
                          window.dispatchEvent(new Event("envoi:library-updated"))
                          setMessage("PDF 已归档到当前研究的论文库。")
                          void navigate("/library")
                        } catch (error) {
                          setMessage((error as Error).message)
                        } finally {
                          setImporting(false)
                        }
                      }}
                    >
                      {importing ? "正在归档…" : "归档到论文库"}
                    </button>
                  )}
                {canToggleReadOnly && (
                  <button
                    aria-pressed={readOnly}
                    title={commandChordLabel(
                      "reader-read-only",
                      resolveBindings(preferences.bindings),
                      /Mac/.test(navigator.platform),
                    )}
                    className="shrink-0 px-3 text-xs hover:text-primary"
                    onClick={toggleReadOnly}
                  >
                    {readOnly ? t("reader.readOnly") : t("reader.livePreview")}
                  </button>
                )}
                <div className="flex items-center gap-1 px-2">
                  <button
                    title={showTree ? t("reader.hideTree") : t("reader.showTree")}
                    onClick={() => setShowTree(!showTree)}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      showTree ? "text-primary" : "text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <FolderTree className="h-3.5 w-3.5" />
                  </button>
                  <button
                    title={showChat ? t("reader.hideChat") : t("reader.showChat")}
                    onClick={() => setShowChat(!showChat)}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      showChat ? "text-primary" : "text-muted-foreground hover:bg-secondary",
                    )}
                  >
                    <MessageSquareText className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* 内容：打开后默认进入对应预览模式 */}
            <div className="min-h-0 flex-1">
              {!active ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <div className="text-[13px]">{t("reader.openHint")}</div>
                </div>
              ) : activeData?.text === undefined && kind !== "image" && kind !== "pdf" ? (
                <p className="p-4 text-sm text-muted-foreground">{t("reader.notText")}</p>
              ) : kind === "markdown" && readOnly ? (
                <MarkdownViewer
                  source={fileContents[active.id] ?? ""}
                  path={activeData?.path ?? active.name}
                  onOpenDoc={(file) =>
                    openNode({ id: file.id, name: file.path, kind: fileKind(file.path) })
                  }
                />
              ) : kind === "markdown" ? (
                <MarkdownEditor
                  key={active.id}
                  source={fileContents[active.id] ?? ""}
                  readOnly={busy}
                  onChange={(text) => edit(active.id, text)}
                  path={activeData?.path ?? active.name}
                  files={project.files}
                  onOpen={(file) => openNode({ id: file.id, name: file.path, kind: file.kind })}
                />
              ) : (kind === "csv" || kind === "tsv") && activeData?.text !== undefined ? (
                <DelimitedEditor
                  key={active.id}
                  source={activeData.text}
                  delimiter={kind === "tsv" ? "\t" : ","}
                  onChange={(text) => edit(active.id, text)}
                  readOnly={busy || readOnly}
                />
              ) : kind === "text" && activeData?.text !== undefined ? (
                <CodeEditor
                  key={active.id}
                  root={project.rootPath}
                  path={activeData.path}
                  source={activeData.text}
                  readOnly={busy || readOnly}
                  onChange={(text) => edit(active.id, text)}
                  ariaLabel={t("reader.textEditorAria")}
                  jumpTo={codeJump}
                  onNavigate={(path, position) => {
                    const file = project.files.find((item) => item.path === path)
                    if (file) {
                      setCodeJump({ path, position, id: crypto.randomUUID() })
                      openNode({ id: file.id, name: file.path, kind: file.kind })
                    }
                  }}
                />
              ) : kind === "latex" ? (
                <LatexViewer source={fileContents[active.id] ?? ""} />
              ) : kind === "bib" ? (
                <BibViewer source={fileContents[active.id] ?? ""} />
              ) : kind === "pdf" ? (
                activeData?.file || activeData?.url ? (
                  <TexCompilePreview
                    key={`${active.id}:${activeData?.file?.lastModified ?? activeData?.url}`}
                    initialSource={{
                      name: activeData.path,
                      file: activeData.file,
                      url: activeData.url,
                    }}
                  />
                ) : (
                  <p className="p-4 text-xs text-muted-foreground">{t("reader.noPdfContent")}</p>
                )
              ) : kind === "image" && activeData?.url ? (
                <img
                  className="max-h-full max-w-full object-contain"
                  src={activeData.url}
                  alt={active.name}
                />
              ) : (
                <p className="p-4 text-xs text-muted-foreground">{t("reader.noPreview")}</p>
              )}
            </div>

            {/* 底部信息条 */}
            {active && (
              <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-card px-3 text-[11px] text-muted-foreground">
                <span>
                  <ViewerBadge kind={kind ?? active.kind} />
                </span>
                <span className="font-editor">
                  {kind === "pdf"
                    ? t("reader.pdfPaging")
                    : t("reader.lineCount", {
                        n: (fileContents[active.id] ?? "").split("\n").length,
                      })}
                </span>
              </div>
            )}
          </div>
        </Panel>

        {/* 右：AI 聊天 */}
        {showChat && (
          <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-primary/60" />
        )}
        {showChat && (
          <Panel defaultSize="23%" minSize="16%" maxSize="40%">
            <ChatPanel
              context={
                active
                  ? {
                      label: activeData?.path ?? active.name,
                      text:
                        activeData?.text !== undefined
                          ? activeData.text
                          : kind === "pdf" && pdfContext?.id === active.id
                            ? pdfContext.text
                            : "",
                    }
                  : undefined
              }
            />
          </Panel>
        )}
      </PanelGroup>
      <Dialog open={!!treeAction} onOpenChange={(open) => !open && setTreeAction(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {treeAction?.action === "delete"
                ? t("tree.deleteTitle", { name: treeAction.node.name })
                : treeAction?.action === "rename"
                  ? t("tree.renameTitle", { name: treeAction.node.name })
                  : treeAction?.action === "new-folder"
                    ? t("tree.newFolder")
                    : t("tree.newFile")}
            </DialogTitle>
          </DialogHeader>
          {treeAction?.action === "delete" ? (
            <p className="text-sm text-muted-foreground">
              {t(
                treeAction.node.kind === "folder"
                  ? "tree.deleteFolderConfirm"
                  : "tree.deleteConfirm",
                { name: treeAction.node.name },
              )}
            </p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                void runTreeAction()
              }}
            >
              <input
                autoFocus
                value={actionName}
                onChange={(e) => setActionName(e.target.value)}
                placeholder={t("tree.namePlaceholder")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </form>
          )}
          <DialogFooter>
            <button
              onClick={() => setTreeAction(null)}
              className="rounded border border-border px-3 py-1.5 text-xs hover:bg-secondary"
            >
              {t("common.cancel")}
            </button>
            <button
              onClick={() => void runTreeAction()}
              className={cn(
                "rounded px-3 py-1.5 text-xs",
                treeAction?.action === "delete"
                  ? "border border-danger/40 text-danger hover:bg-danger/10"
                  : "bg-primary text-primary-foreground",
              )}
            >
              {t("common.confirm")}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
