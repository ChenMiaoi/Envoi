import { createContext, useContext } from "react";
import type { PaperProject } from "@/lib/projectFiles";
export interface ProjectState { getProject:()=>PaperProject; closeProject:(discard?:boolean)=>Promise<void>; saveAll:()=>Promise<boolean>; saving:boolean; project: PaperProject; setProject: React.Dispatch<React.SetStateAction<PaperProject>>; edit: (id: string, text: string) => void; message: string; setMessage: (message: string) => void; busy: boolean; setBusy: (value: boolean) => void }
export const ProjectContext = createContext<ProjectState | null>(null);
export function useProject() { const state = useContext(ProjectContext); if (!state) throw new Error("Project provider missing"); return state; }
