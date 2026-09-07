import { build } from "esbuild"
import { writeFile, mkdir } from "node:fs/promises"
import { compileSnapshot, runtimeInfo } from "../server/compiler.mjs"
const runtime = runtimeInfo()
if (!runtime.available) {
  console.log("SKIP templates: TeX runtime unavailable —", runtime.error)
  process.exit(0)
}
await build({
  entryPoints: ["src/lib/paperTemplates.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/compile-check/templates.mjs",
})
const { paperTemplates, templateFiles } = await import(
  "../tmp/compile-check/templates.mjs?" + Date.now()
)
for (const template of paperTemplates) {
  const input = {
    engine: "pdflatex",
    main: "main.tex",
    files: Object.entries(templateFiles(template.id))
      .filter(([path]) => /\.(tex|bib)$/.test(path))
      .map(([path, text]) => ({ path, base64: Buffer.from(text).toString("base64") })),
  }
  const result = await compileSnapshot(input)
  await mkdir("tmp/compile-check", { recursive: true })
  await writeFile(`tmp/compile-check/${template.id}.log`, result.log)
  if (result.ok) {
    await writeFile(`tmp/compile-check/${template.id}.pdf`, Buffer.from(result.pdf, "base64"))
    console.log("PASS", template.id)
  } else {
    console.log("FAIL", template.id, result.error, result.log.slice(-650))
    process.exitCode = 1
  }
}
