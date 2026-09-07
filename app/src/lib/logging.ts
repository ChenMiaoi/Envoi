import { safeError, type RendererLog } from "../../shared/log-record"

export function logEvent(entry: RendererLog) {
  try {
    window.envoi?.diagnosticsLog(entry)
  } catch {
    /* Diagnostics must never break an operation. */
  }
}
export function logError(
  event: "renderer.error" | "renderer.rejection" | "react.error",
  error: unknown,
) {
  logEvent({ level: "error", event, error: safeError(error) })
}
export function installErrorLogging() {
  window.addEventListener("error", (event) => logError("renderer.error", event.error))
  window.addEventListener("unhandledrejection", (event) =>
    logError("renderer.rejection", event.reason),
  )
}
