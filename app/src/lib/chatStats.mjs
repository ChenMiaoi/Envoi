export function summarizeChatMetrics(metrics, now = Date.now()) {
  const calls = metrics.flatMap((m) =>
    m.calls.map((c) => ({ ...c, endedAt: c.endedAt ?? m.endedAt })),
  )
  const tools = metrics.flatMap((m) =>
    m.tools.map((t) => ({ ...t, endedAt: t.endedAt ?? m.endedAt })),
  )
  const duration = (item) => Math.max(0, (item.endedAt ?? now) - item.startedAt)
  const measured = calls.filter((c) => c.usage)
  const waits = calls.filter((c) => c.firstTokenAt != null)
  const generated = measured.filter(
    (c) => c.firstTokenAt != null && c.endedAt != null && c.endedAt > c.firstTokenAt,
  )
  const input = measured.reduce(
    (sum, c) => sum + c.usage.input + c.usage.cacheRead + c.usage.cacheWrite,
    0,
  )
  const cache = measured.reduce((sum, c) => sum + c.usage.cacheRead, 0)
  const generationMs = generated.reduce((sum, c) => sum + c.endedAt - c.firstTokenAt, 0)
  return {
    turns: metrics.length,
    calls: calls.length,
    tools: tools.length,
    failedTools: tools.filter((t) => t.status === "failed").length,
    elapsedMs: metrics.reduce((sum, m) => sum + duration(m), 0),
    modelMs: calls.reduce((sum, c) => sum + duration(c), 0),
    toolMs: tools.reduce((sum, t) => sum + duration(t), 0),
    ttftMs: waits.length
      ? waits.reduce((sum, c) => sum + Math.max(0, c.firstTokenAt - c.startedAt), 0) / waits.length
      : null,
    tokensPerSecond: generationMs
      ? generated.reduce((sum, c) => sum + c.usage.output, 0) / (generationMs / 1000)
      : null,
    input: measured.length ? input : null,
    output: measured.length ? measured.reduce((sum, c) => sum + c.usage.output, 0) : null,
    cacheHit: cache > 0 && input > 0 ? cache / input : null,
    usageCalls: measured.length,
  }
}
