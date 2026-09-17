import { createHash, randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { link, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"

const repository = "https://github.com/ChenMiaoi/Envoi"
const releaseApi = "https://api.github.com/repos/ChenMiaoi/Envoi/releases/latest"
const maxInstallerBytes = 1024 * 1024 * 1024

export function newerVersion(candidate, current) {
  const parse = (value) =>
    /^v?(\d+)\.(\d+)\.(\d+)(?:-rc[1-9]\d*)?$/.exec(value)?.slice(1, 4).map(Number)
  const next = parse(candidate)
  const installed = parse(current)
  if (!next || !installed) throw Error("Invalid release version")
  for (let i = 0; i < 3; i++) {
    if (next[i] !== installed[i]) return next[i] > installed[i]
  }
  return false
}

export function releaseInstaller(release, platform = process.platform, arch = process.arch) {
  const version = release.tag_name?.slice(1)
  const name =
    platform === "darwin" && arch === "arm64"
      ? `Envoi-${version}-arm64.dmg`
      : platform === "win32" && arch === "x64"
        ? `Envoi.Setup.${version}.exe`
        : undefined
  if (!name) return null
  const asset = release.assets?.find((item) => item.name === name)
  if (
    !asset ||
    asset.browser_download_url !==
      `${repository}/releases/download/${encodeURIComponent(release.tag_name)}/${encodeURIComponent(name)}` ||
    !Number.isSafeInteger(asset.size) ||
    asset.size <= 0 ||
    asset.size > maxInstallerBytes ||
    !/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")
  )
    return null
  return {
    name,
    url: asset.browser_download_url,
    size: asset.size,
    sha256: asset.digest.slice(7).toLowerCase(),
  }
}

export async function checkUpdate(currentVersion, request = fetch, target = {}) {
  const response = await request(releaseApi, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(15000),
  })
  if ([401, 403, 404].includes(response.status)) {
    return { currentVersion, status: "inaccessible" }
  }
  if (!response.ok) throw Error(`GitHub HTTP ${response.status}`)
  const release = await response.json()
  if (release.draft || release.prerelease || !/^v\d+\.\d+\.\d+$/.test(release.tag_name))
    throw Error("Invalid stable release")
  const available = newerVersion(release.tag_name, currentVersion)
  const installer = available ? releaseInstaller(release, target.platform, target.arch) : null
  return {
    currentVersion,
    latestVersion: release.tag_name.slice(1),
    status: available ? "available" : "current",
    downloadAvailable: !!installer,
    installer,
  }
}

export async function downloadReleaseInstaller(installer, directory, request = fetch) {
  if (!installer || !/^[\w.-]+\.(?:dmg|exe)$/.test(installer.name))
    throw Error("Invalid release installer")
  await mkdir(directory, { recursive: true })
  const response = await request(installer.url, { signal: AbortSignal.timeout(30 * 60 * 1000) })
  if (!response.ok || !response.body) throw Error(`Download failed: HTTP ${response.status}`)
  const temporary = path.join(directory, `.${installer.name}.${randomUUID()}.part`)
  let bytes = 0
  const hash = createHash("sha256")
  try {
    await pipeline(
      Readable.fromWeb(response.body),
      new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length
          if (bytes > installer.size) return callback(Error("Download exceeded expected size"))
          hash.update(chunk)
          callback(null, chunk)
        },
      }),
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    )
    if (bytes !== installer.size || hash.digest("hex") !== installer.sha256)
      throw Error("Downloaded installer failed verification")
    const parsed = path.parse(installer.name)
    for (let suffix = 0; ; suffix++) {
      const destination = path.join(
        directory,
        suffix ? `${parsed.name} (${suffix})${parsed.ext}` : installer.name,
      )
      try {
        await link(temporary, destination)
        return destination
      } catch (error) {
        if (error.code !== "EEXIST") throw error
      }
    }
  } finally {
    await rm(temporary, { force: true })
  }
}
