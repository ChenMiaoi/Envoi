import assert from "node:assert/strict"
import { appendChatEvent } from "../src/lib/chatActivity.mjs"
let m = { id: "answer", role: "assistant", text: "" }
const emit = (event) => {
  m = appendChatEvent(m, event)
}
emit({ type: "thinking", text: "Read ", time: 1000 })
emit({ type: "thinking", text: "evidence", time: 1200 })
emit({ type: "delta", text: "Checking files.", time: 1500 })
emit({ type: "tool", name: "read", id: "a", phase: "start", detail: "paper.md", time: 2000 })
emit({ type: "tool", name: "read", id: "b", phase: "start", detail: "notes.md", time: 2100 })
for (let i = 0; i < 100; i++)
  emit({
    type: "tool",
    name: "read",
    id: "a",
    phase: "update",
    detail: "progress " + i,
    time: 2200 + i,
  })
emit({
  type: "tool",
  name: "read",
  id: "b",
  phase: "end",
  isError: true,
  detail: "missing",
  time: 2400,
})
emit({ type: "tool", name: "read", id: "a", phase: "end", detail: "evidence", time: 2500 })
emit({ type: "thinking", text: "Compare findings", time: 2600 })
emit({ type: "delta", text: "Result.", time: 3000 })
assert.deepEqual(
  m.parts.map((p) => p.type),
  ["thinking", "text", "tool", "tool", "thinking", "text"],
)
assert.equal(m.parts[0].text, "Read evidence")
assert.equal(m.parts[2].input, "paper.md")
assert.equal(m.parts[2].time, 2000)
assert.equal(m.parts[2].updated, 2500)
assert.equal(m.parts[2].detail, "evidence")
assert.equal(m.parts[3].isError, true)
assert.equal(m.text, "Checking files.Result.")
assert.equal(m.tools.length, 4, "partial updates do not inflate historical tool log")
assert.deepEqual(JSON.parse(JSON.stringify(m)), m, "ordered activity survives persistence")
const unchanged = m
emit({ type: "done" })
assert.equal(m, unchanged)
console.log(
  "PASS chat activity: ordered reasoning/text, paired concurrent tools, bounded partial updates, errors and persistence",
)
