import { StreamLanguage } from "@codemirror/language"
import { instructionNames, csrNames, registers } from "../../shared/riscv/features.mjs"

export const riscvLanguage = StreamLanguage.define({
  startState: () => ({ block: false }),
  token(stream, state) {
    if (state.block) {
      if (stream.skipTo("*/")) {
        stream.match("*/")
        state.block = false
      } else stream.skipToEnd()
      return "comment"
    }
    if (stream.eatSpace()) return null
    if (stream.match("/*")) {
      state.block = true
      return "comment"
    }
    if (
      stream.string.slice(0, stream.pos).trim() === "" &&
      stream.match(
        /^#\s*(?:define|include|if|ifdef|ifndef|elif|else|endif|undef|pragma|line|error|warning)\b/,
      )
    )
      return "meta"
    if (stream.match("#") || stream.match("//")) {
      stream.skipToEnd()
      return "comment"
    }
    if (stream.match(/"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?/)) return "string"
    if (stream.match(/\b\d+[fb]\b/)) return "labelName"
    if (stream.match(/(?:0[xX][\da-fA-F]+|0[bB][01]+|\d+)\b/))
      return stream.peek() === ":" ? "labelName" : "number"
    if (stream.match(/%[a-z_]+/)) return "operator"
    const word = stream.match(/[\w.$]+/)
    if (Array.isArray(word)) {
      const name = word[0]
      if (stream.peek() === ":") return "labelName"
      if (registers.has(name) || csrNames.has(name)) return "variableName.special"
      if (
        instructionNames.has(name.replace(/\.(?:aqrl|aq|rl)$/, "")) ||
        /^(li|la|lla|lga|call|tail|ret|nop|mv)$/.test(name)
      )
        return "keyword"
      return name.startsWith(".") ? "meta" : "variableName"
    }
    stream.next()
    return "operator"
  },
  languageData: {
    commentTokens: { line: "#", block: { open: "/*", close: "*/" } },
    closeBrackets: { brackets: ["(", "[", '"'] },
  },
})
