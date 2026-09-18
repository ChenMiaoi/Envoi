import path from "node:path"
import { realpath } from "node:fs/promises"
import { projectPath } from "./file-service.mjs"

export async function restrictedPath(root, relative) {
  const target = projectPath(root, relative)
  const canonicalRoot = await realpath(root)
  let existing = target
  while (true) {
    try {
      const resolved = await realpath(existing)
      const rel = path.relative(canonicalRoot, resolved)
      if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep))
        throw Error("限制模式不能访问项目目录外的文件。")
      return target
    } catch (error) {
      if (error.code !== "ENOENT") throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
}
