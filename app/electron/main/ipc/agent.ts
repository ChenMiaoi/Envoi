import { parseAgentRequest, agentChatSchema } from "../../../shared/contracts"
import type { MainServices } from "../runtime"
export function registerAgentIpc(
  services: Pick<MainServices, "agentBackend" | "requireToolContext" | "agentRoot" | "handle">,
) {
  const { agentBackend, requireToolContext, agentRoot, handle } = services
  handle("envoi:agent-status", () => agentBackend.call("agentStatus"))
  handle("envoi:agent-request", async (event, route: string, body: unknown) => {
    if (["sessions", "session", "new", "history/delete"].includes(route))
      await requireToolContext(event)
    const args = parseAgentRequest(route, body)
    const result = await agentBackend.call("agentRequest", args, {
      root: await agentRoot(body),
    })
    if (result.status >= 400) throw new Error(result.body?.error ?? "AI 操作失败")
    return result.body
  })
  handle(
    "envoi:agent-chat",
    async (
      event,
      params: {
        projectId: string
        sessionId?: string
        context?: string
        dirty: boolean
        message: string
      },
    ) => {
      params = agentChatSchema.parse(params)
      const sender = event.sender
      const root = await agentRoot(params)
      if (!root) throw Error("请先打开并信任项目。")
      void agentBackend
        .call("agentChat", [params], {
          owner: sender.id,
          root,
          onEvent: (chatEvent: Record<string, unknown>) => {
            if (!sender.isDestroyed())
              sender.send("envoi:agent-event", { projectId: params.projectId, ...chatEvent })
          },
        })
        .catch((error: Error) => {
          if (!sender.isDestroyed())
            sender.send("envoi:agent-event", {
              projectId: params.projectId,
              type: "error",
              message: error.message,
            })
        })
      return { ok: true }
    },
  )
}
