import assert from "node:assert/strict"
import { build } from "esbuild"
await build({
  entryPoints: ["src/lib/pdfRenderScheduler.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outfile: "tmp/pdf-render-scheduler.mjs",
})
const { PdfRenderScheduler } = await import("../tmp/pdf-render-scheduler.mjs")
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const scheduler = new PdfRenderScheduler(),
  started = []
let finish
scheduler.pause()
scheduler.enqueue(async () => {
  started.push("first")
  await new Promise((resolve) => {
    finish = resolve
  })
})
const cancel = scheduler.enqueue(async () => {
  started.push("cancelled")
})
cancel()
scheduler.enqueue(async () => {
  started.push("last")
})
await wait(50)
assert.deepEqual(started, [])
scheduler.pause()
await wait(100)
assert.deepEqual(started, [])
await wait(100)
assert.deepEqual(started, ["first"])
finish()
await wait(0)
assert.deepEqual(started, ["first", "last"])
let continued = false
scheduler.enqueue(async (signal) => {
  scheduler.pause()
  await scheduler.wait(signal)
  continued = true
})
await wait(10)
scheduler.dispose()
await wait(180)
assert.equal(continued, false)
console.log(
  "PASS PDF scheduler: scroll debounce, one job at a time, queued cancellation and disposal of paused continuations",
)
