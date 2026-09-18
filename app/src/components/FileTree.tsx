import { useGitStatus } from "@/project/gitStatusContext"
import { gitDecoration } from "@/lib/gitDecoration"
import { createContext, useContext, useMemo, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  FileText,
  FileType2,
  FileCode2,
  BookMarked,
  Image,
  FolderOpen,
  Folder,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { fileIconUrl } from "@/lib/fileIcons"
import { useT } from "@/i18n/useT"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

import type { FileNode } from "@/data/workspace"
export type TreeMenuAction = "new-file" | "new-folder" | "rename" | "delete" | "copy" | "paste"

const kindIcon: Record<string, typeof FileText> = {
  pdf: BookMarked,
  markdown: FileText,
  latex: FileCode2,
  bib: FileType2,
  image: Image,
}

const kindColor: Record<string, string> = {
  pdf: "text-[hsl(var(--hue-red))]",
  markdown: "text-[hsl(var(--hue-blue))]",
  latex: "text-[hsl(var(--hue-green))]",
  bib: "text-[hsl(var(--hue-orange))]",
  image: "text-[hsl(var(--hue-violet))]",
}

const TreeChanges = createContext<{
  files: Map<string, ReturnType<typeof gitDecoration>>
  folders: Set<string>
}>({ files: new Map(), folders: new Set() })

function TreeItem({
  node,
  depth,
  activeId,
  onOpen,
  onMenu,
  onImport,
  onPaste,
}: {
  node: FileNode
  depth: number
  activeId: string | null
  onOpen: (n: FileNode) => void
  onMenu?: (action: TreeMenuAction, node: FileNode) => void
  onImport?: (files: File[], node: FileNode) => void
  onPaste?: (node: FileNode) => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(true)
  const isFolder = node.kind === "folder"
  const isRoot = node.id === "project-root"
  const Icon = isFolder ? (open ? FolderOpen : Folder) : (kindIcon[node.kind] ?? FileText)
  const iconUrl = !isFolder ? fileIconUrl(node.name) : undefined
  const active = node.id === activeId
  const changes = useContext(TreeChanges)
  const path = node.path ?? node.id
  const decoration = !isFolder ? changes.files.get(path) : undefined
  const changedFolder = isFolder && changes.folders.has(node.id)

  const row = (
    <button
      onClick={() => (isFolder ? setOpen(!open) : onOpen(node))}
      onKeyDown={(event) => {
        if (!onMenu || !(event.ctrlKey || event.metaKey) || event.altKey) return
        if (event.key.toLowerCase() === "c" && !isRoot) {
          event.preventDefault()
          onMenu("copy", node)
        } else if (event.key.toLowerCase() === "v" && isFolder) {
          event.preventDefault()
          onPaste?.(node)
        }
      }}
      onDragOver={(event) => {
        if (isFolder && event.dataTransfer.types.includes("Files")) event.preventDefault()
      }}
      onDrop={(event) => {
        if (!isFolder || !event.dataTransfer.files.length) return
        event.preventDefault()
        event.stopPropagation()
        onImport?.(Array.from(event.dataTransfer.files), node)
      }}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-md py-[3.5px] pr-2 text-left text-[12.5px] transition-colors",
        active ? "bg-accent text-primary" : "text-foreground/80 hover:bg-secondary",
      )}
      style={{ paddingLeft: `${depth * 14 + 8}px` }}
    >
      {isFolder ? (
        open ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      {iconUrl ? (
        <img src={iconUrl} className="h-3.5 w-3.5 shrink-0" alt="" />
      ) : (
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            isFolder ? "text-muted-foreground" : kindColor[node.kind],
          )}
          strokeWidth={1.8}
        />
      )}
      <span
        title={node.name}
        className={cn(
          "min-w-0 truncate",
          decoration?.color,
          node.id === "project-root" && "text-[13px] font-semibold text-foreground",
        )}
      >
        {node.name}
      </span>
      {decoration && (
        <span
          aria-hidden="true"
          className={cn("ml-auto shrink-0 text-[10px] font-semibold", decoration.color)}
        >
          {decoration.badge}
        </span>
      )}
      {changedFolder && (
        <span
          aria-hidden="true"
          className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground"
        />
      )}
    </button>
  )
  return (
    <div>
      {onMenu ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent className="w-40">
            {isFolder && (
              <>
                <ContextMenuItem onSelect={() => onMenu("new-file", node)}>
                  {t("tree.newFile")}
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => onMenu("new-folder", node)}>
                  {t("tree.newFolder")}
                </ContextMenuItem>
                {!isRoot && <ContextMenuSeparator />}
              </>
            )}
            {!isRoot && (
              <ContextMenuItem onSelect={() => onMenu("copy", node)}>
                {t("tree.copy")}
              </ContextMenuItem>
            )}
            {isFolder && (
              <ContextMenuItem onSelect={() => onMenu("paste", node)}>
                {t("tree.paste")}
              </ContextMenuItem>
            )}
            {!isRoot && (
              <ContextMenuItem onSelect={() => onMenu("rename", node)}>
                {t("tree.rename")}
              </ContextMenuItem>
            )}
            {!isRoot && (
              <ContextMenuItem
                className="text-danger focus:text-danger"
                onSelect={() => onMenu("delete", node)}
              >
                {t("tree.delete")}
              </ContextMenuItem>
            )}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
      {isFolder &&
        open &&
        node.children?.map((c) => (
          <TreeItem
            key={c.id}
            node={c}
            depth={depth + 1}
            activeId={activeId}
            onOpen={onOpen}
            onMenu={onMenu}
            onImport={onImport}
            onPaste={onPaste}
          />
        ))}
    </div>
  )
}

export function FileTree({
  nodes,
  activeId,
  onOpen,
  onMenu,
  onImport,
  onPaste,
  rootName,
}: {
  rootName?: string
  nodes: FileNode[]
  activeId: string | null
  onOpen: (n: FileNode) => void
  onMenu?: (action: TreeMenuAction, node: FileNode) => void
  onImport?: (files: File[], node: FileNode) => void
  onPaste?: (node: FileNode) => void
}) {
  const { t } = useT()
  const { status } = useGitStatus()
  const changes = useMemo(() => {
    const files = new Map<string, ReturnType<typeof gitDecoration>>()
    const folders = new Set<string>()
    for (const file of status?.files ?? []) {
      files.set(file.path, gitDecoration(file))
      folders.add("project-root")
      for (const path of [file.path, file.originalPath]) {
        if (!path) continue
        let end = path.lastIndexOf("/")
        while (end > 0) {
          folders.add(path.slice(0, end))
          end = path.lastIndexOf("/", end - 1)
        }
      }
    }
    return { files, folders }
  }, [status])
  return (
    <TreeChanges.Provider value={changes}>
      <div className="envoi-scrollbar h-full overflow-y-auto px-1.5 py-2">
        {rootName ? (
          <TreeItem
            key={rootName}
            node={{ id: "project-root", name: rootName, kind: "folder", children: nodes }}
            depth={0}
            activeId={activeId}
            onOpen={onOpen}
            onMenu={onMenu}
            onImport={onImport}
            onPaste={onPaste}
          />
        ) : nodes.length ? (
          nodes.map((n) => (
            <TreeItem
              key={n.id}
              node={n}
              depth={0}
              activeId={activeId}
              onOpen={onOpen}
              onMenu={onMenu}
              onImport={onImport}
              onPaste={onPaste}
            />
          ))
        ) : (
          <p className="px-3 py-2 text-xs text-muted-foreground">{t("project.notOpen")}</p>
        )}
      </div>
    </TreeChanges.Provider>
  )
}
