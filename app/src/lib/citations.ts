export interface Citation {
  key: string
  start: number
  end: number
}

// Mask comments and literal environments without changing source offsets.
export function maskLatex(source: string): string {
  return source.replace(
    /\\begin\{(verbatim\*?|Verbatim|lstlisting|minted|comment)\}[\s\S]*?\\end\{\1\}|\\verb\*?([^a-zA-Z\s])[\s\S]*?\2|\\[%\\]|%[^\n]*/g,
    (match) => (match.startsWith("\\%") || match === "\\\\" ? "  " : match.replace(/[^\n]/g, " ")),
  )
}

export function findCitations(source: string): Citation[] {
  const text = maskLatex(source)
  const found: Citation[] = []
  const pattern =
    /\\(cite|citep|citet|citealp|citealt|citeauthor|citeyear|citeyearpar|autocite|parencite|textcite|footcite|footcitetext|smartcite|supercite|fullcite|footfullcite|cites|parencites|textcites|autocites)\*?(?![a-zA-Z])/gi
  for (const match of text.matchAll(pattern)) {
    let cursor = match.index + match[0].length
    const multiple = /cites$/i.test(match[1])
    do {
      while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++
      while (text[cursor] === "[") {
        let depth = 1
        cursor++
        while (cursor < text.length && depth) {
          if (text[cursor] === "[") depth++
          if (text[cursor] === "]") depth--
          cursor++
        }
        while (/\s/.test(text[cursor] ?? "") && cursor < text.length) cursor++
      }
      if (text[cursor] !== "{") break
      const close = text.indexOf("}", cursor + 1)
      if (close < 0) break
      const keys = text
        .slice(cursor + 1, close)
        .split(",")
        .map((key) => key.trim())
      for (const key of new Set(keys))
        if (key && !/[{}\\\s]/.test(key)) found.push({ key, start: match.index, end: close + 1 })
      cursor = close + 1
    } while (multiple)
  }
  return found
}

export function replaceSelection(source: string, start: number, end: number, insertion: string) {
  const from = Math.max(0, Math.min(start, source.length))
  const to = Math.max(from, Math.min(end, source.length))
  return {
    value: source.slice(0, from) + insertion + source.slice(to),
    cursor: from + insertion.length,
  }
}
