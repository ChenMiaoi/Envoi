import type { RemoteState } from "../../shared/remote"

export function remoteStatusDot(state: RemoteState["state"]): string {
  return state === "connected"
    ? "bg-green-500"
    : state === "connecting"
      ? "bg-amber-500 animate-pulse"
      : "bg-muted-foreground/40"
}

export function remoteStatusPill(state: RemoteState["state"]): string {
  return state === "connected"
    ? "bg-green-500/10 text-green-600 ring-green-500/25 dark:text-green-400"
    : state === "connecting"
      ? "bg-amber-500/10 text-amber-600 ring-amber-500/25 dark:text-amber-400"
      : "bg-muted/60 text-muted-foreground ring-border/70"
}
