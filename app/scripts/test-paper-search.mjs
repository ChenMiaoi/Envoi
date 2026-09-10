import test from "node:test"
import assert from "node:assert/strict"
import { searchPapers } from "../server/paper-search.mjs"
import { configurePaperSearch, paperSearchConfig } from "../server/tool-config.mjs"
import { mkdtemp, rm } from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "node:os"
import { mergeSearchResults, applySearchFilters } from "../src/lib/paperSearch.mjs"
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } })
const failing = (status) => async () => new Response(null, { status })
test("OpenAlex results map fields and rebuild abstracts", async () => {
  const { results } = await searchPapers({ source: "openalex", query: "attention" }, async () =>
    json({
      results: [
        {
          id: "https://openalex.org/W1",
          title: "Attention study",
          doi: "https://doi.org/10.1000/XYZ.1",
          publication_year: 2021,
          authorships: [{ author: { display_name: "Ada Lovelace" } }],
          primary_location: {
            landing_page_url: "https://publisher.example/10.1000/XYZ.1",
            source: { display_name: "Journal of Tests" },
          },
          best_oa_location: { pdf_url: "https://oa.example/paper.pdf" },
          open_access: { is_oa: true },
          abstract_inverted_index: { Hello: [0], world: [1] },
          cited_by_count: 42,
        },
      ],
    }),
  )
  assert.equal(results.length, 1)
  const [paper] = results
  assert.equal(paper.doi, "10.1000/xyz.1")
  assert.equal(paper.abstract, "Hello world")
  assert.equal(paper.pdfUrl, "https://oa.example/paper.pdf")
  assert.equal(paper.openAccess, true)
  assert.deepEqual(paper.authors, ["Ada Lovelace"])
  assert.equal(paper.citationCount, 42)
})
test("Semantic Scholar maps external identifiers and rate limits surface clearly", async () => {
  const { results } = await searchPapers(
    { source: "semanticscholar", query: "attention" },
    async () =>
      json({
        data: [
          {
            paperId: "abc",
            title: "Preprint work",
            year: 2023,
            venue: "",
            journal: { name: "NeurIPS" },
            authors: [{ name: "Grace Hopper" }],
            externalIds: { DOI: "10.1000/XYZ.1", ArXiv: "2301.00001" },
            openAccessPdf: { url: "https://arxiv.org/pdf/2301.00001" },
            isOpenAccess: true,
            citationCount: 7,
            publicationTypes: ["Preprint"],
          },
        ],
      }),
  )
  assert.equal(results[0].arxivId, "2301.00001")
  assert.equal(results[0].venue, "NeurIPS")
  assert.equal(results[0].version, "预印本")
  await assert.rejects(
    searchPapers({ source: "semanticscholar", query: "x" }, failing(429)),
    /过于频繁/,
  )
})
test("Crossref strips JATS abstracts and keeps open status unknown", async () => {
  const { results } = await searchPapers({ source: "crossref", query: "attention" }, async () =>
    json({
      message: {
        items: [
          {
            DOI: "10.1000/xyz.2",
            title: ["Crossref work"],
            author: [{ given: "Alan", family: "Turing" }],
            published: { "date-parts": [[2019, 5]] },
            "container-title": ["Proceedings of Testing"],
            publisher: "Test Press",
            abstract: "<jats:p>Abstract &amp; more</jats:p>",
            URL: "https://doi.org/10.1000/xyz.2",
            "is-referenced-by-count": 3,
            link: [{ "content-type": "application/pdf", URL: "https://publisher.example/p.pdf" }],
          },
        ],
      },
    }),
  )
  const [paper] = results
  assert.equal(paper.abstract, "Abstract & more")
  assert.deepEqual(paper.authors, ["Alan Turing"])
  assert.equal(paper.openAccess, null)
  assert.equal(paper.year, "2019")
})
test("arXiv parses Atom entries and produces HTTPS links", async () => {
  const xml = `<?xml version="1.0"?><feed><title>arXiv Query</title><entry>
    <id>http://arxiv.org/abs/2301.00002v2</id>
    <title>  A   spaced title </title>
    <summary> Line one\n line two </summary>
    <published>2023-01-02T00:00:00Z</published>
    <author><name>Katherine Johnson</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1000/xyz.1</arxiv:doi>
  </entry></feed>`
  const { results } = await searchPapers(
    { source: "arxiv", query: "attention" },
    async () => new Response(xml),
  )
  assert.equal(results.length, 1)
  const [paper] = results
  assert.equal(paper.arxivId, "2301.00002")
  assert.equal(paper.title, "A spaced title")
  assert.equal(paper.url, "https://arxiv.org/abs/2301.00002")
  assert.equal(paper.pdfUrl, "https://arxiv.org/pdf/2301.00002")
  assert.equal(paper.openAccess, true)
  assert.equal(paper.doi, "10.1000/xyz.1")
  assert.deepEqual(paper.authors, ["Katherine Johnson"])
})
test("search validation and uniform filters", async () => {
  await assert.rejects(searchPapers({ source: "bing", query: "x" }), /未知搜索来源/)
  await assert.rejects(searchPapers({ source: "arxiv", query: " " }), /检索词/)
  const papers = [
    { title: "old open", year: "2018", openAccess: true },
    { title: "new closed", year: "2024", openAccess: false },
    { title: "new unknown", year: "2024", openAccess: null },
    { title: "no year", year: "", openAccess: true },
  ]
  assert.deepEqual(
    applySearchFilters(papers, { yearFrom: 2020, yearTo: 2024 }).map((p) => p.title),
    ["new closed", "new unknown"],
  )
  assert.deepEqual(
    applySearchFilters(papers, { openAccessOnly: true }).map((p) => p.title),
    ["old open", "no year"],
  )
})
test("merge dedupes by DOI, keeps sources and per-source citations", () => {
  const openalex = [
    {
      source: "openalex",
      title: "Same Paper",
      authors: ["A"],
      year: "2021",
      doi: "10.1000/xyz.1",
      url: "https://publisher.example/x",
      pdfUrl: "",
      openAccess: null,
      citationCount: 10,
      abstract: "short",
      venue: "Venue",
    },
  ]
  const arxiv = [
    {
      source: "arxiv",
      title: "Same Paper",
      authors: ["A"],
      year: "2021",
      doi: "10.1000/XYZ.1",
      arxivId: "2301.00001",
      url: "https://arxiv.org/abs/2301.00001",
      pdfUrl: "https://arxiv.org/pdf/2301.00001",
      openAccess: true,
      abstract: "a much longer abstract",
      venue: "",
    },
  ]
  const [merged, ...rest] = mergeSearchResults([openalex, arxiv])
  assert.equal(rest.length, 0)
  assert.deepEqual(merged.sources, ["openalex", "arxiv"])
  assert.deepEqual(merged.citations, [{ source: "openalex", count: 10 }])
  assert.equal(merged.pdfUrl, "https://arxiv.org/pdf/2301.00001")
  assert.equal(merged.openAccess, true)
  assert.equal(merged.abstract, "a much longer abstract")
  // 标题+年份兜底去重；不同年份的同名文献不合并。
  const same = { source: "crossref", title: "T", authors: [], year: "2020", openAccess: null }
  const other = { source: "crossref", title: "T", authors: [], year: "2021", openAccess: null }
  assert.equal(mergeSearchResults([[same], [other]]).length, 2)
  assert.equal(
    mergeSearchResults([[same], [{ ...same, source: "arxiv", citationCount: 1 }]]).length,
    1,
  )
})

test("results are cached per source and query; filters do not bust the cache", async () => {
  let calls = 0
  const fetchOnce = async () => (calls++, json({ message: { items: [] } }))
  const input = { source: "crossref", query: "cache probe unique" }
  await searchPapers(input, fetchOnce)
  await searchPapers({ ...input, yearFrom: 2020 }, fetchOnce)
  await searchPapers({ ...input, openAccessOnly: true }, fetchOnce)
  assert.equal(calls, 1)
})
test("429 retries once after Retry-After, then surfaces a clear error", async () => {
  let calls = 0
  const flaky = async () => {
    calls++
    return calls === 1
      ? new Response(null, { status: 429, headers: { "retry-after": "0" } })
      : json({ message: { items: [] } })
  }
  const { results } = await searchPapers({ source: "crossref", query: "retry probe" }, flaky)
  assert.deepEqual(results, [])
  assert.equal(calls, 2)
  calls = 0
  await assert.rejects(
    searchPapers({ source: "crossref", query: "retry probe twice" }, async () => {
      calls++
      return new Response(null, { status: 429 })
    }),
    /过于频繁/,
  )
  assert.equal(calls, 2)
})
test("user config reaches the request: API key header and mailto", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "envoi-search-config-"))
  const file = path.join(dir, "paper-search.json")
  try {
    await assert.rejects(configurePaperSearch({ contactEmail: "not-an-email" }, file), /邮箱/)
    await assert.rejects(configurePaperSearch({ semanticScholarKey: "bad key!" }, file), /Key/)
    const saved = await configurePaperSearch(
      { semanticScholarKey: "abc123", contactEmail: "me@example.org" },
      file,
    )
    assert.deepEqual(saved, { semanticScholarKey: "abc123", contactEmail: "me@example.org" })
    assert.deepEqual(paperSearchConfig(file), saved)
    let seen
    await searchPapers(
      { source: "semanticscholar", query: "config probe" },
      async (url, options) => {
        seen = { url: String(url), headers: options.headers }
        return json({ data: [] })
      },
      () => paperSearchConfig(file),
    )
    assert.equal(seen.headers["x-api-key"], "abc123")
    assert.match(seen.headers["User-Agent"], /me@example\.org/)
    await searchPapers(
      { source: "openalex", query: "config probe" },
      async (url) => {
        seen = { url: String(url) }
        return json({ results: [] })
      },
      () => paperSearchConfig(file),
    )
    assert.match(seen.url, /mailto=me%40example\.org/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
