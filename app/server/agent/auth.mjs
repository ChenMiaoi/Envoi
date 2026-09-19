import { validateProviderCredential } from "../provider-validation.mjs"
// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { randomUUID } from "node:crypto"
import { chmod } from "node:fs/promises"
import path from "node:path"
import { atomicJson, dataDir, jsonFile, safeId } from "../local-data.mjs"

import { agentDir } from "./configuration.mjs"
export function createAuthRequests({ runtimes, services, status, customProviders }) {
  const authJobs = new Map()
  async function request(route, body) {
    const { auth, registry } = await services()
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
      setTimeout(
        () => {
          job.controller.abort()
          authJobs.delete(id)
        },
        body.provider === "kimi-coding" ? 960000 : 600000,
      ).unref()
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
          onDeviceCode: (info) => {
            job.url = info.url
            job.userCode = info.userCode
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
          delete job.userCode
          delete job.instructions
        })
        .catch(() => {
          job.state = job.controller.signal.aborted ? "cancelled" : "failed"
          job.error = "认证未完成，请重试或检查服务商配置。"
          delete job.prompt
          delete job.url
          delete job.userCode
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
          userCode: job.userCode,
          instructions: job.instructions,
          prompt: job.prompt,
          error: job.error,
        },
      }
    }
  }
  return {
    request,
    dispose() {
      for (const job of authJobs.values()) job.controller.abort()
    },
  }
}
