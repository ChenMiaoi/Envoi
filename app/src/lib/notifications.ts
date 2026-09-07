import { toast } from "sonner"

export type NotificationKind = "info" | "success" | "warning" | "error"
export const notificationDuration = { info: 4000, success: 4000, warning: 6000, error: 8000 }

export function notify(
  message: string,
  kind: NotificationKind = "info",
  id?: string,
  testId?: string,
) {
  if (!message.trim()) return
  return toast[kind](message, { id, testId, duration: notificationDuration[kind] })
}
