import assert from "node:assert/strict"
import { test } from "node:test"
import { parseBibliography, inlineBibliography } from "../src/lib/bibliography"
import { findCitations, replaceSelection } from "../src/lib/citations"
import { collectPaper } from "../src/lib/paperSources"
import { findAssetUses, assetMatches } from "../src/lib/assets"
import { paperDependencies } from "../src/lib/paperDependencies"
import { mergeDiskProject } from "../src/lib/projectFiles"

test("adding the first paper to a code project activates its dependency graph", () => {
  const code = { id: "p", name: "p", rootPath: "/p", rootId: "", files: [], directories: [] }
  const disk = {
    ...code,
    rootId: "main.tex",
    files: [
      {
        id: "main.tex",
        path: "main.tex",
        kind: "latex" as const,
        text: "\\section{Idea}",
        saved: "\\section{Idea}",
      },
    ],
  }
  assert.equal(mergeDiskProject(code, disk).rootId, "main.tex")
})

test("inline bibliography supports labels and ignores commented entries", () => {
  const entries = inlineBibliography(String.raw`\begin{thebibliography}{9}
\bibitem[Frigo et al.]{frigo} Frigo. \emph{Cache-oblivious algorithms}. 1999.
% \bibitem{fake} ignored
\bibitem{other} Another reference.
\end{thebibliography}`)
  assert.deepEqual(
    entries.map((entry) => entry.key),
    ["frigo", "other"],
  )
  assert.match(entries[0].title, /Cache-oblivious algorithms/)
  assert(!entries[0].title.includes("ignored"))
})
test("explicit asset extensions distinguish same-stem files and directories", () => {
  const use = findAssetUses([
    { id: "main", path: "main.tex", text: String.raw`\includegraphics{overview.pdf}` },
  ])[0]
  assert(assetMatches("overview.pdf", use))
  assert(!assetMatches("overview.png", use))
  assert(!assetMatches("other/overview.pdf", use))
})
test("paper dependency graph excludes unrelated experiment output and follows sources and assets", () => {
  const files = [
    ["main.tex", String.raw`\input{method}\includegraphics{overview.pdf}\bibliography{refs}`],
    ["method.tex", String.raw`\input{main}\pgfplotstableread{results.csv}`],
    ["refs.bib", ""],
    ["overview.pdf", ""],
    ["overview.png", ""],
    ["results.csv", ""],
    ["experiment.csv", ""],
    ["log.txt", ""],
  ].map(([path, text]) => ({ id: path, path, text, kind: "text" as const }))
  const dependencies = paperDependencies({
    id: "p",
    name: "p",
    rootId: "main.tex",
    files,
    directories: [],
  })
  assert.deepEqual(dependencies.map((file) => file.path).sort(), [
    "main.tex",
    "method.tex",
    "overview.pdf",
    "refs.bib",
    "results.csv",
  ])
})

test("Bib nested braces, string macros, author lists, malformed and duplicate keys", () => {
  const entries = parseBibliography(
    '@string{venue="Journal"}\n@article{a,title={A {nested} title},author={Doe, Jane and Smith, John},journal=venue,year=2024}\n@book{b,title="Other"}',
  )
  assert.equal(entries.length, 2)
  assert.match(entries[0].title, /nested/)
  assert.match(entries[0].author, /Jane/)
  assert.equal(entries[0].venue, "Journal")
  assert.throws(() => parseBibliography("@article{bad,title={unfinished"))
  assert.throws(() => parseBibliography("@article{a,title={One}} @book{a,title={Two}}"))
  assert.deepEqual(parseBibliography(""), [])
})
test("common cite commands, optional arguments, multiple keys, comments and literal exclusions", () => {
  const source = String.raw`\cite{a,b} \citet*[see][p. 2]{a} % \cite{fake}
\parencite[pp. 3]{b} \autocites[see]{a}[p.4]{c}
\verb|\cite{literal}| \begin{verbatim}\cite{literal2}\end{verbatim}
\% visible \cite{d} \nocite{ignored}`
  const found = findCitations(source)
  assert.deepEqual(
    found.map((x) => x.key),
    ["a", "b", "a", "b", "a", "c", "d"],
  )
  for (const item of found) assert.match(source.slice(item.start, item.end), /^\\/)
  assert.equal(findCitations(String.raw`\cite{a} \cite{a}`).length, 2)
  assert.equal(findCitations(String.raw`\cite{a}`).length, 1)
  assert.equal(findCitations("").length, 0)
})
test("reachable chapters only, cycles and missing files", () => {
  const files = [
    {
      id: "main",
      path: "src/main.tex",
      text: String.raw`\input{method} % \input{unused}
\include{missing}`,
    },
    { id: "method", path: "src/method.tex", text: String.raw`\cite{a}\input{main}` },
    { id: "unused", path: "src/unused.tex", text: String.raw`\cite{b}` },
  ]
  const paper = collectPaper(files, "main")
  assert.deepEqual(
    paper.files.map((x) => x.id),
    ["main", "method"],
  )
  assert.equal(paper.citations[0].key, "a")
  assert.equal(paper.citations[0].fileId, "method")
  assert.equal(paper.missing.length, 1)
})
test("insertion replaces only selection, repeats add citations and caret advances", () => {
  const first = replaceSelection("before SELECT after", 7, 13, String.raw`\cite{a}`)
  assert.equal(first.value, String.raw`before \cite{a} after`)
  const second = replaceSelection(first.value, first.cursor, first.cursor, String.raw`\cite{a}`)
  assert.equal(findCitations(second.value).length, 2)
  assert.equal(second.value.slice(second.cursor), " after")
})
test("assets recognize paths and omitted extensions, exclude comments and locate CSV syntax", () => {
  const files = [
    {
      id: "main",
      path: "src/main.tex",
      text: String.raw`\includegraphics[width=2cm]{../assets/architecture}
% \includegraphics{fake}
\includepdf{../pdfs/envoi-sample.pdf}
\addplot table[x=t]{../assets/data.csv};`,
    },
  ]
  const uses = findAssetUses(files)
  assert.equal(uses.length, 3)
  assert(assetMatches("assets/architecture.png", uses[0]))
  assert(assetMatches("pdfs/envoi-sample.pdf", uses[1]))
  assert(assetMatches("assets/data.csv", uses[2]))
})
