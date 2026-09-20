import { app, session, shell } from "electron"
import { randomUUID } from "node:crypto"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"
import { downloadPaper } from "../../../server/paper-download.mjs"
import { libraryRequest, researchRoot } from "../../../server/research-library.mjs"
import { ProjectSessionManager } from "./project-sessions"
import { isRemoteRoot } from "../remote/workspace-routing.mjs"
import type { MainServices } from "../runtime"

export function setupPaperBrowse({
  sessions,
  requireBoundRoot,
  remote,
}: {
  sessions: ProjectSessionManager
  requireBoundRoot: (root: string) => Promise<string>
  remote: MainServices["remote"]
}): void {
  const browse = session.fromPartition("persist:paperbrowse")
  const origin = (contents: Electron.WebContents) => {
    const owner = contents.hostWebContents ?? contents
    const binding = sessions.browse(owner.id)
    if (!binding || sessions.activeRoot(owner.id) !== binding.root) return undefined
    return {
      owner,
      binding,
      current: () =>
        !owner.isDestroyed() &&
        !contents.isDestroyed() &&
        sessions.browse(owner.id) === binding &&
        sessions.activeRoot(owner.id) === binding.root &&
        !binding.controller.signal.aborted,
    }
  }
  type Origin = NonNullable<ReturnType<typeof origin>>
  const notify = (source: Origin, payload: { title?: string; error?: string }) => {
    if (source.current()) source.owner.send("envoi:browse-imported", payload)
  }
  const importFile = async (source: Origin, name: string, base64: string) => {
    if (!source.current()) return
    if (isRemoteRoot(source.binding.root)) {
      const root = source.binding.root
      if (!remote.get(source.owner.id, root).trusted)
        throw Error("Trust this remote workspace before importing papers")
      await remote.call(source.owner.id, root, "library", [
        {
          action: "import",
          papers: [{ title: pdfName(name), attachment: { $blob: base64 } }],
        },
      ])
      notify(source, { title: name })
      return
    }
    const root = await requireBoundRoot(source.binding.root)
    await requireBoundRoot(await researchRoot(root))
    if (!source.current()) return
    await libraryRequest(
      root,
      {
        action: "import",
        papers: [{ title: pdfName(name), attachment: { $blob: base64 } }],
      },
      source.current,
    )
    notify(source, { title: name })
  }
  const pdfName = (name: string) =>
    name
      .replace(/\.pdf$/i, "")
      .replace(/[_-]+/g, " ")
      .trim() || "网页下载论文"
  const pdfUrl = (url: string) => /^https:\/\/[^\s]+\.pdf([?#].*)?$/i.test(url)
  app.on("web-contents-created", (_event, contents) => {
    if (contents.session !== browse) return
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
      return { action: "deny" }
    })
    contents.on("will-navigate", (event, url) => {
      const source = origin(contents)
      if (!pdfUrl(url) || !source) return
      event.preventDefault()
      void downloadPaper(url, fetch, { signal: source.binding.controller.signal })
        .then((file) => importFile(source, file.name, file.base64))
        .catch((error: Error) => notify(source, { error: error.message }))
    })
  })
  browse.on("will-download", (_event, item, contents) => {
    const name = item.getFilename() || "paper.pdf"
    if (item.getMimeType() !== "application/pdf" && !/\.pdf$/i.test(name)) return
    const source = origin(contents)
    if (!source) {
      item.cancel()
      return
    }
    const savePath = path.join(app.getPath("temp"), `envoi-browse-${randomUUID()}.pdf`)
    const cancel = () => item.cancel()
    source.binding.controller.signal.addEventListener("abort", cancel, { once: true })
    item.setSavePath(savePath)
    item.once("done", (_done, state) => {
      void (async () => {
        try {
          if (state !== "completed" || !source.current()) return
          const bytes = await readFile(savePath)
          if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
            throw Error("下载内容不是 PDF")
          await importFile(source, name, bytes.toString("base64"))
        } catch (error) {
          notify(source, { error: (error as Error).message })
        } finally {
          source.binding.controller.signal.removeEventListener("abort", cancel)
          await rm(savePath, { force: true }).catch(() => {})
        }
      })()
    })
  })
}
