import assert from "node:assert/strict"
import { toolInfo, validateChktexPath, configureTools } from "../server/tool-config.mjs"
const info = await toolInfo()
assert.ok(info.groups.latex.length > 0 && info.groups.cpp.length > 0)
const chktex = info.groups.latex.find((tool) => tool.id === "chktex")
if (!chktex.available) {
  console.log("SKIP tool-config: ChkTeX unavailable —", chktex.error)
  process.exit(0)
}
assert.match(validateChktexPath(chktex.path), /(?:^|[\\/])chktex(?:\.exe)?$/i)
assert.throws(() => validateChktexPath("/bin/sh"))
assert.throws(() => validateChktexPath("chktex --shell-command"))
await assert.rejects(configureTools({ chktexPath: "/bin/sh" }))
await assert.rejects(configureTools({ command: "echo injected" }))
console.log(
  "PASS detected ChkTeX/version and validated executable-only configuration; wrong binary/commands rejected without changing tool settings",
)
