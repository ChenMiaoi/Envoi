import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import {
  detectTool,
  executableName,
  environmentInfo,
  probeVersion,
  pythonEnvironment,
} from "../server/tool-config.mjs"
import { build } from "esbuild"
import { pathToFileURL } from "node:url"

test("tool discovery handles spaces, executable suffix, override priority and directories", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi tool discovery "))
  const saved = { ...process.env }
  try {
    const bin = path.join(root, "bin with spaces"),
      override = path.join(root, "override")
    await mkdir(bin)
    await mkdir(override)
    const name = executableName("envoi-test-tool")
    await writeFile(path.join(bin, name), "fixture", { mode: 0o755 })
    process.env.PATH = process.platform === "win32" ? `"${bin}"` : bin
    delete process.env.ENVOI_TEX_BIN
    delete process.env.PAPERDESK_TEX_BIN
    assert.equal(detectTool("envoi-test-tool"), path.join(bin, name))
    await mkdir(path.join(bin, executableName("not-a-tool")))
    assert.equal(detectTool("not-a-tool"), undefined)
    await writeFile(path.join(override, name), "fixture", { mode: 0o755 })
    process.env.ENVOI_TEX_BIN = override
    assert.equal(detectTool("envoi-test-tool"), path.join(override, name))
    assert.equal(environmentInfo().arch, process.arch)
  } finally {
    process.env = saved
    await rm(root, { recursive: true, force: true })
  }
})

test("project Python environment requires pyvenv.cfg inside .venv or venv", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-venv-"))
  try {
    assert.equal(pythonEnvironment("relative/path"), undefined)
    assert.equal(pythonEnvironment(root), undefined)
    const environment = path.join(root, ".venv")
    await mkdir(environment)
    assert.equal(pythonEnvironment(root), undefined)
    await writeFile(path.join(environment, "pyvenv.cfg"), "")
    assert.equal(pythonEnvironment(root), environment)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("toolchain probe requires every binary and reads the version from the first", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi toolchain "))
  const saved = { ...process.env }
  try {
    const bin = path.join(root, "bin")
    await mkdir(bin)
    process.env.PATH = bin
    process.env.ENVOI_TEX_BIN = bin
    delete process.env.PAPERDESK_TEX_BIN
    const binaries = ["envoi-fake-cc", "envoi-fake-cxx"]
    let result = await probeVersion({ binaries })
    assert.equal(result.available, false)
    assert.match(result.error, /envoi-fake-cc/)
    assert.match(result.error, /envoi-fake-cxx/)
    const script = '#!/bin/sh\necho "fake-cc 1.0"\n'
    await writeFile(path.join(bin, executableName("envoi-fake-cc")), script, { mode: 0o755 })
    result = await probeVersion({ binaries })
    assert.equal(result.available, false)
    assert.ok(!result.error.includes("envoi-fake-cc"))
    assert.match(result.error, /envoi-fake-cxx not found/)
    if (process.platform !== "win32") {
      await writeFile(path.join(bin, "envoi-fake-cxx"), script, { mode: 0o755 })
      result = await probeVersion({ binaries })
      assert.equal(result.available, true)
      assert.equal(result.version, "fake-cc 1.0")
    }
  } finally {
    process.env = saved
    await rm(root, { recursive: true, force: true })
  }
})

test("SyncTeX accepts Windows drive paths and CRLF page records", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-synctex-"))
  try {
    const outfile = path.join(root, "sync.mjs")
    await build({
      entryPoints: ["src/lib/syncTex.ts"],
      outfile,
      bundle: true,
      platform: "node",
      format: "esm",
    })
    const { parseSyncTex, matchSyncTexPath } = await import(pathToFileURL(outfile).href)
    const db = parseSyncTex("Input:1:C:\\paper\\main.tex\r\n{1\r\nh1,2:65536,65536\r\n")
    assert.equal(db.records[0].page, 1)
    assert.equal(matchSyncTexPath(["main.tex"], db.inputs[1]), "main.tex")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
