import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import { seedFixtureTrust } from "./fixture-trust.mjs"

const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-file-actions-ui-")))
const root = path.join(temp, "first"),
  other = path.join(temp, "second")
let app
async function until(check) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return
    await delay(100)
  }
  throw Error("File action did not settle")
}
try {
  await mkdir(path.join(root, "folder"), { recursive: true })
  await mkdir(other)
  await writeFile(path.join(root, "a.txt"), "original")
  await writeFile(path.join(root, "b.txt"), "keep destination")
  await writeFile(path.join(root, "folder", "child.txt"), "child")
  await writeFile(path.join(other, "second.txt"), "second")
  await seedFixtureTrust(path.join(temp, "data"), temp)
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByTestId("welcome-page").waitFor()
  const open = async (root) =>
    page.evaluate(
      (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
      root,
    )
  await open(root)
  await page.getByRole("button", { name: "a.txt", exact: true }).click()
  const editor = page.getByRole("textbox", { name: "文本源码编辑器" })
  await editor.fill("unsaved renamed draft")
  await page.getByRole("button", { name: "a.txt", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "重命名", exact: true }).click()
  await page.getByRole("dialog").getByRole("textbox").fill("renamed.txt")
  await page.getByRole("dialog").getByRole("textbox").press("Enter")
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await until(async () => (await editor.textContent()) === "unsaved renamed draft")
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:save")))
  await until(
    async () =>
      (await readFile(path.join(root, "renamed.txt"), "utf8")) === "unsaved renamed draft",
  )
  await assert.rejects(access(path.join(root, "a.txt")), { code: "ENOENT" })
  const collision = await page.evaluate(async (root) => {
    try {
      await window.envoi.fsRename(root, "renamed.txt", "b.txt")
      return "overwritten"
    } catch (error) {
      return error.message
    }
  }, root)
  assert.match(collision, /目标已存在/)
  assert.equal(await readFile(path.join(root, "b.txt"), "utf8"), "keep destination")

  await page.getByRole("button", { name: "child.txt", exact: true }).click()
  await editor.fill("discard deleted draft")
  await page.getByRole("button", { name: "folder", exact: true }).click({ button: "right" })
  await page.getByRole("menuitem", { name: "删除", exact: true }).click()
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click()
  await page.getByRole("dialog").waitFor({ state: "hidden" })
  await assert.rejects(access(path.join(root, "folder")), { code: "ENOENT" })
  await until(
    async () => (await page.getByRole("button", { name: "child.txt", exact: true }).count()) === 0,
  )

  async function discardAndOpen(target) {
    await app.evaluate(({ dialog }, target) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
    }, target)
    await page.evaluate(() => window.dispatchEvent(new Event("envoi:open-project")))
    const dialog = page.getByRole("dialog")
    await dialog.getByRole("button", { name: "选择文件夹…", exact: true }).click()
    await dialog.getByRole("checkbox", { name: "切换时放弃未保存修改" }).check()
    await dialog.getByRole("button", { name: "打开当前目录", exact: true }).click()
    await dialog.waitFor({ state: "hidden" })
  }
  await page.getByRole("button", { name: "renamed.txt", exact: true }).click()
  await editor.fill("must not return")
  await discardAndOpen(other)
  await page.getByRole("button", { name: "second.txt", exact: true }).waitFor()
  await open(root)
  await page.getByRole("button", { name: "renamed.txt", exact: true }).click()
  await until(async () => (await editor.textContent()) === "unsaved renamed draft")
  await editor.fill("discard even when reopening same project")
  await discardAndOpen(root)
  await until(async () => (await editor.textContent()) === "unsaved renamed draft")
  assert.deepEqual(errors, [])
  console.log(
    "PASS file actions: dirty rename and save, collision preservation, folder deletion, discarded drafts across and within projects",
  )
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.on("will-prevent-unload", (event) => event.preventDefault())
    })
    .catch(() => {})
  await app?.close()
  await rm(temp, { recursive: true, force: true })
}
