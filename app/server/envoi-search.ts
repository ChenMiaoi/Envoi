// Envoi web_search extension for pi, loaded by the agent relay via `pi --mode rpc -e <this file>`.
// Keyless academic search: Semantic Scholar with Crossref fallback; Brave web search when ENVOI_SEARCH_KEY is set.
import { Type } from "typebox"

async function searchScholar(query, limit) {
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=title,authors,year,venue,url,externalIds,openAccessPdf,abstract`
  const response = await fetch(url, { headers: { "User-Agent": "Envoi/1.0" } })
  if (!response.ok) throw Error(`Semantic Scholar 返回 ${response.status}`)
  const data = await response.json()
  return (data.data ?? []).map((p) => ({
    title: p.title,
    authors: (p.authors ?? [])
      .map((a) => a.name)
      .slice(0, 6)
      .join(", "),
    year: p.year,
    venue: p.venue,
    url: p.url,
    doi: p.externalIds?.DOI,
    arxiv: p.externalIds?.ArXiv,
    openAccessPdf: p.openAccessPdf?.url,
    abstract: p.abstract?.slice(0, 500),
  }))
}

async function searchCrossref(query, limit) {
  const response = await fetch(
    `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(query)}&rows=${limit}`,
    { headers: { "User-Agent": "Envoi/1.0 (mailto:envoi@localhost)" } },
  )
  if (!response.ok) throw Error(`Crossref 返回 ${response.status}`)
  const data = await response.json()
  return (data.message?.items ?? []).map((w) => ({
    title: w.title?.[0],
    authors: (w.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .slice(0, 6)
      .join(", "),
    year: w.issued?.["date-parts"]?.[0]?.[0],
    venue: w["container-title"]?.[0],
    doi: w.DOI,
    url: w.URL,
  }))
}

async function searchBrave(query, limit) {
  const key = process.env.ENVOI_SEARCH_KEY ?? process.env.PAPERDESK_SEARCH_KEY
  if (!key) throw Error("未配置 Brave Search key（环境变量 ENVOI_SEARCH_KEY）")
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`,
    { headers: { "X-Subscription-Token": key, Accept: "application/json" } },
  )
  if (!response.ok) throw Error(`Brave Search 返回 ${response.status}`)
  const data = await response.json()
  return (data.web?.results ?? []).map((r) => ({
    title: r.title,
    url: r.url,
    description: r.description,
    age: r.age,
  }))
}

export default function (pi) {
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web for academic papers (Semantic Scholar or Crossref, no key needed) or general web pages (Brave, needs ENVOI_SEARCH_KEY). Returns titles, authors, venues, DOIs and links.",
    promptSnippet: "Search the web for papers and sources",
    promptGuidelines: [
      "Use web_search whenever the user asks about recent work, references, related papers, or facts you are unsure about.",
      "Cite web_search results with their URL or DOI in your answer.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (English works best for paper search)" }),
      source: Type.Optional(
        Type.Union([Type.Literal("auto"), Type.Literal("scholar"), Type.Literal("web")], {
          description: "auto: papers first, web fallback; scholar: academic only; web: Brave only",
        }),
      ),
      limit: Type.Optional(Type.Number({ description: "Max results, default 5" })),
    }),
    async execute(_toolCallId, params, signal) {
      if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled" }] }
      const limit = Math.min(Math.max(params.limit ?? 5, 1), 10)
      const source = params.source ?? "auto"
      try {
        let results
        if (source === "web") {
          results = { web: await searchBrave(params.query, limit) }
        } else {
          let papers, scholarError
          try {
            papers = await searchScholar(params.query, limit)
          } catch (error) {
            scholarError = error.message
          }
          if (!papers) papers = await searchCrossref(params.query, limit)
          results = {
            papers,
            ...(scholarError
              ? { note: `Semantic Scholar 不可用(${scholarError}),结果来自 Crossref` }
              : {}),
          }
          if (
            papers.length === 0 &&
            source === "auto" &&
            (process.env.ENVOI_SEARCH_KEY ?? process.env.PAPERDESK_SEARCH_KEY)
          )
            results.web = await searchBrave(params.query, limit)
        }
        return {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          details: results,
        }
      } catch (error) {
        return {
          content: [{ type: "text", text: `web_search 失败:${error.message}` }],
          details: { error: error.message },
        }
      }
    },
  })
}
