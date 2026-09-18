import { memo } from "react"
import { useEffect, useState } from "react"
import { Brain, Terminal, LoaderCircle, Check, CircleAlert } from "lucide-react"
import type { AgentMessage, ChatPart } from "@/lib/agentClient"
import { appendChatEvent } from "@/lib/chatActivity.mjs"
import { useT } from "@/i18n/useT"
import { ChatMarkdown } from "./ChatMarkdown"

export const ChatActivity = memo(function ChatActivity({
  message,
  active,
}: {
  message: AgentMessage
  active: boolean
}) {
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
  const renderPart = (part: ChatPart, index: number) => {
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
          <Icon aria-hidden className={`h-3.5 w-3.5 shrink-0 ${running ? "animate-spin" : ""}`} />
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
                <pre className="mb-2 whitespace-pre-wrap break-words font-editor">{tool.input}</pre>
              )}
              <pre className="whitespace-pre-wrap break-words font-editor">{tool.detail}</pre>
            </>
          ) : (
            <ChatMarkdown text={preview} />
          )}
        </div>
      </details>
    )
  }
  return (
    <div className="space-y-3" aria-label={t("chat.toolActivity")}>
      {activityBlocks(parts).map((block) => {
        if (block.parts[0].type === "text") return renderPart(block.parts[0], block.index)
        const latest = block.parts.at(-1)!
        const live = active && block.index + block.parts.length === parts.length
        const failures = block.parts.filter((p) => p.type === "tool" && p.isError).length
        return (
          <details
            key={block.index}
            className="group/activity min-w-0 text-xs text-muted-foreground"
            data-activity-group
          >
            <summary className="flex cursor-pointer list-none items-center gap-2 py-1 hover:text-foreground">
              {live ? (
                <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin" />
              ) : (
                <Brain className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="shrink-0">
                {live
                  ? latest.type === "tool"
                    ? latest.name
                    : t("chat.reasoning")
                  : t("chat.activitySummary")}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {stepPreview(
                  latest.type === "tool" ? latest.input || latest.detail || "" : latest.text,
                )}
              </span>
              <span className="shrink-0">{t("chat.stepCount", { n: block.parts.length })}</span>
              {failures > 0 && (
                <span className="shrink-0">{t("chat.failedSteps", { n: failures })}</span>
              )}
              <span className="group-open/activity:rotate-90" aria-hidden>
                ›
              </span>
            </summary>
            <div className="ml-1.5 space-y-2 border-l border-border pl-3">
              {thinkingRounds(block.parts).map((round) => {
                const first = round.parts[0]
                return first.type === "thinking" ? (
                  <details key={round.index} data-thinking-round>
                    <summary className="cursor-pointer truncate py-1">
                      {t("chat.reasoning")} · {stepPreview(first.text)} ·{" "}
                      {t("chat.stepCount", { n: round.parts.length })}
                    </summary>
                    <div className="max-h-64 overflow-auto py-2">
                      <ChatMarkdown text={first.text} />
                    </div>
                    {round.parts
                      .slice(1)
                      .map((part, index) =>
                        renderPart(part, block.index + round.index + index + 1),
                      )}
                  </details>
                ) : (
                  <div key={round.index}>
                    {round.parts.map((part, index) =>
                      renderPart(part, block.index + round.index + index),
                    )}
                  </div>
                )
              })}
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
})

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

function activityBlocks(parts: ChatPart[]) {
  const blocks: { index: number; parts: ChatPart[] }[] = []
  parts.forEach((part, index) => {
    const last = blocks.at(-1)
    if (part.type !== "text" && last && last.parts[0].type !== "text") last.parts.push(part)
    else blocks.push({ index, parts: [part] })
  })
  return blocks
}
function thinkingRounds(parts: ChatPart[]) {
  const rounds: { index: number; parts: ChatPart[] }[] = []
  parts.forEach((part, index) => {
    if (!rounds.length || part.type === "thinking") rounds.push({ index, parts: [part] })
    else rounds.at(-1)!.parts.push(part)
  })
  return rounds
}
