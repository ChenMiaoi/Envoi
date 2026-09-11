import { useEffect, useState } from "react"
import { ChartNoAxesColumn, Download } from "lucide-react"
import type { AgentRecord, ChatMetrics } from "@/lib/agentClient"
import { summarizeChatMetrics } from "@/lib/chatStats.mjs"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { useT } from "@/i18n/useT"

export function ChatStats({ record, busy }: { record: AgentRecord | null; busy: boolean }) {
  const { t } = useT()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<"session" | "turn">("session")
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!open || !busy) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [open, busy])
  const assistants = record?.messages.filter((m) => m.role === "assistant") ?? []
  const selected = scope === "turn" ? assistants.slice(-1) : assistants
  const metrics = selected.flatMap((m) =>
    m.metrics
      ? [
          !busy && !m.metrics.endedAt
            ? {
                ...m.metrics,
                status: "interrupted",
                endedAt: m.metrics.updatedAt ?? m.metrics.startedAt,
              }
            : m.metrics,
        ]
      : [],
  )
  const stats = summarizeChatMetrics(metrics, now)
  const missing = t("chat.statsUnavailable")
  const time = (ms: number | null) =>
    ms == null
      ? missing
      : ms < 60000
        ? `${(ms / 1000).toFixed(1)}s`
        : `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  const tokens = (n: number | null) =>
    n == null
      ? missing
      : new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n)
  const rows = [
    [t("chat.statsTurns"), String(selected.length)],
    [t("chat.statsCalls"), metrics.length ? String(stats.calls) : missing],
    [t("chat.statsTools"), metrics.length ? String(stats.tools) : missing],
    [t("chat.statsElapsed"), metrics.length ? time(stats.elapsedMs) : missing],
    [t("chat.statsModelTime"), metrics.length ? time(stats.modelMs) : missing],
    [t("chat.statsToolTime"), metrics.length ? time(stats.toolMs) : missing],
    [t("chat.statsTtft"), time(stats.ttftMs)],
    [
      t("chat.statsSpeed"),
      stats.tokensPerSecond == null ? missing : `${stats.tokensPerSecond.toFixed(1)} tok/s`,
    ],
    [t("chat.statsInput"), tokens(stats.input)],
    [t("chat.statsOutput"), tokens(stats.output)],
    [
      t("chat.statsCache"),
      stats.cacheHit == null ? missing : `${(stats.cacheHit * 100).toFixed(1)}%`,
    ],
    [t("chat.statsFailedTools"), metrics.length ? String(stats.failedTools) : missing],
  ]
  function download() {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      scope,
      measuredTurns: metrics.length,
      totalTurns: selected.length,
      summary: stats,
      turns: metrics,
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "envoi-chat-statistics.json"
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setNow(Date.now())
        setOpen(value)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("chat.statsTitle")}
          title={t("chat.statsTitle")}
          disabled={!assistants.length}
          className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
        >
          <ChartNoAxesColumn className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-[380px] max-w-[calc(100vw-24px)] p-4"
        aria-label={t("chat.statsTitle")}
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">{t("chat.statsTitle")}</h3>
          <button
            onClick={download}
            disabled={!metrics.length}
            title={t("chat.statsExport")}
            aria-label={t("chat.statsExport")}
            className="rounded p-1 text-muted-foreground hover:bg-muted disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
        <div className="mb-3 flex gap-1 rounded bg-muted p-1">
          {(["session", "turn"] as const).map((value) => (
            <button
              key={value}
              aria-pressed={scope === value}
              onClick={() => setScope(value)}
              className="flex-1 rounded px-2 py-1 text-xs aria-pressed:bg-background"
            >
              {t(value === "session" ? "chat.statsSession" : "chat.statsTurn")}
            </button>
          ))}
        </div>
        <div className="max-h-[55vh] overflow-y-auto">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            {rows.map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-sm tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("chat.statsCoverage", {
              measured: metrics.length,
              total: selected.length,
              usage: stats.usageCalls,
              calls: stats.calls,
            })}
          </p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("chat.statsMethod")}</summary>
            <p className="mt-2 leading-relaxed">{t("chat.statsMethodText")}</p>
          </details>
          {!!metrics.length && (
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{t("chat.statsByTurn")}</summary>
              <ol className="mt-2 space-y-2">
                {selected.map((message, index) => (
                  <li key={message.id} className="rounded border p-2">
                    <span className="block">
                      #{scope === "turn" ? assistants.length : index + 1} ·{" "}
                      {message.metrics?.model ?? missing}
                    </span>
                    <span>
                      {message.metrics
                        ? turnSummary(
                            metrics.find((m) => m.startedAt === message.metrics?.startedAt) ??
                              message.metrics,
                          )
                        : missing}
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
  function turnSummary(metric: ChatMetrics) {
    const row = summarizeChatMetrics([metric], now)
    return `${time(row.elapsedMs)} · ${tokens(row.input)} / ${tokens(row.output)} tok · ${t(metric.status === "running" ? "chat.statsRunning" : metric.status === "complete" ? "chat.statsComplete" : metric.status === "failed" ? "chat.statsFailed" : "chat.statsStopped")}`
  }
}
