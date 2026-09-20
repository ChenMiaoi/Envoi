import { translate } from "@/i18n/runtime"
import { parse } from "@retorquere/bibtex-parser"
import { maskLatex } from "./citations"
export function parseBibliography(text: string) {
  const library = parse(text)
  if (library.errors.length) throw new Error(library.errors.map((error) => error.error).join("；"))
  const seen = new Set<string>()
  return library.entries.map((entry) => {
    if (!entry.key || /[\s,{}\\%]/.test(entry.key))
      throw new Error(translate("bib.unsupportedKey", { key: entry.key }))
    if (seen.has(entry.key)) throw new Error(translate("bib.duplicateKey", { key: entry.key }))
    seen.add(entry.key)
    const plain = (value: string | undefined) =>
      (value ?? "")
        .replace(/<[^>]*>/g, "")
        .replace(/\s+/g, " ")
        .trim()
    return {
      inline: false,
      key: entry.key,
      title: plain(entry.fields.title) || translate("bib.noTitle"),
      author:
        entry.fields.author
          ?.map(
            (author) =>
              author.name ||
              [author.firstName, author.prefix, author.lastName, author.suffix]
                .filter(Boolean)
                .join(" "),
          )
          .join("; ") || translate("bib.noAuthor"),
      year: entry.fields.year || entry.fields.date || "",
      venue: plain(entry.fields.journal || entry.fields.booktitle),
      raw: entry.input,
    }
  })
}
export function bibliographyNames(source: string) {
  return [
    ...maskLatex(source).matchAll(
      /\\(?:bibliography|addbibresource)(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g,
    ),
  ].flatMap((match) =>
    match[1].split(",").map((name) => name.trim().replace(/\.bib$/i, "") + ".bib"),
  )
}

/** Inline references are valid LaTeX bibliography entries, without structured BibTeX fields. */
export function inlineBibliography(source: string): ReturnType<typeof parseBibliography> {
  const masked = maskLatex(source)
  return [
    ...masked.matchAll(/\\begin\{thebibliography\}[\s\S]*?\\end\{thebibliography\}/g),
  ].flatMap((environment) => {
    const items = [...environment[0].matchAll(/\\bibitem(?:\s*\[[^\]]*\])?\s*\{([^}]+)\}/g)]
    return items.map((item, index) => {
      const start = environment.index + item.index
      const end =
        environment.index + (items[index + 1]?.index ?? environment[0].lastIndexOf("\\end"))
      const raw = source.slice(start, end).trim()
      const title = maskLatex(source.slice(start + item[0].length, end))
        .replace(/\\(?:newblock|newline|par)\b/g, " ")
        .replace(/\\href\s*\{[^}]*\}\s*\{([^}]*)\}/g, "$1")
        .replace(/\\(?:emph|textit|textbf|url)\s*\{([^}]*)\}/g, "$1")
        .replace(/[{}]/g, "")
        .replace(/\s+/g, " ")
        .trim()
      return { inline: true, key: item[1].trim(), title, author: "", year: "", venue: "", raw }
    })
  })
}
