import { useEffect, useId } from "react"
import { notify, type NotificationKind } from "@/lib/notifications"
import { toast } from "sonner"

/** Adapter for existing operation feedback; no space is reserved in the page. */
export function Notification({
  message,
  kind = "info",
  testId,
}: {
  message: string
  kind?: NotificationKind
  testId?: string
}) {
  const id = useId()
  useEffect(() => {
    const notificationId = testId ?? id
    if (message) notify(message, kind, notificationId, testId)
    else toast.dismiss(notificationId)
  }, [message, kind, id, testId])
  return null
}
