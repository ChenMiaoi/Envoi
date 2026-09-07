import assert from "node:assert/strict"
import { test } from "node:test"
import { checkUpdate, newerVersion } from "../electron/main/updates.mjs"

test("release versions compare numerically and never downgrade", () => {
  assert.equal(newerVersion("v0.10.0", "0.9.9"), true)
  assert.equal(newerVersion("v0.1.0", "0.1.0"), false)
  assert.equal(newerVersion("v0.1.0", "0.2.0"), false)
  assert.throws(() => newerVersion("invalid", "0.1.0"))
})

test("release checks distinguish private access, current, updates and failures", async () => {
  const request = (body) => async () => ({ ok: true, json: async () => body })
  for (const status of [401, 403, 404]) {
    assert.equal((await checkUpdate("0.1.0", async () => ({ status }))).status, "inaccessible")
  }
  assert.equal((await checkUpdate("0.1.0", request({ tag_name: "v0.1.0" }))).status, "current")
  const result = await checkUpdate(
    "0.1.0",
    request({ tag_name: "v0.2.0", html_url: "https://example.com" }),
  )
  assert.equal(result.status, "available")
  assert.equal(result.url, "https://github.com/ChenMiaoi/Envoi/releases/tag/v0.2.0")
  await assert.rejects(checkUpdate("0.1.0", async () => ({ status: 500 })))
  await assert.rejects(checkUpdate("0.1.0", request({ tag_name: "v0.2.0", prerelease: true })))
  await assert.rejects(
    checkUpdate("0.1.0", async () => {
      throw Error("offline")
    }),
  )
})
