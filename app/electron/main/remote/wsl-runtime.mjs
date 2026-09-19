import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { download, verify } from "../installer-utils.mjs"
import { runWsl, wslArguments } from "./wsl.mjs"

export const WSL_NODE_VERSION = "22.23.2"
const digests = {
  x64: "d60acfe00a2932254bb0ad20e01b0d74397a0875595de719654b214f4b03f307",
  arm64: "fff4078c5def658577f92c88db7db3bc0072924bfb93fe52c1e744a54e94abb8",
}
const pending = new Map()
export function wslRuntimePlan(machine) {
  const arch = { x86_64: "x64", aarch64: "arm64" }[machine]
  if (!arch) throw Error(`Unsupported WSL architecture: ${machine}`)
  const name = `node-v${WSL_NODE_VERSION}-linux-${arch}`
  return {
    name,
    digest: digests[arch],
    url: `https://nodejs.org/dist/v${WSL_NODE_VERSION}/${name}.tar.xz`,
    relative: `.envoi/runtimes/${name}`,
  }
}

export async function ensureWslRuntime(host, progress = () => {}) {
  if (pending.has(host)) return pending.get(host)
  const operation = prepare(host, progress)
  pending.set(host, operation)
  try {
    return await operation
  } finally {
    pending.delete(host)
  }
}

async function prepare(host, progress) {
  progress("checking")
  const machine = (await runWsl(host, "uname -m")).trim()
  const plan = wslRuntimePlan(machine)
  const check = `"$HOME/${plan.relative}/bin/node" --version`
  if ((await runWsl(host, check).catch(() => "")).trim() === `v${WSL_NODE_VERSION}`)
    return plan.relative
  const temporary = await mkdtemp(path.join(tmpdir(), "envoi-wsl-node-"))
  try {
    progress("downloading")
    const archive = path.join(temporary, "node.tar.xz")
    await download(plan.url, archive, "WSL Node.js")
    await verify(archive, `sha256:${plan.digest}`, "WSL Node.js")
    progress("installing")
    const script = [
      "set -eu",
      "umask 077",
      `base="$HOME/${plan.relative}"`,
      'mkdir -p "$base/bin"',
      'work=$(mktemp -d "$base/.install.XXXXXXXX")',
      "trap 'rm -rf -- \"$work\"' EXIT HUP INT TERM",
      'cat > "$work/archive.tar.xz"',
      `test "$(sha256sum "$work/archive.tar.xz" | cut -d ' ' -f 1)" = '${plan.digest}'`,
      `tar -xJf "$work/archive.tar.xz" -C "$work" '${plan.name}/bin/node'`,
      `test "$("$work/${plan.name}/bin/node" --version)" = 'v${WSL_NODE_VERSION}'`,
      `mv -f "$work/${plan.name}/bin/node" "$base/bin/node"`,
    ].join("\n")
    await new Promise((resolve, reject) => {
      const child = spawn("wsl.exe", wslArguments({ kind: "wsl", host, directory: "/" }, script), {
        windowsHide: true,
        stdio: ["pipe", "ignore", "pipe"],
      })
      let error = ""
      const source = createReadStream(archive)
      const timer = setTimeout(() => {
        error = "WSL runtime installation timed out"
        child.kill()
      }, 120000)
      child.stderr.on("data", (chunk) => {
        error = (error + chunk).slice(-6000)
      })
      child.stdin.on("error", () => {})
      source.on("error", (failure) => {
        error = failure.message
        child.kill()
      })
      child.on("error", (failure) => {
        error = failure.message
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        source.destroy()
        if (code === 0) resolve()
        else reject(Error(error || "WSL runtime installation failed"))
      })
      source.pipe(child.stdin)
    })
    if ((await runWsl(host, check)).trim() !== `v${WSL_NODE_VERSION}`)
      throw Error("WSL runtime verification failed")
    return plan.relative
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}
