export const field = "rounded border border-input bg-background px-2 py-1.5 text-xs"
export const headerPrimary =
  "rounded-lg bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
export const headerGhost =
  "rounded-lg border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-border hover:bg-secondary hover:text-foreground active:scale-[0.98] disabled:opacity-50"
export const notice = (error: unknown) =>
  window.dispatchEvent(
    new CustomEvent("envoi:storage-warning", { detail: (error as Error).message }),
  )
