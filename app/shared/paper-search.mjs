// 在线论文检索的共享纯逻辑：标准化结果、跨来源去重合并与筛选。
// 网络适配器位于 server/paper-search.mjs（主进程执行）；本模块不依赖 Node 或 DOM。
export function normalizeDoi(value) {
  const match = /10\.\d{4,9}\/\S+/i.exec(String(value ?? ""))
  return match ? match[0].replace(/[.,;)\]]+$/, "").toLowerCase() : ""
}
export function normalizeArxivId(value) {
  const match = /(\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(v\d+)?/i.exec(String(value ?? ""))
  return match ? match[1].toLowerCase() : ""
}
export function normalizeTitle(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}
// 优先用规范化 DOI / arXiv ID 识别同一篇文献；标题+年份仅作兜底，避免误合并。
// arXiv 记录的 DataCite DOI（10.48550/arxiv.<id>）与 arXiv ID 视为同一标识。
export function dedupeKey(item) {
  const doi = normalizeDoi(item.doi)
  const arxiv = normalizeArxivId(item.arxivId ?? item.url) || normalizeArxivId(doi)
  if (arxiv && (doi.startsWith("10.48550/arxiv.") || !doi)) return "arxiv:" + arxiv
  if (doi) return "doi:" + doi
  return "title:" + normalizeTitle(item.title) + ":" + String(item.year ?? "")
}
const longer = (a, b) => (String(b ?? "").length > String(a ?? "").length ? b : a)
const QUERY_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "by",
  "for",
  "from",
  "in",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
])
const queryParts = (query) => {
  const phrase = normalizeTitle(query)
  const all = [...new Set(phrase.split(" ").filter(Boolean))]
  const meaningful = all.filter((term) => !QUERY_STOP_WORDS.has(term))
  return { phrase, terms: meaningful.length ? meaningful : all }
}
const fieldTerms = (value) => new Set(normalizeTitle(value).split(" ").filter(Boolean))
const coverage = (terms, value) => {
  if (!terms.length) return 0
  const words = fieldTerms(value)
  return terms.filter((term) => words.has(term)).length / terms.length
}
const containsPhrase = (value, phrase) => {
  if (!phrase) return false
  const field = normalizeTitle(value)
  return phrase.includes(" ") ? ` ${field} `.includes(` ${phrase} `) : fieldTerms(field).has(phrase)
}
const validYear = (value) => {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1000 && year <= 3000 ? year : 0
}
const roundScore = (value) => Math.round(value * 10) / 10
const SOURCE_LABELS = {
  openalex: "OpenAlex",
  semanticscholar: "Semantic Scholar",
  crossref: "Crossref",
  arxiv: "arXiv",
}

// 跨来源统一评分。主题相关性占绝对主导；引用量按论文年龄折算且封顶，
// 多来源发现只作很小的置信度加分，不能把弱匹配推到直接匹配之前。
export function scoreSearchResult(item, query, options = {}) {
  const { phrase, terms } = queryParts(query)
  if (!phrase || !terms.length) return { score: 0, reasons: [] }
  const titleCoverage = coverage(terms, item.title),
    abstractCoverage = coverage(terms, item.abstract),
    authorCoverage = coverage(terms, (item.authors ?? []).join(" ")),
    venueCoverage = coverage(terms, [item.venue, item.publisher].filter(Boolean).join(" ")),
    titlePhrase = containsPhrase(item.title, phrase),
    abstractPhrase = containsPhrase(item.abstract, phrase)
  let score =
    titleCoverage * 60 +
    (titlePhrase ? 40 : 0) +
    abstractCoverage * 25 +
    (abstractPhrase || abstractCoverage === 1 ? 12 : 0) +
    authorCoverage * 8 +
    venueCoverage * 8
  const reasons = []
  if (titlePhrase) reasons.push("标题包含完整检索词")
  else if (titleCoverage)
    reasons.push(`标题匹配 ${Math.round(titleCoverage * terms.length)}/${terms.length} 个关键词`)
  if (abstractPhrase) reasons.push("摘要包含完整检索词")
  else if (abstractCoverage === 1) reasons.push("摘要覆盖全部关键词")
  else if (abstractCoverage)
    reasons.push(`摘要匹配 ${Math.round(abstractCoverage * terms.length)}/${terms.length} 个关键词`)
  const preferredSource = (item.sourceWeights ?? [])
    .filter((entry) => Number.isInteger(entry.weight))
    .sort((a, b) => b.weight - a.weight || a.source.localeCompare(b.source, "en"))[0]
  if (preferredSource) {
    const preferenceScore = (Math.min(3, Math.max(0, preferredSource.weight)) - 1) * 2
    score += preferenceScore
    if (preferenceScore > 0)
      reasons.push(`优先来源：${SOURCE_LABELS[preferredSource.source] ?? preferredSource.source}`)
    else if (preferenceScore < 0) reasons.push("来源优先级较低")
  }
  if (authorCoverage) reasons.push("作者匹配检索词")
  if (venueCoverage) reasons.push("发表来源匹配检索词")

  const citations = Math.max(0, ...(item.citations ?? []).map((entry) => Number(entry.count) || 0))
  if (citations) {
    const currentYear = validYear(options.currentYear) || new Date().getUTCFullYear(),
      year = validYear(item.year),
      age = year ? Math.max(1, currentYear - year + 1) : 1,
      citationScore = Math.min(8, Math.log2(1 + citations / age) * 2)
    score += citationScore
    if (citationScore >= 1) reasons.push("被引次数提供年龄折算加分")
  }
  const sourceBonus = Math.min(3, Math.max(0, (item.sources?.length ?? 1) - 1) * 1.5)
  score += sourceBonus
  if (sourceBonus) reasons.push(`由 ${item.sources.length} 个来源发现`)
  return { score: roundScore(score), reasons }
}

export function rankSearchResults(results, query, options = {}) {
  if (!normalizeTitle(query))
    return [...(results ?? [])].sort((a, b) => b.sources.length - a.sources.length)
  return (results ?? [])
    .map((item, index) => ({
      item: { ...item, ranking: scoreSearchResult(item, query, options) },
      index,
    }))
    .sort(
      (a, b) =>
        b.item.ranking.score - a.item.ranking.score ||
        normalizeTitle(a.item.title).localeCompare(normalizeTitle(b.item.title), "en") ||
        String(b.item.year).localeCompare(String(a.item.year), "en") ||
        dedupeKey(a.item).localeCompare(dedupeKey(b.item), "en") ||
        a.index - b.index,
    )
    .map(({ item }) => item)
}
// 合并多个来源的结果批次：同一篇文献保留全部发现来源与各自引用次数（不相加），
// 字段取首个非空值，摘要取较长者，开放状态取确定值（true 优先，未知不当作无全文）。
export function mergeSearchResults(batches, query = "", options = {}) {
  const merged = [],
    byKey = new Map()
  for (const batch of batches)
    for (const item of batch ?? []) {
      if (!item || !String(item.title ?? "").trim()) continue
      const key = dedupeKey(item)
      let target = byKey.get(key)
      if (!target) {
        target = {
          title: String(item.title).trim(),
          authors: Array.isArray(item.authors) ? item.authors.filter(Boolean).map(String) : [],
          year: String(item.year ?? ""),
          venue: String(item.venue ?? ""),
          publisher: String(item.publisher ?? ""),
          abstract: String(item.abstract ?? ""),
          doi: normalizeDoi(item.doi),
          arxivId: normalizeArxivId(item.arxivId ?? item.url),
          url: String(item.url ?? ""),
          pdfUrl: String(item.pdfUrl ?? ""),
          openAccess: item.openAccess === true ? true : item.openAccess === false ? false : null,
          sources: [],
          sourceWeights: [],
          citations: [],
          versions: [],
        }
        byKey.set(key, target)
        merged.push(target)
      }
      if (!target.sources.includes(item.source)) target.sources.push(item.source)
      if (!target.sourceWeights.some((entry) => entry.source === item.source))
        target.sourceWeights.push({
          source: item.source,
          weight:
            Number.isInteger(item.sourceWeight) && item.sourceWeight >= 0 && item.sourceWeight <= 3
              ? item.sourceWeight
              : 1,
        })
      if (item.citationCount != null && !target.citations.some((c) => c.source === item.source))
        target.citations.push({ source: item.source, count: Number(item.citationCount) || 0 })
      if (item.version && !target.versions.includes(item.version))
        target.versions.push(String(item.version))
      if (!target.authors.length && Array.isArray(item.authors))
        target.authors = item.authors.filter(Boolean).map(String)
      for (const field of ["year", "venue", "publisher", "url", "pdfUrl"])
        if (!target[field] && item[field]) target[field] = String(item[field])
      if (!target.doi) target.doi = normalizeDoi(item.doi)
      if (!target.arxivId) target.arxivId = normalizeArxivId(item.arxivId ?? item.url)
      target.abstract = longer(target.abstract, item.abstract)
      if (target.openAccess !== true)
        target.openAccess =
          item.openAccess === true ? true : (target.openAccess ?? item.openAccess ?? null)
    }
  return rankSearchResults(merged, query, options)
}
const asYear = (value) => {
  const year = Number(value)
  return Number.isInteger(year) && year >= 1000 && year <= 3000 ? year : 0
}
// 统一在前端/适配器之后应用筛选；来源原生不支持的条件在这里生效，不静默丢弃。
export function applySearchFilters(results, options = {}) {
  const from = asYear(options.yearFrom),
    to = asYear(options.yearTo)
  return (results ?? []).filter((item) => {
    const year = asYear(item.year)
    if (from && (!year || year < from)) return false
    if (to && (!year || year > to)) return false
    // “仅开放全文”只保留确认开放的记录；状态未知不等于无开放全文，但也不满足此筛选。
    if (options.openAccessOnly && item.openAccess !== true) return false
    return true
  })
}
