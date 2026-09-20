import { mkdir, realpath, rm } from "node:fs/promises"
import path from "node:path"
import { detectTool, pythonEnvironment } from "../../server/tool-config.mjs"
import { runToolProcess } from "./tool-process.mjs"

const execute = async (command, args, options) => {
  const result = await runToolProcess(command, args, options)
  if (result.code !== 0) throw Error(result.stderr.trim() || "Python environment creation failed")
  return result
}
const pending = new Map()

export function pythonEnvironmentStatus(root) {
  return { path: pythonEnvironment(root) ?? null }
}

export async function createPythonEnvironment(
  root,
  manager,
  run = execute,
  resolve = detectTool,
  { signal } = {},
) {
  signal?.throwIfAborted()
  if (!["venv", "uv"].includes(manager)) throw Error("Unknown Python environment manager")
  root = await realpath(root)
  signal?.throwIfAborted()
  if (pending.has(root)) {
    const result = await pending.get(root)
    signal?.throwIfAborted()
    return result
  }
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
      signal?.throwIfAborted()
      await run(command, manager === "uv" ? ["venv", target] : ["-m", "venv", target], {
        cwd: root,
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 1_000_000,
        signal,
      })
      signal?.throwIfAborted()
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
