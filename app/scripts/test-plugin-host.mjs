import { test } from "node:test"
import assert from "node:assert/strict"
import { PluginHost } from "../server/plugin-host.mjs"

test("plugin activation is isolated by scope and releases resources in reverse order", async () => {
  const host = new PluginHost()
  const released = []
  const start = async (context) => {
    context.add(() => released.push(`${context.scope}:one`))
    context.add(() => released.push(`${context.scope}:two`))
    return context.scope
  }
  assert.equal(await host.activate("envoi.cpp", "workspace-a", start), "workspace-a")
  assert.equal(await host.activate("envoi.cpp", "workspace-b", start), "workspace-b")
  assert.equal(host.status("envoi.cpp", "workspace-a"), "active")
  await host.deactivate("envoi.cpp", "workspace-a", true)
  assert.deepEqual(released, ["workspace-a:two", "workspace-a:one"])
  assert.equal(host.status("envoi.cpp", "workspace-a"), "disabled")
  assert.equal(host.status("envoi.cpp", "workspace-b"), "active")
  await assert.rejects(host.activate("envoi.cpp", "workspace-a", start), /disabled/)
  host.enable("envoi.cpp", "workspace-a")
  assert.equal(await host.activate("envoi.cpp", "workspace-a", start), "workspace-a")
  await host.disposeScope("workspace-a")
  await host.disposeScope("workspace-b")
  assert.equal(host.status("envoi.cpp", "workspace-a"), "inactive")
})

test("failed activation cleans up and permits retry", async () => {
  const host = new PluginHost()
  let released = false
  await assert.rejects(
    host.activate("envoi.python", "workspace", async (context) => {
      context.add(() => {
        released = true
      })
      throw Error("server failed")
    }),
    /server failed/,
  )
  assert.equal(released, true)
  assert.equal(host.status("envoi.python", "workspace"), "failed")
  assert.equal(await host.activate("envoi.python", "workspace", async () => "ready"), "ready")
})
