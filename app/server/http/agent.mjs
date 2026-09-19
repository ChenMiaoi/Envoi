import { randomBytes } from "node:crypto"
import { createAgentCore } from "../agent.mjs"
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
