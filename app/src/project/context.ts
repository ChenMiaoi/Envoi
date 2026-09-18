import { createContext, useContext } from "react"
import { useStoreSelection, type SelectorStore } from "@/lib/selectorStore"
import type { PaperProject } from "@/lib/projectFiles"
export interface ProjectState {
  getProject: () => PaperProject
  closeProject: (discard?: boolean) => Promise<void>
  saveAll: () => Promise<boolean>
  saving: boolean
  project: PaperProject
  setProject: React.Dispatch<React.SetStateAction<PaperProject>>
  edit: (id: string, text: string) => void
  message: string
  setMessage: (message: string) => void
  busy: boolean
  agentWriting: boolean
  navigationBusy: boolean
  setAgentBusy: (id: string, value: boolean) => void
  setBusy: (value: boolean) => void
}
export const ProjectContext = createContext<SelectorStore<ProjectState> | null>(null)
const identity = (state: ProjectState) => state
export function useProject<S = ProjectState>(
  select: (state: ProjectState) => S = identity as (state: ProjectState) => S,
  equal?: (left: S, right: S) => boolean,
) {
  const store = useContext(ProjectContext)
  if (!store) throw new Error("Project provider missing")
  return useStoreSelection(store, select, equal)
}
