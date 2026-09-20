import { createReadStream, createWriteStream, existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"
import * as tar from "tar"
import { download, findBinary, json, unzip, verify } from "./installer-utils.mjs"

import { elanAsset, installedLean, installLean } from "./lean-installer.mjs"

const serverIds = { c: "clangd", cpp: "clangd", python: "pyright", rust: "rustAnalyzer" }
const binaries = { clangd: "clangd", rustAnalyzer: "rust-analyzer", pyright: "langserver.index.js" }
const installs = new Map()

export function installAsset(id, platform = process.platform, arch = process.arch) {
  if (id === "clangd") {
    if (
      !["darwin", "win32", "linux"].includes(platform) ||
      (arch !== "x64" && platform !== "darwin")
    )
      return null
    return {
      repository: "clangd/clangd",
      matches: (name) =>
        new RegExp(
          `^clangd-${
            platform === "darwin" ? "mac" : platform === "win32" ? "windows" : "linux"
          }-[0-9.]+\\.zip$`,
        ).test(name),
    }
  }
  if (id === "rustAnalyzer") {
    const target = {
      darwin: { arm64: "aarch64-apple-darwin.gz", x64: "x86_64-apple-darwin.gz" },
      win32: { arm64: "aarch64-pc-windows-msvc.zip", x64: "x86_64-pc-windows-msvc.zip" },
      linux: { arm64: "aarch64-unknown-linux-gnu.gz", x64: "x86_64-unknown-linux-gnu.gz" },
    }[platform]?.[arch]
    return target
      ? {
          repository: "rust-lang/rust-analyzer",
          matches: (name) => name === `rust-analyzer-${target}`,
        }
      : null
  }
  return null
}

async function release(id) {
  if (id === "pyright") {
    const metadata = await json("https://registry.npmjs.org/pyright/latest", "application/json")
    const url = metadata.dist?.tarball
    if (!/^https:\/\/registry\.npmjs\.org\/pyright\/-\/pyright-[\w.-]+\.tgz$/.test(url))
      throw Error("Invalid Pyright package URL")
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity ?? ""))
      throw Error("Pyright package integrity is unavailable")
    return { version: metadata.version, url, digest: metadata.dist.integrity, format: "tar" }
  }
  const selector = installAsset(id)
  if (!selector) throw Error("No language server build is available for this system")
  const metadata = await json(`https://api.github.com/repos/${selector.repository}/releases/latest`)
  const asset = metadata.assets?.find((entry) => selector.matches(entry.name))
  if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? ""))
    throw Error("Verified language server archive is unavailable")
  if (
    !asset.browser_download_url?.startsWith(
      `https://github.com/${selector.repository}/releases/download/`,
    )
  )
    throw Error("Invalid language server download URL")
  return {
    version: metadata.tag_name,
    url: asset.browser_download_url,
    digest: asset.digest,
    format: asset.name.endsWith(".zip") ? "zip" : "gzip",
  }
}

// 是否有针对当前平台的官方可验证安装来源（Pyright 基于 Node，全平台可用）。
export function lspInstallable(id, platform = process.platform, arch = process.arch) {
  if (id === "lean") return !!elanAsset(platform, arch)
  if (id === "pyright") return true
  return (id === "clangd" || id === "rustAnalyzer") && !!installAsset(id, platform, arch)
}

async function extract(archive, directory, id, format) {
  if (format === "zip") await unzip(archive, directory)
  else if (format === "tar")
    await tar.x({
      file: archive,
      cwd: directory,
      strip: 1,
      filter: (_name, entry) => entry.type === "File" || entry.type === "Directory",
    })
  else {
    const target = path.join(directory, binaries[id])
    await pipeline(createReadStream(archive), createGunzip(), createWriteStream(target))
  }
  const binary = await findBinary(
    directory,
    process.platform === "win32" && id !== "pyright" ? `${binaries[id]}.exe` : binaries[id],
  )
  if (!binary) throw Error("Language server executable was not found in the archive")
  if (id !== "pyright" && process.platform !== "win32") await chmod(binary, 0o755)
  return binary
}

export async function installedServer(directory, language, preferredServer) {
  if (language === "lean" && (!preferredServer || preferredServer === "lean"))
    return installedLean(directory)
  const id = serverIds[language]
  if (!id || (preferredServer && preferredServer !== id)) return null
  try {
    const metadata = JSON.parse(await readFile(path.join(directory, id, "current.json"), "utf8"))
    if (metadata.id !== id || !/^[\w.-]+$/.test(metadata.version)) return null
    const base = path.join(directory, id, metadata.version)
    const binary = path.resolve(base, metadata.binary)
    if (!binary.startsWith(`${base}${path.sep}`) || !(await stat(binary)).isFile()) return null
    return {
      id,
      name: { clangd: "clangd", rustAnalyzer: "rust-analyzer", pyright: "Pyright" }[id],
      path: binary,
      version: metadata.version,
      command: id === "pyright" ? process.execPath : binary,
      args: id === "pyright" ? [binary, "--stdio"] : [],
      env: id === "pyright" ? { ELECTRON_RUN_AS_NODE: "1" } : undefined,
    }
  } catch {
    return null
  }
}

export function installLanguageServer(directory, language) {
  if (language === "lean") return installLean(directory)
  const id = serverIds[language]
  if (!id) return Promise.reject(Error("Unsupported language server"))
  if (installs.has(id)) return installs.get(id)
  const pending = (async () => {
    const selected = await release(id)
    if (!/^[\w.-]+$/.test(selected.version)) throw Error("Invalid language server version")
    const parent = path.join(directory, id)
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(path.join(parent, ".install-"))
    const archive = path.join(tmpdir(), `envoi-lsp-${id}-${path.basename(staging)}.archive`)
    try {
      await download(selected.url, archive)
      await verify(archive, selected.digest)
      const binary = await extract(archive, staging, id, selected.format)
      const relativeBinary = path.relative(staging, binary)
      const installed = path.join(parent, selected.version)
      if (existsSync(installed)) {
        const previous = await installedServer(directory, language)
        if (!previous || previous.version !== selected.version)
          await rm(installed, { recursive: true, force: true })
      }
      if (!existsSync(installed)) await rename(staging, installed)
      const metadata = { id, version: selected.version, binary: relativeBinary }
      const temporary = path.join(parent, `current-${path.basename(staging)}.json`)
      await writeFile(temporary, JSON.stringify(metadata))
      await rename(temporary, path.join(parent, "current.json"))
      return installedServer(directory, language)
    } finally {
      await rm(archive, { force: true })
      await rm(staging, { recursive: true, force: true })
    }
  })()
  installs.set(id, pending)
  pending.finally(() => installs.delete(id)).catch(() => {})
  return pending
}
