import { compileSnapshot } from "../server/compiler.mjs"
import { build } from "esbuild"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import assert from "node:assert/strict"
await build({
  entryPoints: ["src/lib/projectFiles.ts", "src/lib/projectSession.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "tmp/restore-check",
})
const { readProject } = await import("../tmp/restore-check/projectFiles.js")
const { mergeDrafts } = await import("../tmp/restore-check/projectSession.js")
let compiledLog
globalThis.window = {
  envoi: {
    async fsList(root) {
      const files = [],
        directories = []
      async function walk(folder, prefix = "") {
        for (const item of await readdir(folder, { withFileTypes: true })) {
          if ([".git", ".envoi", ".paperdesk", "node_modules"].includes(item.name)) continue
          const relative = prefix + item.name
          if (item.isDirectory()) {
            directories.push(relative)
            await walk(path.join(folder, item.name), relative + "/")
          } else {
            const bytes = await readFile(path.join(folder, item.name))
            if (relative === "build/diagnostics.json") continue
            files.push({
              path: relative,
              kind: "text",
              text:
                relative === "build/compile.log" && compiledLog
                  ? compiledLog
                  : /\.(tex|bib|csv|txt|json|md|log)$/.test(relative)
                    ? bytes.toString()
                    : undefined,
            })
          }
        }
      }
      await walk(root)
      return { files, directories }
    },
    async fsRead(root, relative) {
      return { text: await readFile(path.join(root, relative), "utf8") }
    },
    async assetUrl(root, relative) {
      return (
        "data:application/octet-stream;base64," +
        (await readFile(path.join(root, relative))).toString("base64")
      )
    },
  },
}
const root = path.resolve("../examples/demo"),
  snapshot = []
for (const file of (await window.envoi.fsList(root)).files) {
  if (
    file.path.startsWith("build/") ||
    file.path.startsWith("output/") ||
    !/\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(file.path)
  )
    continue
  snapshot.push({
    path: file.path,
    base64: (await readFile(path.join(root, file.path))).toString("base64"),
  })
}
const compilation = await compileSnapshot(
  { main: "main.tex", engine: "pdflatex", files: snapshot },
  { trustedRoot: root },
)
assert(compilation.ok, compilation.log)
compiledLog = compilation.log
const project = await readProject(root)
assert(project.diagnostics.items.length >= 6)
const imageWarnings = project.diagnostics.items.filter((item) =>
  item.message.includes("image without description"),
)
assert.equal(imageWarnings.length, 6)
assert(imageWarnings.every((item) => item.path?.startsWith("chapters/") && item.line))
assert.notEqual(project.diagnostics.signature, "legacy-unverified")
const restored = mergeDrafts(project, {
  ...project,
  diagnostics: { ...project.diagnostics, status: "cancelled", items: [] },
})
assert.equal(restored.diagnostics.items.length, project.diagnostics.items.length)
console.log(
  "PASS actual disk legacy log restored",
  project.diagnostics.items.length,
  "diagnostics; all 6 image warnings point to chapters; empty cancelled cache cannot erase them",
)
