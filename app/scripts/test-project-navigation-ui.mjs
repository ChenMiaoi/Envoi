import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { seedFixtureTrust } from "./fixture-trust.mjs"

const temp = await mkdtemp(path.join(tmpdir(), "envoi-navigation-"))
const root = path.join(temp, "research-project-with-a-long-name")
const broken = path.join(temp, "broken")
await mkdir(root)
await mkdir(broken)
await writeFile(path.join(root, "notes.md"), "# Original\n")
await writeFile(path.join(broken, "large.csv"), "x".repeat(5_000_001))
await seedFixtureTrust(path.join(temp, "data"), temp)
let app
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: {
      ...process.env,
      ENVOI_DATA_DIR: path.join(temp, "data"),
      ENVOI_DESKTOP_TEST_HIDDEN: "1",
    },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByTestId("welcome-page").waitFor()
  await page.getByRole("button", { name: "远程 SSH 工作区…", exact: true }).click()
  await page.getByRole("textbox", { name: "SSH 主机", exact: true }).fill("research")
  await page.getByRole("textbox", { name: "远程目录", exact: true }).fill("/work/paper")
  await page.keyboard.press("Escape")
  if (process.platform === "win32") {
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("envoi:remote-wsl-distributions")
      ipcMain.handle("envoi:remote-wsl-distributions", () => ["Fixture-Ubuntu"])
      ipcMain.removeHandler("envoi:remote-wsl-directories")
      ipcMain.handle("envoi:remote-wsl-directories", (_event, _host, input) => ({
        home: "/home/fixture",
        directory: input || "/home/fixture/",
        directories: [],
      }))
    })
    await page.getByRole("button", { name: "WSL 工作区…", exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector('input[aria-label="远程目录"]')?.value === "/home/fixture/",
      undefined,
      { polling: 100 },
    )
    await page
      .getByRole("textbox", { name: "远程目录", exact: true })
      .fill("/home/fixture/project/")
    await page.keyboard.press("Escape")
    await page.getByRole("button", { name: "WSL 工作区…", exact: true }).click()
    await page.getByRole("button", { name: "回到 home 目录", exact: true }).waitFor()
    assert.equal(
      await page.getByRole("textbox", { name: "远程目录", exact: true }).inputValue(),
      "/home/fixture/project/",
    )
    await page.keyboard.press("Escape")
  }
  await page.getByRole("button", { name: "远程 SSH 工作区…", exact: true }).click()
  assert.equal(
    await page.getByRole("textbox", { name: "SSH 主机", exact: true }).inputValue(),
    "research",
  )
  assert.equal(
    await page.getByRole("textbox", { name: "远程目录", exact: true }).inputValue(),
    "/work/paper",
  )
  // Hold a simulated connection until its dialog has been dismissed.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:remote-connect")
    ipcMain.handle(
      "envoi:remote-connect",
      (event) =>
        new Promise((resolve) => {
          globalThis.finishNavigationConnection = () => resolve({ root: "ssh://cancelled/" })
          event.sender.send("envoi:remote-event", {
            type: "state",
            value: {
              root: "ssh://cancelled/",
              kind: "ssh",
              host: "research",
              directory: "/work/paper",
              state: "connecting",
              generation: 0,
            },
          })
        }),
    )
    ipcMain.removeHandler("envoi:remote-cancel")
    ipcMain.handle("envoi:remote-cancel", () => {
      globalThis.navigationCancelled = true
    })
  })
  await page.evaluate(() => {
    window.navigationOpened = []
    window.addEventListener("envoi:open-recent", (event) =>
      window.navigationOpened.push(event.detail),
    )
  })
  await page.getByRole("button", { name: "连接并打开", exact: true }).click()
  await page.getByRole("button", { name: "取消连接", exact: true }).waitFor()
  await page.keyboard.press("Escape")
  await app.evaluate(() => globalThis.finishNavigationConnection())
  await page.getByRole("button", { name: "远程 SSH 工作区…", exact: true }).click()
  await page.getByRole("button", { name: "连接并打开", exact: true }).waitFor()
  assert.equal(await app.evaluate(() => globalThis.navigationCancelled), true)
  assert.deepEqual(await page.evaluate(() => window.navigationOpened), [])
  await page.keyboard.press("Escape")

  await page.evaluate(
    ({ root, broken }) => {
      window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root }))
      window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: broken }))
    },
    { root, broken },
  )
  await page.getByRole("button", { name: "notes.md", exact: true }).waitFor()
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    broken,
  )
  await page.getByTestId("project-notification").filter({ hasText: "5 MB" }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.envoi.dataGet("session", "current"))).value.rootPath,
    root,
  )
  await page.getByRole("button", { name: /项目：.*切换项目/ }).click()
  await page.getByRole("menuitem", { name: /research-project-with-a-long-name/ }).waitFor()
  assert.equal(
    await page.getByRole("button", { name: "删除当前项目文件…", exact: true }).count(),
    0,
  )
  await page.keyboard.press("Escape")

  for (const width of [1440, 1024, 900]) {
    await page.setViewportSize({ width, height: 850 })
    const overlap = await page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="页面导航"]').getBoundingClientRect()
      const identity = document
        .querySelector('button[aria-label^="项目："]')
        .getBoundingClientRect()
      return identity.right > nav.left
    })
    assert.equal(overlap, false, `project switcher overlaps navigation at ${width}px`)
  }
  if (process.env.ENVOI_NAVIGATION_SCREENSHOT_DIR) {
    const output = path.resolve(process.env.ENVOI_NAVIGATION_SCREENSHOT_DIR)
    await mkdir(output, { recursive: true })
    for (let frame = 0; frame < 3; frame++) {
      const png = await app.evaluate(async ({ BrowserWindow }) =>
        (
          await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, {
            stayHidden: true,
            stayAwake: true,
          })
        )
          .toPNG()
          .toString("base64"),
      )
      await writeFile(path.join(output, "navigation-900.png"), Buffer.from(png, "base64"))
    }
  }
  // A failed or pending trust request must never trap the user behind its modal.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:restrict-project")
    ipcMain.handle("envoi:restrict-project", () => {
      throw Error("Remote workspace is not connected in this window")
    })
    ipcMain.removeHandler("envoi:grant-project-trust")
    ipcMain.handle(
      "envoi:grant-project-trust",
      () =>
        new Promise((_, reject) => {
          globalThis.failNavigationTrust = () => reject(Error("Connection lost"))
        }),
    )
    ipcMain.removeHandler("envoi:project-trust")
    ipcMain.handle("envoi:project-trust", () => ({ trusted: false, decided: false }))
  })
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].webContents.send("envoi:trust-changed")
  })
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:show-trust")))
  const security = page.getByRole("dialog", { name: "项目安全模式", exact: true })
  await security.getByRole("button", { name: "以限制模式继续", exact: true }).click()
  await security.getByRole("alert").filter({ hasText: "not connected" }).waitFor()
  await security.getByRole("button", { name: "Close", exact: true }).click()
  await security.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: /项目：.*切换项目/ }).click()
  await page.keyboard.press("Escape")
  await page.evaluate(() => window.dispatchEvent(new Event("envoi:show-trust")))
  await security.getByRole("button", { name: "信任项目", exact: true }).click()
  await page.keyboard.press("Escape")
  await security.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: /项目：.*切换项目/ }).click()
  await page.getByRole("menuitem", { name: /关闭当前项目/ }).click()
  await page.getByRole("button", { name: "关闭项目", exact: true }).click()
  await page.getByTestId("welcome-page").waitFor()
  await app.evaluate(() => globalThis.failNavigationTrust())
  assert.equal(await security.count(), 0)
  assert.deepEqual(errors, [])
  console.log(
    "PASS project switcher, header layout, SSH/WSL form isolation, cancelled connection and failed project preparation",
  )
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows().forEach((window) => window.destroy()),
    )
    .catch(() => {})
  await app?.close().catch(() => {})
  assert(path.dirname(temp) === tmpdir() && path.basename(temp).startsWith("envoi-navigation-"))
  await rm(temp, { recursive: true, force: true })
}
