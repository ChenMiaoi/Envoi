import { createHash } from "node:crypto"
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import path from "node:path"
import { compileSnapshot } from "../server/compiler.mjs"
const root = fileURLToPath(new URL("../../examples/demo/", import.meta.url))
const files = []
async function walk(dir, prefix = "") {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || ["build", "output"].includes(entry.name)) continue
    const relative = prefix + entry.name
    if (entry.isDirectory()) await walk(path.join(dir, entry.name), relative + "/")
    else if (/\.(tex|bib|sty|cls|bst|png|jpe?g|pdf|eps|csv|txt|dat|otf|ttf)$/i.test(relative))
      files.push({
        path: relative,
        base64: (await readFile(path.join(dir, entry.name))).toString("base64"),
      })
  }
}
await walk(root)
const result = await compileSnapshot(
  { main: "main.tex", engine: "pdflatex", files },
  { trustedRoot: root },
)
await mkdir(path.join(root, "build"), { recursive: true })
await writeFile(path.join(root, "build/compile.log"), result.log)
if (!result.ok) throw Error(result.error + "\n" + result.log.slice(-1500))
await writeFile(path.join(root, "build/main.pdf"), Buffer.from(result.pdf, "base64"))
console.log("Built examples/demo/build/main.pdf")

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
await writeFile(
  path.join(root, "build/preview.json"),
  JSON.stringify(
    {
      main: "main.tex",
      pdfSha256: hash(Buffer.from(result.pdf, "base64")),
      files: Object.fromEntries(
        files.map((file) => [file.path, hash(Buffer.from(file.base64, "base64"))]),
      ),
    },
    null,
    2,
  ),
)
