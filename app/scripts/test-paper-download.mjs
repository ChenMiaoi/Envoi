import { test } from "node:test"
import assert from "node:assert/strict"
import { downloadPaper } from "../server/paper-download.mjs"
test("PDF links validate redirects, content and declared size", async () => {
  let calls = 0
  const result = await downloadPaper("https://papers.example/abs/1", async () => {
    calls++
    return calls === 1
      ? new Response(null, { status: 302, headers: { location: "/paper.pdf" } })
      : new Response("%PDF-1.4\nfixture")
  })
  assert.equal(result.name, "paper.pdf")
  assert.equal(Buffer.from(result.base64, "base64").toString(), "%PDF-1.4\nfixture")
  await assert.rejects(downloadPaper("file:///etc/passwd"), /HTTPS/)
  await assert.rejects(
    downloadPaper("https://papers.example", async () => new Response("<html>login</html>")),
    /不是 PDF/,
  )
  await assert.rejects(
    downloadPaper(
      "https://papers.example",
      async () => new Response("", { headers: { "content-length": "100000001" } }),
    ),
    /100 MB/,
  )
  await assert.rejects(
    downloadPaper(
      "https://papers.example",
      async () =>
        new Response(null, { status: 302, headers: { location: "http://papers.example" } }),
    ),
    /HTTPS/,
  )
})

test("cancelled PDF downloads cannot publish a late response", async () => {
  const controller = new AbortController()
  await assert.rejects(
    downloadPaper(
      "https://papers.example/late.pdf",
      async () => {
        controller.abort()
        return new Response("%PDF-1.4\nlate response")
      },
      { signal: controller.signal },
    ),
    { name: "AbortError" },
  )
})

test(
  "browser PDF imports stay with their window and cancel on project changes",
  { timeout: 30000 },
  async () => {
    const { _electron } = await import("playwright")
    const { createRequire } = await import("node:module")
    const { mkdtemp, mkdir, realpath, rm } = await import("node:fs/promises")
    const { tmpdir } = await import("node:os")
    const path = await import("node:path")
    const require = createRequire(import.meta.url)
    const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-browse-test-")))
    const a = path.join(temp, "A"),
      b = path.join(temp, "B")
    await mkdir(a)
    await mkdir(b)
    let app
    try {
      app = await _electron.launch({
        executablePath: require("electron"),
        args: [
          path.resolve(import.meta.dirname, ".."),
          "--user-data-dir=" + path.join(temp, "profile"),
        ],
        env: {
          ...process.env,
          ENVOI_DATA_DIR: path.join(temp, "data"),
          ENVOI_DESKTOP_TEST_HIDDEN: "1",
        },
      })
      const first = await app.firstWindow()
      await first.waitForFunction(() => !!window.envoi)
      const nextWindow = app.waitForEvent("window")
      await app.evaluate(
        ({ BrowserWindow }, preload) => {
          const first = BrowserWindow.getAllWindows()[0]
          const second = new BrowserWindow({
            show: false,
            webPreferences: {
              preload,
              contextIsolation: true,
              sandbox: true,
              webviewTag: true,
            },
          })
          void second.loadURL(first.webContents.getURL())
        },
        path.resolve(import.meta.dirname, "../dist/preload/index.cjs"),
      )
      const second = await nextWindow
      await second.waitForFunction(() => !!window.envoi)
      const bind = (page, root) =>
        page.evaluate(async (root) => {
          await window.envoi.bindProject(root)
          await window.envoi.grantProjectTrust(root)
          await window.envoi.bindPaperBrowse(root)
        }, root)
      const guest = (page) =>
        page.evaluate(
          () =>
            new Promise((resolve) => {
              const view = document.createElement("webview")
              view.setAttribute("partition", "persist:paperbrowse")
              view.setAttribute("src", "about:blank")
              view.addEventListener("dom-ready", () => resolve(view.getWebContentsId()), {
                once: true,
              })
              document.body.append(view)
            }),
        )
      await bind(first, a)
      await bind(second, b)
      const firstGuest = await guest(first),
        secondGuest = await guest(second)
      const start = (id, name) =>
        app.evaluate(
          ({ webContents }, { id, name }) => {
            globalThis.pendingDownload = undefined
            globalThis.fetch = (_url, options) =>
              new Promise((resolve) => {
                globalThis.pendingDownload = {
                  signal: options.signal,
                  release: () => resolve(new Response("%PDF-1.4\n" + name)),
                }
              })
            webContents
              .fromId(id)
              .emit(
                "will-navigate",
                { preventDefault() {} },
                "https://papers.invalid/" + name + ".pdf",
              )
            return !!globalThis.pendingDownload
          },
          { id, name },
        )
      const release = () =>
        app.evaluate(() => {
          const pending = globalThis.pendingDownload
          pending.release()
          return pending.signal.aborted
        })
      assert.equal(await start(secondGuest, "second-window"), true)
      assert.equal(await release(), false)
      await second.waitForFunction(
        async (root) => (await window.envoi.library(root, { action: "list" })).papers.length === 1,
        b,
      )
      assert.equal(
        (await first.evaluate((root) => window.envoi.library(root, { action: "list" }), a)).papers
          .length,
        0,
      )

      assert.equal(await start(firstGuest, "old-project"), true)
      await bind(first, b)
      assert.equal(await release(), true)
      await assert.rejects(
        first.evaluate((root) => window.envoi.bindPaperBrowse(root), a),
        /not active/,
      )

      assert.equal(await start(firstGuest, "revoked"), true)
      await first.evaluate((root) => window.envoi.restrictProject(root), b)
      assert.equal(await release(), true)
      await bind(first, b)
      assert.equal(await start(firstGuest, "closed"), true)
      await first.evaluate((root) => window.envoi.closeProject(root), b)
      assert.equal(await release(), true)

      await bind(first, b)
      assert.equal(await start(firstGuest, "current-project"), true)
      assert.equal(await release(), false)
      await first.waitForFunction(
        async (root) => (await window.envoi.library(root, { action: "list" })).papers.length === 2,
        b,
      )
      const list = await first.evaluate((root) => window.envoi.library(root, { action: "list" }), b)
      assert.deepEqual(list.papers.map((p) => p.title).sort(), ["current project", "second window"])
      assert.equal(
        (await first.evaluate((root) => window.envoi.library(root, { action: "list" }), a)).papers
          .length,
        0,
      )
    } finally {
      await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
      await app?.close().catch(() => {})
      await rm(temp, { recursive: true, force: true })
    }
  },
)
