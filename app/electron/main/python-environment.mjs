import { execFile } from "node:child_process"
import { mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import { detectTool, pythonEnvironment } from "../../server/tool-config.mjs"

const execute = promisify(execFile)
const pending = new Map()

export function pythonEnvironmentStatus(root) {
  return { path: pythonEnvironment(root) ?? null }
}

export async function createPythonEnvironment(root, manager, run = execute, resolve = detectTool) {
  if (!["venv", "uv"].includes(manager)) throw Error("Unknown Python environment manager")
  root = await realpath(root)
  if (pending.has(root)) return pending.get(root)
  const job = (async () => {
    const existing = pythonEnvironment(root)
    if (existing) return { path: existing }
    const command = manager === "uv" ? resolve("uv") : (resolve("python3") ?? resolve("python"))
    if (!command)
      throw Error(
        manager === "uv"
          ? "uv is not installed. Install uv or choose venv."
          : "Python is not installed. Install Python and try again.",
      )
    const target = path.join(root, ".venv")
    // Reserve the target exclusively: never modify an existing directory or symlink.
    await mkdir(target)
    try {
      await run(command, manager === "uv" ? ["venv", target] : ["-m", "venv", target], {
        cwd: root,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 1_000_000,
      })
      if (pythonEnvironment(root) !== target)
        throw Error("Python environment creation did not finish")
      return { path: target }
    } catch (error) {
      await rm(target, { recursive: true, force: true })
      throw error
    }
  })()
  pending.set(root, job)
  try {
    return await job
  } finally {
    pending.delete(root)
  }
}
