import { readFile } from "node:fs/promises"

const tag = process.argv[2]
if (!/^v\d+\.\d+\.\d+$/.test(tag ?? "")) throw Error("Expected v<major>.<minor>.<patch>")
const file = `docs/releases/${tag}.md`
const notes = (await readFile(file, "utf8")).replace(/<!--[\s\S]*?-->/g, "").trim()
if (!notes || !/^[-*] \S.+/m.test(notes))
  throw Error(`${file} must contain user-facing release notes with at least one change`)
console.log(`Release notes validated: ${file}`)
