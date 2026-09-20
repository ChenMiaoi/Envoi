import { execFile } from "node:child_process"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"
import * as tar from "tar"
import { download, findBinary, json, unzip, verify } from "./installer-utils.mjs"

const execute = promisify(execFile)
const installs = new Map()
export function elanAsset(platform = process.platform, arch = process.arch) {
  const target = {
    win32: { x64: "x86_64-pc-windows-msvc.zip" },
    linux: { x64: "x86_64-unknown-linux-gnu.tar.gz", arm64: "aarch64-unknown-linux-gnu.tar.gz" },
    darwin: { x64: "x86_64-apple-darwin.tar.gz", arm64: "aarch64-apple-darwin.tar.gz" },
  }[platform]?.[arch]
  return target ? `elan-${target}` : null
}
const executable = (name) => (process.platform === "win32" ? `${name}.exe` : name)
export async function installedLean(directory) {
  const home = path.join(directory, "lean", "elan")
  try {
    const metadata = JSON.parse(await readFile(path.join(home, "envoi.json"), "utf8"))
    const binary = path.join(home, "bin", executable("lean"))
    for (const name of ["lean", "lake", "elan"])
      if (!(await stat(path.join(home, "bin", executable(name)))).isFile()) return null
    if (typeof metadata.version !== "string" || !metadata.version.startsWith("Lean (version 4."))
      return null
    return {
      id: "lean",
      name: "Lean 4",
      path: binary,
      command: binary,
      args: ["--server"],
      version: metadata.version,
      env: {
        ELAN_HOME: home,
        PATH: `${path.join(home, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
      },
    }
  } catch {
    return null
  }
}
export function installLean(directory) {
  if (installs.has(directory)) return installs.get(directory)
  const pending = (async () => {
    const existing = await installedLean(directory)
    if (existing) return existing
    const name = elanAsset()
    if (!name) throw Error("No Elan build is available for this system")
    const release = await json("https://api.github.com/repos/leanprover/elan/releases/latest")
    const asset = release.assets?.find((entry) => entry.name === name)
    if (
      !asset ||
      !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? "") ||
      !asset.browser_download_url?.startsWith(
        "https://github.com/leanprover/elan/releases/download/",
      )
    )
      throw Error("Verified Elan archive is unavailable")
    const parent = path.join(directory, "lean")
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(path.join(parent, ".install-"))
    const home = path.join(parent, "elan")
    const archive = path.join(staging, "elan.archive")
    try {
      await download(asset.browser_download_url, archive, "Elan")
      await verify(archive, asset.digest, "Elan")
      if (name.endsWith(".zip")) await unzip(archive, staging, "Elan")
      else
        await tar.x({
          file: archive,
          cwd: staging,
          filter: (_name, entry) => entry.type === "File" || entry.type === "Directory",
        })
      const installer = await findBinary(staging, executable("elan-init"))
      if (!installer) throw Error("Elan installer was not found")
      if (process.platform !== "win32") await chmod(installer, 0o755)
      const env = { ...process.env, ELAN_HOME: home }
      await execute(
        installer,
        ["-y", "--no-modify-path", "--default-toolchain", "leanprover/lean4:stable"],
        {
          env,
          cwd: staging,
          windowsHide: true,
          timeout: 1_800_000,
          maxBuffer: 2_000_000,
        },
      )
      const { stdout } = await execute(path.join(home, "bin", executable("lean")), ["--version"], {
        env,
        cwd: staging,
        windowsHide: true,
        // Elan resolves and downloads the default toolchain lazily on first use.
        timeout: 1_800_000,
      })
      if (!stdout.trim().startsWith("Lean (version 4."))
        throw Error("Lean 4 installation could not be verified")
      const metadata = path.join(home, "envoi.pending.json")
      await writeFile(metadata, JSON.stringify({ version: stdout.trim() }))
      await rename(metadata, path.join(home, "envoi.json"))
      return installedLean(directory)
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })()
  installs.set(directory, pending)
  pending.finally(() => installs.delete(directory)).catch(() => {})
  return pending
}
