import { StreamLanguage } from "@codemirror/language"

// Lean block comments can nest; identifiers include Unicode and trailing primes.
export const leanLanguage = StreamLanguage.define({
  startState: () => ({ comments: 0, string: false }),
  token(stream, state) {
    if (!state.comments && !state.string) {
      if (stream.eatSpace()) return null
      if (stream.match("--")) {
        stream.skipToEnd()
        return "comment"
      }
      if (stream.match("/-")) state.comments++
      else if (stream.eat('"')) state.string = true
      else if (
        stream.match(
          /\b(?:theorem|lemma|def|example|instance|inductive|structure|class|namespace|section|end|variable|universe|import|open|export|private|protected|noncomputable|opaque|axiom|abbrev|where|by|fun|forall|let|in|if|then|else|match|with|do|return|have|show|from|calc|Type|Prop|Sort)\b/,
        )
      )
        return "keyword"
      else if (stream.match(/\d+(?:\.\d+)?/)) return "number"
      else if (stream.match(/[\p{L}_][\p{L}\p{N}_'₀-₉]*/u)) return "variableName"
      else {
        stream.next()
        return "operator"
      }
    }
    if (state.comments) {
      while (!stream.eol()) {
        if (stream.match("/-")) state.comments++
        else if (stream.match("-/")) {
          if (!--state.comments) break
        } else stream.next()
      }
      return "comment"
    }
    while (!stream.eol()) {
      const char = stream.next()
      if (char === "\\") stream.next()
      else if (char === '"') {
        state.string = false
        break
      }
    }
    return "string"
  },
  languageData: {
    commentTokens: { line: "--", block: { open: "/-", close: "-/" } },
    closeBrackets: { brackets: ["(", "[", "{", '"', "⟨"] },
  },
})
