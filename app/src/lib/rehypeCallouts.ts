import type { Element, Root } from "hast"

/** rehype 插件：把 Obsidian / GitHub 风格的 `> [!type]` 块引用转换为带标题的 callout 卡片。 */
const KIND: Record<string, string> = {
  note: "note",
  info: "note",
  todo: "todo",
  abstract: "abstract",
  summary: "abstract",
  tldr: "abstract",
  tip: "tip",
  hint: "tip",
  success: "tip",
  check: "tip",
  done: "tip",
  question: "question",
  help: "question",
  faq: "question",
  warning: "warning",
  caution: "warning",
  attention: "warning",
  important: "important",
  example: "example",
  quote: "quote",
  cite: "quote",
  failure: "danger",
  fail: "danger",
  missing: "danger",
  danger: "danger",
  error: "danger",
  bug: "danger",
}
const LABEL: Record<string, string> = {
  note: "Note",
  todo: "Todo",
  abstract: "Abstract",
  tip: "Tip",
  question: "Question",
  warning: "Warning",
  important: "Important",
  example: "Example",
  quote: "Quote",
  danger: "Danger",
}

function transform(quote: Element) {
  const first = quote.children.find((child) => child.type === "element")
  if (!first || first.tagName !== "p" || !first.children.length) return
  const text = first.children[0]
  if (text.type !== "text") return
  const match = text.value.match(/^\[!([A-Za-z]+)\][+-]?[ \t]*/)
  if (!match) return
  const kind = KIND[match[1].toLowerCase()]
  if (!kind) return
  const rest = text.value.slice(match[0].length)
  const newline = rest.indexOf("\n")
  const title = (newline === -1 ? rest : rest.slice(0, newline)).trim() || LABEL[kind]
  text.value = newline === -1 ? "" : rest.slice(newline + 1)
  if (!text.value.trim()) first.children.shift()
  if (!first.children.length) quote.children.splice(quote.children.indexOf(first), 1)
  quote.properties = { ...quote.properties, className: ["callout", `callout-${kind}`] }
  quote.children.unshift({
    type: "element",
    tagName: "p",
    properties: { className: ["callout-title"] },
    children: [{ type: "text", value: title }],
  })
}

export function rehypeCallouts() {
  return (tree: Root) => {
    const walk = (node: Root | Element) => {
      if ("tagName" in node && node.tagName === "blockquote") transform(node)
      node.children.forEach((child) => {
        if (child.type === "element") walk(child)
      })
    }
    walk(tree)
  }
}
