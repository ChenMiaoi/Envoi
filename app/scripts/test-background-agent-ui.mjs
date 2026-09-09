import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-background-")))
const roots = [path.join(temp, "experiment"), path.join(temp, "main")]
for (const root of roots) {
  await mkdir(root)
  await writeFile(path.join(root, "main.tex"), root.endsWith("main") ? "Main" : "Experiment")
}
await seedFixtureTrust(path.join(temp, "data"), temp)
const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
})
try {
  await app.evaluate(({ ipcMain, dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    const settings = {
      provider: "fixture",
      model: "fixture/model",
      context: "current",
      tools: "write",
    }
    const records = new Map()
    globalThis.backgroundFixture = { aborts: 0 }
    ipcMain.removeHandler("envoi:agent-status")
    ipcMain.handle("envoi:agent-status", () => ({
      available: true,
      runtime: true,
      settings,
      providers: [{ id: "fixture", name: "Fixture", auth: { configured: true } }],
      models: [
        { id: "model", provider: "fixture", name: "Model", available: true, thinkingLevels: [] },
      ],
      storage: {},
    }))
    ipcMain.removeHandler("envoi:agent-request")
    ipcMain.handle("envoi:agent-request", (_event, route, body) => {
      if (route === "sessions")
        return {
          sessions: records.has(body.projectId) ? [records.get(body.projectId)] : [],
          settings,
        }
      if (route === "session") return records.get(body.projectId)
      if (route === "abort") {
        globalThis.backgroundFixture.aborts++
        return {}
      }
      throw Error(route)
    })
    ipcMain.removeHandler("envoi:agent-chat")
    ipcMain.handle("envoi:agent-chat", (event, body) => {
      const send = (data) =>
        event.sender.send("envoi:agent-event", { projectId: body.projectId, ...data })
      records.set(body.projectId, {
        id: "fixture-session",
        name: "Experiment task",
        status: "running",
        messages: [],
      })
      send({ type: "session", id: "fixture-session" })
      send({ type: "tool", phase: "start", name: "bash", id: "call-1" })
      globalThis.backgroundFixture.finish = () => {
        const record = records.get(body.projectId)
        record.status = "complete"
        record.messages = [{ id: "answer", role: "assistant", text: "Experiment complete" }]
        send({ type: "delta", text: "Experiment complete" })
        send({ type: "done" })
      }
      return { ok: true }
    })
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.getByTestId("welcome-page").waitFor()
  const open = async (root) => {
    await page.evaluate(
      (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
      root,
    )
    await page.waitForFunction(
      async (root) => (await window.envoi.dataGet("session", "current"))?.value?.rootPath === root,
      root,
    )
    await page
      .getByRole("button", { name: path.basename(root), exact: true })
      .first()
      .waitFor()
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    )
    await page.evaluate(() => (location.hash = "/writer"))
    await page.getByRole("textbox", { name: "LaTeX 正文编辑器" }).waitFor()
  }
  await open(roots[0])
  const input = page.getByRole("textbox", { name: "询问科研助手" })
  await input.fill("Run the bounded experiment")
  await page.getByRole("button", { name: "发送", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "LaTeX 正文编辑器" })
  await page.waitForFunction(
    () => document.querySelector('[aria-label="LaTeX 正文编辑器"]').readOnly,
  )
  await page.getByText("开始执行 · bash", { exact: true }).filter({ visible: true }).waitFor()
  await open(roots[1])
  await page.waitForFunction(
    () => document.querySelector('[aria-label="LaTeX 正文编辑器"]')?.readOnly === false,
  )
  assert.equal(await editor.getAttribute("readonly"), null)
  await editor.fill("Main notes while experiment runs")
  assert.equal(await app.evaluate(() => globalThis.backgroundFixture.aborts), 0)
  await page.getByText(/后台任务：/).waitFor()
  await app.evaluate(() => globalThis.backgroundFixture.finish())
  await page.getByText(/后台任务：/).waitFor({ state: "hidden" })
  assert.equal(await editor.inputValue(), "Main notes while experiment runs")
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:save")))
  await page.waitForFunction(
    async (root) =>
      (await window.envoi.fsRead(root, "main.tex")).text === "Main notes while experiment runs",
    roots[1],
  )
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
  await open(roots[0])
  await page.getByText("Experiment complete", { exact: true }).filter({ visible: true }).waitFor()
  assert.equal(await editor.inputValue(), "Experiment")
  console.log(
    "PASS background agent: switching preserves task, isolated edits, completion and session",
  )
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
