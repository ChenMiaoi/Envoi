import { translate } from "@/i18n/runtime"
import { envoi, ipcError } from "@/lib/desktop"
import { managementDirName, legacyDirName } from "./managementDir"
export function localGitRuntime() {
  return envoi().gitRuntime()
}
async function gitBridge<T>(call: () => Promise<unknown>, failure: string): Promise<T> {
  const runtime = await localGitRuntime()
  if (!runtime.available) throw Error(runtime.error)
  const result = (await call().catch((error) => {
    throw ipcError(error)
  })) as { ok?: boolean; error?: string } | null
  if (!result || result.ok === false) throw Error(result?.error ?? failure)
  return result as T
}
export async function initializeLocalGit(rootPath: string) {
  // 已存在的仓库会被直接沿用（existing: true），分支以实际为准。
  const result = await gitBridge<{ branch?: string }>(
    () => envoi().gitInit(rootPath),
    translate("git.initFailed"),
  )
  // 标记项目配置中的 git 状态；配置文件缺失时初始化仍视为成功。
  for (const configPath of [
    `${managementDirName}/project.json`,
    `${legacyDirName}/project.json`,
    "paperdesk.json",
  ]) {
    const content = await envoi()
      .fsRead(rootPath, configPath)
      .catch(() => undefined)
    if (content?.text === undefined) continue
    const json = JSON.parse(content.text)
    json.git = { ...json.git, branch: result.branch ?? json.git?.branch, status: "initialized" }
    await envoi().fsWrite(rootPath, configPath, { text: JSON.stringify(json, null, 2) + "\n" })
    return
  }
}
export interface GitStatus {
  state: "ready" | "not-initialized"
  branch?: string
  detached?: boolean
  version: string
  files: {
    path: string
    originalPath?: string
    index: string
    worktree: string
    untracked: boolean
    conflict: boolean
  }[]
}
export function localGitStatus(rootPath: string): Promise<GitStatus> {
  return gitBridge(() => envoi().gitStatus(rootPath), translate("git.statusFailed"))
}
export interface GitRef {
  name: string
  kind: "branch" | "tag" | "remote"
}
export interface GitCommit {
  hash: string
  parents: string[]
  refs: GitRef[]
  head: boolean
  author: string
  date: string
  subject: string
}
export interface GitLog {
  state: "ready" | "not-initialized" | "nested"
  branch?: string
  detached?: boolean
  enclosing?: string
  commits: GitCommit[]
  truncated: boolean
}
export function localGitLog(rootPath: string): Promise<GitLog> {
  return gitBridge(() => envoi().gitLog(rootPath), translate("git.logFailed"))
}
export interface GitShow {
  commit: GitCommit & { body: string }
  files: { path: string; added: number | null; deleted: number | null }[]
}
export function localGitShow(rootPath: string, commit: string): Promise<GitShow> {
  return gitBridge(() => envoi().gitShow(rootPath, { commit }), translate("git.showFailed"))
}
