import assert from "node:assert/strict"
import { test } from "node:test"
import { createEventBatch } from "../src/lib/eventBatch"
import { sameFileNavigation, sameSavedFiles } from "../src/lib/projectPerformance"
import { previewManifest, verifyPreview } from "../src/lib/pdfSync"
import type { PaperProject } from "../src/lib/projectFiles"

const source = {
  id: "main",
  path: "main.tex",
  kind: "latex" as const,
  text: "draft",
  saved: "saved",
}
test("navigation ignores text edits while saved-file invalidation tracks saves, moves and deletions", () => {
  const files = [source]
  const edited = [{ ...source, text: "new draft" }]
  assert.equal(sameFileNavigation(files, edited), true)
  assert.equal(sameSavedFiles(files, edited), true)
  assert.equal(sameSavedFiles(files, [{ ...source, saved: "new saved" }]), false)
  assert.equal(sameFileNavigation(files, [{ ...source, path: "renamed.tex" }]), false)
  assert.equal(sameSavedFiles(files, [{ ...source, path: "renamed.tex" }]), false)
  assert.equal(sameFileNavigation(files, []), false)
})

test("stream batches preserve event order and flush the tail on completion or cancellation", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] })
  const batches: number[][] = []
  const stream = createEventBatch<number>((events) => batches.push(events))
  for (let i = 0; i < 100; i++) stream.push(i)
  assert.equal(batches.length, 0)
  t.mock.timers.tick(32)
  assert.deepEqual(batches, [Array.from({ length: 100 }, (_, i) => i)])
  stream.push(100)
  stream.finish()
  stream.finish()
  stream.push(101)
  t.mock.timers.tick(100)
  assert.deepEqual(batches[1], [100])
  assert.equal(batches.length, 2)
})

test("PDF verification reuses immutable file reads and rejects changed drafts or PDFs", async () => {
  let assetReads = 0,
    pdfReads = 0
  class Asset extends File {
    override async arrayBuffer() {
      assetReads++
      return super.arrayBuffer()
    }
  }
  class Pdf extends File {
    override async arrayBuffer() {
      pdfReads++
      return super.arrayBuffer()
    }
  }
  const pdf = new Pdf(["PDF"], "main.pdf")
  const project: PaperProject = {
    id: "test",
    name: "Test",
    rootId: "main",
    directories: [],
    files: [
      source,
      { id: "asset", path: "plot.png", kind: "image", file: new Asset(["image"], "plot.png") },
    ],
  }
  const manifest = await previewManifest(project, pdf)
  project.files.push({
    id: "manifest",
    path: "build/preview.json",
    kind: "text",
    text: JSON.stringify(manifest),
  })
  for (let i = 0; i < 10; i++)
    assert.equal(await verifyPreview(project, { id: "pdf", file: pdf }), true)
  assert.equal(assetReads, 1)
  assert.equal(pdfReads, 1)
  assert.equal(
    await verifyPreview(
      { ...project, files: [{ ...source, text: "changed" }, ...project.files.slice(1)] },
      { id: "pdf", file: pdf },
    ),
    false,
  )
  assert.equal(
    await verifyPreview(project, { id: "pdf", file: new File(["other PDF"], "main.pdf") }),
    false,
  )
})
