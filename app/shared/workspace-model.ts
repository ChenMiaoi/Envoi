export type Workspace = {
  path: string
  name: string
  main: boolean
  current: boolean
  branch: string
  changes: number
  available: boolean
  purpose: string
  base?: string
}
export type Overview = {
  projectName: string
  experimentDirectory: string
  main: string
  initialized: boolean
  hasCommit: boolean
  workspaces: Workspace[]
}
export type Result = {
  id: string
  title: string
  summary: string
  command: string
  created: string
  experiment: string
  commit: string
  source: string
  files: { path: string; sha256: string }[]
}
