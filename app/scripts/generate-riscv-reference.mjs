import { readFile, readdir, writeFile, mkdir, copyFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import path from "node:path"

const repository = path.resolve(import.meta.dirname, "../../vendor/riscv-opcodes")
const output = path.resolve(import.meta.dirname, "../shared/riscv")
const revision = execFileSync("git", ["-C", repository, "rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim()
const instructions = new Map(),
  imports = []
for (const directory of ["extensions", "extensions/unratified"]) {
  for (const file of (
    await readdir(path.join(repository, directory), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name, "en"))) {
    if (!file.isFile() || !file.name.startsWith("rv")) continue
    const source = `${directory}/${file.name}`
    for (const row of (await readFile(path.join(repository, source), "utf8")).split(/\r?\n/)) {
      const tokens = row.trim().split(/\s+/)
      if (!tokens[0] || tokens[0].startsWith("#")) continue
      if (tokens[0] === "$import") {
        imports.push({
          source,
          name: tokens[1].split("::")[1],
          target: tokens[1].split("::")[0],
          extension: file.name,
        })
        continue
      }
      const pseudo = tokens[0] === "$pseudo_op"
      const name = tokens[pseudo ? 2 : 0]
      if (!/^[\w.]+$/.test(name)) throw Error(`Invalid instruction in ${source}`)
      const entry = {
        extension: file.name,
        source,
        operands: tokens.slice(pseudo ? 3 : 1).filter((value) => !value.includes("=")),
        pseudo,
        unratified: directory.endsWith("unratified"),
      }
      const variants = instructions.get(name) ?? []
      variants.push(entry)
      instructions.set(name, variants)
    }
  }
}
for (const item of imports) {
  const variants = instructions.get(item.name)
  const { target, ...imported } = item
  const original = variants?.find((entry) => entry.extension === target)
  if (!original) throw Error(`Unresolved opcode import: ${target}::${item.name}`)
  variants.push({ ...original, ...imported, unratified: item.source.includes("unratified/") })
}
const csrs = []
for (const file of ["csrs.csv", "csrs32.csv"]) {
  for (const row of (await readFile(path.join(repository, file), "utf8")).split(/\r?\n/)) {
    const match = row.match(/^(0x[\da-f]+),\s*"([\w]+)"/i)
    if (match)
      csrs.push({
        name: match[2],
        address: match[1].toLowerCase(),
        rv32Only: file === "csrs32.csv",
      })
  }
}
const data = {
  repository: "https://github.com/riscv/riscv-opcodes",
  revision,
  instructions: Object.fromEntries([...instructions].sort(([a], [b]) => a.localeCompare(b, "en"))),
  csrs,
}
await mkdir(output, { recursive: true })
await writeFile(path.join(output, "opcodes.json"), JSON.stringify(data, null, 2) + "\n")
await copyFile(path.join(repository, "LICENSE"), path.join(output, "LICENSE"))
console.log(
  `Generated ${instructions.size} instruction names and ${csrs.length} CSRs from ${revision}`,
)
