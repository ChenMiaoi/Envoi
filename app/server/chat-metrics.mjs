// Local, content-free telemetry. SDK token usage is normalized across providers.
export function createChatMetrics({ model, provider }, clock = Date.now) {
  const value = {
    version: 1,
    model,
    provider,
    startedAt: clock(),
    status: "running",
    calls: [],
    tools: [],
  }
  let current
  function handle(event) {
    const now = clock()
    value.updatedAt = now
    if (event.type === "turn_start") {
      current = { startedAt: now, status: "running", usage: null }
      value.calls.push(current)
      return true
    }
    if (event.type === "message_update" && current && current.firstTokenAt == null) {
      const delta = event.assistantMessageEvent
      if (["text_delta", "thinking_delta", "toolcall_delta"].includes(delta?.type) && delta.delta) {
        current.firstTokenAt = now
        return true
      }
    }
    if (event.type === "message_end" && event.message?.role === "assistant" && current) {
      current.endedAt = now
      current.status = event.message.stopReason
      const usage = event.message.usage
      // The SDK also creates all-zero usage when a provider supplies none.
      if (
        usage &&
        [usage.input, usage.output, usage.cacheRead, usage.cacheWrite].some(
          (n) => Number.isFinite(n) && n > 0,
        )
      ) {
        current.usage = Object.fromEntries(
          ["input", "output", "cacheRead", "cacheWrite"].map((key) => [
            key,
            Number.isFinite(usage[key]) && usage[key] >= 0 ? usage[key] : 0,
          ]),
        )
      }
      current = undefined
      return true
    }
    if (event.type === "tool_execution_start") {
      value.tools.push({
        id: event.toolCallId,
        name: event.toolName,
        startedAt: now,
        status: "running",
      })
      return true
    }
    if (event.type === "tool_execution_end") {
      const tool = value.tools.find((t) => t.id === event.toolCallId && t.endedAt == null)
      if (tool) {
        tool.endedAt = now
        tool.status = event.isError ? "failed" : "complete"
      }
      return !!tool
    }
    return false
  }
  function finish(status) {
    const now = clock()
    value.updatedAt = now
    value.endedAt = now
    value.status = status
    for (const item of [...value.calls, ...value.tools])
      if (item.endedAt == null) {
        item.endedAt = now
        item.status = status === "complete" ? "incomplete" : status
      }
  }
  return { value, handle, finish }
}
