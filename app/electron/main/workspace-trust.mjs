import path from "node:path"
import { realpath, stat } from "node:fs/promises"
import { atomicJson, jsonFile } from "../../server/local-data.mjs"

export function createWorkspaceTrust(file, confirm) {
  let queue = Promise.resolve()
  const pending = new Map()
  const opened = new Set()
  const canonical = async (directory) => {
    if (typeof directory !== "string" || !path.isAbsolute(directory))
      throw Error("请选择有效的本地目录。")
    const root = await realpath(directory)
    if (!(await stat(root)).isDirectory()) throw Error("项目路径不是目录。")
    return root
  }
  const contains = (parent, root) => {
    const relative = path.relative(parent, root)
    return (
      !relative ||
      (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
    )
  }
  async function isTrusted(root) {
    const stored = await jsonFile(file, { roots: [] })
    const trusted = Math.max(
      -1,
      ...stored.roots.filter((parent) => contains(parent, root)).map((parent) => parent.length),
    )
    const restricted = Math.max(
      -1,
      ...(stored.restricted ?? [])
        .filter((parent) => contains(parent, root))
        .map((parent) => parent.length),
    )
    return trusted > restricted
  }
  async function requireTrust(directory) {
    const root = await canonical(directory)
    if (!(await isTrusted(root))) throw Error("限制模式下不可使用此功能，请先信任项目。")
    return root
  }
  async function trust(directory) {
    const root = await canonical(directory)
    if (pending.has(root)) return pending.get(root)
    const action = queue
      .catch(() => {})
      .then(async () => {
        if (!(await isTrusted(root))) {
          if (!(await confirm(root))) throw Error("已取消打开目录，未授予信任。")
          const current = await jsonFile(file, { roots: [] })
          await atomicJson(file, {
            roots: [...current.roots.filter((parent) => !contains(root, parent)), root],
            restricted: (current.restricted ?? []).filter((parent) => parent !== root),
          })
        }
        return root
      })
    queue = action
    pending.set(root, action)
    try {
      return await action
    } finally {
      pending.delete(root)
    }
  }
  async function open(directory) {
    const root = await canonical(directory)
    opened.add(root)
    return root
  }
  async function requireOpen(directory) {
    const root = await canonical(directory)
    if (![...opened].some((parent) => contains(parent, root))) throw Error("请先打开此目录。")
    return root
  }
  async function status(directory) {
    const root = await requireOpen(directory)
    const trusted = await isTrusted(root)
    const stored = await jsonFile(file, { roots: [] })
    return {
      trusted,
      decided: trusted || !!stored.restricted?.some((parent) => contains(parent, root)),
    }
  }
  async function restrict(directory) {
    const root = await requireOpen(directory)
    const action = queue
      .catch(() => {})
      .then(async () => {
        const current = await jsonFile(file, { roots: [] })
        await atomicJson(file, {
          roots: current.roots.filter((parent) => !contains(root, parent)),
          restricted: [
            ...(current.restricted ?? []).filter((parent) => !contains(root, parent)),
            root,
          ],
        })
      })
    queue = action
    await action
    return root
  }
  return { trust, requireTrust, open, requireOpen, status, restrict, isTrusted }
}
