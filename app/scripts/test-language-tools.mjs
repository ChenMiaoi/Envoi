import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { runLanguageTool } from "../electron/main/language-tools.mjs"
import { runToolProcess } from "../electron/main/tool-process.mjs"

test("cancelled tools do not start and running tools terminate before rejection", async () => {
  const controller = new AbortController()
  controller.abort(Error("revoked"))
  await assert.rejects(
    async () =>
      runToolProcess(process.execPath, ["-e", "process.exit(99)"], { signal: controller.signal }),
    /revoked/,
  )
  const running = new AbortController()
  const job = runToolProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: running.signal,
  })
  const rejection = assert.rejects(job, /closed workspace/)
  running.abort(Error("closed workspace"))
  await rejection
  await assert.rejects(
    runToolProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeout: 50 }),
    /timed out/,
  )
  const result = await runToolProcess(process.execPath, ["-e", "process.stdout.write('ok')"])
  assert.equal(result.stdout, "ok")
  assert.equal(result.code, 0)
})

test("language tools format unsaved text and return lint diagnostics", async (context) => {
  if (process.platform === "win32") return context.skip("Executable fixture uses POSIX scripts")
  const root = await mkdtemp(path.join(tmpdir(), "envoi-language-tools-"))
  try {
    const ruff = path.join(root, "ruff")
    await writeFile(
      ruff,
      '#!/bin/sh\nif [ "$1" = format ]; then cat; else printf \'[{"code":"F401","message":"unused import","location":{"row":2,"column":3}}]\'; exit 1; fi\n',
      { mode: 0o755 },
    )
    const source = "import os\nvalue=1\n"
    const formatted = await runLanguageTool(root, "main.py", source, "format", ruff)
    assert.equal(formatted.text, source)
    const checked = await runLanguageTool(root, "main.py", source, "lint", ruff)
    assert.deepEqual(checked.diagnostics, [
      { line: 2, column: 3, message: "F401: unused import", severity: "warning", source: "Ruff" },
    ])
    await assert.rejects(
      runLanguageTool(root, "../other.py", source, "format", ruff),
      /outside the project/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("clang-tidy checks unsaved text through a virtual filesystem overlay", async (context) => {
  if (process.platform === "win32") return context.skip("Executable fixture uses POSIX scripts")
  const root = await mkdtemp(path.join(tmpdir(), "envoi-language-tools-"))
  try {
    const tidy = path.join(root, "clang-tidy")
    await writeFile(
      tidy,
      '#!/usr/bin/env node\nconst fs = require("node:fs"); const source = process.argv[2]; const arg = process.argv.find(value => value.startsWith("--vfsoverlay=")); if (!arg) process.exit(2); const overlay = JSON.parse(fs.readFileSync(arg.slice(13), "utf8")); if (overlay["use-external-names"] !== false || overlay.roots[0].name !== source || !fs.readFileSync(overlay.roots[0]["external-contents"], "utf8").includes("int y;")) process.exit(2); console.log(`${source}:1:5: warning: example warning [sample-check]`);\n',
      { mode: 0o755 },
    )
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "main.cpp"), "int x;\n")
    const result = await runLanguageTool(root, "src/main.cpp", "int y;\n", "lint", tidy)
    assert.deepEqual(result.diagnostics, [
      {
        line: 1,
        column: 5,
        message: "example warning",
        severity: "warning",
        source: "sample-check",
      },
    ])
    assert.equal(await readFile(path.join(root, "src/main.cpp"), "utf8"), "int x;\n")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Clippy diagnostics map back to the selected Rust file", async (context) => {
  if (process.platform === "win32") return context.skip("Executable fixture uses POSIX scripts")
  const root = await mkdtemp(path.join(tmpdir(), "envoi-language-tools-"))
  try {
    await mkdir(path.join(root, "crate", "src"), { recursive: true })
    await writeFile(
      path.join(root, "crate", "Cargo.toml"),
      '[package]\nname="example"\nversion="0.1.0"\n',
    )
    const source = "fn main() { let unused = 1; }\n"
    await writeFile(path.join(root, "crate", "src", "main.rs"), "fn main() {}\n")
    const clippy = path.join(root, "cargo-clippy")
    const message = JSON.stringify({
      reason: "compiler-message",
      message: {
        level: "warning",
        message: "unused variable",
        code: { code: "unused_variables" },
        spans: [{ is_primary: true, file_name: "src/main.rs", line_start: 1, column_start: 17 }],
      },
    })
    await writeFile(
      clippy,
      `#!/bin/sh\n[ "$1" = clippy ] || exit 2\ngrep -q 'let unused = 1' src/main.rs || exit 2\nprintf '%s\\n' '${message}'\n`,
      { mode: 0o755 },
    )
    const result = await runLanguageTool(root, "crate/src/main.rs", source, "lint", clippy)
    assert.deepEqual(result.diagnostics, [
      {
        line: 1,
        column: 17,
        message: "unused variable",
        severity: "warning",
        source: "unused_variables",
      },
    ])
    assert.equal(
      await readFile(path.join(root, "crate", "src", "main.rs"), "utf8"),
      "fn main() {}\n",
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("Lean formatting uses the unsaved buffer and nearest Lake project", async (context) => {
  if (process.platform === "win32") return context.skip("Executable fixture uses POSIX scripts")
  const root = await mkdtemp(path.join(tmpdir(), "envoi-lean-format-"))
  try {
    const nested = path.join(root, "nested")
    await mkdir(nested)
    await writeFile(path.join(nested, "lakefile.toml"), 'name = "test"')
    await writeFile(path.join(nested, "Main.lean"), "saved buffer")
    const formatter = path.join(root, "lean-fmt")
    await writeFile(
      formatter,
      '#!/bin/sh\n[ "$1" = format ] && [ "$2" = - ] && [ -f lakefile.toml ] || exit 2\ncat\n',
      { mode: 0o755 },
    )
    const draft = "def value := 1\n"
    assert.equal(
      (await runLanguageTool(root, "nested/Main.lean", draft, "format", formatter)).text,
      draft,
    )
    assert.equal(await readFile(path.join(nested, "Main.lean"), "utf8"), "saved buffer")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
