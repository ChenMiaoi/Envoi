import { _electron } from "playwright"
import { createRequire } from "node:module"
import { pathToFileURL } from "node:url"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, copyFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import { seedFixtureTrust } from "./fixture-trust.mjs"

const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-code-editor-")))
const root = path.join(temp, "project")
const ruff = path.join(temp, process.platform === "win32" ? "ruff.exe" : "ruff")
const tidy = path.join(temp, process.platform === "win32" ? "clang-tidy.exe" : "clang-tidy")
let app
try {
  await mkdir(root)
  if (process.platform === "win32") {
    const compiler = path.join(
      process.env.WINDIR,
      "Microsoft.NET",
      "Framework64",
      "v4.0.30319",
      "csc.exe",
    )
    execFileSync(compiler, [
      "/nologo",
      "/target:exe",
      "/reference:System.Web.Extensions.dll",
      `/out:${ruff}`,
      path.resolve("scripts/fixtures/language-tool.cs"),
    ])
    await copyFile(ruff, tidy)
  } else {
    await writeFile(
      ruff,
      '#!/bin/sh\nif [ "$1" = "--version" ]; then echo "ruff 0.9.0"; elif [ "$1" = "format" ]; then sed "s/answer = value + 1/answer = value + 2/"; else printf \'[{"code":"W001","message":"example warning","location":{"row":1,"column":1}}]\'; exit 1; fi\n',
      { mode: 0o755 },
    )
    await writeFile(
      tidy,
      '#!/usr/bin/env node\nconst fs = require("node:fs"); if (process.argv.includes("--version")) { console.log("clang-tidy version 20"); process.exit(0); } const source = process.argv[2]; const arg = process.argv.find(value => value.startsWith("--vfsoverlay=")); const overlay = JSON.parse(fs.readFileSync(arg.slice(13), "utf8")); if (fs.readFileSync(overlay.roots[0]["external-contents"], "utf8").includes("unsaved_warning")) console.log(`${source}:1:1: warning: live C++ warning [live-check]`);\n',
      { mode: 0o755 },
    )
  }
  await writeFile(path.join(root, "hello.py"), "value = 1\n")
  await writeFile(path.join(root, "main.cpp"), "int main() { return 0; }\n")
  await writeFile(path.join(root, "Cargo.toml"), "[package]\nname = 'demo'\n")
  await writeFile(path.join(root, "Main.lean"), "theorem demo : True := by trivial\n")
  await writeFile(path.join(root, "top.sv"), "module top; endmodule\n")
  await writeFile(path.join(root, "defs.vh"), "`define WIDTH 32\n")
  await seedFixtureTrust(path.join(temp, "data"), temp)
  const managed = path.join(temp, "profile/language-servers/pyright")
  await mkdir(path.join(managed, "1.0.0"), { recursive: true })
  await writeFile(
    path.join(managed, "current.json"),
    JSON.stringify({ id: "pyright", version: "1.0.0", binary: "langserver.index.js" }),
  )
  await writeFile(
    path.join(managed, "1.0.0/langserver.index.js"),
    `require("node:fs").writeFileSync(${JSON.stringify(path.join(temp, "lsp.pid"))}, String(process.pid)); import(${JSON.stringify(pathToFileURL(path.resolve("scripts/fixtures/lsp-fixture.mjs")).href)});`,
  )
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  const page = await app.firstWindow()
  const errors = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    root,
  )
  for (const file of ["hello.py", "main.cpp", "Main.lean", "top.sv", "defs.vh", "Cargo.toml"]) {
    await page.getByRole("button", { name: file, exact: true }).click()
    await page.getByRole("textbox", { name: "文本源码编辑器" }).waitFor()
  }
  const editor = page.getByRole("textbox", { name: "文本源码编辑器" })
  await page.getByRole("button", { name: "hello.py", exact: true }).click()
  await page.getByRole("button", { name: "创建 Python 环境", exact: true }).click()
  const environmentPrompt = page
    .locator("[data-sonner-toast]")
    .filter({ hasText: "项目尚无虚拟环境" })
  await environmentPrompt.getByRole("button", { name: "venv", exact: true }).waitFor()
  await environmentPrompt.getByRole("button", { name: "uv", exact: true }).waitFor()
  await environmentPrompt.getByRole("button", { name: "关闭", exact: true }).click()
  await environmentPrompt.waitFor({ state: "hidden" })
  await page.getByRole("button", { name: "创建 Python 环境", exact: true }).click()
  await environmentPrompt.getByRole("button", { name: "uv", exact: true }).waitFor()
  await environmentPrompt.getByRole("button", { name: "关闭", exact: true }).click()
  await environmentPrompt.waitFor({ state: "hidden" })
  await editor.focus()
  const focusStyle = await editor.evaluate((element) => ({
    shadow: getComputedStyle(element).boxShadow,
    outline: getComputedStyle(element).outlineStyle,
  }))
  assert.equal(focusStyle.shadow, "none")
  assert.equal(focusStyle.outline, "none")
  console.log("PASS: Python environment choices can be reopened and editor focus has no glow")
  await page.locator(".cm-lintRange-info").first().waitFor()
  await editor.fill("value = 42\n")
  const crashedPid = Number(await readFile(path.join(temp, "lsp.pid"), "utf8"))
  process.kill(crashedPid)
  await page.getByTestId("lsp-retry").waitFor()
  assert.equal(await page.locator(".cm-lintRange-info").count(), 0)
  assert((await editor.innerText()).includes("value = 42"))
  await page.getByTestId("lsp-retry").click()
  await page.locator(".cm-lintRange-info").first().waitFor()
  assert((await editor.innerText()).includes("value = 42"))
  assert.notEqual(Number(await readFile(path.join(temp, "lsp.pid"), "utf8")), crashedPid)
  await editor.fill("value = 1\n")
  console.log(
    "PASS: language server crash clears diagnostics, exposes retry and preserves the draft",
  )
  const tooltipTheme = await page.evaluate(() => {
    const host = document.querySelector('[aria-label="文本源码编辑器"]').closest(".cm-editor")
    const tooltip = document.createElement("div")
    tooltip.className = "cm-tooltip"
    host.append(tooltip)
    const expected = document.createElement("div")
    expected.style.backgroundColor = "hsl(var(--popover))"
    expected.style.color = "hsl(var(--popover-foreground))"
    host.append(expected)
    const actualStyle = getComputedStyle(tooltip)
    const expectedStyle = getComputedStyle(expected)
    const result = {
      background: actualStyle.backgroundColor,
      foreground: actualStyle.color,
      expectedBackground: expectedStyle.backgroundColor,
      expectedForeground: expectedStyle.color,
    }
    tooltip.remove()
    expected.remove()
    return result
  })
  assert.equal(tooltipTheme.background, tooltipTheme.expectedBackground)
  assert.equal(tooltipTheme.foreground, tooltipTheme.expectedForeground)
  assert.equal(await page.getByRole("button", { name: "格式化", exact: true }).count(), 0)
  assert.equal(await page.getByRole("button", { name: "代码检查", exact: true }).count(), 0)
  await page.getByRole("link", { name: "设置", exact: true }).first().click()
  await page.getByRole("link", { name: "扩展", exact: true }).click()
  const lean = page.getByTestId("extension-lean")
  await lean.locator("button[aria-expanded]").click()
  await lean.getByText("Lean 4 (Elan / Lake)", { exact: true }).waitFor()
  await lean.getByText("lean-fmt (optional)", { exact: true }).waitFor()
  await lean.getByText("Lint 警告由 Lean 语言服务提供", { exact: false }).waitFor()
  const rtl = page.getByTestId("extension-rtl")
  await rtl.locator("button[aria-expanded]").click()
  const rtlProject = rtl.getByTestId("rtl-project-settings")
  await rtlProject.getByRole("textbox", { name: "顶层模块", exact: true }).fill("top")
  await rtlProject
    .getByRole("textbox", { name: "源文件（按编译顺序）", exact: true })
    .fill("top.sv")
  await rtlProject.getByRole("button", { name: "保存 RTL 配置", exact: true }).click()
  await rtlProject.getByText("RTL 工程配置已保存", { exact: false }).waitFor()
  const rtlConfig = JSON.parse(await readFile(path.join(root, ".envoi/rtl.json"), "utf8"))
  assert.equal(rtlConfig.top, "top")
  assert.deepEqual(rtlConfig.files, ["top.sv"])
  assert.match(await readFile(path.join(root, ".envoi/rtl.f"), "utf8"), /--top top/)
  assert.match(await rtl.textContent(), /slang-server/)
  assert.match(await rtl.textContent(), /Verible LSP/)
  await rtl.locator("button[aria-expanded]").click()
  console.log(
    "PASS: RTL sources and headers open, both servers appear and project settings persist",
  )
  const python = page.getByTestId("extension-python")
  await python.locator("button[aria-expanded]").click()
  for (let index = 0; index < 2; index++) {
    const input = python.getByRole("textbox", { name: "Ruff 手动输入路径" }).first()
    await input.fill(ruff)
    await input.locator("..").getByRole("button", { name: "使用" }).click()
    await page.waitForFunction(
      ({ ruff, id }) =>
        JSON.parse(localStorage.getItem("envoi.preferences.v1") ?? "{}").toolPaths?.[id] === ruff,
      { ruff, id: index === 0 ? "ruffFormat" : "ruffLint" },
    )
  }
  await page.getByRole("link", { name: "阅读", exact: true }).first().click()
  await page.getByRole("button", { name: "hello.py", exact: true }).click()
  await page.getByRole("button", { name: "打开问题列表" }).waitFor()
  await page.waitForFunction(() => document.querySelectorAll(".cm-lintRange-warning").length > 0)
  assert.match(await page.getByRole("button", { name: "打开问题列表" }).textContent(), /Python01/)
  await page.getByRole("button", { name: "打开问题列表" }).click()
  assert.match(await page.getByRole("dialog").textContent(), /W001: example warning/)
  await page.keyboard.press("Escape")
  await editor.click()
  await editor.press("Control+End")
  await editor.press("Enter")
  await editor.type("answer = value + 1")
  await editor.press("Control+s")
  let saved = ""
  for (let attempt = 0; attempt < 60; attempt++) {
    saved = await readFile(path.join(root, "hello.py"), "utf8")
    if (saved.includes("answer = value + 2")) break
    await delay(100)
  }
  assert.match(saved, /answer = value \+ 2/)
  await page.waitForFunction(() =>
    document
      .querySelector('[aria-label="文本源码编辑器"]')
      ?.textContent?.includes("answer = value + 2"),
  )
  await page.getByRole("link", { name: "设置", exact: true }).first().click()
  await page.getByRole("link", { name: "扩展", exact: true }).click()
  const cpp = page.getByTestId("extension-cpp")
  assert.equal(await cpp.getByRole("combobox").count(), 0)
  await cpp.locator("button[aria-expanded]").click()
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('[data-testid="extension-cpp"] button')].filter((button) =>
        button.textContent?.includes("手动输入路径"),
      ).length === 5,
  )
  assert.equal(await cpp.getByRole("button", { name: "手动输入路径" }).count(), 5)
  assert.match(await cpp.textContent(), /语言服务器.*格式化.*代码检查/)
  let tidyInput = cpp.getByRole("textbox", { name: "clang-tidy 手动输入路径" })
  if ((await tidyInput.count()) === 0) {
    await cpp
      .locator(".rounded-xl", { hasText: "clang-tidy" })
      .first()
      .getByRole("button", { name: "手动输入路径" })
      .click()
    tidyInput = cpp.getByRole("textbox", { name: "clang-tidy 手动输入路径" })
  }
  await tidyInput.fill(tidy)
  await tidyInput.locator("..").getByRole("button", { name: "使用" }).click()
  await page.waitForFunction(
    (tidy) =>
      JSON.parse(localStorage.getItem("envoi.preferences.v1") ?? "{}").toolPaths?.clangTidy ===
      tidy,
    tidy,
  )
  await page.getByRole("link", { name: "阅读", exact: true }).first().click()
  await page.getByRole("button", { name: "main.cpp", exact: true }).click()
  await editor.click()
  await editor.press("Control+End")
  await editor.press("Enter")
  await editor.type("// unsaved_warning")
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="打开问题列表"]')?.textContent?.includes("C++01"),
  )
  assert.doesNotMatch(await readFile(path.join(root, "main.cpp"), "utf8"), /unsaved_warning/)
  await page.getByRole("link", { name: "设置", exact: true }).first().click()
  await page.getByRole("link", { name: "扩展", exact: true }).click()
  await cpp.locator("button[aria-expanded]").click()
  await cpp.getByRole("checkbox").uncheck()
  await page.waitForFunction(
    () =>
      JSON.parse(localStorage.getItem("envoi.preferences.v1") ?? "{}").pluginStates?.[
        "envoi.cpp"
      ] === false,
  )
  await page.getByRole("link", { name: "阅读", exact: true }).first().click()
  await page.getByRole("button", { name: "main.cpp", exact: true }).click()
  assert.match(await page.getByRole("button", { name: "打开问题列表" }).textContent(), /C\+\+00/)
  assert.equal(await page.getByRole("button", { name: "格式化", exact: true }).count(), 0)
  await editor.click()
  await editor.press("Control+End")
  await editor.press("Enter")
  await editor.type("// still editable without language service")
  await editor.press("Control+s")
  await page.waitForFunction(
    async (root) =>
      (await window.envoi.fsRead(root, "main.cpp")).text.includes(
        "still editable without language service",
      ),
    root,
  )
  await page.getByRole("button", { name: "hello.py", exact: true }).click()
  assert.match(await page.getByRole("button", { name: "打开问题列表" }).textContent(), /Python/)
  await page.getByRole("link", { name: "写作", exact: true }).first().click()
  await page.waitForFunction(() =>
    document.querySelector('[aria-label="打开问题列表"]')?.textContent?.includes("LaTeX"),
  )
  assert.deepEqual(errors, [])
  console.log("PASS code editor preserves edits with a language plugin disabled")
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
  await rm(temp, { recursive: true, force: true })
}
