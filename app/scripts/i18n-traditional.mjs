#!/usr/bin/env node
// Generates zh-TW.ts and zh-HK.ts from the canonical zh-CN.ts dictionary via OpenCC.
// zh-TW: s2twp (简体→繁体，台湾惯用语). zh-HK: s2hk (简体→繁体，香港字形).
// HK 术语覆盖（繁体→繁体）追加在 OVERRIDES_HK 中，按最长匹配优先应用。
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import * as OpenCC from "opencc-js"
import ts from "typescript"
import assert from "node:assert/strict"

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
const KEY_OVERRIDES_TW = {
  "research.merge": "檢視並合併",
  "settings.category.extensions": "擴充功能",
  "extensions.loadFailed": "擴充功能 {id} 載入失敗，其他擴充功能仍可使用。",
  "extensions.retry": "重新啟動語言服務",
  "extensions.cpp.description": "C 與 C++ 補全、診斷與跳轉",
  "extensions.openProject": "請先開啟專案，再設定工作區擴充功能。",
  "extensions.installPrompt": "找不到{name}語言伺服器。要取得嗎？",
  "extensions.installAction": "下載並安裝",
  "extensions.restartToInstall": "請完全結束並重新開啟 Envoi，然後重試安裝。",
  "extensions.toolReady": "已偵測到工具",
  "extensions.workspaceOverride": "工作區覆寫",
  "extensions.autoDetect": "自動偵測",
  "extensions.configure": "設定{name}",
  "extensions.pathUnavailable": "已儲存的路徑不可用",
  "settings.search.priorityTitle": "來源優先級",
  "settings.search.priorityAria": "{source} 來源優先級",
  "settings.update.channel": "更新頻道",
  "settings.update.preview": "預先發行版",
  "settings.update.previewAvailable": "發現預先發行版本",
  "settings.update.noPreview": "暫無預先發行版本。",
  "settings.update.downloadPreview": "下載預先發行版",
  "settings.update.openInstaller": "開啟安裝程式",
  "settings.update.restart": "重新啟動並更新",
  "settings.update.readyToRestart": "更新已下載，重新啟動應用程式即可安裝。",
  "settings.update.noInstaller": "發現新版本，但沒有適用於目前系統的可驗證安裝程式。",
  "app.statusbar.lspUnavailable": "LSP 無法使用",
  "command.reader-read-only": "切換唯讀預覽",
  "settings.tools.group.build": "建置系統",
  "settings.tools.refresh": "重新偵測",
  "settings.tools.projectVenv": "目前專案環境 (.venv)",
  "settings.tools.projectVenvMissing":
    "未偵測到 .venv 或 venv；建立後 Python 語言服務將優先使用其中的工具。",
  "reader.readOnly": "唯讀預覽",
}
const KEY_OVERRIDES_HK = {
  "research.merge": "查看並合併",
  "settings.category.extensions": "擴充功能",
  "extensions.loadFailed": "擴充功能 {id} 載入失敗，其他擴充功能仍可使用。",
  "extensions.retry": "重新啟動語言服務",
  "extensions.cpp.description": "C 與 C++ 補全、診斷與跳轉",
  "extensions.openProject": "請先開啟專案，再設定工作區擴充功能。",
  "extensions.missingTool": "缺少語言伺服器",
  "extensions.installPrompt": "搵唔到{name}語言伺服器。要下載嗎？",
  "extensions.downloadPage": "開啟下載頁面",
  "extensions.installAction": "下載並安裝",
  "extensions.restartToInstall": "請完全結束並重新開啟 Envoi，然後重試安裝。",
  "extensions.toolReady": "已偵測到工具",
  "extensions.enabled": "啟用",
  "extensions.inherited": "繼承全域設定",
  "extensions.workspaceOverride": "工作區覆寫",
  "extensions.languageServer": "語言伺服器",
  "extensions.autoDetect": "自動偵測",
  "extensions.toolSettings": "工具設定",
  "extensions.starting": "正在啟動",
  "extensions.startFailed": "啟動失敗",
  "extensions.configure": "設定{name}",
  "extensions.pathPlaceholder": "執行檔的絕對路徑",
  "extensions.lint": "程式碼檢查",
  "extensions.pathUnavailable": "已儲存的路徑不可用",
  "extensions.localEnvironmentHint": "自動檢測本機語言伺服器與工具，成功後會記住其路徑",
  "settings.update.openInstaller": "開啟安裝程式",
  "settings.update.restart": "重新啟動並更新",
  "settings.update.readyToRestart": "更新已下載，重新啟動應用程式即可安裝。",
  "settings.update.downloaded": "更新已下載，檔案位置：",
  "settings.update.noInstaller": "發現新版本，但沒有適用於目前系統的可驗證安裝程式。",
  "command.reader-read-only": "切換唯讀預覽",
  "settings.tools.projectVenv": "目前項目環境 (.venv)",
  "settings.tools.projectVenvMissing":
    "未檢測到 .venv 或 venv；建立後 Python 語言服務將優先使用其中的工具。",
  "reader.livePreview": "即時預覽",
  "reader.readOnly": "唯讀預覽",
  "tree.paste": "貼上",
}

function parseDictionary(path) {
  const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true)
  const pairs = []
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isStringLiteral(node.name) &&
      ts.isStringLiteral(node.initializer)
    )
      pairs.push([node.name.text, node.initializer.text])
    ts.forEachChild(node, visit)
  }
  visit(source)
  if (!pairs.length) throw new Error(`No dictionary entries: ${path}`)
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
  return `/** 由 scripts/i18n-traditional.mjs 从 zh-CN.ts 自动生成（OpenCC）。术语覆盖请修改该脚本，勿手改本文件。 */\nimport type { Messages } from "./zh-CN"\nconst ${name}: Messages = ${JSON.stringify(Object.fromEntries(pairs), null, 2)}\nexport default ${name}\n`
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
const twPairs = pairs.map(([key, value]) => [key, KEY_OVERRIDES_TW[key] ?? tw(value)])
const hkPairs = pairs.map(([key, value]) => [key, KEY_OVERRIDES_HK[key] ?? hk(value)])
if (process.argv.includes("--check")) {
  for (const [locale, expected] of [
    ["TW", twPairs],
    ["HK", hkPairs],
  ])
    assert.deepEqual(
      Object.fromEntries(parseDictionary(join(messagesDir, `zh-${locale}.ts`))),
      Object.fromEntries(expected),
      `zh-${locale} is out of sync; run npm run i18n:traditional`,
    )
  console.log(`Traditional dictionaries match ${pairs.length} source keys.`)
} else {
  writeFileSync(join(messagesDir, "zh-TW.ts"), render("zhTW", twPairs))
  writeFileSync(join(messagesDir, "zh-HK.ts"), render("zhHK", hkPairs))
  console.log(`zh-TW / zh-HK generated from ${pairs.length} keys.`)
}
