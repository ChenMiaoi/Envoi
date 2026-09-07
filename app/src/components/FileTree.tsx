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
import type { FileNode } from "@/data/workspace"

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
}: {
  node: FileNode
  depth: number
  activeId: string | null
  onOpen: (n: FileNode) => void
}) {
  const [open, setOpen] = useState(true)
  const isFolder = node.kind === "folder"
  const Icon = isFolder ? (open ? FolderOpen : Folder) : (kindIcon[node.kind] ?? FileText)
  const active = node.id === activeId

  return (
    <div>
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
            "truncate",
            node.id === "project-root" && "text-[13px] font-semibold text-foreground",
          )}
        >
          {node.name}
        </span>
      </button>
      {isFolder &&
        open &&
        node.children?.map((c) => (
          <TreeItem key={c.id} node={c} depth={depth + 1} activeId={activeId} onOpen={onOpen} />
        ))}
    </div>
  )
}

export function FileTree({
  nodes,
  activeId,
  onOpen,
  rootName,
}: {
  rootName?: string
  nodes: FileNode[]
  activeId: string | null
  onOpen: (n: FileNode) => void
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
        />
      ) : nodes.length ? (
        nodes.map((n) => (
          <TreeItem key={n.id} node={n} depth={0} activeId={activeId} onOpen={onOpen} />
        ))
      ) : (
        <p className="px-3 py-2 text-xs text-muted-foreground">{t("project.notOpen")}</p>
      )}
    </div>
  )
}
