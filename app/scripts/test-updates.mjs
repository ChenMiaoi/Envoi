import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { test } from "node:test"
import {
  checkUpdate,
  downloadReleaseInstaller,
  newerVersion,
  releaseInstaller,
} from "../electron/main/updates.mjs"

const release = {
  tag_name: "v0.4.1",
  assets: [
    {
      name: "Envoi-0.4.1-arm64.dmg",
      browser_download_url:
        "https://github.com/ChenMiaoi/Envoi/releases/download/v0.4.1/Envoi-0.4.1-arm64.dmg",
      size: 4,
      digest: `sha256:${createHash("sha256").update("test").digest("hex")}`,
    },
    {
      name: "Envoi.Setup.0.4.1.exe",
      browser_download_url:
        "https://github.com/ChenMiaoi/Envoi/releases/download/v0.4.1/Envoi.Setup.0.4.1.exe",
      size: 4,
      digest: `sha256:${createHash("sha256").update("test").digest("hex")}`,
    },
  ],
}
const previewRelease = {
  ...release,
  tag_name: "v0.4.1-rc1",
  prerelease: true,
  assets: release.assets.map((asset) => ({
    ...asset,
    name: asset.name.replace("0.4.1", "0.4.1-rc1"),
    browser_download_url: asset.browser_download_url.replaceAll("0.4.1", "0.4.1-rc1"),
  })),
}

test("release versions compare numerically and never downgrade", () => {
  assert.equal(newerVersion("v0.10.0", "0.9.9"), true)
  assert.equal(newerVersion("v0.1.0", "0.1.0"), false)
  assert.equal(newerVersion("v0.1.0", "0.2.0"), false)
  assert.equal(newerVersion("v0.4.1", "0.4.1-rc1"), false)
  assert.equal(newerVersion("v0.4.2", "0.4.1-rc1"), true)
  assert.throws(() => newerVersion("invalid", "0.1.0"))
})

test("release checks select only a verified installer for this system", async () => {
  const request = (body) => async () => ({ ok: true, json: async () => body })
  for (const status of [401, 403, 404]) {
    assert.equal((await checkUpdate("0.1.0", async () => ({ status }))).status, "inaccessible")
  }
  assert.equal((await checkUpdate("0.4.1", request(release))).status, "current")
  const mac = await checkUpdate("0.4.0", request(release), {
    platform: "darwin",
    arch: "arm64",
  })
  assert.equal(mac.status, "available")
  assert.equal(mac.installer?.name, "Envoi-0.4.1-arm64.dmg")
  assert.equal(mac.downloadAvailable, true)
  assert.equal(releaseInstaller(release, "win32", "x64")?.name, "Envoi.Setup.0.4.1.exe")
  assert.equal(releaseInstaller(release, "darwin", "x64"), null)
  assert.equal(releaseInstaller(release, "linux", "x64"), null)
  assert.equal(
    releaseInstaller(
      { ...release, assets: [{ ...release.assets[0], digest: "sha256:bad" }] },
      "darwin",
      "arm64",
    ),
    null,
  )
  await assert.rejects(checkUpdate("0.1.0", async () => ({ status: 500 })))
  await assert.rejects(checkUpdate("0.1.0", request({ ...release, prerelease: true })))
  await assert.rejects(
    checkUpdate("0.1.0", async () => {
      throw Error("offline")
    }),
  )
})

test("pre-release checks are opt-in and select the newest published RC", async () => {
  const target = { channel: "preview", platform: "darwin", arch: "arm64" }
  const request = async (url) => {
    assert.match(url, /\/releases\?per_page=100$/)
    return {
      ok: true,
      json: async () => [
        { ...previewRelease, tag_name: "v0.4.1-rc2", draft: true },
        previewRelease,
        release,
        { ...previewRelease, tag_name: "v0.4.0-rc2" },
      ],
    }
  }
  const fromStable = await checkUpdate("0.4.1", request, target)
  assert.equal(fromStable.status, "available")
  assert.equal(fromStable.prerelease, true)
  assert.equal(fromStable.latestVersion, "0.4.1-rc1")
  assert.equal(fromStable.installer?.name, "Envoi-0.4.1-rc1-arm64.dmg")
  assert.equal((await checkUpdate("0.4.1-rc1", request, target)).status, "current")
  assert.equal((await checkUpdate("0.4.2", request, target)).status, "current")
  const empty = await checkUpdate(
    "0.4.1",
    async () => ({ ok: true, json: async () => [release] }),
    target,
  )
  assert.equal(empty.status, "unpublished")
  await assert.rejects(
    checkUpdate("0.4.1", async () => ({ ok: true, json: async () => ({}) }), target),
    /Invalid release list/,
  )
})

test("installer downloads into Downloads without overwriting or accepting a bad digest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "envoi-update-test-"))
  const installer = releaseInstaller(release, "darwin", "arm64")
  const request = async () => new Response("test")
  try {
    const first = await downloadReleaseInstaller(installer, directory, request)
    const second = await downloadReleaseInstaller(installer, directory, request)
    assert.equal(path.basename(first), "Envoi-0.4.1-arm64.dmg")
    assert.equal(path.basename(second), "Envoi-0.4.1-arm64 (1).dmg")
    assert.equal(await readFile(first, "utf8"), "test")
    await assert.rejects(
      downloadReleaseInstaller({ ...installer, sha256: "0".repeat(64) }, directory, request),
      /verification/,
    )
    assert.deepEqual(
      (await readdir(directory)).sort(),
      [path.basename(second), path.basename(first)].sort(),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
