import { build } from "esbuild"
import assert from "node:assert/strict"
import { compileSnapshot, runtimeInfo } from "../server/compiler.mjs"
const runtime = runtimeInfo()
if (!runtime.available) {
  console.log("SKIP diagnostics: TeX runtime unavailable —", runtime.error)
  process.exit(0)
}
await build({
  entryPoints: ["src/lib/diagnostics.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/compile-check/diagnostics.mjs",
})
const { parseDiagnostics } = await import("../tmp/compile-check/diagnostics.mjs")
for (const [kind, chapter] of [
  ["warning", "\\section{Test}\nSee \\ref{missing}."],
  ["error", "\\section{Test}\n\\UndefinedControl"],
]) {
  const files = [
    {
      path: "main.tex",
      text: "\\documentclass{article}\n\\begin{document}\n\\input{chapters/method}\n\\end{document}",
    },
    { path: "chapters/method.tex", text: chapter },
  ]
  const result = await compileSnapshot({
    engine: "pdflatex",
    main: "main.tex",
    files: files.map((f) => ({ path: f.path, base64: Buffer.from(f.text).toString("base64") })),
  })
  const items = parseDiagnostics(result.log, files, !result.ok)
  assert(
    items.some((d) => d.severity === kind && d.path === "chapters/method.tex" && d.line === 2),
    JSON.stringify(items),
  )
  console.log("PASS actual", kind, "→ chapters/method.tex:2")
}
