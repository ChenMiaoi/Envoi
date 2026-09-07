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
  await page.screenshot({ path: path.join(temp, "notification.png") })
  await page.getByRole("button", { name: "关闭", exact: true }).click()
  await warning.waitFor({ state: "detached" })
  await instance.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler("envoi:check-update")
    ipcMain.handle("envoi:check-update", () => ({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      status: "available",
    }))
  })
  await page.getByRole("button", { name: "检查更新", exact: true }).click()
  await page.getByRole("button", { name: "下载更新", exact: true }).waitFor()
  const info = page.locator('[data-sonner-toast][data-type="info"]')
  await info.waitFor()
  await page.mouse.move(100, 100)
  await info.waitFor({ state: "detached", timeout: 8000 })
  assert.equal(await page.getByRole("button", { name: "下载更新", exact: true }).isVisible(), true)
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
    await page.screenshot({ path: path.join(temp, theme + ".png") })
    console.log(theme, styles)
  }
  assert.notEqual(colors[0], colors[1])
  console.log(
    "PASS settings dismiss, retained update action, themed scrollbars; screenshots:",
    temp,
  )
} finally {
  // This isolated fixture has no user data; bypass the application's close-project guard.
  await instance.evaluate(({ app }) => app.exit(0)).catch(() => {})
}
