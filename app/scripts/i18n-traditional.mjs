#!/usr/bin/env node
// Generates zh-TW.ts and zh-HK.ts from the canonical zh-CN.ts dictionary via OpenCC.
// zh-TW: s2twp (简体→繁体，台湾惯用语). zh-HK: s2hk (简体→繁体，香港字形).
// HK 术语覆盖（繁体→繁体）追加在 OVERRIDES_HK 中，按最长匹配优先应用。
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as OpenCC from "opencc-js"

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "i18n", "messages")

/* ---------- 台湾术语修正（OpenCC twp 的 IT 词表里有误映射，输出之后修正） ---------- */
const OVERRIDES_TW = [["全域性", "全域"]]

/* ---------- 香港术语覆盖（OpenCC s2hk 输出之后应用） ---------- */
const OVERRIDES_HK = [
  ["網路", "網絡"],
  ["軟體", "軟件"],
  ["內存", "記憶體"],
  ["兼容", "相容"],
  ["默認", "預設"],
]

function parseDictionary(path) {
  let text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
  const pairs = []
  const re = /["']([^"']+)["']\s*:\s*["']((?:[^"'\\]|\\.)*)["']/g
  let m
  while ((m = re.exec(text))) pairs.push([m[1], m[2].replace(/\\(.)/g, "$1")])
  if (!pairs.length) throw new Error(`未解析到任何键值：${path}`)
  return pairs
}

/** 保护 {name} 插值占位符不被转换。 */
function protect(text) {
  const tokens = []
  const protectedText = text.replace(/\{(\w+)\}/g, (match) => {
    tokens.push(match)
    return `\0${tokens.length - 1}\0`
  })
  return { protectedText, tokens }
}
function restore(text, tokens) {
  return text.replace(/\0(\d+)\0/g, (match, i) => tokens[Number(i)])
}

function render(name, pairs) {
  const lines = pairs.map(
    ([key, value]) => ` '${key}':'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`,
  )
  return `/** 由 scripts/i18n-traditional.mjs 从 zh-CN.ts 自动生成（OpenCC）。术语覆盖请修改该脚本，勿手改本文件。 */\nimport type {Messages} from './zh-CN';\nconst ${name}: Messages = {\n${lines.join(",\n")},\n};\nexport default ${name};\n`
}

const convertTW = OpenCC.Converter({ from: "cn", to: "twp" })
const convertHK = OpenCC.Converter({ from: "cn", to: "hk" })

function pipeline(convert, overrides = []) {
  return (text) => {
    const { protectedText, tokens } = protect(text)
    let out = convert(protectedText)
    for (const [from, to] of overrides.sort((a, b) => b[0].length - a[0].length))
      out = out.split(from).join(to)
    return restore(out, tokens)
  }
}

const pairs = parseDictionary(join(messagesDir, "zh-CN.ts"))
const tw = pipeline(convertTW, OVERRIDES_TW)
const hk = pipeline(convertHK, OVERRIDES_HK)
const twPairs = pairs.map(([key, value]) => [key, tw(value)])
const hkPairs = pairs.map(([key, value]) => [key, hk(value)])
writeFileSync(join(messagesDir, "zh-TW.ts"), render("zhTW", twPairs))
writeFileSync(join(messagesDir, "zh-HK.ts"), render("zhHK", hkPairs))
console.log(`zh-TW / zh-HK generated from ${pairs.length} keys.`)
