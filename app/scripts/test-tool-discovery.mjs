import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises"
import path from "node:path"
import { homedir, tmpdir } from "node:os"
import {
  detectTool,
  executableName,
  environmentInfo,
  probeVersion,
  pythonEnvironment,
  toolCandidates,
  probeLanguageServerPath,
  validateLanguageServerPath,
  probeCandidates,
  compareVersions,
  probeToolPath,
  toolDirectories,
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

test("language servers expose distinct installations and validate a chosen executable", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lsp-choices-"))
  const saved = { ...process.env }
  try {
    const first = path.join(root, "first")
    const second = path.join(root, "second")
    await mkdir(first)
    await mkdir(second)
    const script = '#!/bin/sh\necho "clangd version 99.1"\n'
    const selected = path.join(second, "clangd")
    await writeFile(path.join(first, "clangd"), '#!/bin/sh\necho "clangd version 18.2"\n', {
      mode: 0o755,
    })
    await writeFile(selected, script, { mode: 0o755 })
    process.env.PATH = `${first}${path.delimiter}${second}${path.delimiter}/bin`
    delete process.env.ENVOI_TEX_BIN
    delete process.env.PAPERDESK_TEX_BIN
    assert.deepEqual(toolCandidates("clangd").slice(0, 2), [path.join(first, "clangd"), selected])
    await writeFile(path.join(first, "envoi-version-probe"), '#!/bin/sh\necho "tool 18.2"\n', {
      mode: 0o755,
    })
    await writeFile(path.join(second, "envoi-version-probe"), '#!/bin/sh\necho "tool 99.1"\n', {
      mode: 0o755,
    })
    assert.deepEqual(
      (await probeCandidates("envoi-version-probe")).map((candidate) => candidate.path),
      [path.join(second, "envoi-version-probe"), path.join(first, "envoi-version-probe")],
    )
    assert(compareVersions("clangd version 19.10", "clangd version 19.9") > 0)
    assert.deepEqual(await probeLanguageServerPath("clangd", selected), {
      path: selected,
      version: "clangd version 99.1",
    })
    assert.equal(validateLanguageServerPath("clangd", selected), selected)
    const versioned = path.join(second, "clangd-99")
    await writeFile(versioned, script, { mode: 0o755 })
    await rm(selected)
    await symlink(versioned, selected)
    assert.equal(validateLanguageServerPath("clangd", selected), selected)
    assert.equal(validateLanguageServerPath("clangd", versioned), versioned)
    assert(
      (await probeCandidates("clangd")).some(
        (candidate) => candidate.path === versioned || candidate.path === selected,
      ),
    )
    assert.throws(() => validateLanguageServerPath("ccls", selected), /does not match/)
    assert.throws(() => validateLanguageServerPath("clangd", "clangd --stdio"), /Invalid/)
  } finally {
    process.env = saved
    await rm(root, { recursive: true, force: true })
  }
})

test("manual toolchain selection requires its companion executable", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-toolchain-choice-"))
  try {
    const gcc = path.join(root, "gcc-19")
    await writeFile(gcc, '#!/bin/sh\necho "gcc 19.2"\n', { mode: 0o755 })
    await assert.rejects(probeToolPath("gcc", gcc), /companion/)
    await writeFile(path.join(root, "g++-19"), '#!/bin/sh\necho "g++ 19.2"\n', { mode: 0o755 })
    assert.equal((await probeToolPath("gcc", gcc)).version, "gcc 19.2")
    const python = path.join(root, "python3.14")
    await writeFile(python, '#!/bin/sh\necho "Python 3.14.0"\n', { mode: 0o755 })
    assert.equal((await probeToolPath("python", python)).version, "Python 3.14.0")
    const savedPath = process.env.PATH
    try {
      process.env.PATH = `${root}${path.delimiter}/bin`
      assert(toolCandidates("python").includes(python))
    } finally {
      process.env.PATH = savedPath
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("macOS discovery includes the standard Rust installation directory", () => {
  if (process.platform === "darwin")
    assert(toolDirectories().includes(path.join(homedir(), ".cargo", "bin")))
})

test("a rustup proxy without the rust-analyzer component is unavailable", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-rust-proxy-"))
  const saved = { ...process.env }
  try {
    const proxy = path.join(root, "rust-analyzer")
    await writeFile(proxy, '#!/bin/sh\necho "error: Unknown binary rust-analyzer" >&2\nexit 1\n', {
      mode: 0o755,
    })
    process.env.PATH = `${root}${path.delimiter}/bin`
    assert.equal(
      (await probeCandidates("rust-analyzer")).some((candidate) => candidate.path === proxy),
      false,
    )
    await assert.rejects(probeLanguageServerPath("rustAnalyzer", proxy), /not installed/)
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
