import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { realpath, mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
const require = createRequire(import.meta.url),
  temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-save-compile-"))),
  root = path.join(temp, "paper")
await mkdir(root)
await writeFile(
  path.join(root, "main.tex"),
  "\\documentclass{article}\n\\begin{document}Initial\\end{document}",
)
await writeFile(path.join(root, "notes.md"), "Notes")
let app
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function until(test) {
  const deadline = Date.now() + 15000
  while (!(await test())) {
    if (Date.now() > deadline) throw Error("Timed out")
    await pause(50)
  }
}
try {
  await seedFixtureTrust(path.join(temp, "data"), temp)
  app = await _electron.launch({
    executablePath: require("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  await app.evaluate(({ dialog, ipcMain }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
    globalThis.compiles = []
    globalThis.releaseCompile = null
    ipcMain.removeHandler("envoi:compiler-runtime")
    ipcMain.handle("envoi:compiler-runtime", () => ({ available: true }))
    ipcMain.removeHandler("envoi:compile")
    ipcMain.handle("envoi:compile", async (_event, input) => {
      const fs = process.getBuiltinModule("fs")
      globalThis.compiles.push({
        drafts: input.drafts,
        text: fs.readFileSync(input.rootPath + "/main.tex", "utf8"),
      })
      await new Promise((resolve) => {
        globalThis.releaseCompile = resolve
      })
      globalThis.releaseCompile = null
      return { ok: false, error: "Controlled compiler fixture", log: "Controlled completion" }
    })
  })
  const page = await app.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    root,
  )
  await page.getByRole("button", { name: "main.tex", exact: true }).waitFor()
  await page.evaluate(() => (location.hash = "/writer"))
  const editor = page.getByRole("textbox", { name: "LaTeX 正文编辑器", exact: true })
  await editor.fill("Saved before compile")
  const chord = process.platform === "darwin" ? "Meta+s" : "Control+s"
  await editor.press(chord)
  await until(() => app.evaluate(() => globalThis.compiles.length === 1)).catch(async (error) => {
    console.log(
      await page.evaluate(
        async () => (await window.envoi.dataGet("session", "current"))?.value?.compileLog,
      ),
    )
    throw error
  })
  const first = await app.evaluate(() => globalThis.compiles[0])
  assert.equal(first.text, "Saved before compile")
  assert.deepEqual(first.drafts, [])
  await editor.press(chord)
  await editor.press(chord)
  await editor.press(chord)
  assert.equal(await app.evaluate(() => globalThis.compiles.length), 1)
  await app.evaluate(() => globalThis.releaseCompile())
  await until(() => app.evaluate(() => globalThis.compiles.length === 2))
  await app.evaluate(() => globalThis.releaseCompile())
  await pause(500)
  assert.equal(await app.evaluate(() => globalThis.compiles.length), 2)
  await editor.press(chord)
  await until(() => app.evaluate(() => globalThis.compiles.length === 3))
  await app.evaluate(() => globalThis.releaseCompile())
  await pause(500)
  await page.getByRole("combobox", { name: "当前 LaTeX 文件" }).selectOption("notes.md")
  await editor.fill("Saved note")
  await editor.press(chord)
  await until(async () => (await readFile(path.join(root, "notes.md"), "utf8")) === "Saved note")
  assert.equal(await app.evaluate(() => globalThis.compiles.length), 3)
  await page.evaluate(() => (location.hash = "/reader"))
  await page.keyboard.press(chord)
  await pause(200)
  assert.equal(await app.evaluate(() => globalThis.compiles.length), 3)
  await page.evaluate(() => (location.hash = "/writer"))
  await page.getByRole("combobox", { name: "当前 LaTeX 文件" }).selectOption("main.tex")
  await editor.fill("Must not compile")
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:fs-save")
    ipcMain.handle("envoi:fs-save", () => {
      throw Error("Save conflict fixture")
    })
  })
  await editor.press(chord)
  await page.getByTestId("project-notification").waitFor()
  await pause(200)
  assert.equal(await app.evaluate(() => globalThis.compiles.length), 3)
  console.log(
    "PASS Ctrl+S: save before compile, unchanged recompile, one queued run, non-LaTeX/reader save only, failed save blocks compile",
  )
} finally {
  await app?.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app?.close().catch(() => {})
  await rm(temp, { recursive: true, force: true, maxRetries: 3 })
}
