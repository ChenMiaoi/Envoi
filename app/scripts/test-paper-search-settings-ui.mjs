import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"

const temp = await mkdtemp(path.join(tmpdir(), "envoi-paper-search-settings-"))
const instance = await _electron.launch({
  executablePath: createRequire(import.meta.url)("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
})
try {
  const page = await instance.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await instance.evaluate(({ ipcMain }) => {
    globalThis.__paperSearchSettingsFixture = {
      semanticScholarKey: "",
      contactEmail: "",
      sourceWeights: { openalex: 1, semanticscholar: 1, crossref: 1, arxiv: 1 },
    }
    ipcMain.removeHandler("envoi:paper-search-config")
    ipcMain.removeHandler("envoi:configure-paper-search")
    ipcMain.handle("envoi:paper-search-config", () => globalThis.__paperSearchSettingsFixture)
    ipcMain.handle("envoi:configure-paper-search", (_event, input) => {
      globalThis.__paperSearchSettingsFixture = structuredClone(input)
      return globalThis.__paperSearchSettingsFixture
    })
  })
  await page.evaluate(() => {
    location.hash = "/settings/global/references"
  })
  const panel = page.getByTestId("paper-search-settings")
  await panel.waitFor()
  const openAlex = panel.getByRole("combobox", { name: "OpenAlex 来源优先级", exact: true })
  const arxiv = panel.getByRole("combobox", { name: "arXiv 来源优先级", exact: true })
  const crossref = panel.getByRole("combobox", { name: "Crossref 来源优先级", exact: true })
  assert.equal(await panel.getByRole("combobox").count(), 4)
  assert.equal(await openAlex.inputValue(), "1")
  await arxiv.selectOption("3")
  await crossref.selectOption("0")
  await panel.getByRole("button", { name: "保存", exact: true }).click()
  await page.locator('[data-sonner-toast][data-type="success"]').waitFor()
  const saved = await instance.evaluate(() => globalThis.__paperSearchSettingsFixture)
  assert.deepEqual(saved.sourceWeights, {
    openalex: 1,
    semanticscholar: 1,
    crossref: 0,
    arxiv: 3,
  })

  await page.evaluate(() => {
    location.hash = "/settings/global/general"
  })
  await page.getByRole("button", { name: "检查更新", exact: true }).waitFor()
  await page.evaluate(() => {
    location.hash = "/settings/global/references"
  })
  await panel.waitFor()
  assert.equal(await arxiv.inputValue(), "3")
  assert.equal(await crossref.inputValue(), "0")
  console.log("PASS paper search source priorities: controls, save and reload")
} finally {
  await instance.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await instance.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
