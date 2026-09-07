import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { createDiagnostics } from "../electron/main/logging.mjs"
import { safeError } from "../shared/log-record.ts"

test("diagnostics omit content and credentials, preserve error codes and source locations", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "envoi-logs-"))
  try {
    const logger = createDiagnostics(path.join(root, "logs"), "0.1.0", 2048)
    const error = Object.assign(new TypeError("Bearer SECRET manuscript CHAT"), {
      code: "EACCES",
      stack:
        "TypeError: SECRET\n    at save (C:\\Users\\Private\\Envoi\\src\\lib\\save.ts:12:3)\n    at https://example.com?token=SECRET:1:2",
    })
    assert.deepEqual(safeError(error), {
      name: "TypeError",
      code: "EACCES",
      frames: ["lib/save.ts:12:3", "[external frame]"],
    })
    logger.write(
      "error",
      "ipc",
      "operation.failed",
      {
        operationId: "test-1",
        method: "envoi:save",
        token: "SECRET",
        body: "manuscript CHAT",
        durationMs: 2,
      },
      error,
    )
    const initial = await readFile(path.join(root, "logs/main.log"), "utf8")
    assert.ok(initial.includes("EACCES"))
    assert.ok(initial.includes("lib/save.ts:12:3"))
    assert.doesNotMatch(initial, /SECRET|manuscript|CHAT|Private|Bearer/)
    for (let i = 0; i < 80; i++)
      logger.write("debug", "test", "rotation", { operationId: String(i) })
    assert.deepEqual((await readdir(path.join(root, "logs"))).sort(), ["main.log", "main.old.log"])
    const destination = path.join(root, "diagnostics.json")
    await logger.export(destination)
    const exported = JSON.parse(await readFile(destination, "utf8"))
    assert.equal(exported.logs.length, 2)
    assert.equal(exported.version, "0.1.0")
    assert.doesNotMatch(JSON.stringify(exported), /SECRET|manuscript|CHAT|Private/)
    const blocked = path.join(root, "blocked")
    await writeFile(blocked, "file")
    const failed = createDiagnostics(blocked, "0.1.0")
    assert.doesNotThrow(() => failed.write("info", "test", "disk.failure"))
    assert.equal(failed.info().available, false)
    await assert.rejects(failed.export(path.join(root, "failure.json")))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
