export interface AiConfig {
  provider?: string | null
  thinking?: string | null
  model: string | null
  context: "none" | "current"
  tools: "none" | "read" | "write"
}
export interface ModelCatalog {
  state: string
  source: string
  visibility?: string
  checkedAt?: number
  error?: string
  message?: string
  unresolved?: number
}
export interface AgentStatus {
  available: boolean
  runtime: boolean
  error?: string
  providers: {
    id: string
    name: string
    oauth: boolean
    apiKey?: boolean
    catalog?: ModelCatalog
    auth: { configured: boolean; source?: string }
  }[]
  models: {
    id: string
    provider: string
    name: string
    thinkingLevels: string[]
    available: boolean
    unavailableReason?: string
  }[]
  settings: AiConfig
  storage: { dataDir: string; credentials: string; kind: string }
}
export interface AgentToolEvent {
  name: string
  phase: string
  id?: string
  time?: number
  detail?: string
  isError?: boolean
}
export type ChatPart =
  | { type: "text" | "thinking"; text: string; time: number; updated: number }
  | (AgentToolEvent & { type: "tool"; time: number; updated: number; input?: string })
export interface ChatMetrics {
  version: 1
  updatedAt?: number
  model: string
  provider: string
  startedAt: number
  endedAt?: number
  status: string
  calls: {
    startedAt: number
    endedAt?: number
    firstTokenAt?: number
    status: string
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number } | null
  }[]
  tools: { id: string; name: string; startedAt: number; endedAt?: number; status: string }[]
}
export interface AgentMessage {
  metrics?: ChatMetrics
  parts?: ChatPart[]
  id: string
  role: "user" | "assistant"
  text: string
  tools?: AgentToolEvent[]
  error?: string
}
export interface AgentRecord {
  created?: number
  id: string
  name: string
  messages: AgentMessage[]
  status: string
  running?: boolean
  count?: number
}
export type ChatEvent =
  | { type: "metrics"; metrics: ChatMetrics }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "session"; id: string }
  | ({ type: "tool" } & AgentToolEvent)
  | { type: "done" }
  | { type: "error"; message: string }
