import { createContext, useContext } from "react"
import type { GitStatus } from "@/lib/localGit"

export const GitStatusContext = createContext<{
  status: GitStatus | null
  message: string
  busy: boolean
  refresh: () => void
}>({ status: null, message: "", busy: false, refresh: () => {} })
export const useGitStatus = () => useContext(GitStatusContext)
