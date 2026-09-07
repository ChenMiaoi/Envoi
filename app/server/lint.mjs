import { chktexPath } from "./tool-config.mjs"
import { spawn, execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
export function lintRuntime() {
  try {
    const executable = chktexPath()
    if (!executable) throw Error("missing")
    execFileSync(executable, ["-W"], { windowsHide: true, timeout: 3000, stdio: "ignore" })
    return { available: true, name: "ChkTeX", path: executable }
  } catch {
    return { available: false, error: "本机未发现可用 ChkTeX，实时检查不可用；未自动安装。" }
  }
}
export async function lintText(input, { signal, trustedRoot } = {}) {
  if (
    typeof input?.text !== "string" ||
    Buffer.byteLength(input.text) > 500000 ||
    typeof input.path !== "string" ||
    input.path.startsWith("/") ||
    input.path
      .split("/")
      .some((p) => !p || p === ".." || p === "." || /[\\:\u0000-\u001f]/u.test(p)) ||
    !input.path.endsWith(".tex")
  )
    throw Error("Invalid editor snapshot")
  if (
    input.disabledRules !== undefined &&
    (!Array.isArray(input.disabledRules) ||
      input.disabledRules.length > 42 ||
      input.disabledRules.some((n) => !Number.isInteger(n) || n < 1 || n > 42))
  )
    throw Error("Invalid ChkTeX rule list")
  const runtime = lintRuntime()
  if (!runtime.available) return runtime
  const cwd = await mkdtemp(path.join(tmpdir(), "envoi-lint-"))
  try {
    const output = await new Promise((resolve, reject) => {
      const child = spawn(
        runtime.path,
        [
          "-q",
          "-v0",
          "-I0",
          ...(!trustedRoot ? ["-g0"] : []),
          ...(input.disabledRules ?? []).flatMap((n) => ["-n", String(n)]),
          "-p",
          input.path,
        ],
        {
          windowsHide: true,
          cwd: trustedRoot ?? cwd,
          env: trustedRoot
            ? process.env
            : { PATH: "/usr/bin:/bin", HOME: cwd, LANG: "en_US.UTF-8" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
      let stdout = "",
        stderr = ""
      const kill = () => child.kill("SIGKILL")
      const timer = setTimeout(kill, 5000)
      signal?.addEventListener("abort", kill, { once: true })
      if (signal?.aborted) kill()
      child.stdout.on("data", (chunk) => {
        stdout += chunk
        if (stdout.length > 500000) kill()
      })
      child.stderr.on("data", (chunk) => {
        stderr += chunk
        if (stderr.length > 10000) kill()
      })
      child.on("error", reject)
      child.on("close", (code) => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", kill)
        if (signal?.aborted) reject(Error("检查已取消"))
        else if (code === null || code > 3) reject(Error("ChkTeX 检查失败或超时"))
        else resolve(stdout)
      })
      child.stdin.on("error", () => {})
      child.stdin.end(input.text)
    })
    const items = []
    for (const line of output.split("\n")) {
      const match = /^(.+?):(\d+):(\d+):(\d+):(.*)$/.exec(line)
      if (match && match[1] === input.path)
        items.push({
          id: `lint-${items.length}`,
          path: input.path,
          line: Number(match[2]),
          column: Number(match[3]),
          code: match[4],
          severity: "warning",
          message: match[5],
        })
    }
    return { available: true, items }
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
}
