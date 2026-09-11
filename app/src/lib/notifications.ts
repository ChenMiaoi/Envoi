import { toast } from "sonner"
import { logEvent } from "./logging"

export type NotificationKind = "info" | "success" | "warning" | "error"
export const notificationDuration = { info: 4000, success: 4000, warning: 6000, error: 8000 }

export function notify(
  message: string,
  kind: NotificationKind = "info",
  id?: string,
  testId?: string,
) {
  if (!message.trim()) return
  logEvent({
    event: "notification.shown",
    level: kind === "warning" ? "warn" : kind === "error" ? "error" : "info",
  })
  return toast[kind](message, { id, testId, duration: notificationDuration[kind] })
}

/** Indeterminate background work; resolve by calling notify with the same id. */
export function notifyLoading(message: string, id: string) {
  if (!message.trim()) return
  logEvent({ event: "notification.shown", level: "info" })
  return toast.loading(message, { id })
}
