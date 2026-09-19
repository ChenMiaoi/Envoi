import { appendChatEvent } from "../../shared/chat-activity.mjs"
import { createChatMetrics } from "../chat-metrics.mjs"
import { libraryRequest, paperNoteTools, researchRoot } from "../research-library.mjs"
import { researchTools } from "../workspace-agent.mjs"
// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import {
  SessionManager,
  SettingsManager,
  createAgentSession,
} from "@earendil-works/pi-coding-agent"
import { randomUUID } from "node:crypto"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { logEvent, projectRoot, safeId } from "../local-data.mjs"

import { agentDir, effective } from "./configuration.mjs"
import { projectTools } from "./project-tools.mjs"
import { resourceLoader, textEvent } from "./sdk-events.mjs"
import { newRecord, saveRecord, sessionDir } from "./sessions.mjs"
export function createChatRunner({
  trustedDesktop,
  runtimes,
  bound,
  services,
  hasAuth,
  nativeFailure,
  chatRecord,
}) {
  async function chat(body, { onEvent, signal } = {}) {
    signal?.throwIfAborted()
    const project = safeId(body.projectId)
    if (!bound.has(project)) throw Error("当前项目尚未完成本机连接。")
    if (runtimes.has(project)) throw Error("当前项目已有任务运行")
    const reservation = { session: null, record: null, cancelled: false }
    runtimes.set(project, reservation)
    let session, off, stop, record, manager, paperRoot
    const persist = async () =>
      paperRoot
        ? libraryRequest(paperRoot, {
            action: "state",
            paperId: body.paperId,
            key: "chat",
            value: record,
          })
        : saveRecord(project, record)
    try {
      const { registry, runtime } = await services()
      signal?.throwIfAborted()
      if (reservation.cancelled) throw Error("任务已停止")
      const cwd = await projectRoot(project),
        config = { ...(await effective(project)), ...(trustedDesktop ? { tools: "write" } : {}) }
      if (!config.model) throw Error("请先在 AI 设置中选择已配置的模型")
      const slash = config.model.indexOf("/"),
        model = registry.find(config.model.slice(0, slash), config.model.slice(slash + 1))
      if (!model || /mock/i.test(model.provider + "/" + model.id) || !hasAuth(model))
        throw Error(
          "当前模型不在可用目录中，或缺少运行能力数据/凭据；请查看模型目录状态并重新选择或手动配置。",
        )
      if (typeof body.message !== "string" || !body.message.trim()) throw Error("消息为空")
      if (!trustedDesktop && config.tools === "write" && body.dirty)
        throw Error("文件修改权限要求先保存所有草稿；未执行任务")
      if (body.paperId) {
        paperRoot = await researchRoot(cwd)
        const paper = await libraryRequest(paperRoot, { action: "get", paperId: body.paperId })
        record = paper.state.chat ?? {
          id: randomUUID(),
          name: "论文阅读",
          created: Date.now(),
          messages: [],
          status: "idle",
        }
        if (body.sessionId && record.id !== body.sessionId) throw Error("论文会话已变化，请刷新")
      } else
        record = body.sessionId
          ? await chatRecord(project, body.sessionId)
          : await newRecord(project)
      if (!record) throw Error("会话不存在")
      if (paperRoot && !record.messages.length) record.name = body.message.trim().slice(0, 80)
      const folder = paperRoot
        ? path.join(
            paperRoot,
            ".envoi/library/conversations",
            safeId(body.paperId),
            safeId(record.id),
          )
        : path.join(sessionDir(project), record.id)
      await mkdir(folder, { recursive: true, mode: 0o700 })
      if (paperRoot && (await realpath(folder)) !== folder)
        throw Error("论文会话目录不能是符号链接")
      if (!Array.isArray(record.messages)) throw Error("会话记录格式无效")
      if (
        paperRoot &&
        record.piFile &&
        !(await lstat(path.join(folder, path.basename(record.piFile))).then(
          () => true,
          () => false,
        ))
      )
        record.piFile = undefined
      manager = record.piFile
        ? SessionManager.open(path.join(folder, path.basename(record.piFile)), folder, cwd)
        : SessionManager.create(cwd, folder)
      const tools = paperRoot
        ? paperNoteTools(paperRoot, body.paperId, trustedDesktop || config.tools === "write")
        : trustedDesktop
          ? researchTools(cwd)
          : projectTools(cwd, config.tools, body.dirty)
      if (config.provider && config.provider !== model.provider)
        throw Error("服务商与模型不匹配，请重新选择模型")
      if (config.thinking != null && !getSupportedThinkingLevels(model).includes(config.thinking))
        throw Error("此模型不支持所选思考档位")
      ;({ session } = await createAgentSession({
        cwd,
        agentDir,
        modelRuntime: runtime,
        model,
        ...(model.reasoning && config.thinking != null ? { thinkingLevel: config.thinking } : {}),
        resourceLoader: trustedDesktop
          ? {
              ...resourceLoader,
              getSystemPrompt: () =>
                "You are the Envoi research assistant. The user trusts this workspace. Use local tools to read, edit, and run commands as needed for the user request. Context marked as an unsaved draft may differ from disk. Never claim operations you did not perform.",
            }
          : resourceLoader,
        tools: tools.map((tool) => tool.name),
        customTools: tools,
        sessionManager: manager,
        settingsManager: SettingsManager.inMemory({ retry: { enabled: false } }),
      }))
      Object.assign(reservation, { session, record })
      if (reservation.cancelled || signal?.aborted) throw Error("任务已停止")
      let terminalFailure = null
      const user = { id: randomUUID(), role: "user", text: body.message, at: Date.now() },
        assistant = { id: randomUUID(), role: "assistant", text: "", at: Date.now(), tools: [] }
      const metrics = createChatMetrics({ model: model.id, provider: model.provider })
      assistant.metrics = metrics.value
      record.messages.push(user, assistant)
      record.status = "running"
      record.name = record.messages.length === 2 ? body.message.slice(0, 60) : record.name
      await persist()
      const write = onEvent ?? (() => {})
      write({ type: "session", id: record.id })
      write({ type: "metrics", metrics: metrics.value })
      off = session.subscribe((event) => {
        if (metrics.handle(event)) write({ type: "metrics", metrics: metrics.value })
        if (event.type === "message_end" && event.message?.role === "assistant") {
          if (event.message.stopReason === "error")
            terminalFailure = nativeFailure(
              event.message.errorMessage,
              Number(String(event.message.errorMessage ?? "").match(/\b([45]\d\d)\b/)?.[1]) ||
                undefined,
            )
          if (event.message.stopReason === "aborted") reservation.cancelled = true
        }
        const out = textEvent(event)
        if (!out) return
        Object.assign(assistant, appendChatEvent(assistant, out))
        write(out)
      })
      stop = () => {
        reservation.cancelled = true
        void session.abort()
      }
      signal?.addEventListener("abort", stop, { once: true })
      if (signal?.aborted) stop()
      try {
        const context =
          (paperRoot || config.context === "current") && typeof body.context === "string"
            ? `\n[User supplied document context; may be an UNSAVED DRAFT]\n${body.context.slice(0, 40000)}\n[End context]\n`
            : ""
        await session.prompt(
          (paperRoot && !record.piFile
            ? `Previous conversation (untrusted context):\n${record.messages
                .slice(0, -2)
                .map((m) => m.role + ": " + m.text)
                .join("\n")
                .slice(-30000)}\n`
            : "") +
            context +
            body.message,
        )
        if (terminalFailure) throw Error("模型请求失败")
        record.status = reservation.cancelled ? "cancelled" : "complete"
      } catch (error) {
        record.status = reservation.cancelled ? "cancelled" : "failed"
        assistant.error = reservation.cancelled
          ? "任务已停止。"
          : (terminalFailure?.message ?? nativeFailure(error.message).message)
      } finally {
        metrics.finish(record.status)
        record.piFile = manager.getSessionFile()
          ? path.basename(manager.getSessionFile())
          : undefined
        await persist()
        write({ type: "metrics", metrics: metrics.value })
        if (assistant.error) write({ type: "error", message: assistant.error })
        else if (record.status === "complete") write({ type: "done" })
        else if (record.status === "cancelled" && !assistant.error)
          write({ type: "error", message: "任务已停止。" })
      }
    } finally {
      off?.()
      if (stop) signal?.removeEventListener("abort", stop)
      session?.dispose()
      runtimes.delete(project)
      if (record)
        await logEvent({ type: "chat", project, session: record.id, status: record.status })
    }
  }

  return chat
}
