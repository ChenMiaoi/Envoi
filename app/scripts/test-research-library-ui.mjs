import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, realpath, rm, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-library-ui-"))),
  require = createRequire(import.meta.url)
function pdf() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R 7 0 R 8 0 R 9 0 R 10 0 R 11 0 R 12 0 R 13 0 R 14 0 R 15 0 R 16 0 R 17 0 R 18 0 R 19 0 R 20 0 R 21 0 R 22 0 R 23 0 R 24 0 R 25 0 R 26 0 R 27 0 R 28 0 R 29 0 R 30 0 R 31 0 R 32 0 R 33 0 R 34 0 R 35 0 R 36 0 R 37 0 R 38 0 R 39 0 R 40 0 R 41 0 R 42 0 R 43 0 R 44 0 R] /Count 40 >>",
    ...[],
  ]
  const page =
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>"
  const stream = "BT /F1 18 Tf 50 500 Td (Research fixture) Tj ET"
  objects.push(
    page,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...Array(39).fill(page),
  )
  let output = "%PDF-1.4\n",
    offsets = [0]
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(output))
    output += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`
  }
  const start = Buffer.byteLength(output)
  output +=
    "xref\n0 45\n0000000000 65535 f \n" +
    offsets
      .slice(1)
      .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
      .join("") +
    `trailer\n<< /Size 45 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
  return Buffer.from(output).toString("base64")
}
let app
try {
  await seedFixtureTrust(path.join(temp, "data"), temp)
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false })
  })
  const page = await app.firstWindow(),
    errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.getByTestId("welcome-page").waitFor()
  await page.getByRole("button", { name: /打开示例项目/ }).click()
  await page.getByRole("button", { name: "main.tex", exact: true }).waitFor()
  const root = (await page.evaluate(() => window.envoi.dataGet("session", "current"))).value
    .rootPath
  await page.evaluate(
    async ({ root, pdf }) => {
      await window.envoi.library(root, {
        action: "import",
        papers: [
          { title: "Paper A", collection: "相关工作", notes: "Note A", attachment: { $blob: pdf } },
          { title: "Paper B", collection: "方法与基线", notes: "Note B" },
        ],
      })
    },
    {
      root,
      pdf: process.env.ENVOI_PDF_STRESS_FILE
        ? (await readFile(process.env.ENVOI_PDF_STRESS_FILE)).toString("base64")
        : pdf(),
    },
  )
  const seeded = await page.evaluate((root) => window.envoi.library(root, { action: "list" }), root)
  const paperB = seeded.papers.find((p) => p.title === "Paper B")
  await page.evaluate(
    ({ root, id }) =>
      window.envoi.library(root, {
        action: "state",
        paperId: id,
        key: "chat",
        value: {
          id: "layout-fixture",
          name: "Layout fixture",
          status: "complete",
          messages: [
            { id: "u", role: "user", text: "这篇论文与当前研究有什么联系？" },
            {
              id: "a",
              role: "assistant",
              text: "这是一条布局测试消息，用于确认对话展开后笔记仍然可以编辑。",
            },
          ],
        },
      }),
    { root, id: paperB.id },
  )
  await page.setViewportSize({ width: 2560, height: 1392 })
  await page.evaluate(() =>
    Object.defineProperty(window, "devicePixelRatio", { get: () => 2, configurable: true }),
  )
  await page.evaluate(() => {
    window.pdfCanvasAllocations = 0
    const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "width")
    Object.defineProperty(HTMLCanvasElement.prototype, "width", {
      ...descriptor,
      set(value) {
        if (value > 0 && this.closest("[data-pdf-page]")) window.pdfCanvasAllocations++
        descriptor.set.call(this, value)
      },
    })
  })
  await page.evaluate(() => (location.hash = "/library"))
  await page.getByTestId("research-library").waitFor()
  const notes = page.getByRole("textbox", { name: "论文阅读笔记", exact: true })
  await notes.waitFor()
  assert.equal(await notes.getAttribute("contenteditable"), "true")
  assert.equal(await page.locator('textarea[aria-label="论文阅读笔记"]').count(), 0)
  assert.equal(await notes.textContent(), "Note A")
  await page.locator("canvas").first().waitFor()
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll("canvas")).some((c) => c.width > 0),
  )
  const budget = await page.locator("canvas").evaluateAll((nodes) => ({
    count: nodes.filter((c) => c.width > 0).length,
    pixels: nodes.reduce((n, c) => n + c.width * c.height, 0),
  }))
  assert(budget.count <= 4, JSON.stringify(budget))
  assert(budget.pixels <= 16_100_000, JSON.stringify(budget))
  console.log("PDF bitmap budget", budget)
  const noteBounds = await notes.boundingBox(),
    panelBounds = await page.getByTestId("paper-notes-panel").boundingBox()
  assert(
    noteBounds.height > panelBounds.height * 0.65,
    "empty chat leaves the space to the note editor",
  )
  if (process.env.ENVOI_LIBRARY_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_LIBRARY_SCREENSHOT })
  await page.waitForTimeout(500)
  const renderCount = await page.evaluate(() => window.pdfCanvasAllocations)
  await notes.fill("Typing does not redraw the PDF")
  await page.waitForTimeout(900)
  assert.equal(
    await page.evaluate(() => window.pdfCanvasAllocations),
    renderCount,
    "note autosave must not rerasterize the PDF",
  )
  const fastScroll = await page.evaluate(async () => {
    const figure = document.querySelector('[data-pdf-page="1"]'),
      scroller = figure.parentElement.parentElement
    const before = window.pdfCanvasAllocations,
      gaps = []
    let previous = performance.now()
    for (let page = 2; page <= 30; page++) {
      scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 800 }))
      scroller.scrollTop = scroller.querySelector(`[data-pdf-page="${page}"]`).offsetTop
      await new Promise((resolve) => requestAnimationFrame(() => resolve()))
      const now = performance.now()
      gaps.push(now - previous)
      previous = now
    }
    return {
      renders: window.pdfCanvasAllocations - before,
      maxFrameMs: Math.round(Math.max(...gaps)),
    }
  })
  assert(fastScroll.renders <= 2, JSON.stringify(fastScroll))
  console.log("Fast scroll across 29 pages", fastScroll)
  await page.locator('[data-pdf-page="30"] .textLayer span').first().waitFor({ timeout: 15000 })
  assert(
    await page.locator('[data-pdf-page="30"] canvas').evaluate((c) => c.width > 0),
    "destination renders after scrolling stops",
  )
  await notes.fill("Saved note A")
  await page.getByRole("button", { name: /^Paper B/ }).click()
  await notes.waitFor()
  assert.equal(await notes.textContent(), "Note B")
  await page
    .getByText("这是一条布局测试消息，用于确认对话展开后笔记仍然可以编辑。", { exact: true })
    .waitFor()
  if (process.env.ENVOI_LIBRARY_SCREENSHOT) {
    await page.setViewportSize({ width: 1100, height: 800 })
    await page.locator('[data-testid="paper-notes-panel"]:visible').screenshot({
      path: process.env.ENVOI_LIBRARY_SCREENSHOT.replace(".png", "-conversation.png"),
    })
    await page.setViewportSize({ width: 2560, height: 1392 })
  }
  const paperPanel = page.getByTestId("paper-notes-panel").filter({ visible: true })
  await paperPanel.getByRole("button", { name: "新建对话", exact: true }).click()
  await page
    .getByText("这是一条布局测试消息，用于确认对话展开后笔记仍然可以编辑。", { exact: true })
    .waitFor({ state: "hidden" })
  await paperPanel.getByRole("button", { name: "对话历史", exact: true }).click()
  await page.getByRole("button").filter({ hasText: "Layout fixture" }).click()
  await page
    .getByText("这是一条布局测试消息，用于确认对话展开后笔记仍然可以编辑。", { exact: true })
    .waitFor()
  await notes.fill("Saved note B")
  await page.getByRole("button", { name: /^Paper A/ }).click()
  assert.equal(await notes.textContent(), "Saved note A")
  await page.waitForTimeout(800)
  const papers = (
    await page.evaluate((root) => window.envoi.library(root, { action: "list" }), root)
  ).papers
  const a = papers.find((p) => p.title === "Paper A"),
    b = papers.find((p) => p.title === "Paper B")
  for (const p of [a, b]) {
    const d = await page.evaluate(
      ({ root, id }) => window.envoi.library(root, { action: "get", paperId: id }),
      { root, id: p.id },
    )
    assert.equal(d.note.text, "Saved note " + p.title.slice(-1))
  }
  const scroller = page.locator('[data-pdf-page="1"]')
  await scroller.waitFor()
  await scroller.evaluate(
    (el) =>
      (el.parentElement.parentElement.scrollTop =
        el.parentElement.querySelector('[data-pdf-page="2"]').offsetTop + 30),
  )
  await page.waitForTimeout(700)
  const reading = (
    await page.evaluate(
      ({ root, id }) => window.envoi.library(root, { action: "get", paperId: id }),
      { root, id: a.id },
    )
  ).state.reading
  assert(reading.page >= 2)
  await page.getByRole("button", { name: /^Paper B/ }).click()
  await page.getByRole("button", { name: /^Paper A/ }).click()
  await page.locator("canvas").first().waitFor()
  await page.waitForTimeout(500)
  const scroll = await page
    .locator('[data-pdf-page="1"]')
    .evaluate((el) => el.parentElement.parentElement.scrollTop)
  assert(scroll > 300)
  const pageNumber = page.getByRole("spinbutton", { name: "论文页码" })
  assert.equal(Number(await pageNumber.inputValue()), reading.page)
  await pageNumber.fill("12")
  await pageNumber.press("Enter")
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-pdf-page="12"]')
    return (
      Math.abs(
        el.getBoundingClientRect().top - el.parentElement.parentElement.getBoundingClientRect().top,
      ) < 30
    )
  })
  await page.waitForTimeout(400)
  await page.getByRole("combobox", { name: "PDF 缩放" }).selectOption("1.5")
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-pdf-page="12"]')
    return el.parentElement.scrollWidth > el.parentElement.parentElement.clientWidth
  })
  await page.getByRole("button", { name: /^Paper B/ }).click()
  await page.getByRole("button", { name: /^Paper A/ }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-pdf-page="12"]')
    return (
      el &&
      Math.abs(
        el.getBoundingClientRect().top - el.parentElement.parentElement.getBoundingClientRect().top,
      ) < 35
    )
  })
  const allocated = await page
    .locator("canvas")
    .evaluateAll((nodes) => nodes.filter((c) => c.width > 0).length)
  assert(allocated <= 4, "offscreen canvases must be released")
  const archivePath = path.join(temp, "research-export.json")
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, archivePath)
  await page.getByRole("button", { name: "导出全部资料…", exact: true }).click()
  await page.getByText(/已导出当前研究的全部资料/).waitFor()
  const archive = JSON.parse(await readFile(archivePath, "utf8"))
  assert.equal(archive.version, 1)
  assert.equal(archive.papers.length, 2)
  await page.reload()
  await page.getByRole("button", { name: "main.tex", exact: true }).waitFor()
  await page.evaluate(() => (location.hash = "/library"))
  await notes.waitFor()
  assert.equal(await notes.textContent(), "Saved note A")
  await page.getByRole("button", { name: "修改历史", exact: true }).click()
  await page.getByRole("button", { name: /恢复版本 1/ }).click()
  await page.waitForTimeout(650)
  assert.equal(await notes.textContent(), "Note A")
  await writeFile(path.join(root, "metrics.csv"), "method,score\nbaseline,0.5\n")
  await writeFile(
    path.join(root, "reader-import.pdf"),
    Buffer.concat([Buffer.from(pdf(), "base64"), Buffer.from("\n% Reader import fixture\n")]),
  )
  await page.evaluate(() => (location.hash = "/reader"))
  await page.getByRole("button", { name: "metrics.csv", exact: true }).click()
  const cell = page.locator("table textarea").last()
  assert.equal(await cell.getAttribute("readonly"), "")
  await page.getByRole("button", { name: "编辑数据", exact: true }).click()
  await cell.fill("0.75")
  assert.equal(await cell.inputValue(), "0.75")
  await page.getByRole("button", { name: "reader-import.pdf", exact: true }).click()
  await page.getByRole("button", { name: "归档到论文库", exact: true }).click()
  await page.getByTestId("project-notification").waitFor()
  await page.waitForFunction(() => location.hash === "#/library")
  await page.getByRole("button", { name: /^reader-import/ }).waitFor()
  const imported = await page.evaluate(
    (root) => window.envoi.library(root, { action: "list" }),
    root,
  )
  assert.equal(imported.papers.length, 3)
  await app.evaluate(
    (_, base64) => {
      globalThis.fetch = async () =>
        new Response(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)))
    },
    Buffer.concat([Buffer.from(pdf(), "base64"), Buffer.from("\n% URL fixture\n")]).toString(
      "base64",
    ),
  )
  await page.route("https://api.crossref.org/**", (route) =>
    route.fulfill({ json: { message: { items: [] } } }),
  )
  await page.getByRole("button", { name: "URL / DOI", exact: true }).click()
  await page
    .getByRole("textbox", { name: "PDF URL 或 DOI" })
    .fill("https://papers.example/url-paper.pdf")
  await page.getByRole("button", { name: "导入链接", exact: true }).click()
  await page.getByRole("button", { name: /^url-paper/ }).waitFor()
  const linked = await page.evaluate((root) => window.envoi.library(root, { action: "list" }), root)
  assert.equal(linked.papers.length, 4)

  assert.deepEqual(errors, [])
  console.log(
    "PASS: project library IPC, three panes, independent notes, autosave on switching, reading position, restart and history restore",
  )
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await rm(temp, { recursive: true, force: true, maxRetries: 3 })
}
