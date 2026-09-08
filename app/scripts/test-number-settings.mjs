import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const temp = await mkdtemp(path.join(tmpdir(), "envoi-numbers-"))
let app
async function launch() {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  const page = await app.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(() => {
    location.hash = "/settings/global/general"
  })
  return page
}
async function stop() {
  await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await app.close().catch(() => {})
}
try {
  let page = await launch()
  const size = page.getByRole("spinbutton", { name: "界面字号", exact: true })
  await size.waitFor()
  if (process.env.ENVOI_NUMBER_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_NUMBER_SCREENSHOT })
  await size.fill("")
  assert.equal(await size.inputValue(), "")
  await size.fill("17")
  await size.press("Enter")
  await page.waitForFunction(
    () => document.documentElement.style.getPropertyValue("--ui-font-size") === "17px",
  )
  await page.getByRole("button", { name: "增大界面字号", exact: true }).click()
  assert.equal(await size.inputValue(), "18")
  await size.fill("999")
  await size.press("Tab")
  assert.equal(await size.inputValue(), "24")
  await size.fill("invalid")
  await size.press("Enter")
  assert.equal(await size.inputValue(), "24")
  await page.getByRole("button", { name: "恢复界面字号默认值", exact: true }).click()
  assert.equal(await size.inputValue(), "13")
  const preview = page.getByRole("spinbutton", { name: "预览行高", exact: true })
  await preview.fill("2.35")
  await preview.press("Enter")
  await page.evaluate(() => {
    location.hash = "/settings/global/editor"
  })
  const editor = page.getByRole("spinbutton", { name: "编辑器字号", exact: true })
  await editor.fill("15.5")
  await editor.press("Enter")
  await editor.press("ArrowUp")
  assert.equal(await editor.inputValue(), "16")
  await page.waitForFunction(
    () => JSON.parse(localStorage.getItem("envoi.preferences.v1")).fontSize === 16,
  )
  await stop()
  page = await launch()
  assert.equal(
    await page.getByRole("spinbutton", { name: "预览行高", exact: true }).inputValue(),
    "2.35",
  )
  console.log(
    "PASS: numeric settings accept custom values, empty drafts, bounds, reset, keyboard stepping and persistence",
  )
} finally {
  if (app) await stop()
  await rm(temp, { recursive: true, force: true })
}
