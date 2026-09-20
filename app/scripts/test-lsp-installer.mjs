import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import * as tar from "tar"
import {
  installAsset,
  installedServer,
  installLanguageServer,
  lspInstallable,
} from "../electron/main/lsp-installer.mjs"

test("language servers report install sources only for supported builds", () => {
  assert.equal(lspInstallable("pyright", "linux", "arm64"), true)
  assert.equal(lspInstallable("clangd", "darwin", "arm64"), true)
  assert.equal(lspInstallable("clangd", "linux", "arm64"), false)
  assert.equal(lspInstallable("rustAnalyzer", "win32", "x64"), true)
  assert.equal(lspInstallable("ccls", "darwin", "arm64"), false)
  assert.equal(lspInstallable("pylsp", "darwin", "arm64"), false)
  assert.equal(lspInstallable("basedpyright", "darwin", "arm64"), false)
})
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

test("Pyright installation requests npm metadata as JSON and verifies its archive", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-pyright-install-test-"))
  const previousFetch = globalThis.fetch
  try {
    const packageDirectory = path.join(directory, "fixture", "package", "dist")
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(path.join(packageDirectory, "langserver.index.js"), "// test server\n")
    const archive = path.join(directory, "pyright.tgz")
    await tar.c({ gzip: true, cwd: path.join(directory, "fixture"), file: archive }, ["package"])
    const bytes = await readFile(archive)
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
    const tarball = "https://registry.npmjs.org/pyright/-/pyright-1.2.3.tgz"
    const requests = []
    globalThis.fetch = async (url, options = {}) => {
      requests.push({ url, accept: options.headers?.Accept })
      if (url === "https://registry.npmjs.org/pyright/latest") {
        if (options.headers?.Accept !== "application/json")
          return new Response(null, { status: 406 })
        return Response.json({ version: "1.2.3", dist: { tarball, integrity } })
      }
      assert.equal(url, tarball)
      return new Response(bytes)
    }

    const installed = await installLanguageServer(path.join(directory, "servers"), "python")
    assert.equal(installed?.version, "1.2.3")
    assert.deepEqual(requests, [
      { url: "https://registry.npmjs.org/pyright/latest", accept: "application/json" },
      { url: tarball, accept: undefined },
    ])
    assert.equal(await readFile(installed.path, "utf8"), "// test server\n")
  } finally {
    globalThis.fetch = previousFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test("Lean selects Elan assets and isolates nested Lake projects", async () => {
  const { elanAsset, installedLean } = await import("../electron/main/lean-installer.mjs")
  const { leanProjectRoot, leanServerSpec } = await import("../electron/main/lean-project.mjs")
  assert.equal(elanAsset("win32", "arm64"), null)
  assert.equal(elanAsset("linux", "arm64"), "elan-aarch64-unknown-linux-gnu.tar.gz")
  assert.equal(lspInstallable("lean", "win32", "x64"), true)
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lean-project-"))
  try {
    const nested = path.join(root, "nested")
    await mkdir(path.join(nested, "src"), { recursive: true })
    await writeFile(path.join(nested, "lean-toolchain"), "leanprover/lean4:v4.19.0")
    await writeFile(path.join(nested, "lakefile.toml"), 'name = "demo"')
    const command = path.join(root, process.platform === "win32" ? "lean.exe" : "lean")
    assert.equal(leanProjectRoot(root, "nested/src/Main.lean"), nested)
    assert.equal(leanProjectRoot(root, "Main.lean"), root)
    assert.throws(
      () => leanServerSpec({ command }, root, "nested/src/Main.lean"),
      /Lake is missing/,
    )
    const lake = path.join(root, process.platform === "win32" ? "lake.exe" : "lake")
    await writeFile(lake, "")
    const spec = leanServerSpec(
      { command, env: { ELAN_HOME: "managed" } },
      root,
      "nested/src/Main.lean",
    )
    assert.equal(spec.cwd, nested)
    assert.equal(spec.command, lake)
    assert.deepEqual(spec.args, ["serve", "--"])
    assert.equal(spec.env.ELAN_HOME, "managed")
    assert.equal(await installedLean(root), null)
    const home = path.join(root, "lean", "elan")
    await mkdir(path.join(home, "bin"), { recursive: true })
    for (const name of ["lean", "lake", "elan"])
      await writeFile(
        path.join(home, "bin", process.platform === "win32" ? name + ".exe" : name),
        "",
      )
    await writeFile(
      path.join(home, "envoi.json"),
      JSON.stringify({ version: "Lean (version 4.19.0, test)" }),
    )
    const managed = await installedServer(root, "lean")
    assert.equal(managed.env.ELAN_HOME, home)
    assert.deepEqual(managed.args, ["--server"])
    assert.equal(await installedServer(root, "lean", "pyright"), null)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Lean installation rejects unverified downloads and permits retry", async () => {
  const { installLean, elanAsset } = await import("../electron/main/lean-installer.mjs")
  if (!elanAsset()) return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-elan-integrity-"))
  const fetch = globalThis.fetch
  try {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return Response.json({
        assets: [
          {
            name: elanAsset(),
            browser_download_url:
              "https://github.com/leanprover/elan/releases/download/v1/elan.zip",
          },
        ],
      })
    }
    await assert.rejects(installLean(root), /Verified Elan archive is unavailable/)
    await assert.rejects(installLean(root), /Verified Elan archive is unavailable/)
    assert.equal(calls, 2)
    assert.equal(await installedServer(root, "lean"), null)
  } finally {
    globalThis.fetch = fetch
    await rm(root, { recursive: true, force: true })
  }
})
