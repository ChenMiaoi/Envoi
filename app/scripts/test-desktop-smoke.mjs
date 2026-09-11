import { createRequire } from "node:module"
import { realpath, mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
async function waitForAsync(page, predicate, arg) {
  const deadline = Date.now() + 60000
  while (!(await page.evaluate(predicate, arg))) {
    if (Date.now() > deadline) throw Error("Async desktop condition timed out")
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const require = createRequire(import.meta.url)
const { _electron } = require(process.env.ENVOI_PLAYWRIGHT ?? "playwright")
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-desktop-smoke-")))
const root = path.join(temp, "paper with spaces")
await mkdir(root)
await writeFile(path.join(root, "trusted-extra.tex"), "Local project input")
await writeFile(
  path.join(root, "main.tex"),
  "\\documentclass{article}\n\\begin{document}Desktop test\\end{document}",
)
let instance
try {
  instance = await _electron.launch({
    executablePath: process.env.ENVOI_DESKTOP_EXECUTABLE ?? require("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })

  let prompts = 0
  await instance.evaluate(({ dialog }) => {
    globalThis.trustPrompts = 0
    dialog.showMessageBox = async () => {
      globalThis.trustPrompts++
      return { response: 0, checkboxChecked: false }
    }
  })
  const page = await instance.firstWindow()
  const errors = []
  page.on("pageerror", (e) => errors.push(e.message))
  await page.waitForFunction(() => !!window.envoi)
  await page.getByTestId("welcome-page").waitFor()
  if (process.platform === "darwin") {
    const chrome = await instance.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      return {
        buttons: window.getWindowButtonPosition(),
        bounds: window.getBounds(),
        content: window.getContentBounds(),
      }
    })
    assert.deepEqual(chrome.buttons, { x: 16, y: 14 })
    assert.equal(
      chrome.content.height,
      chrome.bounds.height,
      "content extends into the native titlebar",
    )
    assert.equal(
      await page
        .locator(".window-drag")
        .evaluate((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region")),
      "drag",
    )
  }

  await page.getByTestId("welcome-page").waitFor()
  assert.equal(
    await page.getByTestId("welcome-page").getByRole("heading", { name: "Envoi." }).count(),
    1,
  )
  if (process.env.ENVOI_WELCOME_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_WELCOME_SCREENSHOT })
  await page.setViewportSize({ width: 760, height: 600 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole("button", { name: /新建项目/ }).click()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await page.getByRole("link", { name: "快捷键", exact: true }).click()
  await page.waitForFunction(() => location.hash.includes("/settings/global/shortcuts"))
  await page.evaluate(() => {
    location.hash = "/writer"
  })
  await page.getByTestId("welcome-page").waitFor()
  console.log(
    "loaded",
    await page.title(),
    await page
      .locator("body")
      .innerText()
      .then((t) => t.slice(0, 120)),
  )
  await instance.evaluate(({ dialog }, root) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, root)
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:open-project")))
  await page.getByRole("button", { name: "选择文件夹…", exact: true }).click()
  await page.getByRole("button", { name: "打开当前目录", exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes("main.tex"))
  await page.getByRole("button", { name: "信任项目", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await page.evaluate(async (temp) => {
    await window.envoi.trustDirectory(temp)
    await window.envoi.grantProjectTrust(temp)
  }, temp)
  const result = await page.evaluate(async (root) => {
    const bridge = window.envoi
    const binding = await bridge.bindProject(root)
    await bridge.bindProject(root)
    await bridge.fsWrite(root, "nested/deep/test.txt", { text: "hello" })
    const read = await bridge.fsRead(root, "nested/deep/test.txt")
    await bridge.gitInit(root)
    const git = await bridge.gitStatus(root)
    const sessions = await bridge.agentRequest("sessions", { projectId: binding.project.id })
    const runtime = await bridge.compilerRuntime()
    let compile
    if (runtime.available)
      compile = await bridge.compile({
        rootPath: root,
        main: "main.tex",
        engine: "pdflatex",
        files: [
          {
            path: "main.tex",
            base64: btoa(
              "\\documentclass{article}\\begin{document}Desktop test\\input{" +
                root.replace(/\\/g, "/") +
                '/trusted-extra.tex}\\immediate\\write18{echo trusted > "' +
                root.replace(/\\/g, "/") +
                '/trusted-tool.txt"}\\end{document}',
            ),
          },
        ],
      })
    let asset
    if (compile?.ok) {
      await bridge.fsWrite(root, "build/main.pdf", { base64: compile.pdf })
      const response = await fetch(await bridge.assetUrl(root, "build/main.pdf"))
      asset = {
        status: response.status,
        header: new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5)),
      }
    }
    return { binding, read, git, sessions, runtime, compile, asset }
  }, root)
  assert.equal(result.read.text, "hello")
  assert.equal(result.git.state, "ready")
  assert.equal(result.sessions.settings.tools, "write")
  if (result.runtime.available) {
    assert.equal(result.compile.ok, true, result.compile.log)
    assert.deepEqual(result.asset, { status: 200, header: "%PDF-" })
    assert.equal((await readFile(path.join(root, "trusted-tool.txt"), "utf8")).trim(), "trusted")
  }
  // Real external edits must reach the renderer without reopening the directory.
  await writeFile(path.join(root, "external-note.txt"), "external content")
  await page.waitForFunction(() => document.body.innerText.includes("external-note.txt"))
  const conflict = await page.evaluate(
    (root) =>
      window.envoi.fsSave(root, [
        { path: "external-note.txt", text: "draft", expectedText: "stale" },
      ]),
    root,
  )
  assert.equal(conflict.saved.length, 0)
  assert.match(conflict.error, /外部修改/)
  assert.equal(await readFile(path.join(root, "external-note.txt"), "utf8"), "external content")
  if (result.runtime.available) {
    const native = await page.evaluate(
      (root) =>
        window.envoi.compile({
          rootPath: root,
          main: "main.tex",
          engine: "pdflatex",
          drafts: [
            {
              path: "main.tex",
              text: "\\documentclass{article}\\begin{document}Unsaved native draft\\end{document}",
            },
          ],
        }),
      root,
    )
    assert.equal(native.ok, true, native.log)
    assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /Desktop test/)
  }
  if (result.runtime.available) {
    await page.evaluate((root) => {
      window.cancelledCompile = window.envoi.compile({
        rootPath: root,
        main: "main.tex",
        engine: "pdflatex",
        drafts: [
          {
            path: "main.tex",
            text:
              '\\documentclass{article}\\begin{document}\\immediate\\write18{echo started > "' +
              root.replace(/\\/g, "/") +
              '/cancel-started.txt"' +
              (navigator.platform.startsWith("Win")
                ? " & ping -n 30 127.0.0.1 > nul"
                : "; sleep 30") +
              "}Cancel test\\end{document}",
          },
        ],
      })
    }, root)
    await waitForAsync(
      page,
      async (root) => {
        try {
          return (await window.envoi.fsRead(root, "cancel-started.txt")).text?.includes("started")
        } catch {
          return false
        }
      },
      root,
    )
    await page.evaluate(() => window.envoi.cancelCompile())
    const cancelled = await page.evaluate(() => window.cancelledCompile)
    assert.equal(cancelled.ok, false)
    assert.match(cancelled.error, /取消/)
    console.log("PASS: cancellation interrupts running local compiler commands")
  }
  const toolsPid = await instance.evaluate(
    ({ app }) =>
      app
        .getAppMetrics()
        .find((item) => item.name === "Envoi Tools" || item.serviceName === "Envoi Tools")?.pid,
  )
  assert.ok(toolsPid, "Git runs in a dedicated utility process")
  await instance.evaluate((_electron, pid) => process.kill(pid, "SIGKILL"), toolsPid)
  await waitForAsync(page, async () => {
    try {
      return (await window.envoi.gitRuntime()).available
    } catch {
      return false
    }
  })
  console.log("PASS: backend process isolation and restart after forced exit")
  console.log("PASS: filesystem watch, backend save conflict, native draft compilation")
  prompts = await instance.evaluate(() => globalThis.trustPrompts)
  assert.equal(prompts, 0)
  await page.reload()
  await page.waitForFunction(() => location.hash === "#/reader")
  await page.getByRole("button", { name: /项目：/ }).waitFor()
  await page.evaluate(() => (location.hash = "/writer"))
  if (result.runtime.available) await page.locator("canvas").first().waitFor({ timeout: 20000 })
  if (process.env.ENVOI_SMOKE_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_SMOKE_SCREENSHOT })
  assert.deepEqual(errors, [])
  console.log("PASS: first trust, repeat binding, nested writes, Git, AI access, compiler", {
    prompts,
    compiled: result.compile?.ok,
  })
  await instance.close()
  instance = null
  instance = await _electron.launch({
    executablePath: process.env.ENVOI_DESKTOP_EXECUTABLE ?? require("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  await instance.evaluate(({ dialog }) => {
    globalThis.trustPrompts = 0
    dialog.showMessageBox = async () => {
      globalThis.trustPrompts++
      return { response: 1 }
    }
  })
  const reopened = await instance.firstWindow()
  await reopened.waitForFunction(() => !!window.envoi)
  await reopened.waitForFunction(() => location.hash === "#/reader")
  await reopened.evaluate(() => (location.hash = "/writer"))
  await reopened.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true }).waitFor()
  await reopened.evaluate((root) => window.envoi.bindProject(root), root)
  assert.equal(await instance.evaluate(() => globalThis.trustPrompts), 0)
  console.log("PASS: persisted trust across restart")
  await reopened.waitForFunction(() => document.body.innerText.includes("main.tex"))
  const editor = reopened.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true })
  await editor.fill("Unsaved text to discard")
  await reopened.evaluate(() => {
    location.hash = "/settings/global/general"
  })
  await reopened.waitForFunction(() => location.hash.includes("/settings/global/general"))
  await reopened.evaluate(() => window.dispatchEvent(new Event("envoi:close-project")))
  assert.equal(
    await reopened.getByRole("button", { name: "关闭项目", exact: true }).isEnabled(),
    false,
  )
  await reopened.getByLabel("放弃当前未保存修改").check()
  await reopened.getByRole("button", { name: "关闭项目", exact: true }).click()
  await reopened.waitForFunction(
    () =>
      !!document.querySelector('[data-testid="welcome-page"]') &&
      !document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'),
  )
  await reopened.getByTestId("welcome-page").waitFor()
  await reopened.reload()
  await reopened.waitForFunction(
    () =>
      !!document.querySelector('[data-testid="welcome-page"]') &&
      !document.querySelector('textarea[aria-label="LaTeX 正文编辑器"]'),
  )
  await reopened
    .getByTestId("welcome-page")
    .getByRole("button", { name: /^paper / })
    .click()
  await reopened.waitForFunction(() => document.body.innerText.includes("main.tex"))
  await reopened.evaluate(() => (location.hash = "/writer"))
  assert.equal(
    await editor.inputValue().then((text) => text.includes("Unsaved text to discard")),
    false,
  )
  await editor.fill("Unsaved draft pending removal")
  await reopened.evaluate(() => window.dispatchEvent(new Event("envoi:manage-projects")))
  await reopened.getByRole("button", { name: "移除并关闭", exact: true }).click()
  await reopened.getByRole("button", { name: "取消", exact: true }).click()
  assert.equal(
    await reopened.locator('textarea[aria-label="LaTeX 正文编辑器"]').inputValue(),
    "Unsaved draft pending removal",
  )
  await reopened.getByRole("button", { name: "移除并关闭", exact: true }).click()
  await reopened.getByRole("button", { name: "放弃修改并移除", exact: true }).click()
  await reopened.getByTestId("welcome-page").waitFor()
  await waitForAsync(
    reopened,
    async () => (await window.envoi.dataGet("recent"))?.value?.length === 0,
  )
  const remainingRoots = (await reopened.evaluate(() => window.envoi.dataGet("roots"))).value
  assert(remainingRoots.length > 0)
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /Desktop test/)
  console.log(
    "PASS: cancel preserves draft; discard-and-remove closes current project and preserves files and locations",
  )
  const deleteRoot = path.join(temp, "delete-paper")
  await mkdir(path.join(deleteRoot, "chapters"), { recursive: true })
  await mkdir(path.join(deleteRoot, ".envoi"))
  await writeFile(path.join(deleteRoot, "chapters", "paper.tex"), "Temporary paper")
  await writeFile(
    path.join(deleteRoot, ".envoi", "project.json"),
    JSON.stringify({ main: "chapters/paper.tex" }),
  )
  await instance.evaluate(({ dialog }, root) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
  }, deleteRoot)
  await reopened.evaluate(() => window.dispatchEvent(new Event("envoi:open-project")))
  await reopened.getByRole("button", { name: "选择文件夹…", exact: true }).click()
  await reopened.getByRole("button", { name: "打开当前目录", exact: true }).click()
  await reopened
    .getByRole("button", { name: "项目：delete-paper，打开项目管理", exact: true })
    .click()
  await reopened.getByRole("button", { name: "删除当前项目文件…", exact: true }).click()
  await reopened.getByRole("button", { name: "检查待删除目录", exact: true }).click()
  await reopened
    .getByRole("textbox", { name: "确认删除项目目录名", exact: true })
    .fill("delete-paper")
  await instance.evaluate(
    ({ shell }, destination) => {
      shell.trashItem = async (source) => {
        await process.getBuiltinModule("fs/promises").rename(source, destination)
      }
    },
    path.join(temp, "trash-fixture"),
  )
  await reopened.getByRole("button", { name: "移到回收站", exact: true }).click()
  await reopened.waitForFunction(() => !!document.querySelector('[data-testid="welcome-page"]'))
  await assert.rejects(
    readFile(path.join(deleteRoot, "chapters", "paper.tex")),
    (error) => error.code === "ENOENT",
  )
  assert.equal(
    await readFile(path.join(temp, "trash-fixture", "chapters", "paper.tex"), "utf8"),
    "Temporary paper",
  )
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /Desktop test/)
  console.log("PASS: verified trash operation leaves other project untouched")
  await reopened.getByTestId("welcome-page").waitFor()
  await reopened.evaluate(async (root) => {
    await window.envoi.dataPut("recent", [
      { id: "welcome-recent-test", name: "paper", path: root, updated: Date.now() },
    ])
    window.dispatchEvent(new Event("envoi:recent-updated"))
  }, root)
  await reopened.getByRole("button", { name: "移除最近项目：paper", exact: true }).click()
  await waitForAsync(reopened, async () => !(await window.envoi.dataGet("recent")).value.length)
  assert.match(await readFile(path.join(root, "main.tex"), "utf8"), /Desktop test/)
  console.log("PASS: welcome recent removal preserves project files")
  // The same creation contract applies to development and packaged applications.
  const dataErrors = []
  instance.process().stderr?.on("data", (chunk) => {
    if (String(chunk).includes("envoi:data-put")) dataErrors.push(String(chunk))
  })
  await reopened.getByRole("button", { name: /打开示例项目/ }).click()
  await reopened.getByTestId("welcome-page").waitFor({ state: "hidden" })
  await reopened.waitForFunction(() => location.hash === "#/reader")
  const example = (await reopened.evaluate(() => window.envoi.dataGet("recent"))).value[0].path
  assert.equal(path.dirname(example), path.join(temp, "data", "examples"))
  const history = await reopened.evaluate((root) => window.envoi.gitLog(root), example)
  assert.equal(history.state, "ready")
  assert.equal(history.commits.length, 5)
  assert.equal(
    (await reopened.evaluate((root) => window.envoi.gitStatus(root), example)).files.length,
    0,
  )
  await reopened.evaluate(() => (location.hash = "/history"))
  await reopened.getByRole("button", { name: "提交历史", exact: true }).click()
  if (process.env.ENVOI_DEMO_SCREENSHOT)
    await reopened.screenshot({ path: process.env.ENVOI_DEMO_SCREENSHOT })
  await reopened.evaluate(() => (location.hash = "/writer"))
  const exampleEditor = reopened.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true })
  const original = await exampleEditor.inputValue()
  await exampleEditor.fill(original + "\n% Saved demo edit\n")
  await reopened.evaluate(() => window.dispatchEvent(new Event("envoi:save")))
  await waitForAsync(
    reopened,
    async (root) =>
      (await window.envoi.fsRead(root, "main.tex")).text.includes("% Saved demo edit"),
    example,
  )
  await waitForAsync(reopened, async () => {
    const record = await window.envoi.dataGet("session", "current")
    return record?.value?.files?.some(
      (file) =>
        file.path === "main.tex" &&
        file.saved?.includes("% Saved demo edit") &&
        file.saved === file.text,
    )
  })
  await reopened.evaluate(() => window.dispatchEvent(new Event("envoi:open-example")))
  await waitForAsync(
    reopened,
    async (previous) => {
      const records = (await window.envoi.dataGet("recent"))?.value ?? []
      return records.some((record) => record.path !== previous)
    },
    example,
  )
  const another = (await reopened.evaluate(() => window.envoi.dataGet("recent"))).value.find(
    (record) => record.path !== example,
  ).path
  await reopened
    .getByRole("button", { name: `项目：${path.basename(another)}，打开项目管理`, exact: true })
    .waitFor()
  assert.notEqual(another, example)
  assert.equal(path.dirname(another), path.join(temp, "data", "examples"))
  assert.match(await readFile(path.join(example, "main.tex"), "utf8"), /Saved demo edit/)
  assert.doesNotMatch(await readFile(path.join(another, "main.tex"), "utf8"), /Saved demo edit/)
  await reopened.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    example,
  )
  await reopened
    .getByRole("button", { name: `项目：${path.basename(example)}，打开项目管理`, exact: true })
    .waitFor()
  await reopened.waitForFunction(() => location.hash === "#/reader")
  await reopened.evaluate(() => (location.hash = "/writer"))
  await waitForAsync(reopened, () =>
    document
      .querySelector('textarea[aria-label="LaTeX 正文编辑器"]')
      ?.value.includes("Saved demo edit"),
  )
  assert.deepEqual(dataErrors, [])
  await reopened.getByTestId("project-notification").waitFor({ state: "hidden", timeout: 2000 })
  assert.equal(
    await reopened.getByTestId("project-notification").count(),
    0,
    "successful open/save stays quiet",
  )
  await reopened.evaluate(() =>
    window.dispatchEvent(
      new CustomEvent("envoi:storage-warning", { detail: "Notification expiry fixture" }),
    ),
  )
  await reopened.getByTestId("project-notification").waitFor()
  await reopened.getByTestId("project-notification").waitFor({ state: "hidden", timeout: 10000 })
  console.log(
    "PASS: each example creates a real independent project, visible history, normal editor saves and preserved recent copies",
  )
} finally {
  await instance?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await instance?.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
