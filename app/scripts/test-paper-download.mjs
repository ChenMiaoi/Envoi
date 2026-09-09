import { test } from "node:test"
import assert from "node:assert/strict"
import { downloadPaper } from "../server/paper-download.mjs"
test("PDF links validate redirects, content and declared size", async () => {
  let calls = 0
  const result = await downloadPaper("https://papers.example/abs/1", async () => {
    calls++
    return calls === 1
      ? new Response(null, { status: 302, headers: { location: "/paper.pdf" } })
      : new Response("%PDF-1.4\nfixture")
  })
  assert.equal(result.name, "paper.pdf")
  assert.equal(Buffer.from(result.base64, "base64").toString(), "%PDF-1.4\nfixture")
  await assert.rejects(downloadPaper("file:///etc/passwd"), /HTTPS/)
  await assert.rejects(
    downloadPaper("https://papers.example", async () => new Response("<html>login</html>")),
    /不是 PDF/,
  )
  await assert.rejects(
    downloadPaper(
      "https://papers.example",
      async () => new Response("", { headers: { "content-length": "100000001" } }),
    ),
    /100 MB/,
  )
  await assert.rejects(
    downloadPaper(
      "https://papers.example",
      async () =>
        new Response(null, { status: 302, headers: { location: "http://papers.example" } }),
    ),
    /HTTPS/,
  )
})
