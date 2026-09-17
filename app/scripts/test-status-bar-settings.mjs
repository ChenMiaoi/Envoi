import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-status-settings-")))
let app
try {
  await seedFixtureTrust(path.join(temp, "data"), temp)
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  const page = await app.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await page.getByRole("button", { name: /打开示例项目/ }).click()
  await page.getByRole("button", { name: "main.tex", exact: true }).waitFor()
  const route = await page.evaluate(() => location.hash)

  const compiler = page.getByRole("button", { name: "pdfLaTeX UTF-8" })
  await compiler.click()
  const popover = page.locator('[data-slot="popover-content"]')
  await popover.getByRole("button", { name: "XeLaTeX" }).click()
  await page.getByRole("button", { name: "XeLaTeX UTF-8" }).waitFor()
  assert.equal(await page.evaluate(() => location.hash), route)

  await app.evaluate(({ ipcMain }) => {
    const settings = { provider: "fixture", model: null, context: "current", tools: "read" }
    ipcMain.removeHandler("envoi:agent-status")
    ipcMain.handle("envoi:agent-status", () => ({
      available: true,
      runtime: true,
      providers: [{ id: "fixture", name: "Fixture", auth: { configured: true } }],
      models: [
        {
          id: "demo",
          provider: "fixture",
          name: "Fixture model",
          available: true,
          thinkingLevels: [],
        },
      ],
      settings,
      storage: {},
    }))
    ipcMain.removeHandler("envoi:agent-request")
    ipcMain.handle("envoi:agent-request", (_event, action) => {
      if (action === "sessions") return { sessions: [], settings }
      throw Error(`Unexpected AI action: ${action}`)
    })
  })
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:ai-configured")))
  await page.locator('button[title="AI 服务"]').click()
  await popover.getByRole("button", { name: "fixture / Fixture model" }).click()
  const root = (await page.evaluate(() => window.envoi.dataGet("recent"))).value[0].path
  await page.waitForFunction(
    async (root) =>
      (await window.envoi.fsRead(root, ".envoi/project.json")).text.includes("fixture/demo"),
    root,
  )
  assert.equal(await page.evaluate(() => location.hash), route)

  await writeFile(path.join(root, "hello.py"), "value = 1\n")
  await page.getByRole("button", { name: "hello.py", exact: true }).click()
  await page.getByRole("textbox", { name: "文本源码编辑器" }).waitFor()
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:tools")
    ipcMain.handle("envoi:tools", () => ({
      groups: {
        python: [
          {
            id: "pylsp",
            label: "python-lsp-server",
            kind: "lsp",
            languages: ["python"],
            available: true,
          },
        ],
      },
    }))
  })
  await page.locator('button[title="本机工具 · 高级"]').click()
  await popover.getByText("LSP · python", { exact: true }).waitFor()
  await popover.getByRole("button", { name: "恢复自动探测" }).waitFor()
  if (process.env.ENVOI_STATUS_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_STATUS_SCREENSHOT })
  await popover.getByRole("button", { name: "python-lsp-server" }).click()
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("envoi.preferences.v1") ?? "{}").lspServers?.python ===
      "pylsp",
  )
  assert.equal(await page.evaluate(() => location.hash), route)
  console.log("PASS status bar AI, LSP and engine controls open in place; choices persist")
} finally {
  if (app) await app.close()
  await rm(temp, { recursive: true, force: true })
}
