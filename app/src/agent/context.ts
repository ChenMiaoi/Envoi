import { useStoreSelection, type SelectorStore } from "@/lib/selectorStore"
import { createContext, useContext } from "react"
import type { AgentStatus, AgentRecord, AiConfig } from "@/lib/agentClient"
export interface AgentState {
  status: AgentStatus | null
  scope: string
  record: AgentRecord | null
  sessions: AgentRecord[]
  busy: boolean
  navigating: boolean
  error: string
  ready: boolean
  config: AiConfig | null
  refresh: () => Promise<void>
  select: (id: string) => Promise<void>
  newSession: () => Promise<void>
  send: (message: string, context?: string) => Promise<void>
  stop: () => void
  remove: (id: string) => Promise<void>
}
export const AgentContext = createContext<SelectorStore<AgentState> | null>(null)
const identity = (state: AgentState) => state
export function useAgent<S = AgentState>(
  select: (state: AgentState) => S = identity as (state: AgentState) => S,
) {
  const store = useContext(AgentContext)
  if (!store) throw Error("Agent provider missing")
  return useStoreSelection(store, select)
}
