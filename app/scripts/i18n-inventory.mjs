#!/usr/bin/env node
// Scans app/src for user-visible UI strings (CJK literals, attribute labels, JSX text)
// and writes an inventory snapshot used to drive the i18n migration.
import { readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, relative, resolve } from "node:path"

const root = resolve(import.meta.dirname, "..")
const src = join(root, "src")
const outDir = join(root, "tmp", "i18n")
mkdirSync(outDir, { recursive: true })

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(tsx|ts)$/.test(name)) out.push(p)
  }
  return out
}

const files = walk(src)
const cjk = /[\u3400-\u9fff\uf900-\ufaff]/
const literal = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g
const attr =
  /\b(?:aria-label|title|placeholder|alt|aria-description)=(["'])((?:\\.|(?!\1)[\s\S])*?)\1/g

const cjkStrings = new Map() // value -> [{file,line}]
const attrStrings = new Map() // value -> [{file,line}]
const jsxText = new Map() // value -> [{file,line}]  (heuristic)

for (const file of files.sort()) {
  const text = readFileSync(file, "utf8")
  const lines = text.split("\n")
  for (const m of text.matchAll(literal)) {
    const value = m[1] === "`" ? m[2].replace(/\\`/g, "`") : m[2]
    if (!cjk.test(value)) continue
    const line = text.slice(0, m.index).split("\n").length
    if (!cjkStrings.has(value)) cjkStrings.set(value, [])
    cjkStrings.get(value).push({ file: relative(root, file), line })
  }
  for (const m of text.matchAll(attr)) {
    const value = m[2]
    if (!value.trim()) continue
    const line = text.slice(0, m.index).split("\n").length
    const key = `${m[1] === "aria-label" ? "aria" : m[1] === "title" ? "title" : m[1] === "placeholder" ? "placeholder" : "alt"}: ${value}`
    if (!attrStrings.has(key)) attrStrings.set(key, [])
    attrStrings.get(key).push({ file: relative(root, file), line })
  }
  // Heuristic JSX text children: >…text…< spanning at most 3 lines, no tag nesting.
  for (const m of text.matchAll(/>\s*([^<{}]{2,120}?)\s*</g)) {
    const value = m[1]
    if (!cjk.test(value) || /[{}<>]/.test(value)) continue
    const line = text.slice(0, m.index).split("\n").length
    if (!jsxText.has(value)) jsxText.set(value, [])
    jsxText.get(value).push({ file: relative(root, file), line })
  }
}

function dump(map) {
  return [...map.entries()]
    .map(([value, locs]) => {
      const first = locs[0]
      return `${value}\t${locs.length}\t${first.file}:${first.line}`
    })
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .join("\n")
}

const cjkPath = join(outDir, "cjk-literals.txt")
const attrPath = join(outDir, "attr-strings.txt")
const jsxPath = join(outDir, "jsx-text.txt")
writeFileSync(cjkPath, dump(cjkStrings))
writeFileSync(attrPath, dump(attrStrings))
writeFileSync(jsxPath, dump(jsxText))
console.log(`CJK literals: ${cjkStrings.size}`)
console.log(`Attr strings: ${attrStrings.size}`)
console.log(`JSX text fragments: ${jsxText.size}`)
console.log(`Inventory written to ${relative(root, outDir)}`)
