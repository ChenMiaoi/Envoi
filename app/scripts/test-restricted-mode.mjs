import { _electron } from "playwright"
import { createRequire } from "node:module"
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  access,
  symlink,
  rm,
  realpath,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
const require = createRequire(import.meta.url),
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-restricted-"))),
  root = path.join(temp, "paper"),
  outside = path.join(temp, "outside")
await mkdir(root)
await mkdir(outside)
await writeFile(path.join(root, "main.tex"), "Original paper")
await writeFile(path.join(root, "README.md"), "# Readable paper")
await writeFile(path.join(outside, "secret.txt"), "outside")
await symlink(outside, path.join(root, "escape"), process.platform === "win32" ? "junction" : "dir")
let app
async function launch() {
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => {
      throw Error("Unexpected native trust prompt")
    }
  })
  return app.firstWindow()
}
async function stop() {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
try {
  let page = await launch()
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    root,
  )
  await page.getByRole("button", { name: "main.tex", exact: true, includeHidden: true }).waitFor()
  const dialog = page.getByRole("dialog")
  await dialog.getByRole("heading", { name: "项目安全模式", exact: true }).waitFor()
  assert.equal(
    await page.getByRole("button", { name: "README.md", exact: true, includeHidden: true }).count(),
    1,
  )
  if (process.env.ENVOI_TRUST_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_TRUST_SCREENSHOT })
  await assert.rejects(access(path.join(root, ".envoi", "project.json")))
  const denied = await page.evaluate(async (root) => {
    const api = window.envoi,
      binding = await api.bindProject(root, { copy: false })
    const calls = [
      () => api.gitStatus(root),
      () => api.compile({ rootPath: root, main: "main.tex", engine: "pdflatex", drafts: [] }),
      () => api.lint({ rootPath: root, path: "main.tex", text: "test" }),
      () => api.workspaces(root, { action: "list" }),
      () => api.agentRequest("sessions", { projectId: binding.project.id }),
      () => api.fsRead(root, "escape/secret.txt"),
      () => api.fsWrite(root, "escape/secret.txt", { text: "bad" }),
      () => api.fsSave(root, [{ path: "escape/secret.txt", text: "bad", expectedText: "outside" }]),
      () => api.compilerRuntime(),
      () => api.gitRuntime(),
    ]
    return Promise.all(
      calls.map(async (call) => {
        try {
          await call()
          return "ALLOWED"
        } catch (e) {
          return String(e)
        }
      }),
    )
  }, root)
  assert(
    denied.every((message) => message.includes("限制模式")),
    JSON.stringify(denied),
  )
  await dialog.locator('[data-slot="dialog-close"]').click()
  await dialog.waitFor({ state: "hidden" })
  assert.deepEqual(await page.evaluate((root) => window.envoi.projectTrust(root), root), {
    trusted: false,
    decided: true,
  })
  await page.evaluate(() => (location.hash = "/writer"))
  const editor = page.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true })
  await editor.fill("Manual edit")
  await editor.press("Control+s")
  await page.waitForFunction(
    async (root) => (await window.envoi.fsRead(root, "main.tex")).text === "Manual edit",
    root,
  )
  assert.equal(await readFile(path.join(outside, "secret.txt"), "utf8"), "outside")
  await page.getByRole("button", { name: "限制模式", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "信任项目", exact: true }).click()
  await page.waitForFunction(
    async (root) => (await window.envoi.projectTrust(root)).trusted === true,
    root,
  )
  await page.getByRole("button", { name: "信任模式", exact: true }).waitFor()
  const trusted = await page.evaluate(async (root) => {
    await window.envoi.gitInit(root)
    return window.envoi.gitStatus(root)
  }, root)
  assert.equal(trusted.state, "ready")
  await page.getByRole("button", { name: "信任模式", exact: true }).click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "以限制模式继续", exact: true })
    .click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await assert.rejects(
    page.evaluate((root) => window.envoi.gitStatus(root), root),
    /限制模式/,
  )
  await stop()
  page = await launch()
  await page.getByRole("button", { name: "限制模式", exact: true }).waitFor()
  assert.equal(await page.getByRole("dialog").count(), 0)
  await page.evaluate(() => (location.hash = "/writer"))
  await page.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true }).waitFor()
  await page.waitForFunction(
    async (root) => (await window.envoi.fsRead(root, "main.tex")).text === "Manual edit",
    root,
  )
  assert.equal(
    (await page.evaluate((root) => window.envoi.fsRead(root, "main.tex"), root)).text,
    "Manual edit",
  )
  const created = path.join(temp, "new-paper")
  await mkdir(path.join(created, ".envoi"), { recursive: true })
  await writeFile(path.join(created, "main.tex"), "New paper")
  await writeFile(
    path.join(created, ".envoi", "project.json"),
    JSON.stringify({ main: "main.tex", git: { requested: true, status: "pending-local-init" } }),
  )
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    created,
  )
  await page.waitForFunction(
    async (root) => (await window.envoi.dataGet("session", "current"))?.value?.rootPath === root,
    created,
  )
  await page.getByRole("dialog").getByRole("button", { name: "信任项目", exact: true }).click()
  await page.waitForFunction(async (root) => {
    try {
      return (await window.envoi.gitStatus(root)).state === "ready"
    } catch {
      return false
    }
  }, created)
  console.log("PASS: deferred Git initialization runs only after trusting the new project")
  console.log(
    "PASS restricted mode: opens without native prompt, reads/saves, blocks execution and symlink escape, upgrades, revokes and persists across restart",
  )
} finally {
  if (app) await stop()
  await rm(temp, { recursive: true, force: true })
}
