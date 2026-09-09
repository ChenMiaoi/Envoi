import { useProject } from "@/project/context"
import { TrustRequired } from "@/project/ProjectTrust"
import { useProjectTrust } from "@/project/useProjectTrust"
import { ChatActivity } from "./ChatActivity"
import { useEffect, useRef, useState } from "react"
import { ArrowUp, Mic, Plus, Square, ChevronUp, ChevronDown } from "lucide-react"
import type { AgentState } from "@/agent/context"
import { useAgent } from "@/agent/context"
import { ChatHistory, type ChatHistorySource } from "./ChatHistory"
import { PiModelMenu } from "./PiModelMenu"
import { cn } from "@/lib/utils"
import { useT } from "@/i18n/useT"

export interface ChatContext {
  label: string
  text: string
}

export function ChatPanel({
  compact = false,
  inputOnly = false,
  context,
  conversation,
  historySource,
  placeholder = "Ask anything",
}: {
  historySource?: ChatHistorySource
  placeholder?: string
  conversation?: Pick<AgentState, "record" | "busy" | "error" | "send" | "stop">
  compact?: boolean
  inputOnly?: boolean
  context?: ChatContext
}) {
  const { project } = useProject()
  const trusted = useProjectTrust(project.rootPath)?.trusted
  const projectAgent = useAgent()
  const agent = { ...projectAgent, ...conversation }
  const { t } = useT()
  const [input, setInput] = useState("")
  const [attempted, setAttempted] = useState(false),
    [collapsed, setCollapsed] = useState(false),
    [ratio, setRatio] = useState(0.35),
    [paneHeight, setPaneHeight] = useState(500)
  const root = useRef<HTMLDivElement>(null),
    drag = useRef<{ y: number; height: number } | null>(null)
  const maxHeight = Math.max(48, Math.min(paneHeight * 0.65, paneHeight - 180)),
    minHeight = Math.min(80, maxHeight)
  const transcriptHeight = Math.max(minHeight, Math.min(maxHeight, paneHeight * ratio))
  useEffect(() => {
    if (!inputOnly) return
    const pane = root.current?.parentElement?.parentElement
    if (!pane) return
    const measure = () => setPaneHeight(pane.clientHeight)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(pane)
    return () => observer.disconnect()
  }, [inputOnly])
  const scrollRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const available =
    !agent.navigating &&
    (!conversation || !projectAgent.busy) &&
    agent.ready &&
    !!agent.config?.model &&
    !!agent.status?.models.some(
      (model) => model.available && `${model.provider}/${model.id}` === agent.config?.model,
    )
  useEffect(() => {
    if (follow.current) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [agent.record])

  useEffect(() => {
    follow.current = true
  }, [agent.record?.id])

  function send() {
    const text = input.trim()
    if (!text || agent.busy || !available) return
    follow.current = true
    setAttempted(true)
    setInput("")
    void agent.send(
      text,
      context ? t("chat.fileContext", { label: context.label, text: context.text }) : undefined,
    )
  }

  if (project.rootPath && !trusted) return <TrustRequired />
  return (
    <div
      ref={root}
      className={cn(
        "relative flex min-h-0 flex-col",
        inputOnly ? "bg-transparent" : "h-full bg-card",
      )}
    >
      {(!inputOnly || !!agent.record?.messages.length) && (
        <div
          className={cn(
            "relative min-h-0 rounded-xl border border-border/60 bg-muted/30",
            inputOnly ? "mx-3 shrink-0" : "flex-1",
          )}
          style={inputOnly ? { height: collapsed ? 12 : transcriptHeight } : undefined}
        >
          {inputOnly && (
            <>
              <div
                role="separator"
                aria-label={t("chat.adjustHeight")}
                aria-orientation="horizontal"
                aria-valuenow={Math.round(transcriptHeight)}
                tabIndex={collapsed ? -1 : 0}
                className="absolute left-3 right-10 top-0 z-10 h-3 cursor-row-resize touch-none"
                onPointerDown={(event) => {
                  if (collapsed) return
                  drag.current = { y: event.clientY, height: transcriptHeight }
                  event.currentTarget.setPointerCapture(event.pointerId)
                }}
                onPointerMove={(event) => {
                  if (drag.current)
                    setRatio(
                      Math.max(
                        minHeight,
                        Math.min(maxHeight, drag.current.height + drag.current.y - event.clientY),
                      ) / paneHeight,
                    )
                }}
                onPointerUp={() => {
                  drag.current = null
                }}
                onPointerCancel={() => {
                  drag.current = null
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault()
                    setRatio(
                      Math.max(
                        minHeight,
                        Math.min(
                          maxHeight,
                          transcriptHeight + (event.key === "ArrowUp" ? 20 : -20),
                        ),
                      ) / paneHeight,
                    )
                  }
                }}
              >
                <span className="mx-auto mt-1 block h-0.5 w-8 rounded bg-border" />
              </div>
              <button
                aria-label={collapsed ? t("chat.expandHistory") : t("chat.collapseHistory")}
                onClick={() => setCollapsed((value) => !value)}
                className="absolute right-3 top-0 z-20 rounded bg-editor px-1 text-muted-foreground hover:text-foreground"
              >
                {collapsed ? (
                  <ChevronUp className="h-3 w-3" />
                ) : (
                  <ChevronDown className="h-3 w-3" />
                )}
              </button>
            </>
          )}
          <div
            ref={scrollRef}
            onScroll={(event) => {
              const el = event.currentTarget
              follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
            }}
            className={cn(
              "flex h-full min-h-0 flex-col gap-3 overflow-y-auto px-3 py-3",
              "pt-5",
              inputOnly && collapsed && "hidden",
            )}
          >
            {agent.record?.messages
              .filter(
                (message) =>
                  message.text ||
                  message.error ||
                  message.tools?.length ||
                  message.parts?.length ||
                  (agent.busy && message.role === "assistant"),
              )
              .map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex min-w-0 shrink-0 flex-col gap-1",
                    message.role === "user" ? "items-end" : "items-start",
                  )}
                >
                  <div
                    className={cn(
                      "min-w-0 max-w-[92%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed",
                      message.role === "user"
                        ? "border border-border/50 bg-muted/80 text-foreground"
                        : "text-foreground",
                    )}
                  >
                    {message.role === "assistant" ? (
                      <ChatActivity
                        message={message}
                        active={agent.busy && message.id === agent.record?.messages.at(-1)?.id}
                      />
                    ) : (
                      message.text
                    )}
                    {message.error ? (
                      message.error.length > 240 ? (
                        <details className="break-words text-xs text-muted-foreground">
                          <summary className="cursor-pointer">
                            {message.error.slice(0, 160)}…
                          </summary>
                          <pre className="mt-2 whitespace-pre-wrap font-sans">{message.error}</pre>
                        </details>
                      ) : (
                        <span className="break-words text-xs text-muted-foreground">
                          {message.error}
                        </span>
                      )
                    ) : null}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}
      {agent.error &&
        (attempted || !!agent.record?.messages.length) &&
        !agent.record?.messages.at(-1)?.error && (
          <p role="alert" className="px-4 pt-1 text-xs text-muted-foreground">
            {agent.error}
          </p>
        )}
      <div className="px-3 py-3">
        <div className="rounded-[26px] border border-border bg-background px-3.5 pb-2.5 pt-3.5 transition-colors focus-within:border-foreground/20">
          <div className="flex items-end gap-2">
            <textarea
              disabled={!available || agent.busy}
              aria-label={t("chat.askAria")}
              rows={compact || inputOnly ? 2 : 3}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  send()
                }
              }}
              placeholder={placeholder}
              className="max-h-40 min-w-0 w-full resize-none overflow-y-auto bg-transparent px-0.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40"
            />
            <div className="shrink-0 pb-0.5 text-muted-foreground">
              {agent.busy ? (
                <button
                  type="button"
                  onClick={agent.stop}
                  aria-label={t("chat.stop")}
                  className="rounded-full bg-foreground p-2 text-primary-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <Square className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={send}
                  disabled={!available || !input.trim()}
                  aria-label={t("chat.send")}
                  className="rounded-full bg-foreground p-2 text-primary-foreground transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
          <div className="mt-2.5 flex min-w-0 items-center gap-1 text-muted-foreground">
            <button
              type="button"
              disabled
              aria-label={t("chat.addAttachment")}
              className="shrink-0 rounded-full p-1.5 disabled:pointer-events-none disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-0.5 [&_button]:h-7 [&_button]:focus-visible:outline-none [&_button]:focus-visible:ring-1 [&_button]:focus-visible:ring-ring">
              <PiModelMenu />
            </div>
            {(!conversation || historySource) && (
              <ChatHistory key={historySource?.scope ?? agent.scope} source={historySource} />
            )}
            <button
              type="button"
              disabled
              aria-label={t("chat.voiceInput")}
              className="shrink-0 rounded-full p-1.5 disabled:pointer-events-none disabled:opacity-40"
            >
              <Mic className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
