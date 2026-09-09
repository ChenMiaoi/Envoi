import { useEffect, useState } from "react"
import { Brain, Terminal, LoaderCircle, Check, CircleAlert } from "lucide-react"
import type { AgentMessage, ChatPart } from "@/lib/agentClient"
import { appendChatEvent } from "@/lib/chatActivity.mjs"
import { useT } from "@/i18n/useT"
import { ChatMarkdown } from "./ChatMarkdown"

export function ChatActivity({ message, active }: { message: AgentMessage; active: boolean }) {
  const { t } = useT()
  const [now, setNow] = useState(() => Date.now())
  const [mounted] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  // Old transcripts did not save event order. Preserve their text and merge tool pairs.
  const parts: ChatPart[] = message.parts ?? [
    ...(message.text ? [{ type: "text" as const, text: message.text, time: 0, updated: 0 }] : []),
    ...((message.tools ?? []).reduce((m, tool) => appendChatEvent(m, { ...tool, type: "tool" }), {
      id: "",
      role: "assistant",
      text: "",
    } as AgentMessage).parts ?? []),
  ]
  const last = parts.at(-1)
  const latestUpdate = parts.reduce((latest, part) => Math.max(latest, part.updated), 0) || mounted
  const pendingTool = [...parts]
    .reverse()
    .find((part) => part.type === "tool" && part.phase !== "end")
  const idle = Math.max(0, Math.floor((now - latestUpdate) / 1000))
  return (
    <div className="space-y-3" aria-label={t("chat.toolActivity")}>
      {parts.map((part, index) => {
        if (part.type === "text") return <ChatMarkdown key={index} text={part.text} />
        const tool = part.type === "tool" ? part : undefined
        const running = active && (tool ? tool.phase !== "end" : index === parts.length - 1)
        const Icon = running
          ? LoaderCircle
          : tool
            ? tool.isError
              ? CircleAlert
              : tool.phase === "end"
                ? Check
                : Terminal
            : Brain
        const preview = tool
          ? tool.input || tool.detail || ""
          : part.type === "thinking"
            ? part.text
            : ""
        const seconds = Math.max(0, Math.floor(((running ? now : part.updated) - part.time) / 1000))
        return (
          <details key={index} className="group min-w-0 text-xs text-muted-foreground">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded py-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              <Icon
                aria-hidden
                className={`h-3.5 w-3.5 shrink-0 ${running ? "animate-spin" : ""}`}
              />
              <span className="shrink-0">{tool ? tool.name : t("chat.reasoning")}</span>
              <span className="min-w-0 flex-1 truncate">{stepPreview(preview)}</span>
              {tool?.isError && <span>{t("chat.toolFailed")}</span>}
              {tool && tool.phase !== "end" && !active && <span>{t("chat.stepInterrupted")}</span>}
              {!!part.time && <span className="shrink-0 tabular-nums">{seconds}s</span>}
              <span aria-hidden className="group-open:rotate-90">
                ›
              </span>
            </summary>
            <div className="ml-1.5 mt-1 max-h-64 overflow-auto border-l border-border pl-4 leading-relaxed">
              {tool ? (
                <>
                  {tool.input && (
                    <pre className="mb-2 whitespace-pre-wrap break-words font-editor">
                      {tool.input}
                    </pre>
                  )}
                  <pre className="whitespace-pre-wrap break-words font-editor">{tool.detail}</pre>
                </>
              ) : (
                <ChatMarkdown text={preview} />
              )}
            </div>
          </details>
        )
      })}
      {active && (
        <div role="status" className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
          <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
          <span>
            {pendingTool?.type === "tool"
              ? t("chat.runningTool", { name: pendingTool.name })
              : last?.type === "thinking"
                ? t("chat.reasoning")
                : t("chat.awaitingResponse")}{" "}
            · {Math.max(0, Math.floor((now - (parts[0]?.time || mounted)) / 1000))}s
            {idle >= 15 && (
              <span className="block">{t("chat.noRecentUpdate", { seconds: idle })}</span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}

function stepPreview(text: string) {
  try {
    const args = JSON.parse(text)
    for (const key of ["description", "command", "path", "query"])
      if (typeof args?.[key] === "string") return args[key].replace(/\s+/g, " ")
  } catch {
    /* Tool output and thinking are usually plain text. */
  }
  return text.replace(/\s+/g, " ")
}
