import { seedFixtureTrust } from "./fixture-trust.mjs"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { _electron } from "playwright"

const require = createRequire(import.meta.url)
const temp = await mkdtemp(path.join(tmpdir(), "envoi-settings-display-"))
await seedFixtureTrust(path.join(temp, "data"), temp)
const instance = await _electron.launch({
  executablePath: require("electron"),
  args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
  env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
})
try {
  const page = await instance.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(() => {
    location.hash = "/settings/global/general"
  })
  await page.getByRole("button", { name: "检查更新", exact: true }).waitFor()
  await instance.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:check-update")
    ipcMain.handle("envoi:check-update", () => ({
      currentVersion: "0.1.0",
      status: "inaccessible",
    }))
  })
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  const warning = page.locator('[data-sonner-toast][data-type="warning"]')
  await warning.filter({ hasText: "暂时无法获取发布信息" }).waitFor()
  await warning.hover()
  const placement = await page.locator("[data-sonner-toaster]").evaluate((node) => ({
    position: getComputedStyle(node).position,
    bottom: getComputedStyle(node).bottom,
    right: getComputedStyle(node).right,
  }))
  assert.deepEqual(placement, { position: "fixed", bottom: "40px", right: "20px" })
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-sonner-toast][data-mounted="true"]')
    return (
      node &&
      getComputedStyle(node).opacity === "1" &&
      node.getBoundingClientRect().bottom < innerHeight - 30
    )
  })
  if (process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1")
    await page.screenshot({ path: path.join(temp, "notification.png") })
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  await warning.waitFor({ state: "detached" })
  await instance.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:check-update")
    ipcMain.handle("envoi:check-update", () => ({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      status: "available",
      downloadAvailable: true,
    }))
  })
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  await page.getByRole("button", { name: "下载更新", exact: true }).waitFor()
  const info = page.locator('[data-sonner-toast][data-type="info"]')
  await info.waitFor()
  await page.mouse.move(100, 100)
  await info.waitFor({ state: "detached", timeout: 8000 })
  assert.equal(await page.getByRole("button", { name: "下载更新", exact: true }).isVisible(), true)
  await instance.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:check-update")
    ipcMain.handle("envoi:check-update", (_event, channel) => ({
      currentVersion: "0.4.1",
      latestVersion: channel === "preview" ? "0.4.1-rc1" : "0.4.1",
      status: channel === "preview" ? "available" : "current",
      downloadAvailable: channel === "preview",
      prerelease: channel === "preview",
    }))
    ipcMain.removeHandler("envoi:download-update")
    ipcMain.handle("envoi:download-update", () => ({ path: "/tmp/Envoi-0.4.1-rc1-arm64.dmg" }))
    ipcMain.removeHandler("envoi:open-downloaded-update")
    ipcMain.handle("envoi:open-downloaded-update", () => {})
  })
  await page.getByRole("combobox", { name: "更新渠道" }).selectOption("preview")
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  await page.getByText("v0.4.1-rc1", { exact: true }).waitFor()
  await page.getByRole("button", { name: "下载预发布版", exact: true }).click()
  await page.getByRole("button", { name: "打开安装包", exact: true }).waitFor()
  await page.getByRole("button", { name: "打开安装包", exact: true }).click()
  await instance.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:check-update")
    ipcMain.handle("envoi:check-update", () => ({
      currentVersion: "0.4.1",
      latestVersion: "0.4.2",
      status: "available",
      downloadAvailable: true,
      restartAvailable: true,
    }))
    ipcMain.removeHandler("envoi:download-update")
    ipcMain.handle("envoi:download-update", () => ({ restartAvailable: true }))
    ipcMain.removeHandler("envoi:restart-update")
    ipcMain.handle("envoi:restart-update", () => {
      globalThis.updateRestartRequested = true
    })
  })
  await page.getByRole("combobox", { name: "更新渠道" }).selectOption("stable")
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  await page.getByRole("button", { name: "下载更新", exact: true }).click()
  await page.getByRole("button", { name: "重启更新", exact: true }).waitFor()
  assert.equal(await page.getByRole("button", { name: "下载更新", exact: true }).count(), 0)
  await page.getByRole("button", { name: "重启更新", exact: true }).click()
  assert.equal(await instance.evaluate(() => globalThis.updateRestartRequested), true)
  // A scroll fixture uses the actual bundled stylesheet and former conflicting class's replacement.
  await page.evaluate(() => {
    const panel = document.createElement("div")
    panel.id = "scroll-fixture"
    panel.className = "envoi-scrollbar"
    panel.style.cssText =
      "position:fixed;right:20px;top:160px;width:220px;height:300px;overflow:scroll;background:hsl(var(--background));z-index:9999"
    const content = document.createElement("div")
    content.style.cssText = "height:900px;width:400px;padding:16px"
    content.textContent = "滚动条显示验证"
    panel.append(content)
    document.body.append(panel)
  })
  const colors = []
  for (const theme of ["graphite", "paper"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme
    }, theme)
    const styles = await page.locator("#scroll-fixture").evaluate((panel) => ({
      width: getComputedStyle(panel).scrollbarWidth,
      thumb: getComputedStyle(panel, "::-webkit-scrollbar-thumb").backgroundColor,
      track: getComputedStyle(panel, "::-webkit-scrollbar-track").backgroundColor,
      buttons: getComputedStyle(panel, "::-webkit-scrollbar-button").display,
    }))
    assert.equal(styles.width, "auto")
    assert.equal(styles.track, "rgba(0, 0, 0, 0)")
    assert.equal(styles.buttons, "none")
    colors.push(styles.thumb)
    if (process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1")
      await page.screenshot({ path: path.join(temp, theme + ".png") })
    console.log(theme, styles)
  }
  assert.notEqual(colors[0], colors[1])
  console.log("PASS settings dismiss, retained update action, themed scrollbars")
  if (process.env.ENVOI_DESKTOP_TEST_HIDDEN !== "1") console.log("Screenshots:", temp)
} finally {
  // This isolated fixture has no user data; bypass the application's close-project guard.
  await instance.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
