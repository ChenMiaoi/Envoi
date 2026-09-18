import { createHash } from "node:crypto"
import { createReadStream, createWriteStream, existsSync } from "node:fs"
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { createGunzip } from "node:zlib"
import * as tar from "tar"
import yauzl from "yauzl"

const serverIds = { c: "clangd", cpp: "clangd", python: "pyright", rust: "rustAnalyzer" }
const binaries = { clangd: "clangd", rustAnalyzer: "rust-analyzer", pyright: "langserver.index.js" }
const maxArchiveBytes = 200_000_000
const maxExtractedBytes = 600_000_000
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

async function json(url) {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Envoi" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw Error(`Download metadata unavailable (${response.status})`)
  return response.json()
}

async function release(id) {
  if (id === "pyright") {
    const metadata = await json("https://registry.npmjs.org/pyright/latest")
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

async function download(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
  if (!response.ok || !response.body)
    throw Error(`Language server download failed (${response.status})`)
  let size = 0
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      callback(size > maxArchiveBytes ? Error("Language server archive is too large") : null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    createWriteStream(destination, { flags: "wx" }),
  )
}

async function verify(file, digest) {
  const [algorithm, expected] = digest.split(/[:-]/, 2)
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const actual = algorithm === "sha512" ? hash.digest("base64") : hash.digest("hex")
  if (actual !== expected) throw Error("Language server archive integrity check failed")
}

async function unzip(file, directory) {
  const zip = await new Promise((resolve, reject) =>
    yauzl.open(file, { lazyEntries: true, validateEntrySizes: true }, (error, opened) =>
      error ? reject(error) : resolve(opened),
    ),
  )
  await new Promise((resolve, reject) => {
    let expanded = 0
    const fail = (error) => {
      zip.close()
      reject(error)
    }
    zip.on("error", fail)
    zip.on("end", resolve)
    zip.on("entry", (entry) => {
      void (async () => {
        const parts = entry.fileName.replace(/\/$/, "").split("/")
        if (
          parts.some(
            (part) => !part || part === "." || part === ".." || /[\\:\u0000-\u001f]/u.test(part),
          ) ||
          entry.fileName.startsWith("/")
        )
          throw Error("Invalid language server archive path")
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode && mode !== 0o100000 && mode !== 0o040000)
          throw Error("Language server archive contains a link")
        expanded += entry.uncompressedSize
        if (expanded > maxExtractedBytes) throw Error("Language server archive is too large")
        const target = path.join(directory, ...parts)
        if (entry.fileName.endsWith("/")) await mkdir(target, { recursive: true })
        else {
          await mkdir(path.dirname(target), { recursive: true })
          const stream = await new Promise((resolve, reject) =>
            zip.openReadStream(entry, (error, opened) => (error ? reject(error) : resolve(opened))),
          )
          await pipeline(stream, createWriteStream(target, { flags: "wx", mode: 0o644 }))
        }
        zip.readEntry()
      })().catch(fail)
    })
    zip.readEntry()
  })
}

async function findBinary(directory, binary, depth = 5) {
  if (depth < 0) return null
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isFile() && entry.name === binary) return target
    if (entry.isDirectory()) {
      const nested = await findBinary(target, binary, depth - 1)
      if (nested) return nested
    }
  }
  return null
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
