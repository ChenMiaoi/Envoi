import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { RemoteWorkspaces } from "../electron/main/remote/connection.mjs"
import { listWslDistributions, browseWslDirectories } from "../electron/main/remote/wsl.mjs"

const host = process.env.ENVOI_TEST_WSL_DISTRO
assert(host, "Set ENVOI_TEST_WSL_DISTRO to an installed distribution with Python 3 and Git")
assert((await listWslDistributions()).includes(host))
const run = (script, args = []) =>
  execFileSync("wsl.exe", ["-d", host, "--exec", "sh", "-c", script, "sh", ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
  }).trim()
const systemNode = run("command -v node || true")
const home = await browseWslDirectories(host)
assert.equal(home.directory, home.home + "/")
const root = run("mktemp -d /var/tmp/envoi-wsl-test.XXXXXXXX")
assert.match(root, /^\/var\/tmp\/envoi-wsl-test\.[A-Za-z0-9]+$/)
const temporary = await mkdtemp(path.join(tmpdir(), "envoi-wsl-"))
const events = []
const remote = new RemoteWorkspaces({
  directory: temporary,
  binaryDirectory: path.resolve("dist/main"),
  executable: process.execPath,
  send: (_owner, channel, payload) => events.push({ channel, payload }),
})
async function waitFor(predicate, timeout = 60000) {
  const until = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > until) throw Error("Timed out waiting for WSL")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
try {
  run('printf "int value = 42;\\nint main() { return value; }\\n" > "$1/main.cpp"', [root])
  run('mkdir "$1/space directory" "$1/other"', [root])
  const completion = await browseWslDirectories(host, root + "/spa")
  assert.deepEqual(completion.directories, [root + "/space directory/"])
  await assert.rejects(browseWslDirectories(host, root + "/missing/"))
  const state = await remote.connect(1, { kind: "wsl", host, directory: root })
  assert.equal(run("command -v node || true"), systemNode)
  assert.equal(state.kind, "wsl")
  assert.match(state.root, /^wsl:\/\//)
  const call = (method, args = []) => remote.call(1, state.root, method, args)
  assert((await call("fs-list")).files.some((file) => file.path === "main.cpp"))
  const source = (await call("fs-read", ["main.cpp"])).text
  assert.deepEqual(
    (
      await call("fs-save", [
        [{ path: "main.cpp", text: source + "// WSL\n", expectedText: source }],
      ])
    ).saved,
    ["main.cpp"],
  )
  assert.equal(
    (await call("fs-save", [[{ path: "main.cpp", text: "bad", expectedText: source }]])).saved
      .length,
    0,
  )
  await assert.rejects(call("fs-read", ["../outside"]))
  await assert.rejects(call("terminal-open"), /Trust/)
  await assert.rejects(call("library", [{ action: "list" }]), /Trust/)
  await call("trust", [true])
  remote.get(1, state.root).trusted = true
  await call("library", [
    {
      action: "import",
      papers: [{ title: "WSL research", citationKey: "wslStudy", notes: "Remote note" }],
    },
  ])
  const library = await call("library", [{ action: "list" }])
  assert.equal(library.papers[0].title, "WSL research")
  const paper = await call("library", [{ action: "get", paperId: library.papers[0].id }])
  assert.equal(paper.note.text, "Remote note")
  assert.equal((await call("git-status")).state, "not-initialized")
  if (process.env.ENVOI_TEST_WSL_LSP === "1") {
    const lsp = await call("lsp-open", ["main.cpp", source, "editor"])
    assert.equal(lsp.available, true)
    await waitFor(() => events.some((event) => event.channel === "envoi:lsp-diagnostics"))
    const definition = await call("lsp-query", [
      "main.cpp",
      "textDocument/definition",
      source.lastIndexOf("value") + 1,
      source,
    ])
    assert(definition.some((entry) => entry.path === "main.cpp" && entry.position.line === 0))
    console.log("PASS WSL clangd diagnostics and definition")
  }
  await call("terminal-open")
  await call("terminal-input", [{ data: "printf 'ENVOI_WSL_OK\\n'; pwd\n" }])
  await waitFor(() => events.some((event) => event.payload?.data?.includes(root)))
  remote.get(1, state.root).child.kill()
  await waitFor(() => remote.entries.get(`1:${state.root}`)?.generation > state.generation)
  assert((await call("terminal-open")).output.includes("ENVOI_WSL_OK"))
  assert((await call("fs-read", ["main.cpp"])).text.includes("// WSL"))
  await remote.disconnect(1)
  execFileSync(process.execPath, ["scripts/test-remote-ui.mjs"], {
    env: { ...process.env, ENVOI_TEST_WSL_DIRECTORY: root },
    stdio: "inherit",
    windowsHide: true,
    timeout: 180000,
  })
  console.log(
    "PASS real WSL: deployment, files, conflicts, trust, Git, PTY, reconnect and desktop editing",
  )
} finally {
  await remote.disconnect(1)
  run('rm -rf -- "$1"', [root])
  await rm(temporary, { recursive: true, force: true })
}
