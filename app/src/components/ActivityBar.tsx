import { BookOpenText, PenLine, LibraryBig, Settings, History } from "lucide-react"
import { NavLink } from "react-router"
import { viewPaths, type ViewId } from "@/navigation/routes"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n/useT"

const items: { id: ViewId; icon: typeof BookOpenText }[] = [
  { id: "reader", icon: BookOpenText },
  { id: "writer", icon: PenLine },
  { id: "library", icon: LibraryBig },
  { id: "history", icon: History },
  { id: "settings", icon: Settings },
]

export function ActivityBar({ view }: { view?: ViewId }) {
  const { t } = useT()
  return (
    <nav aria-label={t("app.statusbar.pageNavigation")} className="flex items-center gap-0.5">
      {items.map((it) => (
        <NavLink
          end
          to={viewPaths[it.id]}
          key={it.id}
          title={t(`view.${it.id}`)}
          className={cn(
            "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
            view === it.id
              ? "bg-accent/70 text-primary [filter:drop-shadow(0_0_5px_hsl(var(--primary)/0.45))]"
              : "text-muted-foreground hover:bg-white/[0.06] hover:text-foreground",
          )}
        >
          <it.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span className="hidden xl:inline">{t(`view.${it.id}`)}</span>
        </NavLink>
      ))}
    </nav>
  )
}
