import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import test from "node:test"
import * as tar from "tar"
import { installTool, installedTool, toolInstallPlan } from "../electron/main/tool-installer.mjs"

test("install plans match official sources per platform and available package managers", () => {
  const env = { brew: false, rustup: false }
  assert.equal(toolInstallPlan("clangd", env), null)
  assert.equal(toolInstallPlan("gcc", env), null)
  assert.deepEqual(toolInstallPlan("ruffFormat", { ...env, platform: "darwin", arch: "arm64" }), {
    method: "github",
    repository: "astral-sh/ruff",
    target: "aarch64-apple-darwin.tar.gz",
    binary: "ruff",
    platform: "darwin",
  })
  assert.deepEqual(toolInstallPlan("ruffLint", { ...env, platform: "win32", arch: "x64" }), {
    method: "github",
    repository: "astral-sh/ruff",
    target: "x86_64-pc-windows-msvc.zip",
    binary: "ruff",
    platform: "win32",
  })
  assert.equal(toolInstallPlan("rustfmt", env), null)
  assert.deepEqual(toolInstallPlan("rustfmt", { ...env, rustup: true }), {
    method: "rustup",
    component: "rustfmt",
    binary: "rustfmt",
  })
  assert.deepEqual(toolInstallPlan("clippy", { ...env, rustup: true }), {
    method: "rustup",
    component: "clippy",
    binary: "cargo-clippy",
  })
  assert.deepEqual(
    toolInstallPlan("clangFormat", { platform: "darwin", arch: "arm64", brew: true }),
    { method: "brew", formula: "clang-format", binary: "clang-format" },
  )
  assert.deepEqual(
    toolInstallPlan("clangTidy", { platform: "darwin", arch: "arm64", brew: true }),
    { method: "brew", formula: "llvm", binary: "clang-tidy" },
  )
  assert.equal(toolInstallPlan("clangTidy", { platform: "linux", arch: "x64" }), null)
  assert.deepEqual(toolInstallPlan("clangFormat", { platform: "linux", arch: "x64" }), {
    method: "npm",
    package: "clang-format",
    binaryPath: "bin/linux_x64/clang-format",
    binary: "clang-format",
    platform: "linux",
  })
  assert.equal(toolInstallPlan("clangFormat", { platform: "linux", arch: "arm64" }), null)
})

test("managed tool lookup accepts only installed files inside its version directory", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-tool-test-"))
  try {
    const versionDirectory = path.join(directory, "ruff", "0.9.9")
    await mkdir(versionDirectory, { recursive: true })
    await writeFile(path.join(versionDirectory, "ruff"), "")
    const manifest = path.join(directory, "ruff", "current.json")
    await writeFile(manifest, JSON.stringify({ id: "ruff", version: "0.9.9", binary: "ruff" }))
    const found = await installedTool(directory, "ruffFormat")
    assert.equal(found?.path, path.join(versionDirectory, "ruff"))
    assert.equal(found?.version, "0.9.9")
    assert.equal((await installedTool(directory, "ruffLint"))?.path, found?.path)
    assert.equal(await installedTool(directory, "clangFormat"), null)
    await writeFile(manifest, JSON.stringify({ id: "ruff", version: "0.9.9", binary: "../x" }))
    assert.equal(await installedTool(directory, "ruffFormat"), null)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("ruff installs from a verified GitHub release archive", async () => {
  if (process.platform === "win32") return
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-ruff-install-test-"))
  const previousFetch = globalThis.fetch
  try {
    const packageDirectory = path.join(directory, "fixture", "ruff-x86_64-unknown-linux-musl")
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(path.join(packageDirectory, "ruff"), "#!/bin/sh\necho ruff\n")
    const archive = path.join(directory, "ruff.tar.gz")
    await tar.c({ gzip: true, cwd: path.join(directory, "fixture"), file: archive }, [
      "ruff-x86_64-unknown-linux-musl",
    ])
    const bytes = await readFile(archive)
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`
    const name = "ruff-x86_64-unknown-linux-musl.tar.gz"
    const url = `https://github.com/astral-sh/ruff/releases/download/0.9.9/${name}`
    globalThis.fetch = async (requested) => {
      if (requested === "https://api.github.com/repos/astral-sh/ruff/releases/latest")
        return Response.json({
          tag_name: "0.9.9",
          assets: [{ name, digest, browser_download_url: url }],
        })
      assert.equal(requested, url)
      return new Response(bytes)
    }
    const installed = await installTool(path.join(directory, "tools"), "ruffFormat", {
      platform: "linux",
      arch: "x64",
      brew: false,
      rustup: false,
    })
    assert.equal(installed.version, "0.9.9")
    assert.equal(await readFile(installed.path, "utf8"), "#!/bin/sh\necho ruff\n")
    assert.equal(
      (await installedTool(path.join(directory, "tools"), "ruffLint"))?.path,
      installed.path,
    )
  } finally {
    globalThis.fetch = previousFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test("clang-format installs from the verified npm package binaries", async () => {
  if (process.platform === "win32") return
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-clang-format-install-test-"))
  const previousFetch = globalThis.fetch
  try {
    const packageDirectory = path.join(directory, "fixture", "package", "bin", "darwin_x64")
    await mkdir(packageDirectory, { recursive: true })
    await writeFile(path.join(packageDirectory, "clang-format"), "#!/bin/sh\necho clang-format\n")
    const archive = path.join(directory, "clang-format.tgz")
    await tar.c({ gzip: true, cwd: path.join(directory, "fixture"), file: archive }, ["package"])
    const bytes = await readFile(archive)
    const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`
    const tarball = "https://registry.npmjs.org/clang-format/-/clang-format-1.8.0.tgz"
    globalThis.fetch = async (requested, options = {}) => {
      if (requested === "https://registry.npmjs.org/clang-format/latest") {
        if (options.headers?.Accept !== "application/json")
          return new Response(null, { status: 406 })
        return Response.json({ version: "1.8.0", dist: { tarball, integrity } })
      }
      assert.equal(requested, tarball)
      return new Response(bytes)
    }
    const installed = await installTool(path.join(directory, "tools"), "clangFormat", {
      platform: "darwin",
      arch: "x64",
      brew: false,
      rustup: false,
    })
    assert.equal(installed.version, "1.8.0")
    assert.equal(await readFile(installed.path, "utf8"), "#!/bin/sh\necho clang-format\n")
  } finally {
    globalThis.fetch = previousFetch
    await rm(directory, { recursive: true, force: true })
  }
})

test("rustup component install exposes the toolchain binary", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-rustup-install-test-"))
  try {
    const bin = path.join(root, "bin")
    await mkdir(bin)
    await writeFile(
      path.join(bin, "rustup"),
      '#!/bin/sh\nif [ "$1" = "component" ]; then\n  mkdir -p "$HOME/.cargo/bin"\n  printf \'#!/bin/sh\\necho "rustfmt 1.8.0-stable"\\n\' > "$HOME/.cargo/bin/rustfmt"\n  chmod +x "$HOME/.cargo/bin/rustfmt"\nfi\n',
      { mode: 0o755 },
    )
    const script = `import(${JSON.stringify(pathToFileURL(path.resolve("electron/main/tool-installer.mjs")).href)}).then(async (m) => console.log(JSON.stringify(await m.installTool(${JSON.stringify(path.join(root, "tools"))}, "rustfmt", { brew: false, rustup: true }))))`
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { HOME: root, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    })
    const installed = JSON.parse(output)
    assert.equal(installed.path, path.join(root, ".cargo", "bin", "rustfmt"))
    assert.equal(installed.version, "rustfmt 1.8.0-stable")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("brew formula install probes the formula prefix binary", async () => {
  if (process.platform === "win32") return
  const root = await mkdtemp(path.join(tmpdir(), "envoi-brew-install-test-"))
  try {
    const bin = path.join(root, "bin")
    await mkdir(bin)
    await writeFile(
      path.join(bin, "brew"),
      '#!/bin/sh\nif [ "$1" = "install" ]; then\n  mkdir -p "$HOME/fakecellar/$2/bin"\n  printf \'#!/bin/sh\\necho "Homebrew clang-format version 21"\\n\' > "$HOME/fakecellar/$2/bin/clang-format"\n  chmod +x "$HOME/fakecellar/$2/bin/clang-format"\nelif [ "$1" = "--prefix" ]; then\n  echo "$HOME/fakecellar/$2"\nfi\n',
      { mode: 0o755 },
    )
    const script = `import(${JSON.stringify(pathToFileURL(path.resolve("electron/main/tool-installer.mjs")).href)}).then(async (m) => console.log(JSON.stringify(await m.installTool(${JSON.stringify(path.join(root, "tools"))}, "clangFormat", { platform: "darwin", brew: true, rustup: false }))))`
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { HOME: root, PATH: `${bin}:/usr/bin:/bin` },
      encoding: "utf8",
    })
    const installed = JSON.parse(output)
    assert.equal(
      installed.path,
      path.join(root, "fakecellar", "clang-format", "bin", "clang-format"),
    )
    assert.equal(installed.version, "Homebrew clang-format version 21")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
