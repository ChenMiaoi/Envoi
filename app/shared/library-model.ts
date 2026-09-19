import type { AgentRecord } from "./agent-model"
export interface PaperMetadata {
  id: string
  title: string
  author: string
  year: string
  venue: string
  tags: string[]
  collection: string
  status: "待读" | "在读" | "已读"
  created: number
  attachmentName?: string
  contentHash?: string
  bib?: string
  citationKey?: string
}
export type ResearchPaper = PaperMetadata & {
  attachmentHash?: string
  attachmentPath?: string
}
export interface PaperDetail extends ResearchPaper {
  note: { text: string; revision: number }
  drafts?: { id: string; text: string }[]
  state: { reading?: { page: number; fraction: number }; chat?: AgentRecord }
}
export interface LibraryIndex {
  root: string
  papersDirectory?: string
  warnings?: string[]
  researchId: string
  papers: ResearchPaper[]
  selected?: string
}
