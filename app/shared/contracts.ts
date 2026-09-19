import { z } from "zod"
import type { AgentRecord, AiConfig } from "./agent-model"
import type { LibraryIndex, PaperDetail } from "./library-model"
import type { SourcePaper } from "./paper-search.mjs"
import type { Overview, Result } from "./workspace-model"

type Fields<S extends z.ZodType> = {
  [K in keyof z.infer<S> as string extends K ? never : K]: z.infer<S>[K]
}
const text = z.string()
const paper = { paperId: text }
const optionalText = text.optional()
const note = { text: text, expectedRevision: z.number().int().nonnegative() }
const libraryShapes = {
  list: z.object({}),
  get: z.object(paper),
  select: z.object({ ...paper, selectedAt: z.number().optional() }),
  import: z.object({
    papers: z.unknown().refine((value) => Boolean(Array.isArray(value)), "Expected papers array"),
    restore: z.boolean().optional(),
  }),
  attach: z.object({ ...paper, base64: text, name: optionalText }),
  remove: z.object(paper),
  pdf: z.object(paper),
  note: z.object({ ...paper, ...note, actor: z.enum(["ai", "user"]).optional() }),
  "dismiss-draft": z.object({ ...paper, draftId: text }),
  history: z.object(paper),
  "chat-list": z.object({ ...paper, query: optionalText }),
  "chat-new": z.object(paper),
  "chat-select": z.object({ ...paper, sessionId: text }),
  state: z.object({ ...paper, key: z.enum(["reading", "chat"]), value: z.unknown() }),
  metadata: z.object({
    ...paper,
    patch: z.object({
      collection: optionalText,
      status: optionalText,
      title: optionalText,
      author: optionalText,
      year: optionalText,
      venue: optionalText,
      tags: z.array(text).optional(),
    }),
  }),
  export: z.object({}),
  "export-file": z.object({}),
  "download-pdf": z.object({ url: text }),
  "paper-search": z.object({
    query: text,
    source: optionalText,
    limit: z.number().optional(),
    yearFrom: z.number().optional(),
    yearTo: z.number().optional(),
    openAccessOnly: z.boolean().optional(),
  }),
}
export type LibraryAction = keyof typeof libraryShapes
export type LibraryInput<A extends LibraryAction = LibraryAction> = {
  [K in A]: { action: K } & Fields<(typeof libraryShapes)[K]>
}[A]
type Ok = { ok: boolean }
export interface LibraryResults {
  list: LibraryIndex
  get: PaperDetail
  select: Ok
  import: { added: number }
  attach: { attachmentHash: string }
  remove: Ok
  pdf: { base64: string }
  note: { text: string; revision: number; conflict?: boolean }
  "dismiss-draft": Ok
  history: { revision: number; text: string; actor: string; created: number }[]
  "chat-list": AgentRecord[]
  "chat-new": AgentRecord
  "chat-select": AgentRecord
  state: Ok
  metadata: Ok
  export: { version: number; researchId: string; papers: unknown[] }
  "export-file": { saved: boolean; path?: string }
  "download-pdf": { name: string; base64: string }
  "paper-search": { results: SourcePaper[] }
}
const workspaceShapes = {
  list: z.object({}),
  results: z.object({}),
  create: z.object({ name: text, purpose: optionalText }),
  commit: z.object({ message: text }),
  rename: z.object({ target: text, name: text }),
  target: z.object({ target: text }),
  save: z.object({
    source: text,
    title: text,
    summary: optionalText,
    command: optionalText,
    files: z.array(text),
  }),
}
export type WorkspaceAction = keyof typeof workspaceShapes
export type WorkspaceInput<A extends WorkspaceAction = WorkspaceAction> = {
  [K in A]: { action: K } & Fields<(typeof workspaceShapes)[K]>
}[A]
export interface WorkspaceResults {
  list: Overview
  results: Result[]
  create: { path: string; branch: string }
  commit: { commit: string }
  rename: { name: string }
  target: string
  save: Result
}
const project = { projectId: text }
const agentShapes = {
  abort: z.object({ ...project, sessionId: optionalText }),
  "models/refresh": z.object({ provider: text }),
  settings: z.object({
    settings: z.object({
      provider: text.nullable().optional(),
      thinking: text.nullable().optional(),
      model: text.nullable().optional(),
      context: z.enum(["none", "current"]).optional(),
      tools: z.enum(["none", "read", "write"]).optional(),
    }),
  }),
  credential: z.object({ provider: text, key: optionalText, remove: z.boolean().optional() }),
  "custom-provider": z.object({
    provider: text,
    baseUrl: text,
    api: text,
    model: text,
    name: optionalText,
    contextWindow: z.union([text, z.number()]).optional(),
    maxTokens: z.union([text, z.number()]).optional(),
  }),
  "oauth/start": z.object({ provider: text }),
  "oauth/status": z.object({ id: text }),
  "oauth/answer": z.object({ id: text, answer: text }),
  "oauth/cancel": z.object({ id: text }),
  sessions: z.object({ ...project, query: optionalText }),
  new: z.object(project),
  "history/delete": z.object({ ...project, sessionId: text, confirm: z.boolean() }),
  session: z.object({ ...project, sessionId: text }),
}
export interface OAuthJob {
  id: string
  state: string
  url?: string
  userCode?: string
  instructions?: string
  error?: string
  prompt?: { message: string; placeholder?: string; options?: { id: string; label: string }[] }
}
export type AgentRoute = keyof typeof agentShapes
export type AgentInput<R extends AgentRoute> = z.infer<(typeof agentShapes)[R]>
export interface AgentResults {
  abort: Ok & { active: boolean }
  "models/refresh": Ok & { error?: string; catalog?: unknown }
  settings: Ok & { settings: AiConfig }
  credential: Ok & { validation?: { message: string }; error?: string }
  "custom-provider": Ok
  "oauth/start": { id: string }
  "oauth/status": OAuthJob
  "oauth/answer": OAuthJob
  "oauth/cancel": OAuthJob
  sessions: { sessions: AgentRecord[]; settings: AiConfig; activeId?: string }
  new: AgentRecord
  "history/delete": Ok
  session: AgentRecord
}
export const agentChatSchema = z.object({
  ...project,
  sessionId: optionalText,
  paperId: optionalText,
  context: optionalText,
  dirty: z.boolean(),
  message: text,
})
export type AgentChatInput = z.infer<typeof agentChatSchema>

function parseAction(shapes: Record<string, z.ZodType>, value: unknown) {
  const input = z.object({ action: text }).passthrough().parse(value)
  if (!Object.hasOwn(shapes, input.action)) throw Error("Unknown operation")
  return { ...(shapes[input.action].parse(input) as object), action: input.action }
}
export const parseLibraryInput = (value: unknown): LibraryInput =>
  parseAction(libraryShapes, value) as LibraryInput
export const parseWorkspaceInput = (value: unknown): WorkspaceInput =>
  parseAction(workspaceShapes, value) as WorkspaceInput
export function parseAgentInput(route: string, value: unknown) {
  if (!Object.hasOwn(agentShapes, route)) throw Error("Unknown AI operation")
  return agentShapes[route as AgentRoute].parse(value)
}

export type AgentRequestArgs = { [R in AgentRoute]: [route: R, body: AgentInput<R>] }[AgentRoute]
export function parseAgentRequest(route: string, body: unknown): AgentRequestArgs {
  return [route, parseAgentInput(route, body)] as AgentRequestArgs
}
