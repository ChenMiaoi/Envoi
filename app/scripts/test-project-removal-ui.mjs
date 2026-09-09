import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
const require = createRequire(import.meta.url),
  temp = await mkdtemp(path.join(tmpdir(), "envoi-remove-ui-")),
  root = path.join(temp, "paper"),
  other = path.join(temp, "other")
await mkdir(root)
await mkdir(other)
await writeFile(path.join(root, "main.tex"), "Original")
await writeFile(path.join(other, "main.tex"), "Other")
await seedFixtureTrust(path.join(temp, "data"), temp)

const app = await _electron.launch({
  executablePath: require("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
})
try {
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 0 })
  })
  const page = await app.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  const open = async () => {
    await page.evaluate(
      (p) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: p })),
      root,
    )
    await page.getByRole("button", { name: "main.tex", exact: true }).waitFor()
    await page.evaluate(() => (location.hash = "/writer"))
  }
  await open()
  const editor = page.locator('textarea[aria-label="LaTeX 正文编辑器"]')
  await editor.fill("Saved draft")
  await page.evaluate(async (other) => {
    const records = await window.envoi.dataGet("recent")
    await window.envoi.dataPut("recent", [
      ...records.value,
      { id: "other", name: "other", path: other, updated: Date.now() },
    ])
    window.dispatchEvent(new Event("envoi:manage-projects"))
  }, other)
  await page.getByRole("button", { name: "移除记录", exact: true }).click()
  await page.getByText("已移除最近项目记录。", { exact: true }).waitFor()
  assert.equal(await editor.inputValue(), "Saved draft")
  assert.equal(await readFile(path.join(other, "main.tex"), "utf8"), "Other")
  await page.getByRole("button", { name: "移除并关闭", exact: true }).click()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  assert.equal(await editor.inputValue(), "Saved draft")
  await page.getByRole("button", { name: "移除并关闭", exact: true }).click()
  await writeFile(path.join(root, "main.tex"), "External change")
  await page.getByRole("button", { name: "保存并移除", exact: true }).click()
  await page.getByRole("button", { name: "保存并移除", exact: true }).waitFor()
  await page.waitForFunction(() =>
    [...document.querySelectorAll("button")].some(
      (b) => b.textContent === "保存并移除" && !b.disabled,
    ),
  )
  assert.equal(await editor.inputValue(), "Saved draft")
  assert.equal((await page.evaluate(() => window.envoi.dataGet("recent"))).value.length, 1)
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "External change")
  await writeFile(path.join(root, "main.tex"), "Original")
  await page.getByRole("button", { name: "保存并移除", exact: true }).click()
  await page.getByTestId("welcome-page").waitFor()
  assert.equal(await readFile(path.join(root, "main.tex"), "utf8"), "Saved draft")
  await page.waitForFunction(
    async () => (await window.envoi.dataGet("recent"))?.value?.length === 0,
  )
  await open()
  assert.equal(await editor.inputValue(), "Saved draft")
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:manage-projects")))
  await page.getByRole("button", { name: "移除并关闭", exact: true }).click()
  await page.getByTestId("welcome-page").waitFor()
  // Exercise the native deletion path without using the real OS trash.
  await open()
  await app.evaluate(async ({ shell }) => {
    const { rename } = process.getBuiltinModule("fs/promises")
    shell.trashItem = (directory) => rename(directory, directory + "-trashed")
  })
  await page.evaluate(
    async ({ root, other }) => {
      await window.envoi.fsTrashProject(root, "paper")
      const runtime = await window.envoi.gitRuntime()
      if (!runtime.available) throw Error(runtime.error)
      await window.envoi.trustDirectory(other)
      await window.envoi.gitInit(other)
    },
    { root, other },
  )
  assert.match(await readFile(path.join(other, ".git/HEAD"), "utf8"), /refs\/heads\/main/)
  console.log(
    "PASS removal: other entry preserves active draft; cancel; save failure retains record; save-and-remove; clean removal",
  )
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
