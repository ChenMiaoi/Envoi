import type { ChatMetrics } from "./agentClient"
export function summarizeChatMetrics(
  metrics: ChatMetrics[],
  now?: number,
): {
  turns: number
  calls: number
  tools: number
  failedTools: number
  elapsedMs: number
  modelMs: number
  toolMs: number
  ttftMs: number | null
  tokensPerSecond: number | null
  input: number | null
  output: number | null
  cacheHit: number | null
  usageCalls: number
}
