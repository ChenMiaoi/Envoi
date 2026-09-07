import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { compileSnapshot, runtimeInfo } from "../server/compiler.mjs"

const runtime = runtimeInfo({ trusted: true })
if (!runtime.available) {
  console.log("SKIP native compiler:", runtime.error)
  process.exit(0)
}
const root = await mkdtemp(path.join(tmpdir(), "envoi native compile "))
try {
  await mkdir(path.join(root, "chapters"))
  await writeFile(path.join(root, "chapters", "body.tex"), "Native project input.")
  await writeFile(
    path.join(root, "main.tex"),
    "\\documentclass{article}\\begin{document}\\input{chapters/body}\\end{document}",
  )
  for (const engine of ["pdflatex", "xelatex"]) {
    const result = await compileSnapshot(
      { engine, main: "main.tex", drafts: [] },
      { trustedRoot: root, sourceRoot: root },
    )
    assert.equal(result.ok, true, result.log)
    assert.equal(Buffer.from(result.pdf, "base64").subarray(0, 5).toString(), "%PDF-")
    assert.ok(result.synctex)
    console.log(`PASS native ${engine}: project path with spaces, included source, PDF and SyncTeX`)
  }
} finally {
  await rm(root, { recursive: true, force: true })
}
