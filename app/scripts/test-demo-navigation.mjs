import { build } from "esbuild"
import { readFile, readdir } from "node:fs/promises"
import { createHash } from "node:crypto"
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs"
import assert from "node:assert/strict"
await build({
  entryPoints: ["src/lib/paperOutline.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/compile-check/outline.mjs",
})
const { buildOutline } = await import("../tmp/compile-check/outline.mjs")
const files = []
async function walk(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["build", "output"].includes(entry.name)) continue
    const path = prefix + entry.name
    if (entry.isDirectory()) await walk(dir + "/" + entry.name, path + "/")
    else if (path.endsWith(".tex"))
      files.push({ id: path, path, text: await readFile(dir + "/" + entry.name, "utf8") })
  }
}
await walk("../examples/demo")
const task = getDocument({
  data: new Uint8Array(await readFile("../examples/demo/build/main.pdf")),
  useSystemFonts: true,
})
try {
  const pdf = await task.promise,
    bookmarks = await pdf.getOutline()
  const flatten = (nodes) => nodes.flatMap((n) => [n, ...flatten(n.children ?? n.items ?? [])])
  const all = flatten(bookmarks)
  let count = 0
  for (const node of flatten(buildOutline(files, "main.tex").nodes)) {
    const title = (node.number ? node.number + " " : "") + node.title
    const matches = all.filter((item) => item.title === title)
    assert.equal(matches.length, 1, title)
    const dest = await pdf.getDestination(matches[0].dest)
    assert.equal(dest[1].name, "XYZ")
    const page = await pdf.getPageIndex(dest[0])
    assert(page >= 0 && page < pdf.numPages)
    count++
    if (
      ["1 Introduction", "5 Illustrative Evaluation", "A.8 Build and version boundaries"].includes(
        title,
      )
    )
      console.log(title, "→ actual page", page + 1, "y", dest[3])
  }
  const manifest = JSON.parse(await readFile("../examples/demo/build/preview.json", "utf8"))
  const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
  assert.equal(hash(await readFile("../examples/demo/build/main.pdf")), manifest.pdfSha256)
  for (const [path, digest] of Object.entries(manifest.files))
    assert.equal(hash(await readFile("../examples/demo/" + path)), digest, path)
  console.log(
    "PASS",
    count,
    "unique actual PDF chapter destinations; source and PDF fingerprints verified",
  )
} finally {
  await task.destroy()
}
await build({
  entryPoints: ["src/lib/pdfSync.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/compile-check/pdf-sync.mjs",
})
const { verifyPreview } = await import("../tmp/compile-check/pdf-sync.mjs")
const manifestText = await readFile("../examples/demo/build/preview.json", "utf8"),
  manifest = JSON.parse(manifestText),
  inputs = []
for (const filePath of Object.keys(manifest.files)) {
  const buffer = await readFile("../examples/demo/" + filePath)
  const text = /\.(tex|bib|csv)$/.test(filePath) ? buffer.toString() : undefined
  inputs.push({
    id: filePath,
    path: filePath,
    kind: filePath.endsWith(".tex") ? "latex" : "image",
    text,
    saved: text,
    file: new File([buffer], filePath),
  })
}
inputs.push({
  id: "build/preview.json",
  path: "build/preview.json",
  kind: "markdown",
  text: manifestText,
  saved: manifestText,
})
const project = {
  id: "demo-test",
  name: "demo",
  rootId: "main.tex",
  files: inputs,
  directories: [],
}
const pdf = {
  id: "build/main.pdf",
  file: new File([await readFile("../examples/demo/build/main.pdf")], "main.pdf"),
}
assert.equal(await verifyPreview(project, pdf), true)
const edited = {
  ...project,
  files: inputs.map((file) =>
    file.path === "main.tex" ? { ...file, text: file.text + "\n% edit" } : file,
  ),
}
assert.equal(await verifyPreview(edited, pdf), false)
assert.equal(
  await verifyPreview(project, { ...pdf, file: new File(["different"], "main.pdf") }),
  false,
)
console.log(
  "PASS browser verification logic accepts exact artifact and rejects edited source/replaced PDF",
)
