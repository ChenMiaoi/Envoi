import { useEffect, useState } from "react"
import { FolderOpen, ChevronDown, Check, Network, SquareTerminal } from "lucide-react"
import { useProject } from "./context"
import { useT } from "@/i18n/useT"
import { recentProjects, type RecentProject } from "@/lib/recentProjects"
import { locationLabel } from "@/lib/workspaceLocation"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"

export function ProjectIdentity() {
  const { t } = useT()
  const { project, navigationBusy, saving, setMessage } = useProject()
  const [recent, setRecent] = useState<RecentProject[]>([])
  const refresh = () =>
    void recentProjects()
      .then(setRecent)
      .catch((error) => setMessage(error.message))
  useEffect(() => {
    let alive = true
    void recentProjects()
      .then((rows) => {
        if (alive) setRecent(rows)
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [project.id])
  const name = project.id === "empty" ? t("project.notOpened") : project.name
  const current = recent.find((entry) => entry.path === project.rootPath)
  const blocked = navigationBusy || saving
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) refresh()
      }}
    >
      <DropdownMenuTrigger
        disabled={blocked}
        aria-label={t("project.identityAria", { name })}
        title={current ? locationLabel(current) : name}
        className="flex min-w-0 max-w-64 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-medium hover:bg-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
        <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel>{t("project.recentHeading")}</DropdownMenuLabel>
        <div className="max-h-64 overflow-y-auto">
          {recent.map((entry) => (
            <DropdownMenuItem
              key={entry.id}
              disabled={blocked || !entry.path}
              onSelect={() =>
                window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: entry.path }))
              }
            >
              <span className="w-4 shrink-0">
                {entry.path === project.rootPath && <Check className="size-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate">{entry.name}</span>
                <span
                  className="block truncate text-[11px] text-muted-foreground"
                  title={locationLabel(entry)}
                >
                  {locationLabel(entry)}
                </span>
              </span>
            </DropdownMenuItem>
          ))}
          {!recent.length && (
            <p className="px-2 py-3 text-xs text-muted-foreground">{t("project.noRecent")}</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event("envoi:open-project"))}>
          <FolderOpen />
          {t("project.openProjectFolder")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event("envoi:open-remote"))}>
          <Network />
          {t("remote.manage")}
        </DropdownMenuItem>
        {/Win/.test(navigator.platform) && (
          <DropdownMenuItem
            onSelect={() =>
              window.dispatchEvent(new CustomEvent("envoi:open-remote", { detail: "wsl" }))
            }
          >
            <SquareTerminal />
            {t("wsl.manage")}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event("envoi:new-project"))}>
          {t("project.newProject")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={project.id === "empty"}
          onSelect={() => window.dispatchEvent(new Event("envoi:close-project"))}
        >
          {t("project.closeCurrentEllipsis")}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => window.dispatchEvent(new Event("envoi:manage-projects"))}>
          {t("project.manageMenu")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
