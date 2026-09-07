import { translate } from "@/i18n/runtime"
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist"
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url"
import {
  extractIdentifiers,
  crossrefToPaper,
  dataciteToPaper,
  xmpToPaper,
  pickTitleHint,
  titleMatches,
  bibtexKey,
  type CrossrefWork,
} from "./paperMetadata"
import type { LibraryPaper } from "./paperLibrary"
GlobalWorkerOptions.workerSrc = workerUrl
export interface Enrichment {
  fields: Partial<Pick<LibraryPaper, "title" | "author" | "year" | "venue">>
  bib?: string
  citationKey?: string
  source: string
}
const headers = { "User-Agent": "Envoi/1.0 (mailto:envoi@localhost)" }
async function fetchJson(url: string) {
  const response = await fetch(url, { headers })
  if (!response.ok) throw Error(translate("bib.metadataHttpError", { status: response.status }))
  return response.json()
}
async function lookupDoi(doi: string): Promise<Enrichment | null> {
  const work = (await fetchJson(`https://api.crossref.org/works/${encodeURIComponent(doi)}`))
    .message as CrossrefWork
  const fields = crossrefToPaper(work)
  if (!fields.title) return null
  let bib: string | undefined
  try {
    const response = await fetch(
      `https://api.crossref.org/works/${encodeURIComponent(doi)}/transform/application/x-bibtex`,
      { headers },
    )
    if (response.ok) bib = (await response.text()).trim()
  } catch {
    /* BibTeX transform is best-effort; fields alone still enrich. */
  }
  const citationKey = bib ? bibtexKey(bib) : undefined
  return { fields, bib, citationKey, source: `Crossref DOI ${doi}` }
}
async function lookupArxiv(id: string): Promise<Enrichment | null> {
  const doi = `10.48550/arxiv.${id}`
  const data = (await fetchJson(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`)).data
    ?.attributes
  const fields = dataciteToPaper(data)
  if (!fields) return null
  let bib: string | undefined
  try {
    const response = await fetch(`https://api.datacite.org/dois/${encodeURIComponent(doi)}`, {
      headers: { ...headers, Accept: "application/x-bibtex" },
    })
    if (response.ok) bib = (await response.text()).trim()
  } catch {
    /* best-effort */
  }
  return {
    fields,
    bib,
    citationKey: bib ? bibtexKey(bib) : undefined,
    source: `DataCite arXiv ${id}`,
  }
}
// The layout hint only queries Crossref; a hit counts only when its title equals the hint after normalization (titleMatches).
async function searchTitle(hint: string): Promise<Enrichment | null> {
  const data = await fetchJson(
    `https://api.crossref.org/works?query.title=${encodeURIComponent(hint)}&rows=5`,
  )
  for (const work of (data.message?.items ?? []) as CrossrefWork[]) {
    if (!work?.DOI || !work.title?.[0] || !titleMatches(hint, work.title[0])) continue
    return lookupDoi(work.DOI)
  }
  return null
}
interface PdfScan {
  text: string
  titleHint: string
  xmp: Record<string, unknown>
  info: { Title?: string; Author?: string }
}
async function scanPdf(blob: Blob, maxPages = 2): Promise<PdfScan> {
  const task = getDocument({ data: await blob.arrayBuffer() })
  try {
    const document = await task.promise
    const parts: string[] = []
    const lines: { text: string; fontSize: number }[] = []
    for (let page = 1; page <= Math.min(document.numPages, maxPages); page++) {
      const content = await (await document.getPage(page)).getTextContent()
      parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "))
      if (page === 1)
        for (const item of content.items) {
          if (!("str" in item) || !item.str.trim()) continue
          lines.push({ text: item.str, fontSize: Math.hypot(item.transform[2], item.transform[3]) })
        }
    }
    const xmp: Record<string, unknown> = {}
    let info: { Title?: string; Author?: string } = {}
    try {
      const meta = await document.getMetadata()
      for (const key of [
        "dc:title",
        "dc:creator",
        "prism:coverDate",
        "prism:publicationDate",
        "dc:date",
        "prism:publicationName",
        "prism:doi",
      ]) {
        const value = meta.metadata?.get(key)
        if (value != null && value !== "") xmp[key] = value
      }
      info = meta.info as { Title?: string; Author?: string }
    } catch {
      /* metadata optional */
    }
    return { text: parts.join("\n"), titleHint: pickTitleHint(lines), xmp, info }
  } finally {
    void task.destroy()
  }
}
export async function extractPdfText(blob: Blob, maxPages = 2) {
  return (await scanPdf(blob, maxPages)).text
}
// Deterministic layers only: publisher XMP/Info, identifier regex, layout hint as a Crossref query. Stored fields always come from XMP or a registry.
export async function enrichPaper(hint: {
  attachment?: Blob
  title: string
}): Promise<Enrichment | null> {
  let scan: PdfScan | null = null
  if (hint.attachment) {
    try {
      scan = await scanPdf(hint.attachment)
    } catch {
      return null
    }
  }
  try {
    if (scan) {
      const { fields, doi } = xmpToPaper(scan.xmp, scan.info)
      if (doi) {
        const found = await lookupDoi(doi).catch(() => null)
        if (found) return { ...found, source: translate("bib.sourceCrossref", { doi }) }
      }
      if (fields.title && fields.author) return { fields, source: translate("bib.sourcePdfXmp") }
    }
    const { doi, arxiv } = extractIdentifiers(scan?.text ?? "")
    if (doi) {
      const found = await lookupDoi(doi)
      if (found) return found
    }
    if (arxiv) {
      const found = await lookupArxiv(arxiv)
      if (found) return found
    }
    const query = scan?.titleHint || hint.title
    if (query) return await searchTitle(query)
  } catch {
    return null
  }
  return null
}
