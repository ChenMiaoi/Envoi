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
// 合并多个来源的结果批次：同一篇文献保留全部发现来源与各自引用次数（不相加），
// 字段取首个非空值，摘要取较长者，开放状态取确定值（true 优先，未知不当作无全文）。
export function mergeSearchResults(batches) {
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
          citations: [],
          versions: [],
        }
        byKey.set(key, target)
        merged.push(target)
      }
      if (!target.sources.includes(item.source)) target.sources.push(item.source)
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
  // 来源排名融合的初步近似：被更多来源独立发现的文献排在前面，其余保持到达顺序。
  return merged.sort((a, b) => b.sources.length - a.sources.length)
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
