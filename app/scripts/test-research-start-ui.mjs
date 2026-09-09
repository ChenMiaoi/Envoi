import { seedFixtureTrust } from "./fixture-trust.mjs"
import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, realpath, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-research-start-")))
await seedFixtureTrust(path.join(temp, "data"), temp)
const app = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
})
try {
  await app.evaluate(({ dialog }, temp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [temp] })
    dialog.showMessageBox = async () => ({ response: 0 })
  }, temp)
  const page = await app.firstWindow()
  page.setDefaultTimeout(15000)
  await page.getByTestId("welcome-page").waitFor()
  await page.getByRole("button", { name: /新建项目/ }).click()
  await page.getByRole("button", { name: "选择文件夹…", exact: true }).click()
  await page.getByPlaceholder("my-research-paper").fill("idea-lab")
  await page.getByRole("button", { name: "创建项目", exact: true }).click()
  await page.getByRole("button", { name: "research-plan.md", exact: true }).waitFor()
  const root = path.join(temp, "idea-lab")
  assert.match(await readFile(path.join(root, "notes/research-plan.md"), "utf8"), /问题与假设/)
  await assert.rejects(readFile(path.join(root, "main.tex")), { code: "ENOENT" })
  assert.match(await readFile(path.join(root, "papers/README.md"), "utf8"), /论文目录/)
  await page.getByRole("button", { name: "新建笔记", exact: true }).click()
  await page.getByRole("button", { name: "创建文件", exact: true }).click()
  await page.getByRole("button", { name: "note-1.md", exact: true }).waitFor()
  assert.equal(await readFile(path.join(root, "notes/note-1.md"), "utf8"), "")
  console.log("PASS research start: idea-first project and visible note creation")
} finally {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
