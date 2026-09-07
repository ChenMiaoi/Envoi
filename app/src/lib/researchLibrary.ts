import { envoi } from "./desktop"
import type { LibraryPaper } from "./paperLibrary"
import type { AgentRecord } from "./agentClient"
export type ResearchPaper = Omit<LibraryPaper, "attachment" | "notes"> & { attachmentHash?: string }
export interface PaperDetail extends ResearchPaper {
  note: { text: string; revision: number }
  drafts?: { id: string; text: string }[]
  state: { reading?: { page: number; fraction: number }; chat?: AgentRecord }
}
export interface LibraryIndex {
  root: string
  researchId: string
  papers: ResearchPaper[]
  selected?: string
}
export function researchLibrary<T>(root: string, input: Record<string, unknown>) {
  return envoi().library(root, input) as Promise<T>
}
