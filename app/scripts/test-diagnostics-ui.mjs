import { seedFixtureTrust } from "./fixture-trust.mjs"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { _electron } from "playwright"

const require = createRequire(import.meta.url)
const root = await mkdtemp(path.join(tmpdir(), "envoi-diagnostics-"))
const destination = path.join(root, "diagnostics.json")
await seedFixtureTrust(path.join(root, "data"), root)
const instance = await _electron.launch({
  executablePath: require("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(root, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(root, "data") },
})
try {
  const page = await instance.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  const info = await page.evaluate(() => window.envoi.diagnosticsInfo())
  assert.equal(info.directory, path.join(root, "data", "logs"))
  assert.equal(info.available, true)
  await instance.evaluate(({ shell, dialog }, destination) => {
    shell.openPath = async (value) => {
      globalThis.openedLogDirectory = value
      return ""
    }
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination })
  }, destination)
  await page.evaluate(async () => {
    await window.envoi.gitRuntime()
    await window.envoi.configureTools({ chktexPath: "/SECRET/not-an-executable" }).catch(() => {})
    window.dispatchEvent(
      new ErrorEvent("error", {
        error: Object.assign(new Error("SECRET manuscript CHAT"), { code: "EACCES" }),
      }),
    )
    window.envoi.diagnosticsLog({
      level: "error",
      event: "notification.shown",
      body: "SECRET",
      token: "SECRET",
    })
    location.hash = "/settings/global/general"
  })
  await page.getByRole("button", { name: "打开日志目录", exact: true }).click()
  assert.equal(await instance.evaluate(() => globalThis.openedLogDirectory), info.directory)
  await page.getByRole("button", { name: "导出诊断日志", exact: true }).click()
  await page.getByText("诊断日志已导出。", { exact: true }).waitFor()
  const bundle = JSON.parse(await readFile(destination, "utf8"))
  const lines = bundle.logs.flatMap((file) => file.content.trim().split("\n").map(JSON.parse))
  assert.ok(lines.some((line) => line.event === "app.started"))
  assert.ok(lines.some((line) => line.event === "renderer.error" && line.error.code === "EACCES"))
  const backend = lines.find(
    (line) => line.module === "backend" && line.event === "operation.failed",
  )
  assert.ok(backend)
  assert.ok(
    lines.some(
      (line) =>
        line.module === "ipc" &&
        line.event === "operation.failed" &&
        line.operationId === backend.operationId,
    ),
  )
  assert.doesNotMatch(JSON.stringify(bundle), /SECRET|manuscript|CHAT/)
  await instance.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => ({ canceled: true })
  })
  assert.equal(await page.evaluate(() => window.envoi.diagnosticsExport()), false)
  if (process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1")
    await page.screenshot({
      path: process.env.ENVOI_DIAGNOSTICS_SCREENSHOT ?? path.join(root, "settings.png"),
    })
  console.log(
    "PASS diagnostics: main/backend/renderer logs, correlation, privacy, open folder, export and cancellation",
  )
} finally {
  await instance.evaluate(({ app }) => app.exit(0)).catch(() => {})
  await instance.close().catch(() => {})
  await rm(root, { recursive: true, force: true })
}
