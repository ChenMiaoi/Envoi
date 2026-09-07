import "fake-indexeddb/auto"
import assert from "node:assert/strict"
import { test, beforeEach } from "node:test"
import { installDesktopFixture } from "./desktopFixture"
import {
  authorizedRoots,
  rememberRoot,
  recentProjects,
  rememberProject,
} from "../src/lib/recentProjects"
beforeEach(installDesktopFixture)
test("desktop locations and recent projects persist paths separately without browser permissions", async () => {
  await rememberRoot("/papers")
  await rememberProject("/papers/my-paper")
  await rememberRoot("/papers")
  assert.equal((await authorizedRoots()).filter((x) => x.path === "/papers").length, 1)
  assert.equal((await recentProjects()).filter((x) => x.path === "/papers/my-paper").length, 1)
  assert((await recentProjects()).every((x) => !("directory" in x)))
})
