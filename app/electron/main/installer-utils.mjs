import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readdir } from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import yauzl from "yauzl"

const maxArchiveBytes = 200_000_000
const maxExtractedBytes = 600_000_000

export async function json(url, accept = "application/vnd.github+json") {
  const response = await fetch(url, {
    headers: { Accept: accept, "User-Agent": "Envoi" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw Error(`Download metadata unavailable (${response.status})`)
  return response.json()
}

export async function download(url, destination, label = "Language server", signal) {
  const cancellation = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(180_000)])
    : AbortSignal.timeout(180_000)
  const response = await fetch(url, { signal: cancellation })
  if (!response.ok || !response.body) throw Error(`${label} download failed (${response.status})`)
  let size = 0
  const limit = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length
      callback(size > maxArchiveBytes ? Error(`${label} archive is too large`) : null, chunk)
    },
  })
  await pipeline(
    Readable.fromWeb(response.body),
    limit,
    createWriteStream(destination, { flags: "wx" }),
    { signal: cancellation },
  )
}

export async function verify(file, digest, label = "Language server") {
  const [algorithm, expected] = digest.split(/[:-]/, 2)
  const hash = createHash(algorithm)
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const actual = algorithm === "sha512" ? hash.digest("base64") : hash.digest("hex")
  if (actual !== expected) throw Error(`${label} archive integrity check failed`)
}

export async function unzip(file, directory, label = "Language server") {
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
          throw Error(`Invalid ${label.toLowerCase()} archive path`)
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode && mode !== 0o100000 && mode !== 0o040000)
          throw Error(`${label} archive contains a link`)
        expanded += entry.uncompressedSize
        if (expanded > maxExtractedBytes) throw Error(`${label} archive is too large`)
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

export async function findBinary(directory, binary, depth = 5) {
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
