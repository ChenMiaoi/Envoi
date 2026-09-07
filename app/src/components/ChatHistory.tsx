import { useEffect, useState } from "react"
import { History, SquarePen } from "lucide-react"
import { useAgent } from "@/agent/context"
import { agentRequest, type AgentRecord } from "@/lib/agentClient"
import { Popover, PopoverTrigger, PopoverContent } from "./ui/popover"
import { useT } from "@/i18n/useT"
export interface ChatHistorySource {
  scope: string
  record: AgentRecord | null
  busy: boolean
  newSession: () => Promise<void>
  select: (id: string) => Promise<void>
  list: (query: string) => Promise<AgentRecord[]>
}
export function ChatHistory({ source }: { source?: ChatHistorySource } = {}) {
  const projectAgent = useAgent(),
    agent = { ...projectAgent, ...source },
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [rows, setRows] = useState<AgentRecord[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("")
  const { t } = useT()
  const list = source?.list
  const disabled = agent.busy || agent.navigating || !agent.ready
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError("")
      void (
        list
          ? list(query)
          : agentRequest<{ sessions: AgentRecord[] }>(
              "sessions",
              { projectId: agent.scope, query },
              controller.signal,
            ).then((result) => result.sessions)
      )
        .then((rows) => {
          if (!controller.signal.aborted) setRows(rows)
        })
        .catch((error) => {
          if (!controller.signal.aborted) setError(error.message)
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false)
        })
    }, 150)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [open, query, agent.scope, list])
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground">
      <button
        title={agent.busy ? t("chat.newChatAfterBusy") : t("chat.newChat")}
        aria-label={t("chat.newChat")}
        disabled={disabled}
        onClick={() => void agent.newSession()}
        className="rounded-full p-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
      >
        <SquarePen className="h-3.5 w-3.5" />
      </button>
      <Popover
        open={open}
        onOpenChange={(value) => {
          if (value) {
            setLoading(true)
            setError("")
          }
          setOpen(value)
        }}
      >
        <PopoverTrigger asChild>
          <button
            aria-label={t("chat.history")}
            title={t("chat.history")}
            className="rounded-full p-1.5 transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <History className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" side="top" className="w-80 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            {source ? t("chat.paperHistoryScope") : t("chat.historyScope")}
          </p>
          <input
            aria-label={t("chat.searchAria")}
            placeholder={t("chat.searchPlaceholder")}
            value={query}
            onChange={(event) => {
              setLoading(true)
              setQuery(event.target.value)
            }}
            className="mb-2 w-full rounded border bg-background px-2 py-1.5 text-sm outline-none"
          />
          <div className="max-h-64 overflow-y-auto">
            {error ? (
              <p role="alert" className="text-xs">
                {error}
              </p>
            ) : loading ? (
              <p className="text-xs text-muted-foreground">{t("chat.searching")}</p>
            ) : rows.length ? (
              rows.map((row) => (
                <button
                  key={row.id}
                  disabled={disabled}
                  aria-current={row.id === agent.record?.id ? "true" : undefined}
                  onClick={() => {
                    void agent.select(row.id)
                    setOpen(false)
                  }}
                  className="mb-1 block w-full rounded px-2 py-2 text-left hover:bg-muted aria-[current=true]:bg-muted disabled:opacity-50"
                >
                  <span className="block truncate text-sm">
                    {row.name || t("common.newSession")}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {row.created ? new Date(row.created).toLocaleString() : ""} ·{" "}
                    {t("chat.messageCount", { n: row.count ?? row.messages?.length ?? 0 })}
                  </span>
                </button>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">
                {query ? t("chat.noMatch") : t("chat.noSaved")}
              </p>
            )}
          </div>
          {agent.busy && (
            <p className="mt-2 text-xs text-muted-foreground">{t("chat.switchAfterBusy")}</p>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}
