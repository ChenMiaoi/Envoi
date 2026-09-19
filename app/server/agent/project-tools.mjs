// Pi's documented Node SDK provides explicit sessions/auth/tools without loading personal extensions.
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent"
import { lstat, readdir, realpath } from "node:fs/promises"
import path from "node:path"

export async function safeToolPath(cwd, value) {
  if (typeof value !== "string") throw Error("需要项目相对文件路径")
  const selected = path.resolve(cwd, value)
  if (
    selected === cwd ||
    !selected.startsWith(cwd + path.sep) ||
    path
      .relative(cwd, selected)
      .split(path.sep)
      .some((part) => part.startsWith("."))
  )
    throw Error("工具只能访问项目内非隐藏文件")
  let resolved
  try {
    resolved = await realpath(selected)
  } catch {
    resolved = path.join(await realpath(path.dirname(selected)), path.basename(selected))
  }
  if (
    !resolved.startsWith(cwd + path.sep) ||
    path
      .relative(cwd, resolved)
      .split(path.sep)
      .some((part) => part.startsWith("."))
  )
    throw Error("拒绝通过符号链接访问项目外文件")
  if (
    await lstat(selected).then(
      (info) => info.nlink > 1 && info.isFile(),
      () => false,
    )
  )
    throw Error("拒绝访问多重硬链接文件")
  return selected
}
export function projectTools(cwd, permission, dirty) {
  if (permission === "none") return []
  const choices = [
    createReadTool(cwd),
    ...(permission === "write" && !dirty ? [createEditTool(cwd), createWriteTool(cwd)] : []),
  ]
  const listing = {
    ...choices[0],
    name: "project_list",
    label: "项目文件列表",
    description: "List visible files in a project directory. Use path . for the project root.",
    async execute(_id, args) {
      const selected = args.path === "." ? cwd : await safeToolPath(cwd, args.path)
      const names = []
      for (const item of await readdir(selected, { withFileTypes: true })) {
        if (item.name.startsWith(".") || item.isSymbolicLink()) continue
        names.push(item.name + (item.isDirectory() ? "/" : ""))
      }
      return {
        content: [{ type: "text", text: names.sort().slice(0, 2000).join("\n") }],
        details: {},
      }
    },
  }
  return [
    listing,
    ...choices.map((tool) => ({
      ...tool,
      name: "project_" + tool.name,
      label: tool.label ?? tool.name,
      async execute(id, args, signal, onUpdate, context) {
        await safeToolPath(cwd, args.path)
        return tool.execute(id, args, signal, onUpdate, context)
      },
    })),
  ]
}
