import { execFile } from "node:child_process"
import { promisify } from "node:util"
import {
  mkdir,
  realpath,
  stat,
  lstat,
  writeFile,
  copyFile,
  rename,
  rm,
  readdir,
  rmdir,
} from "node:fs/promises"
import { randomUUID, createHash } from "node:crypto"
import path from "node:path"
import { createReadStream } from "node:fs"
import { detectTool } from "./tool-config.mjs"
import { dataDir, atomicJson, jsonFile, withDataLock } from "./local-data.mjs"
const execute = promisify(execFile)
async function hashFile(file) {
  const hash = createHash("sha256")
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest("hex")
}
async function git(root, args) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) if (key.startsWith("GIT_")) delete env[key]
  return (
    await execute(
      detectTool("git") ?? "git",
      [
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.hooksPath=" + path.join(dataDir, "disabled-hooks"),
        ...args,
      ],
      {
        cwd: root,
        env,
        windowsHide: true,
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      },
    )
  ).stdout
}
async function repository(root) {
  root = await realpath(root)
  if ((await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim())) !== root)
    throw Error("请打开项目自己的 Git 仓库，再管理实验工作区。")
  const common = await realpath(
    path.resolve(root, (await git(root, ["rev-parse", "--git-common-dir"])).trim()),
  )
  return { root, common, file: path.join(common, "envoi-workspaces.json") }
}
async function entries(root) {
  const raw = await git(root, ["worktree", "list", "--porcelain", "-z"])
  return raw
    .split("\0\0")
    .filter(Boolean)
    .map((block) =>
      Object.fromEntries(
        block
          .split("\0")
          .filter(Boolean)
          .map((line) => {
            const i = line.indexOf(" ")
            return i < 0 ? [line, true] : [line.slice(0, i), line.slice(i + 1)]
          }),
      ),
    )
    .filter((item) => item.worktree && !item.bare)
}
async function registry(repo, initialize = false) {
  const stored = await jsonFile(repo.file, null)
  if (stored) return stored
  const value = { version: 1, main: repo.root, experiments: {} }
  if (initialize) await atomicJson(repo.file, value)
  return value
}
export async function listWorkspaces(root) {
  const repo = await repository(root),
    state = await registry(repo),
    items = await entries(root)
  const workspaces = []
  for (const item of items) {
    const directory = path.resolve(item.worktree),
      info = state.experiments[directory]
    const available = await realpath(directory).then(
      () => true,
      () => false,
    )
    const changes = available
      ? (await git(directory, ["status", "--porcelain"])).trim().split("\n").filter(Boolean).length
      : 0
    workspaces.push({
      path: directory,
      name:
        directory === state.main
          ? (state.mainName ?? "主工作区")
          : (info?.name ?? path.basename(directory)),
      main: directory === state.main,
      current: directory === repo.root,
      branch: String(item.branch ?? "").replace(/^refs\/heads\//, ""),
      head: item.HEAD,
      changes,
      available,
      purpose: info?.purpose ?? "",
      base: info?.base,
    })
  }
  return { main: state.main, initialized: !!(await jsonFile(repo.file, null)), workspaces }
}
export async function createWorkspace(root, input) {
  if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 80)
    throw Error("请输入 1–80 字的实验名称。")
  const repo = await repository(root)
  return withDataLock(repo.file, async () => {
    const lock = repo.file + ".lock"
    try {
      await mkdir(lock)
    } catch (error) {
      if (error.code === "EEXIST") throw Error("另一个任务正在创建实验，请稍后重试。")
      throw error
    }
    try {
      const state = await registry(repo, true),
        id = randomUUID(),
        branch = "experiment/" + id.slice(0, 8)
      const base = (await git(repo.root, ["rev-parse", "HEAD"])).trim()
      const parent = path.join(
        dataDir,
        "worktrees",
        createHash("sha256").update(repo.common).digest("hex").slice(0, 16),
      )
      await mkdir(parent, { recursive: true })
      const target = path.join(await realpath(parent), id)
      await git(repo.root, ["worktree", "add", "-b", branch, target, base])
      state.experiments[target] = {
        name: input.name.trim(),
        purpose: String(input.purpose ?? "").slice(0, 2000),
        base,
        created: new Date().toISOString(),
      }
      await atomicJson(repo.file, state)
      return { path: target, branch }
    } finally {
      await rmdir(lock)
    }
  })
}
async function member(root, target) {
  const info = await listWorkspaces(root),
    canonical = await realpath(target)
  if (!info.workspaces.some((item) => item.path === canonical))
    throw Error("该目录不属于当前研究项目。")
  return { info, target: canonical }
}
export async function workspaceTarget(root, target) {
  return (await member(root, target)).target
}
export async function workspaceName(root) {
  const repo = await repository(root),
    state = await jsonFile(repo.file, null)
  if (!state) return undefined
  return repo.root === state.main
    ? (state.mainName ?? "主工作区")
    : state.experiments[repo.root]?.name
}
export async function renameWorkspace(root, input) {
  if (typeof input?.name !== "string" || !input.name.trim() || input.name.length > 80)
    throw Error("请输入 1–80 字的工作区名称。")
  const target = await workspaceTarget(root, input.target),
    repo = await repository(root)
  return withDataLock(repo.file, async () => {
    const lock = repo.file + ".lock"
    try {
      await mkdir(lock)
    } catch (error) {
      if (error.code === "EEXIST") throw Error("另一个任务正在修改工作区，请稍后重试。")
      throw error
    }
    try {
      const state = await registry(repo, true)
      if (target === state.main) state.mainName = input.name.trim()
      else state.experiments[target] = { ...state.experiments[target], name: input.name.trim() }
      await atomicJson(repo.file, state)
      return { name: input.name.trim() }
    } finally {
      await rmdir(lock)
    }
  })
}
async function inputFile(root, relative) {
  if (
    typeof relative !== "string" ||
    relative
      .split("/")
      .some((p) => !p || p === "." || p === ".." || p.startsWith(".") || /[\\:\x00-\x1f]/.test(p))
  )
    throw Error("无效结果文件路径。")
  const file = path.join(root, relative)
  if ((await realpath(file)) !== file || !(await lstat(file)).isFile())
    throw Error("结果必须是工作区内的普通文件。")
  return file
}
export async function saveWorkspaceResult(root, input) {
  const { info, target } = await member(root, input.source)
  if (target === info.main) throw Error("请从实验工作区保存结果。")
  const files = [...new Set(input.files ?? [])]
  if (!files.length || files.length > 100) throw Error("请选择 1–100 个结果文件。")
  if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 120)
    throw Error("请输入结果名称。")
  const main = await realpath(info.main)
  if ((await repository(main)).common !== (await repository(target)).common)
    throw Error("主工作区已变化，请重新打开项目。")
  const before = (await git(target, ["rev-parse", "HEAD"])).trim()
  if ((await git(target, ["status", "--porcelain", "--untracked-files=no"])).trim())
    throw Error("请先提交实验的已跟踪文件修改，再保存结果，以便准确复现。")
  const untracked = (await git(target, ["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean)
  if (untracked.some((file) => !files.includes(file)))
    throw Error("实验中还有未跟踪的文件，请先提交实验代码，或把它们选入本次结果。")
  const inputs = await Promise.all(files.map((file) => inputFile(target, file)))
  const parent = path.join(main, "results")
  await mkdir(parent, { recursive: true })
  if ((await realpath(parent)) !== parent) throw Error("结果目录不可使用符号链接。")
  const id = randomUUID(),
    staging = path.join(parent, ".saving-" + id),
    destination = path.join(parent, id)
  await mkdir(staging)
  try {
    const outputs = []
    for (let i = 0; i < files.length; i++) {
      const dest = path.join(staging, "files", files[i])
      await mkdir(path.dirname(dest), { recursive: true })
      await copyFile(inputs[i], dest)
      const sha256 = await hashFile(dest)
      if (sha256 !== (await hashFile(inputs[i])))
        throw Error("结果文件在复制期间发生变化，请重试。")
      outputs.push({ path: files[i], sha256 })
    }
    await git(target, ["bundle", "create", path.join(staging, "source.bundle"), "HEAD"])
    if (
      (await git(target, ["rev-parse", "HEAD"])).trim() !== before ||
      (await git(target, ["status", "--porcelain", "--untracked-files=no"])).trim()
    )
      throw Error("实验在保存期间发生修改，请重试。")
    const record = {
      id,
      title: input.title.trim(),
      summary: String(input.summary ?? "").slice(0, 10000),
      command: String(input.command ?? "").slice(0, 4000),
      created: new Date().toISOString(),
      source: target,
      experiment: info.workspaces.find((w) => w.path === target)?.name,
      commit: before,
      files: outputs,
    }
    await writeFile(path.join(staging, "result.json"), JSON.stringify(record, null, 2) + "\n")
    await writeFile(path.join(staging, ".gitignore"), "source.bundle\n")
    await rename(staging, destination)
    return record
  } catch (error) {
    await rm(staging, { recursive: true, force: true, maxRetries: 3 })
    throw error
  }
}
export async function listWorkspaceResults(root) {
  const { main } = await listWorkspaces(root),
    folder = path.join(main, "results")
  const names = await readdir(folder).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  const records = []
  for (const name of names) {
    if (!/^[a-f0-9-]{36}$/.test(name)) continue
    const value = await jsonFile(path.join(folder, name, "result.json"), null)
    if (value) records.push(value)
  }
  return records.sort((a, b) => b.created.localeCompare(a.created))
}

// Reading state must not run `git status` across every experiment.
const researchRoots = new Map()
export async function researchWorkspaceRoot(root) {
  root = await realpath(root)
  const cached = researchRoots.get(root)
  if (cached && Date.now() - cached.checked < 2000) {
    const modified = await stat(cached.file).then(
      (s) => s.mtimeMs,
      () => 0,
    )
    if (modified === cached.modified) return realpath(cached.main)
  }
  const repo = await repository(root),
    state = await jsonFile(repo.file, null),
    items = await entries(root)
  const main = state?.main ?? items[0]?.worktree
  if (!main || !items.some((item) => path.resolve(item.worktree) === path.resolve(main)))
    throw Error("主工作区不可用")
  const canonical = await realpath(main)
  researchRoots.set(root, {
    main: canonical,
    file: repo.file,
    modified: await stat(repo.file).then(
      (s) => s.mtimeMs,
      () => 0,
    ),
    checked: Date.now(),
  })
  return canonical
}
