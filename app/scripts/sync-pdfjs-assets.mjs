import { cp, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
const source = fileURLToPath(new URL("../node_modules/pdfjs-dist/", import.meta.url))
const target = fileURLToPath(new URL("../public/pdfjs/", import.meta.url))
await rm(target, { recursive: true, force: true })
for (const entry of ["cmaps", "standard_fonts", "wasm", "LICENSE"])
  await cp(path.join(source, entry), path.join(target, entry), { recursive: true })
console.log(
  "Synced pdfjs runtime assets (cmaps, standard_fonts, wasm) from pdfjs-dist into public/pdfjs.",
)
