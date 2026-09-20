import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import * as tar from "tar"
import { download, findBinary, json, unzip, verify } from "./installer-utils.mjs"

const binaries = {
  slangServer: "slang-server",
  veribleLsp: "verible-verilog-ls",
  veribleFormat: "verible-verilog-format",
  veribleLint: "verible-verilog-lint",
}
const installs = new Map()
export function rtlInstallPlan(id, platform = process.platform, arch = process.arch) {
  if (!binaries[id]) return null
  const slang = id === "slangServer"
  const target = slang
    ? {
        win32: { x64: "windows-x64.zip", arm64: "windows-arm64.zip" },
        linux: { x64: "linux-x64.tar.gz", arm64: "linux-arm64.tar.gz" },
        darwin: { x64: "macos.tar.gz", arm64: "macos.tar.gz" },
      }[platform]?.[arch]
    : {
        win32: { x64: "win64.zip" },
        linux: { x64: "linux-static-x86_64.tar.gz", arm64: "linux-static-arm64.tar.gz" },
        darwin: { arm64: "macOS.tar.gz" },
      }[platform]?.[arch]
  if (!target) return null
  return {
    package: slang ? "slang-server" : "verible",
    repository: slang ? "hudson-trading/slang-server" : "chipsalliance/verible",
    target,
    binary: binaries[id],
    platform,
  }
}
export async function installedRtlTool(directory, id) {
  const plan = rtlInstallPlan(id)
  if (!plan) return null
  try {
    const parent = path.join(directory, plan.package)
    const metadata = JSON.parse(await readFile(path.join(parent, "current.json"), "utf8"))
    if (!/^[\w.-]+$/.test(metadata.version) || metadata.package !== plan.package) return null
    const base = path.join(parent, metadata.version)
    const binary = path.resolve(base, metadata.binaries[id])
    if (!binary.startsWith(base + path.sep) || !(await stat(binary)).isFile()) return null
    return {
      id,
      path: binary,
      version: metadata.version,
      command: binary,
      name: plan.binary,
      args: id === "veribleLsp" ? ["--rules_config_search"] : [],
    }
  } catch {
    return null
  }
}
export function installRtlTool(directory, id) {
  const plan = rtlInstallPlan(id)
  if (!plan) return Promise.reject(Error("No RTL tool build is available for this system"))
  const key = `${directory}\0${plan.package}`
  if (installs.has(key)) return installs.get(key).then(() => installedRtlTool(directory, id))
  const pending = (async () => {
    const release = await json(`https://api.github.com/repos/${plan.repository}/releases/latest`)
    const version = release.tag_name
    if (!/^[\w.-]+$/.test(version)) throw Error("Invalid RTL tool release version")
    const assetName =
      plan.package === "slang-server"
        ? `slang-server-${plan.target}`
        : `verible-${version}-${plan.target}`
    const asset = release.assets?.find((entry) => entry.name === assetName)
    if (
      !/^sha256:[0-9a-f]{64}$/i.test(asset?.digest ?? "") ||
      !asset.browser_download_url?.startsWith(
        `https://github.com/${plan.repository}/releases/download/`,
      )
    )
      throw Error("Verified RTL tool archive is unavailable")
    const parent = path.join(directory, plan.package)
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(path.join(parent, ".install-"))
    const archive = path.join(staging, "download.archive")
    try {
      await download(asset.browser_download_url, archive, "RTL tool")
      await verify(archive, asset.digest, "RTL tool")
      if (assetName.endsWith(".zip")) await unzip(archive, staging, "RTL tool")
      else
        await tar.x({
          file: archive,
          cwd: staging,
          filter: (_name, entry) => entry.type === "File" || entry.type === "Directory",
        })
      await rm(archive)
      const entries = {}
      const publish = path.join(staging, ".publish")
      await mkdir(publish)
      for (const [toolId, name] of Object.entries(binaries)) {
        if ((toolId === "slangServer") !== (id === "slangServer")) continue
        const binary = await findBinary(staging, plan.platform === "win32" ? name + ".exe" : name)
        if (!binary) throw Error(`Missing RTL tool in archive: ${name}`)
        const filename = path.basename(binary)
        await copyFile(binary, path.join(publish, filename))
        if (plan.platform !== "win32") await chmod(path.join(publish, filename), 0o755)
        entries[toolId] = filename
      }
      const target = path.join(parent, version)
      for (let attempt = 0; ; attempt++) {
        try {
          await rename(publish, target)
          break
        } catch (error) {
          const existing = await installedRtlTool(directory, id)
          if (
            ["EEXIST", "ENOTEMPTY", "EPERM"].includes(error.code) &&
            existing?.version === version
          )
            break
          if (!["EPERM", "EBUSY", "EACCES"].includes(error.code) || attempt >= 10) throw error
          await delay(500 * (attempt + 1))
        }
      }
      const temporary = path.join(parent, `current-${path.basename(staging)}.json`)
      await writeFile(
        temporary,
        JSON.stringify({ package: plan.package, version, binaries: entries }),
      )
      await rename(temporary, path.join(parent, "current.json"))
      const installed = await installedRtlTool(directory, id)
      if (!installed) throw Error("RTL tool installation could not be verified")
      return installed
    } finally {
      await rm(staging, { recursive: true, force: true })
    }
  })()
  installs.set(key, pending)
  pending.finally(() => installs.delete(key)).catch(() => {})
  return pending
}
