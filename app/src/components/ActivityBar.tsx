import { BookOpenText, PenLine, LibraryBig, Settings, FlaskConical } from "lucide-react";
import {NavLink} from "react-router";
import {viewPaths,type ViewId} from "@/navigation/routes";
import { cn } from "@/lib/utils";

const items: { id: ViewId; label: string; icon: typeof BookOpenText }[] = [
  { id: "reader", label: "阅读配置", icon: BookOpenText },
  { id: "writer", label: "写作配置", icon: PenLine },
  { id: "library", label: "论文库", icon: LibraryBig },
  { id: "settings", label: "设置", icon: Settings },
];

export function ActivityBar({
  view,
}: {
  view?: ViewId;
}) {
  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-border bg-card py-2">
      {items.slice(0, 3).map((it) => (
        <NavLink
          end
          to={viewPaths[it.id]}
          key={it.id}
          title={it.label}
          className={cn(
            "group relative mb-1.5 flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
            view === it.id
              ? "bg-accent text-primary"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          )}
        >
          {view === it.id && (
            <span className="absolute left-[-9px] top-1/2 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-primary" />
          )}
          <it.icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </NavLink>
      ))}
      <button
        title="实验追踪（即将上线）"
        className="mb-1.5 flex h-10 w-10 cursor-not-allowed items-center justify-center rounded-lg text-muted-foreground/40"
      >
        <FlaskConical className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      <div className="flex-1" />
      <NavLink
        to={viewPaths.settings}
        title="设置"
        className={cn(
          "flex h-10 w-10 items-center justify-center rounded-lg transition-colors",
          view === "settings"
            ? "bg-accent text-primary"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        )}
      >
        <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </NavLink>
    </div>
  );
}
