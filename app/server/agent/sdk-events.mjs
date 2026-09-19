// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { createExtensionRuntime } from "@earendil-works/pi-coding-agent"

export const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () =>
    "You are the Envoi research assistant. Context explicitly marked as unsaved draft is not the on-disk file. Never claim file operations you did not perform. Tools are limited to authorized project files. No shell, hidden files or external paths are available.",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
}
export function textEvent(event) {
  if (event.type === "message_update") {
    const d = event.assistantMessageEvent
    if (d?.type === "text_delta") return { type: "delta", text: d.delta }
    if (d?.type === "thinking_delta") return { type: "thinking", text: d.delta }
  }
  if (event.type === "tool_execution_start")
    return {
      type: "tool",
      phase: "start",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      detail: JSON.stringify(event.args ?? {}).slice(0, 4000),
    }
  if (event.type === "tool_execution_update")
    return {
      type: "tool",
      phase: "update",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      detail: (event.partialResult?.content ?? [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .slice(-8000),
    }
  if (event.type === "tool_execution_end")
    return {
      type: "tool",
      phase: "end",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      isError: !!event.isError,
      detail: (event.result?.content ?? [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .slice(0, 8000),
    }
  return null
}
