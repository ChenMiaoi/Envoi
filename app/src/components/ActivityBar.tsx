import { BookOpenText, PenLine, LibraryBig, Settings, History } from "lucide-react";
import {NavLink} from "react-router";
import {viewPaths,type ViewId} from "@/navigation/routes";
import { cn } from "@/lib/utils";
import {useT} from "@/i18n/useT";

const items: { id: ViewId; icon: typeof BookOpenText }[] = [
  { id: "reader", icon: BookOpenText },
  { id: "writer", icon: PenLine },
  { id: "library", icon: LibraryBig },
  { id: "history", icon: History },
];

export function ActivityBar({
  view,
}: {
  view?: ViewId;
}) {
  const {t}=useT();
  return (
    <div className="flex h-full w-12 flex-col items-center border-r border-border bg-card py-2">
      {items.slice(0, 4).map((it) => (
        <NavLink
          end
          to={viewPaths[it.id]}
          key={it.id}
          title={t(`view.${it.id}`)}
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
      <div className="flex-1" />
      <NavLink
        to={viewPaths.settings}
        title={t("view.settings")}
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
