import type { Plugin } from "vite"
export function agentPlugin(): Plugin
export interface ChatEvent {
  type: "delta" | "thinking" | "session" | "tool" | "done" | "error"
  [key: string]: unknown
}
export interface AgentCore {
  bind(id: string): void
  status(): Promise<Record<string, unknown>>
  request(
    route: string,
    body: any,
    opts?: { trusted?: boolean },
  ): Promise<{ status: number; body: unknown }>
  chat(
    params: {
      projectId: string
      sessionId?: string
      context?: string
      dirty: boolean
      message: string
    },
    handlers: { onEvent(event: ChatEvent): void; signal?: AbortSignal },
  ): Promise<void>
  dispose(): void
}
export function createAgentCore(options?: { trustedDesktop?: boolean }): AgentCore
