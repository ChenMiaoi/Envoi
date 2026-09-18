import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { installAsset, installedServer } from "../electron/main/lsp-installer.mjs"

test("selects only matching official release assets for supported systems", () => {
  assert.equal(installAsset("clangd", "freebsd", "x64"), null)
  assert.equal(installAsset("clangd", "linux", "arm64"), null)
  assert.equal(installAsset("rustAnalyzer", "win32", "mips"), null)
  assert.equal(installAsset("clangd", "darwin", "arm64").matches("clangd-mac-22.1.6.zip"), true)
  assert.equal(installAsset("clangd", "darwin", "arm64").matches("clangd-linux-22.1.6.zip"), false)
  assert.equal(
    installAsset("rustAnalyzer", "win32", "x64").matches(
      "rust-analyzer-x86_64-pc-windows-msvc.zip",
    ),
    true,
  )
})

test("managed server lookup accepts only installed files inside its version directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-lsp-test-"))
  try {
    const versionDirectory = path.join(directory, "pyright", "1.2.3")
    await mkdir(versionDirectory, { recursive: true })
    await writeFile(path.join(versionDirectory, "langserver.index.js"), "")
    const manifest = path.join(directory, "pyright", "current.json")
    await writeFile(
      manifest,
      JSON.stringify({ id: "pyright", version: "1.2.3", binary: "langserver.index.js" }),
    )
    const found = await installedServer(directory, "python")
    assert.equal(found?.name, "Pyright")
    assert.equal(found?.path, path.join(versionDirectory, "langserver.index.js"))
    assert.deepEqual(found?.args, [found.path, "--stdio"])
    assert.equal(await installedServer(directory, "python", "other"), null)
    await writeFile(
      manifest,
      JSON.stringify({ id: "pyright", version: "1.2.3", binary: "../../other" }),
    )
    assert.equal(await installedServer(directory, "python"), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
