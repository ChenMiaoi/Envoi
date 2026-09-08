import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const temp = await mkdtemp(path.join(tmpdir(), "envoi-fonts-"))
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
  await page.getByRole("button", { name: "界面字体", exact: true }).click()
  const dialog = page.getByRole("dialog")
  await page.waitForFunction(() => document.querySelectorAll("[cmdk-item]").length > 3)
  if (process.env.ENVOI_FONT_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_FONT_SCREENSHOT })
  const families = await page.evaluate(async () => [
    ...new Set((await window.queryLocalFonts()).map((font) => font.family)),
  ])
  assert(families.length > 3)
  const chosen = families.find((font) => font === "Consolas") ?? families[0]
  await dialog.getByRole("combobox").fill(chosen)
  await dialog.getByRole("option", { name: chosen, exact: true }).click()
  await page.waitForFunction(
    (font) => document.documentElement.style.getPropertyValue("--ui-font").includes(font),
    chosen,
  )
  await page.getByRole("button", { name: "界面字体", exact: true }).click()
  await dialog.getByRole("combobox").fill("no-such-font-xyz")
  await dialog.getByText("没有匹配的字体", { exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await page.evaluate(() => {
    location.hash = "/settings/global/editor"
  })
  await page.getByRole("button", { name: "编辑器字体", exact: true }).click()
  await dialog.getByText("等宽字体", { exact: true }).waitFor()
  await dialog.getByRole("combobox").fill(chosen)
  await dialog.getByRole("option", { name: chosen, exact: true }).click()
  await page.waitForFunction(
    (font) =>
      JSON.parse(localStorage.getItem("envoi.preferences.v1")).fontFamily === "local:" + font,
    chosen,
  )
  await stop()
  page = await launch()
  await page
    .getByRole("button", { name: "界面字体", exact: true })
    .getByText(chosen, { exact: true })
    .waitFor()
  await page.getByRole("button", { name: "界面字体", exact: true }).click()
  await page.getByRole("option", { name: "系统字体", exact: true }).click()
  await page.waitForFunction(
    () => !document.documentElement.style.getPropertyValue("--ui-font").startsWith('"'),
  )
  console.log(
    `PASS: ${families.length} installed font families; search, selection, monospace grouping, persistence and system default`,
  )
} finally {
  if (app) await stop()
  await rm(temp, { recursive: true, force: true })
}
