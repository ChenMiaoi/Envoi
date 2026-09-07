import assert from "node:assert/strict"
import { providerFailure, validateProviderCredential } from "../server/provider-validation.mjs"
for (const [text, status, kind] of [
  ["401 Model hy3-preview-free is not supported", 401, "model"],
  ["invalid api key", 401, "authentication"],
  ["insufficient balance", 402, "quota"],
  ["forbidden", 403, "permission"],
  ["rate limit", 429, "rate_limit"],
  ["fetch failed", undefined, "network"],
  ["timeout", undefined, "timeout"],
]) {
  const failure = providerFailure(text, status)
  assert.equal(failure.kind, kind)
  assert(failure.message.includes(text))
}
assert(!providerFailure("sk-secret example failure", 500).message.includes("sk-secret"))
let calls = 0
const success = await validateProviderCredential("openai", "private-fixture", {
  fetcher: async (url, options) => {
    calls++
    assert.equal(url, "https://api.openai.com/v1/models")
    assert.equal(options.headers.Authorization, "Bearer private-fixture")
    assert.equal(options.method, undefined)
    return new Response(JSON.stringify({ data: [{ id: "model" }] }), { status: 200 })
  },
})
assert.equal(success.state, "verified")
assert.equal(calls, 1)
assert(!JSON.stringify(success).includes("private-fixture"))
const invalid = await validateProviderCredential("openai", "bad", {
  fetcher: async () => new Response('{"error":{"message":"invalid API key"}}', { status: 401 }),
})
assert.equal(invalid.kind, "authentication")
assert.equal(invalid.state, "failed")
const publicList = await validateProviderCredential("opencode", "never-send-to-public-catalog", {
  fetcher: async (_url, options) => {
    assert(!options.headers.Authorization)
    return new Response('{"data":[]}')
  },
})
assert.equal(publicList.state, "reachable")
assert.notEqual(publicList.state, "verified")
const unknown = await validateProviderCredential("unknown", "key", {
  fetcher: async () => {
    throw Error("must not invent probe")
  },
})
assert.equal(unknown.state, "saved")
console.log(
  "PASS provider checks: one non-inference request, authenticated/public distinction, error categories and secret-free errors",
)

assert.equal(
  providerFailure("401 Model hy3-preview-free is not supported", 401).message,
  "401 Model hy3-preview-free is not supported",
)
assert(
  !providerFailure("token=private123 /Users/person/private/file", 403).message.includes(
    "private123",
  ),
)
assert(
  !providerFailure("token=private123 /Users/person/private/file", 403).message.includes("/Users/"),
)
