export type LogLevel = "debug" | "info" | "warn" | "error"
export interface SafeError {
  name: string
  code?: string
  frames: string[]
}
// Do not persist error messages: compiler/API errors can contain manuscript text or credentials.
export function safeError(value: unknown): SafeError {
  const error = value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  const names = [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "ReferenceError",
    "AbortError",
    "TimeoutError",
  ]
  const name = typeof error.name === "string" && names.includes(error.name) ? error.name : "Error"
  const code =
    typeof error.code === "string" && /^(?:E[A-Z]{2,24}|ERR_[A-Z_]{1,48})$/.test(error.code)
      ? error.code
      : undefined
  const stack =
    typeof error.stack === "string"
      ? error.stack
      : Array.isArray(error.frames)
        ? error.frames
            .slice(0, 16)
            .filter((frame) => typeof frame === "string" && frame.length < 240)
            .map((frame) => `    at /src/${frame}`)
            .join("\n")
        : ""
  const frames = stack
    ? stack
        .slice(0, 16000)
        .split("\n")
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 16)
        .map((line) => {
          // Keep source locations inside application code, never absolute user paths or URL queries.
          const location = line.match(
            /(?:[/\\](?:dist|src|electron|server)[/\\])([\w/\\.-]+\.(?:m?js|cjs|tsx?)):(\d+):(\d+)\)?$/,
          )
          return location
            ? `${location[1].replaceAll("\\", "/")}:${location[2]}:${location[3]}`
            : "[external frame]"
        })
    : []
  return { name, ...(code ? { code } : {}), frames }
}

export interface RendererLog {
  level: LogLevel
  event: "renderer.error" | "renderer.rejection" | "react.error" | "notification.shown"
  error?: SafeError
}
