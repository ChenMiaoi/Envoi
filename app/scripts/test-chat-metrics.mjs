import assert from "node:assert/strict"
import { createChatMetrics } from "../server/chat-metrics.mjs"
import { summarizeChatMetrics } from "../src/lib/chatStats.mjs"
let now = 1000
const collector = createChatMetrics({ model: "fixture", provider: "local" }, () => now)
const emit = (at, event) => {
  now = at
  collector.handle(event)
}
emit(1100, { type: "turn_start" })
emit(1400, {
  type: "message_update",
  assistantMessageEvent: { type: "thinking_delta", delta: "PRIVATE CONTENT" },
})
emit(1500, {
  type: "message_update",
  assistantMessageEvent: { type: "text_delta", delta: "hello" },
})
emit(2400, {
  type: "message_end",
  message: {
    role: "assistant",
    stopReason: "toolUse",
    usage: { input: 20, cacheRead: 80, cacheWrite: 0, output: 50 },
  },
})
emit(2400, {
  type: "tool_execution_start",
  toolCallId: "a",
  toolName: "read",
  args: { path: "secret.txt" },
})
emit(2500, { type: "tool_execution_start", toolCallId: "b", toolName: "bash" })
emit(2700, { type: "tool_execution_end", toolCallId: "a", isError: false })
emit(2900, { type: "tool_execution_end", toolCallId: "b", isError: true })
emit(3000, { type: "turn_start" })
emit(3200, {
  type: "message_end",
  message: {
    role: "assistant",
    stopReason: "stop",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  },
})
now = 3300
collector.finish("complete")
const stats = summarizeChatMetrics([collector.value], now)
assert.equal(stats.turns, 1)
assert.equal(stats.calls, 2)
assert.equal(stats.tools, 2)
assert.equal(stats.failedTools, 1)
assert.equal(stats.elapsedMs, 2300)
assert.equal(stats.modelMs, 1500)
assert.equal(stats.toolMs, 700, "parallel tools are cumulative, not wall time")
assert.equal(stats.ttftMs, 300)
assert.equal(stats.tokensPerSecond, 50)
assert.equal(stats.input, 100)
assert.equal(stats.output, 50)
assert.equal(stats.cacheHit, 0.8)
assert.equal(stats.usageCalls, 1)
assert(!JSON.stringify(collector.value).includes("PRIVATE"))
assert(!JSON.stringify(collector.value).includes("secret"))
assert.deepEqual(summarizeChatMetrics(JSON.parse(JSON.stringify([collector.value])), now), stats)
const empty = summarizeChatMetrics([], now)
assert.equal(empty.input, null)
assert.equal(empty.cacheHit, null)
assert.equal(empty.ttftMs, null)
const cancelled = createChatMetrics({ model: "fixture", provider: "local" }, () => now)
cancelled.handle({ type: "turn_start" })
now += 500
cancelled.finish("cancelled")
assert.equal(cancelled.value.calls[0].status, "cancelled")
assert.equal(summarizeChatMetrics([cancelled.value]).modelMs, 500)
assert.equal(summarizeChatMetrics([cancelled.value]).input, null)
console.log(
  "PASS metrics: phase timing, first output, normalized cache, usage coverage, cancellation, privacy and persistence",
)

const combined = summarizeChatMetrics([collector.value, cancelled.value], now)
assert.equal(combined.turns, 2)
assert.equal(combined.calls, 3)
assert.equal(combined.modelMs, 2000)
assert.equal(combined.input, 100)
assert.equal(combined.usageCalls, 1)
