import { _electron } from "playwright"
import { createRequire } from "node:module"
import { mkdtemp, mkdir, writeFile, rm, realpath } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { execFileSync } from "node:child_process"
import assert from "node:assert/strict"
import { seedFixtureTrust } from "./fixture-trust.mjs"

const temp = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-git-tree-")))
const root = path.join(temp, "paper")
const git = (...args) => execFileSync("git", ["-C", root, ...args])
let app
try {
  await mkdir(path.join(root, "chapters"), { recursive: true })
  await writeFile(path.join(root, "chapters", "intro.tex"), "Initial")
  await writeFile(path.join(root, "deleted.tex"), "Removed")
  git("init")
  git("add", ".")
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-m", "Fixture")
  await writeFile(path.join(root, "chapters", "intro.tex"), "Modified")
  await rm(path.join(root, "deleted.tex"))
  await writeFile(path.join(root, "added.tex"), "Added")
  git("add", "added.tex")
  await writeFile(path.join(root, "untracked.tex"), "Untracked")
  await seedFixtureTrust(path.join(temp, "data"), temp)
  app = await _electron.launch({
    executablePath: createRequire(import.meta.url)("electron"),
    args: [path.resolve("."), "--user-data-dir=" + path.join(temp, "profile")],
    env: { ...process.env, ENVOI_DATA_DIR: path.join(temp, "data") },
  })
  const page = await app.firstWindow()
  await page.getByTestId("welcome-page").waitFor()
  await page.evaluate(
    (root) => window.dispatchEvent(new CustomEvent("envoi:open-recent", { detail: root })),
    root,
  )
  for (const [name, badge, hue] of [
    ["intro.tex", "M", "yellow"],
    ["added.tex", "A", "green"],
    ["untracked.tex", "U", "green"],
  ]) {
    const row = page.getByRole("button", { name, exact: true })
    await row
      .locator("span")
      .filter({ hasText: new RegExp("^" + badge + "$") })
      .waitFor()
    assert.match(await row.locator("span[title]").getAttribute("class"), new RegExp("hue-" + hue))
  }
  assert.equal(await page.getByRole("button", { name: "deleted.tex", exact: true }).count(), 0)
  assert.equal(
    await page
      .getByRole("button", { name: "chapters", exact: true })
      .locator(".rounded-full")
      .count(),
    1,
  )
  if (process.env.ENVOI_TREE_SCREENSHOT)
    await page.screenshot({ path: process.env.ENVOI_TREE_SCREENSHOT })
  await writeFile(path.join(root, "chapters", "intro.tex"), "Initial")
  await page
    .getByRole("button", { name: "intro.tex", exact: true })
    .locator("span")
    .filter({ hasText: /^M$/ })
    .waitFor({ state: "detached" })
  await page.evaluate(async (root) => {
    await window.envoi.restrictProject(root)
  }, root)
  await page
    .getByRole("button", { name: "added.tex", exact: true })
    .locator("span")
    .filter({ hasText: /^A$/ })
    .waitFor({ state: "detached" })
  console.log(
    "PASS: Git tree colors, badges, folder indicators, deletion omission, external refresh and restricted mode",
  )
} finally {
  if (app) {
    await app.evaluate(({ app }) => app.exit(0)).catch(() => {})
    await app.close().catch(() => {})
  }
  await rm(temp, { recursive: true, force: true })
}
