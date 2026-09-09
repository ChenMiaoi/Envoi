import { createChatMetrics } from "./chat-metrics.mjs"
import { appendChatEvent } from "../src/lib/chatActivity.mjs"
import { workspaceAiDefaults } from "./workspaces.mjs"
import { libraryRequest, researchRoot, paperNoteTools } from "./research-library.mjs"
import { researchTools } from "./workspace-agent.mjs"
import {
  createModelDiscovery,
  discoveryAdapters,
  registerDiscoveredModels,
} from "./model-discovery.mjs"
import { providerFailure, validateProviderCredential } from "./provider-validation.mjs"
// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import {
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  createAgentSession,
  createExtensionRuntime,
  createReadTool,
  createEditTool,
  createWriteTool,
} from "@earendil-works/pi-coding-agent"
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { randomBytes, randomUUID } from "node:crypto"
import { mkdir, realpath, chmod, rm, readdir, lstat, readFile, stat } from "node:fs/promises"
import path from "node:path"
import {
  dataDir,
  atomicJson,
  jsonFile,
  safeId,
  verifyDirectory,
  trustedRoot,
  registerProject,
  projectRoot,
  readProjectConfig,
  withDataLock,
  logEvent,
} from "./local-data.mjs"
const agentDir = path.join(dataDir, "pi"),
  settingsFile = path.join(dataDir, "ai/settings.json")
const defaults = { model: null, context: "current", tools: "read" }
export function normalizeAi(value, partial = false) {
  const result = partial ? {} : { ...defaults }
  if (value?.provider === null || typeof value?.provider === "string")
    result.provider = value.provider
  if (
    value?.thinking === null ||
    ["off", "minimal", "low", "medium", "high", "xhigh"].includes(value?.thinking)
  )
    result.thinking = value.thinking
  if (value?.model === null || (typeof value?.model === "string" && value.model.includes("/")))
    result.model = value.model
  if (["none", "current"].includes(value?.context)) result.context = value.context
  if (["none", "read", "write"].includes(value?.tools)) result.tools = value.tools
  return result
}
async function effective(projectId) {
  const global = normalizeAi(await jsonFile(settingsFile, {}))
  if (projectId === "global") return global
  const root = await projectRoot(projectId),
    { config: project } = await readProjectConfig(root)
  return {
    ...global,
    ...normalizeAi(await workspaceAiDefaults(root), true),
    ...normalizeAi(project?.ai, true),
  }
}
function sessionDir(project) {
  return path.join(dataDir, project === "global" ? "global" : `projects/${safeId(project)}`, "chat")
}
async function saveRecord(project, record) {
  return atomicJson(path.join(sessionDir(project), safeId(record.id) + ".json"), record)
}
function newRecord(project) {
  return withDataLock("chat-index:" + project, () => newRecordLocked(project))
}
async function newRecordLocked(project) {
  const record = {
    id: randomUUID(),
    name: "新会话",
    created: Date.now(),
    messages: [],
    status: "idle",
  }
  const index = await jsonFile(path.join(sessionDir(project), "index.json"), [])
  await saveRecord(project, record)
  await atomicJson(path.join(sessionDir(project), "index.json"), [record.id, ...index])
  await atomicJson(path.join(sessionDir(project), "active.json"), { id: record.id })
  return record
}
export async function safeToolPath(cwd, value) {
  if (typeof value !== "string") throw Error("需要项目相对文件路径")
  const selected = path.resolve(cwd, value)
  if (
    selected === cwd ||
    !selected.startsWith(cwd + path.sep) ||
    path
      .relative(cwd, selected)
      .split(path.sep)
      .some((part) => part.startsWith("."))
  )
    throw Error("工具只能访问项目内非隐藏文件")
  let resolved
  try {
    resolved = await realpath(selected)
  } catch {
    resolved = path.join(await realpath(path.dirname(selected)), path.basename(selected))
  }
  if (
    !resolved.startsWith(cwd + path.sep) ||
    path
      .relative(cwd, resolved)
      .split(path.sep)
      .some((part) => part.startsWith("."))
  )
    throw Error("拒绝通过符号链接访问项目外文件")
  if (
    await lstat(selected).then(
      (info) => info.nlink > 1 && info.isFile(),
      () => false,
    )
  )
    throw Error("拒绝访问多重硬链接文件")
  return selected
}
export function projectTools(cwd, permission, dirty) {
  if (permission === "none") return []
  const choices = [
    createReadTool(cwd),
    ...(permission === "write" && !dirty ? [createEditTool(cwd), createWriteTool(cwd)] : []),
  ]
  const listing = {
    ...choices[0],
    name: "project_list",
    label: "项目文件列表",
    description: "List visible files in a project directory. Use path . for the project root.",
    async execute(_id, args) {
      const selected = args.path === "." ? cwd : await safeToolPath(cwd, args.path)
      const names = []
      for (const item of await readdir(selected, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue
        names.push(item.name + (item.isDirectory() ? "/" : ""))
      }
      return {
        content: [{ type: "text", text: names.sort().slice(0, 2000).join("\n") }],
        details: {},
      }
    },
  }
  return [
    listing,
    ...choices.map((tool) => ({
      ...tool,
      name: "project_" + tool.name,
      label: tool.label ?? tool.name,
      async execute(id, args, signal, onUpdate, context) {
        await safeToolPath(cwd, args.path)
        return tool.execute(id, args, signal, onUpdate, context)
      },
    })),
  ]
}
const resourceLoader = {
  getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
  getSkills: () => ({ skills: [], diagnostics: [] }),
  getPrompts: () => ({ prompts: [], diagnostics: [] }),
  getThemes: () => ({ themes: [], diagnostics: [] }),
  getAgentsFiles: () => ({ agentsFiles: [] }),
  getSystemPrompt: () =>
    "You are the Envoi research assistant. Context explicitly marked as unsaved draft is not the on-disk file. Never claim file operations you did not perform. Tools are limited to authorized project files. No shell, hidden files or external paths are available.",
  getAppendSystemPrompt: () => [],
  extendResources: () => {},
  reload: async () => {},
}
function textEvent(event) {
  if (event.type === "message_update") {
    const d = event.assistantMessageEvent
    if (d?.type === "text_delta") return { type: "delta", text: d.delta }
    if (d?.type === "thinking_delta") return { type: "thinking", text: d.delta }
  }
  if (event.type === "tool_execution_start")
    return {
      type: "tool",
      phase: "start",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      detail: JSON.stringify(event.args ?? {}).slice(0, 4000),
    }
  if (event.type === "tool_execution_update")
    return {
      type: "tool",
      phase: "update",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      detail: (event.partialResult?.content ?? [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .slice(-8000),
    }
  if (event.type === "tool_execution_end")
    return {
      type: "tool",
      phase: "end",
      name: event.toolName,
      id: event.toolCallId,
      time: Date.now(),
      isError: !!event.isError,
      detail: (event.result?.content ?? [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
        .slice(0, 8000),
    }
  return null
}
export function createAgentCore({ trustedDesktop = false } = {}) {
  const runtimes = new Map(),
    authJobs = new Map(),
    bound = new Set()
  let auth, registry, runtime
  const customProviders = new Set()
  const discovery = createModelDiscovery({ directory: path.join(dataDir, "ai/model-catalogs") }),
    catalogStates = new WeakMap(),
    modelUsability = new WeakMap()
  function hasAuth(model) {
    if (modelUsability.has(model)) return modelUsability.get(model)
    return customProviders.has(model.provider)
      ? auth.getAuthStatus(model.provider).configured
      : registry.hasConfiguredAuth(model)
  }
  let serviceCache, servicePending
  async function services(options = {}) {
    const fingerprint = await Promise.all(
      ["auth.json", "models.json"].map((name) =>
        stat(path.join(agentDir, name)).then(
          (info) => `${info.mtimeMs}:${info.size}:${info.ino}`,
          () => "",
        ),
      ),
    ).then((parts) => parts.join("|"))
    if (
      !options.refreshProvider &&
      serviceCache?.fingerprint === fingerprint &&
      Date.now() - serviceCache.at < 30000
    )
      return serviceCache.value
    if (servicePending) {
      await servicePending
      return services(options)
    }
    serviceCache = undefined
    servicePending = buildServices(options)
    try {
      const value = await servicePending
      serviceCache = { fingerprint, at: Date.now(), value }
      return value
    } finally {
      servicePending = undefined
    }
  }
  async function buildServices({ refreshProvider } = {}) {
    await mkdir(agentDir, { recursive: true, mode: 0o700 })
    runtime = await ModelRuntime.create({
      authPath: path.join(agentDir, "auth.json"),
      modelsPath: path.join(agentDir, "models.json"),
      refreshOnCreate: false,
      allowModelNetwork: false,
    })
    const current = new ModelRegistry(runtime)
    auth ??= {
      reload() {},
      getAuthStatus: (id) => runtime.getProviderAuthStatus(id),
      getOAuthProviders: () =>
        runtime
          .getProviders()
          .filter((provider) => provider.auth?.oauth)
          .map((provider) => ({ id: provider.id })),
      has: (id) => runtime.hasConfiguredAuth(id),
      getApiKeyForProvider: async (id) => (await runtime.getAuth(id))?.apiKey,
      getAll: () => ({}),
      set: async (id, credential) => runtime.setRuntimeApiKey(id, credential.key),
      remove: (id) => runtime.removeRuntimeApiKey(id),
      login: (id, options) =>
        runtime.login(id, "oauth", {
          signal: options.signal,
          prompt: async (prompt) =>
            prompt.type === "select"
              ? options.onSelect({ message: prompt.message, options: prompt.options })
              : prompt.type === "manual_code"
                ? options.onManualCodeInput()
                : options.onPrompt({ message: prompt.message }),
          notify: (event) =>
            event.type === "auth_url"
              ? options.onAuth({ url: event.url, instructions: event.instructions })
              : event.type === "progress" && options.onProgress?.(event.message),
        }),
    }
    const config = await jsonFile(path.join(agentDir, "models.json"), { providers: {} })
    customProviders.clear()
    for (const [id, value] of Object.entries(config.providers ?? {})) {
      if (
        value.apiKey === "ENVOI_AUTH_FROM_PRIVATE_STORAGE" ||
        value.apiKey === "PAPERDESK_AUTH_FROM_PRIVATE_STORAGE"
      )
        customProviders.add(id)
      if (value.models?.length)
        current.registerProvider(id, {
          ...value,
          apiKey: undefined,
          models: value.models.map((model) => ({
            ...model,
            input: model.input ?? ["text"],
            reasoning: model.reasoning ?? false,
            // The SDK requires a cost object to parse usage. Unknown prices are not displayed.
            cost: model.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          })),
        })
    }
    const builtins = current.getAll(),
      states = new Map()
    const ids = [
      ...new Set([
        ...builtins.map((model) => model.provider),
        ...auth.getOAuthProviders().map((provider) => provider.id),
      ]),
    ]
    await Promise.all(
      ids.map(async (id) => {
        const original = builtins.filter((model) => model.provider === id),
          manual = config.providers?.[id]?.models?.length > 0,
          configured = manual
            ? !!(await runtime.getAuth(id))
            : original.some((model) => current.hasConfiguredAuth(model)) ||
              !!(await runtime.getAuth(id))
        if (manual) {
          states.set(id, {
            state: "manual",
            source: "manual",
            message: "手动配置的模型标识",
            configured,
          })
          return
        }
        if (!configured) {
          states.set(id, {
            state: "unconfigured",
            source: "none",
            message: "配置服务商后获取模型目录",
            configured: false,
          })
          return
        }
        if (!discoveryAdapters[id]) {
          states.set(id, {
            state: "builtin",
            source: "sdk",
            checkedAt: Date.now(),
            models: original,
            configured,
          })
          return
        }
        try {
          const key = await current.getApiKeyForProvider(id)
          const result = await discovery.discover(id, key, { force: refreshProvider === id })
          registerDiscoveredModels(current, id, result)
          states.set(id, { ...result, configured })
        } catch (error) {
          states.set(id, {
            state: "failed",
            source: discoveryAdapters[id].url,
            error: nativeFailure(error.message).message,
            configured,
          })
        }
      }),
    )
    for (const model of current.getAll()) {
      const state = states.get(model.provider)
      modelUsability.set(
        model,
        !!state?.configured &&
          (state.state === "manual" || !!state.models?.some((item) => item.id === model.id)),
      )
    }
    catalogStates.set(current, states)
    registry = current
    return { auth, registry: current, runtime }
  }
  function nativeFailure(raw, status) {
    const secrets = Object.values(auth?.getAll() ?? {})
      .flatMap((value) => [value.key, value.access, value.refresh])
      .filter((value) => typeof value === "string" && value)
    return providerFailure(raw, status, secrets)
  }
  async function chatRecord(project, id) {
    const record = await jsonFile(path.join(sessionDir(project), safeId(id) + ".json"), null)
    if (record?.status === "running" && !runtimes.has(project)) {
      record.status = "cancelled"
      await saveRecord(project, record)
    }
    if (record?.piFile) {
      try {
        const lines = (
          await readFile(
            path.join(sessionDir(project), safeId(id), path.basename(record.piFile)),
            "utf8",
          )
        )
          .trim()
          .split("\n")
        const failures = lines
          .map((line) => JSON.parse(line).message)
          .filter((message) => message?.role === "assistant" && message.stopReason === "error")
        const targets = record.messages.filter(
          (message) => message.role === "assistant" && message.error,
        )
        if (failures.length === targets.length)
          for (let i = 0; i < targets.length; i++)
            targets[i].error = nativeFailure(
              failures[i].errorMessage,
              Number(String(failures[i].errorMessage ?? "").match(/\b([45]\d\d)\b/)?.[1]) ||
                undefined,
            ).message
      } catch {
        /* Existing metadata remains available if native history cannot be read. */
      }
    }
    return record
  }
  async function listRecords(project, query = "") {
    const index = await jsonFile(path.join(sessionDir(project), "index.json"), [])
    return Promise.all(index.map((id) => chatRecord(project, id))).then((rows) =>
      rows
        .filter(Boolean)
        .filter(
          (row) =>
            !query ||
            [row.name, ...row.messages.map((message) => message.text + " " + (message.error ?? ""))]
              .join(" ")
              .toLocaleLowerCase()
              .includes(query.toLocaleLowerCase()),
        )
        .map(({ messages, ...row }) => ({
          ...row,
          count: messages.length,
          running: runtimes.get(project)?.record?.id === row.id,
        })),
    )
  }
  async function status() {
    const { auth, registry } = await services(),
      states = catalogStates.get(registry),
      oauth = auth.getOAuthProviders()
    const models = registry
      .getAll()
      .filter(
        (model) =>
          states.get(model.provider)?.state === "manual" ||
          states.get(model.provider)?.models?.some((item) => item.id === model.id),
      )
    const providers = [...states.keys()].map((id) => {
      const state = states.get(id)
      return {
        id,
        name: registry.getProviderDisplayName(id),
        oauth: oauth.some((provider) => provider.id === id),
        apiKey: !["openai-codex", "github-copilot", "google-vertex", "amazon-bedrock"].includes(id),
        auth: { ...auth.getAuthStatus(id), configured: state.configured },
        catalog: {
          state: state.state,
          source: state.source,
          visibility: state.visibility,
          checkedAt: state.checkedAt,
          error: state.error,
          message: state.message,
          unresolved: state.unresolved?.length ?? 0,
        },
      }
    })
    return {
      runtime: true,
      available: models.some((model) => hasAuth(model)),
      providers,
      models: [
        ...models.map((model) => ({
          id: model.id,
          provider: model.provider,
          name: model.name,
          thinkingLevels: model.reasoning ? getSupportedThinkingLevels(model) : [],
          available: hasAuth(model),
        })),
        ...[...states].flatMap(([provider, state]) =>
          (state.unresolved ?? []).map((id) => ({
            id,
            provider,
            name: id,
            thinkingLevels: [],
            available: false,
            unavailableReason: "目录已列出，但缺少可验证的运行能力数据",
          })),
        ),
      ],
      settings: normalizeAi(await jsonFile(settingsFile, {})),
      storage: { dataDir, credentials: path.join(agentDir, "auth.json"), kind: "pi-file-0600" },
      configurationError: registry.getError()
        ? "自定义模型配置无效，请修复或移除后重试。"
        : undefined,
    }
  }
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
    const { auth, registry } = await services()
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
    if (route === "credential") {
      if (runtimes.size) throw Error("请等待当前 AI 任务结束后修改凭据")
      const providers = (await status()).providers
      if (!providers.some((p) => p.id === body.provider)) throw Error("未知服务商")
      if (body.remove === true) await auth.remove(body.provider)
      else {
        if (
          typeof body.key !== "string" ||
          !body.key.trim() ||
          body.key.length > 16000 ||
          body.key.trim().startsWith("!")
        )
          throw Error("无效 API key")
        const validation = await validateProviderCredential(body.provider, body.key.trim())
        if (validation.state === "failed")
          return { status: 400, body: { error: validation.message, validation, saved: false } }
        await auth.set(body.provider, { type: "api_key", key: body.key.trim() })
        await atomicJson(
          path.join(dataDir, "ai/validation", safeId(body.provider) + ".json"),
          validation,
        )
        await services({ refreshProvider: body.provider })
      }
      await chmod(path.join(agentDir, "auth.json"), 0o600)
      return {
        status: 200,
        body: {
          ok: true,
          validation: body.remove
            ? undefined
            : await jsonFile(
                path.join(dataDir, "ai/validation", safeId(body.provider) + ".json"),
                null,
              ),
        },
      }
    }
    if (route === "custom-provider") {
      if (runtimes.size) throw Error("请等待当前 AI 任务结束后修改服务商")
      safeId(body.provider)
      if (
        registry.getAll().some((model) => model.provider === body.provider) &&
        !customProviders.has(body.provider)
      )
        throw Error("此标识属于内置服务商，请使用独立的自定义标识")
      if (/mock/i.test(body.provider)) throw Error("不支持模拟服务商")
      const url = new URL(body.baseUrl)
      if (
        !["https:", "http:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw Error("请输入不含凭据或查询参数的服务地址")
      if (!["openai-completions", "anthropic-messages", "google-generative-ai"].includes(body.api))
        throw Error("不支持该接口类型")
      if (typeof body.model !== "string" || !body.model.trim()) throw Error("请输入真实模型标识")
      if (
        !Number.isSafeInteger(Number(body.contextWindow ?? 32000)) ||
        Number(body.contextWindow ?? 32000) < 1 ||
        !Number.isSafeInteger(Number(body.maxTokens ?? 4096)) ||
        Number(body.maxTokens ?? 4096) < 1
      )
        throw Error("模型窗口与输出上限必须是正整数")
      const file = path.join(agentDir, "models.json"),
        config = await jsonFile(file, { providers: {} })
      config.providers ??= {}
      config.providers[body.provider] = {
        baseUrl: url.href,
        api: body.api,
        apiKey: "ENVOI_AUTH_FROM_PRIVATE_STORAGE",
        models: [
          ...(config.providers[body.provider]?.models ?? []).filter(
            (model) => model.id !== body.model.trim(),
          ),
          {
            id: body.model.trim(),
            name: body.name?.trim() || body.model.trim(),
            input: ["text"],
            reasoning: false,
            contextWindow: Number(body.contextWindow) || 32000,
            maxTokens: Number(body.maxTokens) || 4096,
          },
        ],
      }
      await atomicJson(file, config)
      return { status: 200, body: { ok: true } }
    }
    if (route === "oauth/start") {
      for (const old of authJobs.values())
        if (old.provider === body.provider && !["done", "failed", "cancelled"].includes(old.state))
          old.controller.abort()
      if (!auth.getOAuthProviders().some((provider) => provider.id === body.provider))
        throw Error("该服务商不支持 OAuth")
      const id = randomUUID(),
        job = { id, provider: body.provider, controller: new AbortController(), state: "starting" }
      authJobs.set(id, job)
      setTimeout(() => {
        job.controller.abort()
        authJobs.delete(id)
      }, 600000).unref()
      const prompt = (question) =>
        new Promise((resolve, reject) => {
          job.prompt = question
          job.state = "input"
          job.answer = resolve
          job.controller.signal.addEventListener("abort", () => reject(Error("已取消")), {
            once: true,
          })
        })
      void auth
        .login(body.provider, {
          signal: job.controller.signal,
          onAuth: (info) => {
            job.url = info.url
            job.instructions = info.instructions
            job.state = "authorize"
          },
          onPrompt: prompt,
          onManualCodeInput: () => prompt({ message: "粘贴授权后的回调地址或验证码" }),
          onSelect: (question) => prompt({ ...question, select: true }),
          onProgress: () => {},
        })
        .then(async () => {
          await services({ refreshProvider: body.provider })
          job.state = "done"
          delete job.prompt
          delete job.url
          delete job.instructions
        })
        .catch(() => {
          job.state = job.controller.signal.aborted ? "cancelled" : "failed"
          job.error = "认证未完成，请重试或检查服务商配置。"
          delete job.prompt
          delete job.url
          delete job.instructions
        })
      return { status: 200, body: { id } }
    }
    if (route.startsWith("oauth/")) {
      const job = authJobs.get(body.id)
      if (!job) throw Error("认证会话不存在")
      if (route === "oauth/cancel") job.controller.abort()
      if (route === "oauth/answer") {
        if (typeof body.answer !== "string" || !job.answer) throw Error("当前没有待回答的认证步骤")
        job.answer(body.answer)
        delete job.answer
        delete job.prompt
        job.state = "waiting"
      }
      return {
        status: 200,
        body: {
          id: job.id,
          state: job.state,
          url: job.url,
          instructions: job.instructions,
          prompt: job.prompt,
          error: job.error,
        },
      }
    }
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
      const { auth, registry, runtime } = await services()
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
  function dispose() {
    for (const running of runtimes.values())
      void running.session?.abort().finally(() => running.session.dispose())
    for (const job of authJobs.values()) job.controller.abort()
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
export function agentPlugin() {
  const token = randomBytes(32).toString("hex"),
    core = createAgentCore()
  return {
    name: "envoi-agent",
    configureServer(server) {
      server.httpServer?.once("close", () => core.dispose())
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/envoi/agent")) return next()
        const host = req.headers.host ?? ""
        if (
          !/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) ||
          !(
            req.headers.origin === `http://${host}` ||
            (!req.headers.origin && req.headers["sec-fetch-site"] === "same-origin")
          )
        ) {
          res.statusCode = 403
          res.end()
          return
        }
        res.setHeader("Cache-Control", "no-store")
        res.setHeader("Content-Type", "application/json")
        try {
          if (req.method === "GET" && req.url === "/api/envoi/agent") {
            res.end(JSON.stringify({ ...(await core.status()), token }))
            return
          }
          if (req.method !== "POST" || req.headers["x-envoi-token"] !== token)
            throw Error("请求未获授权")
          let raw = ""
          for await (const chunk of req) {
            raw += chunk
            if (raw.length > 2_000_000) throw Error("请求超过大小限制")
          }
          const body = JSON.parse(raw),
            route = req.url.slice("/api/envoi/agent/".length)
          if (route === "chat") {
            const closer = new AbortController()
            res.on("close", () => closer.abort())
            try {
              await core.chat(body, {
                signal: closer.signal,
                onEvent: (event) => {
                  if (res.writableEnded) return
                  if (!res.headersSent) {
                    res.setHeader("Content-Type", "application/x-ndjson")
                    res.flushHeaders()
                  }
                  res.write(JSON.stringify(event) + "\n")
                },
              })
            } catch (error) {
              if (!res.headersSent) {
                res.statusCode = 400
                res.end(JSON.stringify({ error: error.message }))
              } else if (!res.writableEnded)
                res.end(
                  JSON.stringify({ type: "error", message: "请求未完成，请检查会话状态。" }) + "\n",
                )
              return
            }
            if (res.headersSent && !res.writableEnded) res.end()
            return
          }
          const result = await core.request(route, body)
          res.statusCode = result.status
          res.end(JSON.stringify(result.body))
        } catch (error) {
          if (res.statusCode === 200) res.statusCode = 400
          res.end(JSON.stringify({ error: error.message }))
        }
      })
    },
  }
}
