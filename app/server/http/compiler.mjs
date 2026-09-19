import { randomBytes } from "node:crypto"
import { compileSnapshot, runtimeInfo, validateSnapshot } from "../compiler.mjs"
import {
  gitRuntime,
  initializeBoundGit,
  readBoundGitLog,
  readBoundGitShow,
  readBoundGitStatus,
  verifyProjectBinding,
} from "../git.mjs"
import { lintText } from "../lint.mjs"
import { configureTools, toolInfo } from "../tool-config.mjs"
const LIMIT = 40 * 1024 * 1024
export function compilerPlugin() {
  const token = randomBytes(32).toString("hex")
  let running = false
  return {
    name: "envoi-local-compiler",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/envoi/")) return next()
        if (req.url.startsWith("/api/envoi/agent")) return next()
        const host = req.headers.host ?? ""
        const sameOrigin =
          req.headers.origin === `http://${host}` ||
          (!req.headers.origin && req.headers["sec-fetch-site"] === "same-origin")
        if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host) || !sameOrigin) {
          res.statusCode = 403
          res.end("Local same-origin requests only")
          return
        }
        res.setHeader("Content-Type", "application/json")
        res.setHeader("Cache-Control", "no-store")
        if (req.method === "GET" && req.url === "/api/envoi/tools") {
          res.end(JSON.stringify({ ...(await toolInfo()), latex: runtimeInfo(), token }))
          return
        }
        if (
          req.method === "POST" &&
          req.url === "/api/envoi/tools" &&
          req.headers["x-envoi-token"] === token
        ) {
          try {
            let body = ""
            for await (const chunk of req) {
              body += chunk
              if (body.length > 8192) throw Error("Request too large")
            }
            res.end(
              JSON.stringify({
                ...(await configureTools(JSON.parse(body))),
                latex: runtimeInfo(),
                token,
              }),
            )
          } catch (error) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }
        if (req.method === "GET" && req.url === "/api/envoi/compiler") {
          res.end(JSON.stringify({ ...runtimeInfo(), token }))
          return
        }
        if (req.method === "GET" && req.url === "/api/envoi/git") {
          res.end(JSON.stringify({ ...gitRuntime(), token }))
          return
        }
        if (req.method === "POST" && req.headers["x-envoi-token"] === token) {
          const gitHandlers = {
            "/api/envoi/git-init": initializeBoundGit,
            "/api/envoi/git-status": readBoundGitStatus,
            "/api/envoi/git-log": readBoundGitLog,
            "/api/envoi/git-show": readBoundGitShow,
            "/api/envoi/project-bind": verifyProjectBinding,
          }
          const handler = gitHandlers[req.url]
          if (!handler) {
            res.statusCode = 403
            res.end(JSON.stringify({ error: "Invalid compile request" }))
            return
          }
          try {
            let body = ""
            for await (const chunk of req) {
              body += chunk
              if (body.length > 8192) throw Error("Request too large")
            }
            res.end(JSON.stringify(await handler(JSON.parse(body))))
          } catch (error) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: error.message }))
          }
          return
        }
        if (
          req.method === "POST" &&
          req.url === "/api/envoi/lint" &&
          req.headers["x-envoi-token"] === token
        ) {
          const controller = new AbortController()
          res.on("close", () => {
            if (!res.writableEnded) controller.abort()
          })
          try {
            let body = ""
            for await (const chunk of req) {
              body += chunk
              if (body.length > 800000) throw Error("检查文本过大")
            }
            res.end(JSON.stringify(await lintText(JSON.parse(body), { signal: controller.signal })))
          } catch (error) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: error.message }))
          }
          return
        }
        if (
          req.method !== "POST" ||
          req.url !== "/api/envoi/compile" ||
          req.headers["x-envoi-token"] !== token
        ) {
          res.statusCode = 403
          res.end(JSON.stringify({ error: "Invalid compile request" }))
          return
        }
        if (running) {
          res.statusCode = 409
          res.end(JSON.stringify({ error: "已有编译正在运行，请稍后再试。" }))
          return
        }
        running = true
        const controller = new AbortController()
        res.on("close", () => {
          if (!res.writableEnded) controller.abort(Error("编译已取消"))
        })
        try {
          let body = ""
          for await (const chunk of req) {
            body += chunk
            if (body.length > LIMIT * 1.5) throw Error("项目请求过大")
          }
          const snapshot = validateSnapshot(JSON.parse(body))
          res.end(JSON.stringify(await compileSnapshot(snapshot, { signal: controller.signal })))
        } catch (error) {
          res.statusCode = 400
          res.end(JSON.stringify({ ok: false, error: error.message }))
        } finally {
          running = false
        }
      })
    },
  }
}
