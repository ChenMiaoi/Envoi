import type { ReactNode } from "react"
export function SettingsRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/50 py-4 last:border-0">
      <div className="min-w-0">
        <h3 className="text-[13px] font-medium">{label}</h3>
        {hint && (
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>
        )}
      </div>
      <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">{children}</div>
    </div>
  )
}
