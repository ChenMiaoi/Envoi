import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import assert from "node:assert/strict"
const directory = await mkdtemp(path.join(tmpdir(), "envoi-remote-ui-"))
let app
try {
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(directory, "profile")],
    env: {
      ...process.env,
      ENVOI_DATA_DIR: path.join(directory, "data"),
      ENVOI_DESKTOP_TEST_HIDDEN: "1",
    },
  })
  const page = await app.firstWindow(),
    errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(() => {
    window.location.hash = "/settings/global/extensions"
  })
  await page.getByTestId("extension-remote-ssh").waitFor()
  await page
    .getByTestId("extension-remote-ssh")
    .getByRole("button", { name: "远程 SSH 工作区…" })
    .click()
  await page.getByRole("textbox", { name: "SSH 主机", exact: true }).fill("-oProxyCommand=bad")
  await page.getByRole("textbox", { name: "远程目录", exact: true }).fill("/workspace")
  await page.getByRole("button", { name: "连接并打开", exact: true }).click()
  await page.getByRole("alert").filter({ hasText: "SSH config alias" }).waitFor()
  const capture = async (name) => {
    if (process.env.ENVOI_REMOTE_SCREENSHOT !== "1") return
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive())
    try {
      await page.screenshot({ path: path.resolve("tmp/" + name) })
    } finally {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    }
  }
  await capture("remote-ssh-dialog.png")
  await page.keyboard.press("Escape")
  await page.getByTestId("extension-wsl").getByRole("button", { name: "WSL", exact: true }).click()
  await page.getByRole("combobox", { name: "发行版", exact: true }).waitFor()
  assert.equal(await page.getByRole("textbox", { name: "SSH 主机", exact: true }).count(), 0)
  const distro = process.env.ENVOI_TEST_WSL_DISTRO
  if (distro) {
    await page.getByRole("combobox", { name: "发行版", exact: true }).selectOption(distro)
    await page
      .getByRole("textbox", { name: "远程目录", exact: true })
      .fill(process.env.ENVOI_TEST_WSL_DIRECTORY)
    await capture("wsl-dialog.png")
  } else {
    await page.keyboard.press("Escape")
    await page.getByTestId("extension-remote-ssh").getByRole("button").click()
  }
  const config = process.env.ENVOI_TEST_SSH_CONFIG
  if (config || distro) {
    if (config) {
      await page
        .getByRole("textbox", { name: "SSH 主机", exact: true })
        .fill(process.env.ENVOI_TEST_SSH_HOST ?? "envoi-test")
      await page
        .getByRole("textbox", { name: "远程目录", exact: true })
        .fill(process.env.ENVOI_TEST_SSH_DIRECTORY ?? "/workspace")
      await page
        .getByRole("textbox", { name: "SSH 配置文件（可选，本机绝对路径）", exact: true })
        .fill(config)
    }
    const connecting = page.getByRole("button", { name: "连接并打开", exact: true }).click()
    // One-time fixture host confirmation, if this known_hosts file is still empty.
    await connecting
    const auth = page.getByRole("heading", { name: "SSH 身份验证", exact: true })
    const trust = page.getByRole("button", { name: "信任项目", exact: true })
    if (distro) await trust.waitFor({ timeout: 90000 })
    else await Promise.race([auth.waitFor(), trust.waitFor()])
    if (await auth.isVisible()) {
      await page.getByRole("textbox", { name: "验证响应", exact: true }).fill("yes")
      await page.getByRole("button", { name: "继续", exact: true }).click()
    }
    await trust.click()
    await page.getByRole("button", { name: "main.cpp", exact: true }).click()
    const editor = page.getByRole("textbox", { name: "文本源码编辑器" })
    await editor.waitFor()
    await editor.press("Control+End")
    await editor.press("Enter")
    await editor.type("// remote UI saved")
    await editor.press("Control+s")
    await page.waitForFunction(async () => {
      const [state] = await window.envoi.remoteList()
      return (await window.envoi.fsRead(state.root, "main.cpp")).text.includes("// remote UI saved")
    })
    await page.getByRole("button", { name: "远程终端", exact: true }).click()
    await page.locator('[data-terminal-ready="true"]').waitFor()
    await page
      .locator(".xterm-helper-textarea")
      .pressSequentially("printf 'ENVOI_UI_TERMINAL\\n'; pwd")
    await page.locator(".xterm-helper-textarea").press("Enter")
    await page.waitForFunction(() =>
      document
        .querySelector(".xterm-accessibility-tree")
        ?.textContent?.includes("ENVOI_UI_TERMINAL"),
    )
    await capture(distro ? "wsl-workspace.png" : "remote-ssh-workspace.png")
    await page.keyboard.press("Escape")
    await editor.click()
    await editor.press("Control+End")
    await editor.press("Enter")
    await editor.type("// preserved offline")
    await page.evaluate(async () => {
      const [state] = await window.envoi.remoteList()
      await window.envoi.remoteDisconnect(state.root)
    })
    assert((await editor.textContent()).includes("preserved offline"))
    await page.evaluate(async () => {
      const [state] = await window.envoi.remoteList()
      await window.envoi.remoteReconnect(state.root)
    })
    assert((await editor.textContent()).includes("preserved offline"))
    console.log(
      "PASS remote desktop: connect, trust, existing file tree/editor, save, PTY panel, draft survival",
    )
  }
  assert.deepEqual(errors, [])
  console.log("PASS SSH and WSL extensions and connection validation UI")
} finally {
  await app
    ?.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    .catch(() => {})
  await app?.close().catch(() => {})
  assert(directory.startsWith(path.join(tmpdir(), "envoi-remote-ui-")))
  await rm(directory, { recursive: true, force: true })
}
