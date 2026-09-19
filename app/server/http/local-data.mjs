import { randomBytes } from "node:crypto"
import { dataDir, dataStore, registerProject, verifyDirectory } from "../local-data.mjs"
export function localDataPlugin() {
  const token = randomBytes(32).toString("hex")
  return {
    name: "envoi-local-data",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/envoi/data")) return next()
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
        res.setHeader("Content-Type", "application/json")
        res.setHeader("Cache-Control", "no-store")
        try {
          if (req.method === "GET" && req.url === "/api/envoi/data") {
            res.end(JSON.stringify({ available: true, token, dataDir }))
            return
          }
          if (req.method !== "POST" || req.headers["x-envoi-token"] !== token) {
            res.statusCode = 403
            throw Error("请求未获授权")
          }
          let body = ""
          for await (const chunk of req) {
            body += chunk
            if (body.length > 150_000_000) throw Error("数据超过本机传输上限")
          }
          const input = JSON.parse(body)
          if (req.url === "/api/envoi/data/bind") {
            const root = await verifyDirectory(input)
            res.end(
              JSON.stringify({
                project: await registerProject(root, { copy: input.copy === true }),
              }),
            )
            return
          }
          const result = await dataStore(input)
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
