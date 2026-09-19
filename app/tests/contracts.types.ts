import { appendChatEvent } from "../shared/chat-activity.mjs"
import type { EnvoiBridge } from "../shared/bridge"
import type { BackendArgs, BackendResults } from "../shared/backend-contract"
import type { PaperDetail } from "../shared/library-model"

// Compiled by check-architecture; never executed against a user's project.
export function checkContracts(bridge: EnvoiBridge) {
  const paper: Promise<PaperDetail> = bridge.library("root", { action: "get", paperId: "paper" })
  // @ts-expect-error A note write requires its expected revision.
  bridge.library("root", { action: "note", paperId: "paper", text: "draft" })
  // @ts-expect-error A caller cannot choose an arbitrary result type.
  bridge.library<string>("root", { action: "list" })
  // @ts-expect-error Unknown workspace operations are rejected.
  bridge.workspaces("root", { action: "delete-all" })
  // @ts-expect-error Session selection requires an ID.
  bridge.agentRequest("session", { projectId: "project" })
  // @ts-expect-error A compiler request cannot use a lint payload.
  const badCompile: BackendArgs["compile"] = [{ path: "a.tex", text: "draft" }]
  // @ts-expect-error Worker route and body must remain correlated.
  const badAgent: BackendArgs["agentRequest"] = ["session", { provider: "provider" }]
  // @ts-expect-error Shared declarations must retain event payload checking.
  appendChatEvent({ id: "a", role: "assistant", text: "" }, { type: "delta", text: 123 })
  const compileResult: BackendResults["compile"] = { ok: false, log: "cancelled" }
  return { paper, badCompile, badAgent, compileResult }
}
