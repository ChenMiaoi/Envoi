import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import assert from "node:assert/strict"
import { build } from "esbuild"

await mkdir("tmp", { recursive: true })
const temp = await mkdtemp(path.resolve("tmp/performance-ui-"))
let app
try {
  await build({
    entryPoints: ["scripts/performance-ui.fixture.tsx"],
    outfile: path.join(temp, "fixture.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
  })
  await writeFile(
    path.join(temp, "index.html"),
    '<!doctype html><div id="root"></div><script src="fixture.js"></script>',
  )
  await writeFile(
    path.join(temp, "main.cjs"),
    `const { app, BrowserWindow } = require('electron');
app.whenReady().then(() => { const window = new BrowserWindow({ show: false }); window.loadFile(${JSON.stringify(path.join(temp, "index.html"))}); });`,
  )
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.join(temp, "main.cjs"), "--user-data-dir=" + path.join(temp, "profile")],
  })
  const page = await app.firstWindow()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.waitForFunction(() => typeof window.performanceFixture?.controls.edit === "function")
  const before = await page.evaluate(() => ({ ...window.performanceFixture.counts }))
  for (let i = 0; i < 100; i++) {
    await page.evaluate((i) => {
      window.performanceFixture.controls.edit(`draft ${i}`)
      window.performanceFixture.controls.stream(`reply ${i}`)
    }, i)
    await page.waitForFunction(
      (i) =>
        document.querySelector("#editor").textContent === `draft ${i}` &&
        document.querySelector("#transcript").textContent === `reply ${i}`,
      i,
    )
  }
  const after = await page.evaluate(() => ({ ...window.performanceFixture.counts }))
  assert.equal(after.navigation - before.navigation, 0, "typing must not render file navigation")
  assert.equal(after.model - before.model, 0, "streaming must not render model controls")
  assert.ok(after.editor > before.editor)
  assert.ok(after.transcript > before.transcript)
  await page.evaluate(() => {
    window.performanceFixture.controls.rename("renamed.tex")
    window.performanceFixture.controls.model("model-b")
    window.performanceFixture.controls.choose("other")
  })
  await page.waitForFunction(
    () =>
      document.querySelector("#navigation").textContent === "renamed.tex" &&
      document.querySelector("#model").textContent === "model-b" &&
      document.querySelector("#editor").textContent === "other text",
  )
  assert.deepEqual(errors, [])
  console.log(
    "PASS performance: 100 edits + 100 streamed updates cause 0 navigation/model renders; relevant updates and changed selectors stay current (React StrictMode)",
  )
} finally {
  if (app) await app.close().catch(() => {})
  await rm(temp, { recursive: true, force: true })
}
