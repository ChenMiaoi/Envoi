import { spawn } from "node:child_process"
import { killProcessTree } from "../../server/process-tree.mjs"

// Wait for process termination before callers clean up workspaces or snapshots.
export function runToolProcess(
  command,
  args,
  { input = "", cwd, timeout = 30000, maxBuffer = 3000000, signal } = {},
) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: "pipe",
    })
    let stdout = "",
      stderr = "",
      bytes = 0,
      failure
    const stop = (error) => {
      failure ??= error
      killProcessTree(child.pid)
    }
    const abort = () => stop(signal.reason ?? Error("Tool cancelled"))
    const timer = setTimeout(() => stop(Error("Tool timed out")), timeout)
    signal?.addEventListener("abort", abort, { once: true })
    if (signal?.aborted) abort()
    const collect = (target) => (chunk) => {
      if (failure) return
      bytes += Buffer.byteLength(chunk)
      if (bytes > maxBuffer) return stop(Error("Tool output is too large"))
      if (target === "stdout") stdout += chunk
      else stderr += chunk
    }
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", collect("stdout"))
    child.stderr.on("data", collect("stderr"))
    child.on("error", (error) => {
      failure ??= error
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      if (failure) reject(failure)
      else resolve({ code, stdout, stderr })
    })
    child.stdin.on("error", () => {})
    child.stdin.end(input)
  })
}
