import { z } from "zod"
import { agentChatSchema, parseAgentInput } from "./contracts.ts"
import type { AgentRequestArgs, AgentRoute, AgentResults } from "./contracts.ts"
import type { EnvoiBridge } from "./bridge"

type BridgeResult<K extends keyof EnvoiBridge> = EnvoiBridge[K] extends (
  ...args: never[]
) => Promise<infer R>
  ? R
  : never
export interface BackendArgs {
  shutdown: []
  cancel: []
  runtime: []
  gitRuntime: []
  gitInit: [root: string, extra?: Record<string, unknown>]
  gitStatus: [root: string, extra?: Record<string, unknown>]
  gitLog: [root: string, extra?: Record<string, unknown>]
  gitShow: [root: string, extra?: Record<string, unknown>]
  tools: [options?: { refresh?: boolean; root?: string }]
  configureTools: Parameters<EnvoiBridge["configureTools"]>
  compile: [input: Omit<Parameters<EnvoiBridge["compile"]>[0], "rootPath"> & { rootPath?: string }]
  lint: Parameters<EnvoiBridge["lint"]>
  agentStatus: []
  agentRequest: AgentRequestArgs
  agentChat: Parameters<EnvoiBridge["agentChat"]>
}
export interface BackendResults {
  shutdown: null
  cancel: null
  runtime: BridgeResult<"compilerRuntime">
  gitRuntime: BridgeResult<"gitRuntime">
  gitInit: unknown
  gitStatus: unknown
  gitLog: unknown
  gitShow: unknown
  tools: BridgeResult<"tools">
  configureTools: BridgeResult<"configureTools">
  compile: BridgeResult<"compile">
  lint: BridgeResult<"lint">
  agentStatus: BridgeResult<"agentStatus">
  agentRequest: { status: number; body: AgentResults[AgentRoute] & { error?: string } }
  agentChat: void
}
const text = z.string()
const gitArgs = z.tuple([text, z.record(text, z.unknown()).optional()])
const schemas = {
  shutdown: z.tuple([]),
  cancel: z.tuple([]),
  runtime: z.tuple([]),
  gitRuntime: z.tuple([]),
  gitInit: gitArgs,
  gitStatus: gitArgs,
  gitLog: gitArgs,
  gitShow: gitArgs,
  tools: z.tuple([z.object({ refresh: z.boolean().optional(), root: text.optional() }).optional()]),
  configureTools: z.tuple([z.object({ chktexPath: text.nullable() })]),
  compile: z.tuple([
    z.object({
      rootPath: text.optional(),
      main: text,
      engine: text,
      files: z.array(z.object({ path: text, base64: text })).optional(),
      drafts: z.array(z.object({ path: text, text })).optional(),
    }),
  ]),
  lint: z.tuple([
    z.object({
      rootPath: text.optional(),
      path: text,
      text,
      disabledRules: z.array(z.number()).optional(),
    }),
  ]),
  agentStatus: z.tuple([]),
  agentRequest: z.tuple([text, z.unknown()]),
  agentChat: z.tuple([agentChatSchema]),
}
export function validateBackendCall(method: string, args: unknown) {
  if (!Object.hasOwn(schemas, method)) throw Error("未知后台操作")
  schemas[method as keyof typeof schemas].parse(args)
  if (method === "agentRequest") {
    const [route, body] = schemas.agentRequest.parse(args)
    parseAgentInput(route, body)
  }
}
