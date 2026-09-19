import { protocol } from "electron"
import { readFile, realpath } from "node:fs/promises"
import path from "node:path"
import { ProjectSessionManager } from "./project-sessions"

export function createAssetProtocol(
  sessions: ProjectSessionManager,
  resolveInside: (root: string, file: string) => Promise<string>,
) {
  // ── envoi:// 自定义协议（契约第 2 节）──

  const MIME: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    bmp: "image/bmp",
    ico: "image/x-icon",
    json: "application/json",
    css: "text/css",
    html: "text/html",
    js: "text/javascript",
    mjs: "text/javascript",
    txt: "text/plain",
    md: "text/markdown",
    csv: "text/csv",
    tsv: "text/tab-separated-values",
    xml: "application/xml",
    woff: "font/woff",
    woff2: "font/woff2",
    ttf: "font/ttf",
    otf: "font/otf",
    eps: "application/postscript",
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: "envoi",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ])

  async function handleAsset(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const root = sessions.rootForToken(url.host)
    if (!root) return new Response("未授权的资源访问", { status: 403 })
    let target: string
    try {
      target = await resolveInside(root, decodeURIComponent(url.pathname).replace(/^\/+/, ""))
    } catch {
      return new Response("无效资源路径", { status: 400 })
    }
    const real = await realpath(target).catch(() => null)
    if (!real) return new Response("资源不存在", { status: 404 })
    const data = await readFile(real)
    const mime = MIME[path.extname(real).slice(1).toLowerCase()] ?? "application/octet-stream"
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    })
  }

  return handleAsset
}
