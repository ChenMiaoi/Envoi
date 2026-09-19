// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { rm } from "node:fs/promises"
import path from "node:path"
import { createAuthRequests } from "./agent/auth.mjs"
import { createChatRunner } from "./agent/chat.mjs"
import { effective, normalizeAi, settingsFile } from "./agent/configuration.mjs"
import { createModelServices } from "./agent/models.mjs"
import { createSessionRepository, newRecord, sessionDir } from "./agent/sessions.mjs"
import {
  atomicJson,
  jsonFile,
  registerProject,
  safeId,
  trustedRoot,
  verifyDirectory,
} from "./local-data.mjs"
export { normalizeAi } from "./agent/configuration.mjs"
export { projectTools, safeToolPath } from "./agent/project-tools.mjs"
export function createAgentCore({ trustedDesktop = false } = {}) {
  const runtimes = new Map(),
    bound = new Set()
  const { services, status, hasAuth, nativeFailure, customProviders, catalogStates } =
    createModelServices()
  const { chatRecord, listRecords } = createSessionRepository({ runtimes, nativeFailure })
  const authentication = createAuthRequests({ runtimes, services, status, customProviders })
  const chat = createChatRunner({
    trustedDesktop,
    runtimes,
    bound,
    services,
    hasAuth,
    nativeFailure,
    chatRecord,
  })
  async function request(route, body, opts = {}) {
    if (route === "abort") {
      const project = safeId(body.projectId)
      if (!bound.has(project)) throw Error("请先打开项目")
      const active = runtimes.get(project)
      if (active && (!active.record || active.record.id === body.sessionId)) {
        active.cancelled = true
        await active.session?.abort()
      }
      return { status: 200, body: { ok: true, active: !!active } }
    }
    const { registry } = await services()
    if (route === "models/refresh") {
      if (typeof body.provider !== "string") throw Error("请选择服务商")
      const fresh = await services({ refreshProvider: body.provider })
      const state = catalogStates.get(fresh.registry).get(body.provider)
      return { status: 200, body: { ok: !state?.error, error: state?.error, catalog: state } }
    }
    if (route === "bind") {
      const root = opts.trusted ? await trustedRoot(body.directory) : await verifyDirectory(body),
        project = await registerProject(root, { copy: body.copy === true })
      bound.add(project.id)
      return { status: 200, body: { ok: true, project } }
    }
    if (route === "settings") {
      const settings = normalizeAi(body.settings)
      if (settings.model) {
        const slash = settings.model.indexOf("/")
        if (!registry.find(settings.model.slice(0, slash), settings.model.slice(slash + 1)))
          throw Error("未知模型")
      }
      await atomicJson(settingsFile, settings)
      return { status: 200, body: { ok: true, settings } }
    }
    if (["credential", "custom-provider"].includes(route) || route.startsWith("oauth/"))
      return authentication.request(route, body)
    const project = safeId(body.projectId)
    if (!bound.has(project)) throw Error("当前项目尚未完成本机连接。")
    if (route === "sessions") {
      return {
        status: 200,
        body: {
          sessions: await listRecords(
            project,
            typeof body.query === "string" ? body.query.slice(0, 500) : "",
          ),
          settings: {
            ...(await effective(project)),
            ...(trustedDesktop ? { tools: "write" } : {}),
          },
          activeId: (await jsonFile(path.join(sessionDir(project), "active.json"), {})).id,
        },
      }
    }
    if (route === "new") {
      if (runtimes.has(project)) throw Error("请先停止当前任务")
      return { status: 200, body: await newRecord(project) }
    }
    if (route === "history/delete") {
      if (body.confirm !== true || runtimes.has(project))
        throw Error("需明确确认且停止任务后才能清理历史")
      const id = safeId(body.sessionId),
        index = await jsonFile(path.join(sessionDir(project), "index.json"), [])
      if (!index.includes(id)) throw Error("会话不存在")
      await rm(path.join(sessionDir(project), id + ".json"), { force: true })
      await rm(path.join(sessionDir(project), id), { recursive: true, force: true })
      const remaining = index.filter((value) => value !== id)
      await atomicJson(path.join(sessionDir(project), "index.json"), remaining)
      if ((await jsonFile(path.join(sessionDir(project), "active.json"), {})).id === id)
        await atomicJson(path.join(sessionDir(project), "active.json"), { id: remaining[0] })
      return { status: 200, body: { ok: true } }
    }
    if (route === "session") {
      if (runtimes.has(project) && runtimes.get(project)?.record?.id !== body.sessionId)
        throw Error("请先停止当前任务")
      const record = await chatRecord(project, body.sessionId)
      if (!record) throw Error("会话不存在")
      await atomicJson(path.join(sessionDir(project), "active.json"), { id: record.id })
      return { status: 200, body: record }
    }

    throw Error("未知 AI 操作")
  }
  function dispose() {
    for (const running of runtimes.values())
      void running.session?.abort().finally(() => running.session.dispose())
    authentication.dispose()
  }
  return {
    status,
    request,
    chat,
    dispose,
    bind(id) {
      bound.add(safeId(id))
    },
  }
}
