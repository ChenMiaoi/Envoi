import { applySearchFilters, normalizeDoi, normalizeArxivId } from "../shared/paper-search.mjs"
import { paperSearchConfig } from "./tool-config.mjs"
// 在线论文检索：每个来源一个适配器，在主进程（可信 Node 侧）调用官方接口。
// 统一返回标准化结果；适配器只负责抓取与字段映射，年份/开放全文筛选由 applySearchFilters 统一应用。
// 限流对策：结果短期缓存（同一查询不重复请求）、429/5xx 按 Retry-After 退避重试一次、
// 每来源请求串行（arXiv 额外保持 ≥3 秒间隔）、用户可配置个人 API Key 与联系邮箱进入 polite pool。
export const paperSources = ["openalex", "semanticscholar", "crossref", "arxiv"]
export const sourceNames = {
  openalex: "OpenAlex",
  semanticscholar: "Semantic Scholar",
  crossref: "Crossref",
  arxiv: "arXiv",
}
const cache = new Map(),
  cacheTtl = 6 * 3600_000,
  cacheLimit = 200
function cached(key, produce) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.created < cacheTtl) return hit.results
  return produce().then((results) => {
    if (cache.size >= cacheLimit) cache.delete(cache.keys().next().value)
    cache.set(key, { created: Date.now(), results })
    return results
  })
}
// 每来源串行，避免突发请求；arXiv 遵守官方 ≥3 秒间隔。
const queues = new Map(),
  lastStart = new Map()
function enqueue(source, task) {
  const run = (queues.get(source) ?? Promise.resolve()).then(async () => {
    const wait = source === "arxiv" ? 3000 - (Date.now() - (lastStart.get(source) ?? 0)) : 0
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    lastStart.set(source, Date.now())
    return task()
  })
  queues.set(
    source,
    run.catch(() => {}),
  )
  return run
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function request(url, source, { apiKey = "", email = "envoi@localhost" }, fetchImpl) {
  const headers = { "User-Agent": `Envoi/1.0 (mailto:${email})` }
  if (apiKey) headers["x-api-key"] = apiKey
  let failure
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await sleep(failure.retryAfter)
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) })
    if (response.status === 429 || response.status >= 500) {
      const retryAfter = Math.min(Number(response.headers.get("retry-after")) * 1000 || 1500, 8000)
      await response.body?.cancel()
      failure = { status: response.status, retryAfter }
      continue
    }
    if (!response.ok) throw Error(`${sourceNames[source]} 请求失败：HTTP ${response.status}`)
    return response
  }
  if (failure.status === 429)
    throw Error(
      source === "semanticscholar"
        ? "Semantic Scholar 请求过于频繁（未认证额度为共享池）；可在设置中配置个人 API Key"
        : `${sourceNames[source]} 请求过于频繁（限流），请稍后重试`,
    )
  throw Error(`${sourceNames[source]} 服务暂时不可用：HTTP ${failure.status}`)
}
async function fetchJson(url, source, options, fetchImpl) {
  return (await request(url, source, options, fetchImpl)).json()
}
function openAlexAbstract(index) {
  if (!index) return ""
  const words = []
  for (const [word, positions] of Object.entries(index))
    for (const position of positions) words[position] = word
  return words.filter(Boolean).join(" ").slice(0, 4000)
}
async function searchOpenAlex(query, { limit, email }, request) {
  const data = await fetchJson(
    `https://api.openalex.org/works?search=${encodeURIComponent(query)}&per-page=${limit}&mailto=${encodeURIComponent(email)}`,
    "openalex",
    { email },
    request,
  )
  return (data.results ?? []).map((work) => {
    const location = work.best_oa_location ?? work.primary_location ?? {}
    return {
      source: "openalex",
      sourceId: String(work.id ?? ""),
      title: String(work.title ?? ""),
      authors: (work.authorships ?? []).map((a) => a.author?.display_name).filter(Boolean),
      year: work.publication_year ? String(work.publication_year) : "",
      venue: String(
        work.primary_location?.source?.display_name ??
          work.best_oa_location?.source?.display_name ??
          "",
      ),
      publisher: "",
      abstract: openAlexAbstract(work.abstract_inverted_index),
      doi: normalizeDoi(work.doi),
      arxivId: "",
      url: String(location.landing_page_url ?? work.doi ?? work.id ?? ""),
      pdfUrl: String(location.pdf_url ?? ""),
      openAccess: work.open_access?.is_oa === true,
      citationCount: work.cited_by_count ?? null,
      version: work.type === "preprint" ? "预印本" : "",
    }
  })
}
async function searchSemanticScholar(query, { limit, apiKey, email }, request) {
  const fields =
    "title,authors,year,venue,abstract,externalIds,url,openAccessPdf,isOpenAccess,citationCount,journal,publicationTypes"
  const data = await fetchJson(
    `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
    "semanticscholar",
    { apiKey, email },
    request,
  )
  return (data.data ?? []).map((paper) => ({
    source: "semanticscholar",
    sourceId: String(paper.paperId ?? ""),
    title: String(paper.title ?? ""),
    authors: (paper.authors ?? []).map((a) => a.name).filter(Boolean),
    year: paper.year ? String(paper.year) : "",
    venue: String(paper.venue || paper.journal?.name || ""),
    publisher: "",
    abstract: String(paper.abstract ?? ""),
    doi: normalizeDoi(paper.externalIds?.DOI),
    arxivId: normalizeArxivId(paper.externalIds?.ArXiv),
    url: String(paper.url ?? ""),
    pdfUrl: String(paper.openAccessPdf?.url ?? ""),
    openAccess: paper.isOpenAccess === true,
    citationCount: paper.citationCount ?? null,
    version: (paper.publicationTypes ?? []).includes("Preprint") ? "预印本" : "",
  }))
}
const decodeXml = (value) =>
  String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
async function searchCrossref(query, { limit, email }, request) {
  const select =
    "DOI,title,author,published,container-title,publisher,abstract,URL,type,is-referenced-by-count,link"
  const data = await fetchJson(
    `https://api.crossref.org/works?query=${encodeURIComponent(query)}&rows=${limit}&select=${select}`,
    "crossref",
    { email },
    request,
  )
  return (data.message?.items ?? []).map((item) => ({
    source: "crossref",
    sourceId: String(item.DOI ?? ""),
    title: String(item.title?.[0] ?? ""),
    authors: (item.author ?? [])
      .map((a) => [a.given, a.family].filter(Boolean).join(" "))
      .filter(Boolean),
    year: item.published?.["date-parts"]?.[0]?.[0]
      ? String(item.published["date-parts"][0][0])
      : "",
    venue: String(item["container-title"]?.[0] ?? ""),
    publisher: String(item.publisher ?? ""),
    // Crossref 摘要为 JATS 片段，去掉标签仅保留文本。
    abstract: decodeXml(String(item.abstract ?? "").replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 4000),
    doi: normalizeDoi(item.DOI),
    arxivId: "",
    url: String(item.URL ?? ""),
    pdfUrl: String(
      (item.link ?? []).find((link) => /pdf/i.test(link["content-type"] ?? ""))?.URL ?? "",
    ),
    // Crossref 不携带开放状态；未知不能当作无开放全文。
    openAccess: null,
    citationCount: item["is-referenced-by-count"] ?? null,
    version: "",
  }))
}
function arxivEntries(xml) {
  const entries = []
  for (const block of xml.split("<entry>").slice(1)) {
    const pick = (tag) =>
      decodeXml(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(block)?.[1] ?? "").trim()
    const id = pick("id"),
      arxivId = normalizeArxivId(id)
    if (!arxivId) continue
    const authors = []
    for (const match of block.matchAll(
      /<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g,
    ))
      authors.push(decodeXml(match[1]).trim())
    entries.push({
      source: "arxiv",
      sourceId: arxivId,
      title: pick("title").replace(/\s+/g, " "),
      authors,
      year: (/\d{4}/.exec(pick("published")) ?? [""])[0],
      venue: pick("arxiv:journal_ref"),
      publisher: "",
      abstract: pick("summary").replace(/\s+/g, " ").slice(0, 4000),
      doi: normalizeDoi(pick("arxiv:doi")),
      arxivId,
      url: "https://arxiv.org/abs/" + arxivId,
      pdfUrl: "https://arxiv.org/pdf/" + arxivId,
      openAccess: true,
      citationCount: null,
      version: "预印本",
    })
  }
  return entries
}
async function searchArxiv(query, { limit, email }, fetchImpl) {
  const response = await request(
    `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=${limit}&sortBy=relevance`,
    "arxiv",
    { email },
    fetchImpl,
  )
  return arxivEntries(await response.text())
}
const adapters = {
  openalex: searchOpenAlex,
  semanticscholar: searchSemanticScholar,
  crossref: searchCrossref,
  arxiv: searchArxiv,
}
const asYear = (value) => {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1000 && year <= 3000 ? year : undefined
}
export async function searchPapers(input, request = fetch, readConfig = paperSearchConfig) {
  const source = String(input?.source ?? "")
  if (!paperSources.includes(source)) throw Error("未知搜索来源")
  const query = String(input?.query ?? "").trim()
  if (!query || query.length > 500) throw Error("请输入 500 字以内的检索词")
  const limit = Math.min(Math.max(Math.trunc(Number(input?.limit)) || 25, 1), 50)
  const settings = readConfig()
  const options = {
    limit,
    email: settings.contactEmail || "envoi@localhost",
    apiKey: source === "semanticscholar" ? settings.semanticScholarKey : "",
    yearFrom: asYear(input?.yearFrom),
    yearTo: asYear(input?.yearTo),
    openAccessOnly: input?.openAccessOnly === true,
  }
  // 缓存键不含筛选条件：原始结果复用，筛选在取出后统一应用。
  const results = await cached(`${source}|${query.toLowerCase()}|${limit}`, () =>
    enqueue(source, () => adapters[source](query, options, request)),
  )
  return {
    source,
    results: applySearchFilters(results, options).map((item) => ({
      ...item,
      sourceWeight: settings.sourceWeights?.[source] ?? 1,
    })),
  }
}
