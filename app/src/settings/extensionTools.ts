export type Tool = {
  id: string
  label: string
  kind?: string
  languages?: string[]
  available: boolean
  path?: string
  version?: string
  error?: string
  candidates?: { path: string; version?: string }[]
  binary?: string
  installable?: boolean
  installMethod?: string | null
}
export type ToolInfo = { groups?: Record<string, Tool[]> }
export function pathsOf(tool: Tool) {
  if (tool.id === "rustAnalyzer" && !tool.version && !tool.candidates?.some((item) => item.version))
    return []
  return (
    tool.candidates ??
    (tool.available && tool.path ? [{ path: tool.path, version: tool.version }] : [])
  )
}
