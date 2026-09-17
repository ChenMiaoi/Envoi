import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import assert from "node:assert/strict"
import { seedFixtureTrust } from "./fixture-trust.mjs"

const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-code-editor-")))
const root = path.join(temp, "project")
let app
try {
  await mkdir(root)
  await writeFile(path.join(root, "hello.py"), "value = 1\n")
  await writeFile(path.join(root, "main.cpp"), "int main() { return 0; }\n")
  await writeFile(path.join(root, "Cargo.toml"), "[package]\nname = 'demo'\n")
  await seedFixtureTrust(path.join(temp, "data"), temp)
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
  for (const file of ["hello.py", "main.cpp", "Cargo.toml"]) {
    await page.getByRole("button", { name: file, exact: true }).click()
    await page.getByRole("textbox", { name: "文本源码编辑器" }).waitFor()
  }
  const editor = page.getByRole("textbox", { name: "文本源码编辑器" })
  await page.getByRole("button", { name: "hello.py", exact: true }).click()
  await editor.click()
  await editor.press("Control+End")
  await editor.press("Enter")
  await editor.type("answer = value + 1")
  await editor.press("Control+s")
  await page.waitForFunction(
    async (root) =>
      (await window.envoi.fsRead(root, "hello.py")).text.includes("answer = value + 1"),
    root,
  )
  assert.match(await readFile(path.join(root, "hello.py"), "utf8"), /answer = value \+ 1/)
  assert.deepEqual(errors, [])
  console.log("PASS code editor opens Python, C++ and TOML and preserves source edits")
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
  await rm(temp, { recursive: true, force: true })
}
