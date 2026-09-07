#!/usr/bin/env node
// Merges tmp/i18n/fragments/*.json into src/i18n/messages/{zh-CN,en,ja}.ts.
// Fails on duplicate keys (against existing dictionary or across fragments).
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const messagesDir = join(root, "src", "i18n", "messages")
const fragmentsDir = join(root, "tmp", "i18n", "fragments")

if (!existsSync(fragmentsDir)) {
  console.log("no fragments directory")
  process.exit(0)
}

const files = readdirSync(fragmentsDir)
  .filter((f) => f.endsWith(".json"))
  .sort()
if (!files.length) {
  console.log("no fragments")
  process.exit(0)
}

const merged = {} // key -> {zh,en,ja,source}
for (const file of files) {
  const data = JSON.parse(readFileSync(join(fragmentsDir, file), "utf8"))
  for (const [key, value] of Object.entries(data)) {
    if (!/^[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9.]*$/.test(key))
      throw new Error(`${file}: bad key ${key}`)
    if (merged[key])
      throw new Error(`duplicate key across fragments: ${key} (${file} vs ${merged[key].source})`)
    for (const lang of ["zh", "en", "ja"])
      if (typeof value?.[lang] !== "string" || !value[lang])
        throw new Error(`${file}: ${key} missing ${lang}`)
    merged[key] = { ...value, source: file }
  }
}

function existingKeys(path) {
  const text = readFileSync(path, "utf8")
  return new Set([...text.matchAll(/^ '([^']+)':/gm)].map((m) => m[1]))
}

const targets = { zh: "zh-CN.ts", en: "en.ts", ja: "ja.ts" }
for (const [lang, file] of Object.entries(targets)) {
  const path = join(messagesDir, file)
  const have = existingKeys(path)
  for (const key of Object.keys(merged))
    if (have.has(key)) throw new Error(`${file}: key already exists: ${key}`)
}

const keys = Object.keys(merged).sort()
for (const [lang, file] of Object.entries(targets)) {
  const path = join(messagesDir, file)
  let text = readFileSync(path, "utf8")
  const esc = (v) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/'/g, "\\'")
  const lines = keys.map((key) => ` '${key}':'${esc(merged[key][lang])}'`).join(",\n")
  const block = ` /* ---------- 迁移增补（fragments 合并） ---------- */\n${lines},\n`
  if (file === "zh-CN.ts") {
    const anchor = "} as const;"
    if (!text.includes(anchor)) throw new Error("zh-CN anchor missing")
    text = text.replace(anchor, block + anchor)
  } else {
    const anchor = "\n};"
    const idx = text.lastIndexOf(anchor)
    if (idx < 0) throw new Error(`${file} anchor missing`)
    text = text.slice(0, idx) + "\n" + block.trimStart() + text.slice(idx)
  }
  writeFileSync(path, text)
}
console.log(`merged ${keys.length} keys from ${files.length} fragments into zh-CN/en/ja`)
