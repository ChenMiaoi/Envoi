import {
  createModelDiscovery,
  discoveryAdapters,
  registerDiscoveredModels,
} from "../model-discovery.mjs"
import { providerFailure } from "../provider-validation.mjs"
// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai"
import { ModelRegistry, ModelRuntime } from "@earendil-works/pi-coding-agent"
import { mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { dataDir, jsonFile } from "../local-data.mjs"

import { agentDir, normalizeAi, settingsFile } from "./configuration.mjs"
export function createModelServices() {
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
              : event.type === "device_code"
                ? options.onDeviceCode({
                    url: event.verificationUri,
                    userCode: event.userCode,
                  })
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

  return { services, status, hasAuth, nativeFailure, customProviders, catalogStates }
}
