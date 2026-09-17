import { cp, lstat, readdir, realpath } from "node:fs/promises"
import path from "node:path"

async function inspectSource(source) {
  const info = await lstat(source)
  if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
    throw Error("不支持复制符号链接或特殊文件")
  if (info.isDirectory())
    for (const entry of await readdir(source)) await inspectSource(path.join(source, entry))
}

async function ensureSafeDestination(root, target) {
  let parent = path.dirname(target)
  while (parent !== root) {
    const info = await lstat(parent).catch((error) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (info?.isSymbolicLink()) throw Error("目标目录不能是符号链接")
    const next = path.dirname(parent)
    if (next === parent) throw Error("目标不在项目目录中")
    parent = next
  }
  await realpath(root)
  const existing = await lstat(target).catch((error) => {
    if (error.code === "ENOENT") return null
    throw error
  })
  if (existing) throw Error(`目标已存在：${path.basename(target)}`)
}

export async function copyIntoProject(root, source, target) {
  if (typeof source !== "string" || !path.isAbsolute(source)) throw Error("无效来源路径")
  await inspectSource(source)
  await ensureSafeDestination(root, target)
  const relative = path.relative(source, target)
  if (
    !relative ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
  )
    throw Error("不能将目录复制到自身")
  await cp(source, target, { recursive: true, force: false, errorOnExist: true })
}
