import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test from "node:test"
import { runLanguageTool } from "../electron/main/language-tools.mjs"

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

test("file based checkers require the saved source", async (context) => {
  if (process.platform === "win32") return context.skip("Executable fixture uses POSIX scripts")
  const root = await mkdtemp(path.join(tmpdir(), "envoi-language-tools-"))
  try {
    const tidy = path.join(root, "clang-tidy")
    await writeFile(tidy, '#!/bin/sh\necho "$1:1:5: warning: example warning [sample-check]"\n', {
      mode: 0o755,
    })
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "main.cpp"), "int x;\n")
    await assert.rejects(
      runLanguageTool(root, "src/main.cpp", "int y;\n", "lint", tidy),
      /Save the file/,
    )
    const result = await runLanguageTool(root, "src/main.cpp", "int x;\n", "lint", tidy)
    assert.deepEqual(result.diagnostics, [
      {
        line: 1,
        column: 5,
        message: "example warning",
        severity: "warning",
        source: "sample-check",
      },
    ])
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
    await writeFile(path.join(root, "crate", "src", "main.rs"), source)
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
      `#!/bin/sh\n[ "$1" = clippy ] || exit 2\nprintf '%s\\n' '${message}'\n`,
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
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
