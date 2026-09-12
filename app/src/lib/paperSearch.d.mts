export interface PaperSearchResult {
  title: string
  authors: string[]
  year: string
  venue: string
  publisher: string
  abstract: string
  doi: string
  arxivId: string
  url: string
  pdfUrl: string
  /** true 确认开放；false 确认非开放；null 未知（不能展示为“无开放全文”） */
  openAccess: boolean | null
  sources: string[]
  citations: { source: string; count: number }[]
  versions: string[]
  ranking?: { score: number; reasons: string[] }
}
/** 适配器返回的单一来源结果（合并前）；sources 之外的字段同上，citationCount/version 为单值。 */
export type SourcePaper = Omit<PaperSearchResult, "sources" | "citations" | "versions"> & {
  source: string
  sourceId?: string
  citationCount?: number
  version?: string
}
export interface SearchFilters {
  yearFrom?: number
  yearTo?: number
  openAccessOnly?: boolean
}
export function normalizeDoi(value: unknown): string
export function normalizeArxivId(value: unknown): string
export function normalizeTitle(value: unknown): string
export function dedupeKey(item: {
  doi?: string
  arxivId?: string
  url?: string
  title?: string
  year?: string
}): string
export function scoreSearchResult(
  item: PaperSearchResult,
  query: string,
  options?: { currentYear?: number },
): { score: number; reasons: string[] }
export function rankSearchResults(
  results: PaperSearchResult[],
  query: string,
  options?: { currentYear?: number },
): PaperSearchResult[]
export function mergeSearchResults(
  batches: SourcePaper[][],
  query?: string,
  options?: { currentYear?: number },
): PaperSearchResult[]
export function applySearchFilters<T extends { year?: string; openAccess?: boolean | null }>(
  results: T[],
  options?: SearchFilters,
): T[]
