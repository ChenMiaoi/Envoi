import { useGitStatus } from "@/project/gitStatusContext"
import { useProject } from "@/project/context"
import { gitDecoration } from "@/lib/gitDecoration"
import { useState } from "react"
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
import { useT } from "@/i18n/useT"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"

import type { FileNode } from "@/data/workspace"
export type TreeMenuAction = "new-file" | "new-folder" | "rename" | "delete"

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

function TreeItem({
  node,
  depth,
  activeId,
  onOpen,
  onMenu,
}: {
  node: FileNode
  depth: number
  activeId: string | null
  onOpen: (n: FileNode) => void
  onMenu?: (action: TreeMenuAction, node: FileNode) => void
}) {
  const { t } = useT()
  const [open, setOpen] = useState(true)
  const isFolder = node.kind === "folder"
  const isRoot = node.id === "project-root"
  const Icon = isFolder ? (open ? FolderOpen : Folder) : (kindIcon[node.kind] ?? FileText)
  const active = node.id === activeId
  const { status } = useGitStatus()
  const { project } = useProject()
  const path = isFolder ? node.id : project.files.find((file) => file.id === node.id)?.path
  const change = status?.files.find((file) => file.path === path)
  const decoration = !isFolder && change ? gitDecoration(change) : undefined
  const changedFolder =
    isFolder &&
    status?.files.some(
      (file) =>
        node.id === "project-root" ||
        file.path.startsWith(node.id + "/") ||
        file.originalPath?.startsWith(node.id + "/"),
    )

  const row = (
    <button
      onClick={() => (isFolder ? setOpen(!open) : onOpen(node))}
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
      <Icon
        className={cn(
          "h-3.5 w-3.5 shrink-0",
          isFolder ? "text-muted-foreground" : kindColor[node.kind],
        )}
        strokeWidth={1.8}
      />
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
  rootName,
}: {
  rootName?: string
  nodes: FileNode[]
  activeId: string | null
  onOpen: (n: FileNode) => void
  onMenu?: (action: TreeMenuAction, node: FileNode) => void
}) {
  const { t } = useT()
  return (
    <div className="envoi-scrollbar h-full overflow-y-auto px-1.5 py-2">
      {rootName ? (
        <TreeItem
          key={rootName}
          node={{ id: "project-root", name: rootName, kind: "folder", children: nodes }}
          depth={0}
          activeId={activeId}
          onOpen={onOpen}
          onMenu={onMenu}
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
          />
        ))
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("project.notOpen")}</p>
      )}
    </div>
  )
}
