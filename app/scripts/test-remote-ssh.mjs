import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { RemoteWorkspaces } from "../electron/main/remote/connection.mjs"
const temp = await mkdtemp(path.join(tmpdir(), "envoi-ssh-live-"))
const name = "envoi-ssh-test-" + process.pid
const docker = (...args) =>
  execFileSync("docker", args, { encoding: "utf8", windowsHide: true, timeout: 300000 })
const waitFor = async (condition, timeout = 30000) => {
  const end = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > end) throw Error("Timed out waiting for remote event")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
let remote
try {
  docker("build", "-t", "envoi-ssh-test", path.resolve("scripts/fixtures/remote-ssh"))
  const key = path.join(temp, "id_ed25519")
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", key], { windowsHide: true })
  docker("run", "--detach", "--rm", "--name", name, "-p", "127.0.0.1::22", "envoi-ssh-test")
  docker("cp", key + ".pub", name + ":/root/.ssh/authorized_keys")
  docker("exec", name, "chmod", "600", "/root/.ssh/authorized_keys")
  const port = Number(docker("port", name, "22/tcp").trim().split(":").at(-1))
  const config = path.join(temp, "config")
  await writeFile(
    config,
    `Host envoi-test\n HostName 127.0.0.1\n User root\n Port ${port}\n IdentityFile "${key.replaceAll("\\", "/")}"\n UserKnownHostsFile "${path.join(temp, "known_hosts").replaceAll("\\", "/")}"\n StrictHostKeyChecking ask\n`,
  )
  const events = []
  remote = new RemoteWorkspaces({
    directory: path.join(temp, "data"),
    binaryDirectory: path.resolve("dist/main"),
    executable: process.execPath,
    sshArgs: ["-F", config],
    sessions: {},
    send(owner, channel, payload) {
      events.push({ owner, channel, payload })
      if (payload?.type === "prompt") remote.answer(owner, payload.id, "yes")
    },
  })
  const state = await remote.connect(1, { host: "envoi-test", directory: "/workspace" })
  const call = (method, args = []) => remote.call(1, state.root, method, args)
  assert.equal(state.state, "connected")
  const entries = await call("fs-list")
  assert(entries.files.some((file) => file.path === "main.cpp"))
  await assert.rejects(call("lsp-open", ["main.cpp", "int value;", "editor"]), /Trust/)
  await assert.rejects(call("hello", [999, "/workspace"]), /version mismatch/)
  const original = (await call("fs-read", ["main.cpp"])).text
  const saved = await call("fs-save", [
    [{ path: "main.cpp", text: original + "// saved remotely\n", expectedText: original }],
  ])
  assert.deepEqual(saved.saved, ["main.cpp"])
  const conflict = await call("fs-save", [
    [{ path: "main.cpp", text: "lost draft", expectedText: original }],
  ])
  assert.equal(conflict.saved.length, 0)
  assert(conflict.error)
  await assert.rejects(call("fs-read", ["../etc/passwd"]))
  await call("trust", [true])
  remote.get(1, state.root).trusted = true
  const source = (await call("fs-read", ["main.cpp"])).text
  const lsp = await call("lsp-open", ["main.cpp", source, "editor"])
  assert.equal(lsp.available, true)
  assert.equal(lsp.server, "clangd")
  await waitFor(() => events.some((event) => event.channel === "envoi:lsp-diagnostics"))
  const definition = await call("lsp-query", [
    "main.cpp",
    "textDocument/definition",
    source.lastIndexOf("value") + 1,
    source,
  ])
  assert(definition.some((entry) => entry.path === "main.cpp" && entry.position.line === 0))
  const completionSource = "int exampleValue;\nint main() { exa }\n"
  const completion = await call("lsp-query", [
    "main.cpp",
    "textDocument/completion",
    completionSource.indexOf("exa }") + 3,
    completionSource,
  ])
  assert(JSON.stringify(completion).includes("exampleValue"))
  await call("lsp-change", ["main.cpp", "int main() { undefined_symbol; }\n"])
  await waitFor(() =>
    events.some(
      (event) =>
        event.channel === "envoi:lsp-diagnostics" &&
        JSON.stringify(event.payload).includes("undefined_symbol"),
    ),
  )
  await call("terminal-open")
  await call("terminal-input", [{ data: "printf 'ENVOI_PTY_OK\\n'; pwd\n" }])
  await waitFor(() =>
    events.some(
      (event) => event.payload?.type === "terminal" && event.payload.data?.includes("/workspace"),
    ),
  )
  assert(await call("git-status"))
  // Drop transport while the daemon and PTY remain alive, then wait for automatic reconnection.
  remote.get(1, state.root).child.kill()
  await waitFor(() => remote.entries.get(`1:${state.root}`)?.generation > state.generation, 60000)
  assert.equal((await call("fs-read", ["main.cpp"])).text, source)
  assert((await call("terminal-open")).output.includes("ENVOI_PTY_OK"))
  // Deterministic long-running tools prove that revocation and RPC deadlines
  // terminate real Linux processes rather than only rejecting local promises.
  docker(
    "exec",
    name,
    "sh",
    "-c",
    `cat > /usr/local/bin/clang-format <<'EOF'
#!/bin/sh
if [ "$1" = --version ]; then echo 'clang-format version 18.0.0'; exit 0; fi
echo $$ > /tmp/envoi-tool-started
exec sleep 60
EOF
cat > /usr/local/bin/uv <<'EOF'
#!/bin/sh
if [ "$1" = --version ]; then echo 'uv 0.5.0'; exit 0; fi
echo $$ > /tmp/envoi-python-started
exec sleep 60
EOF
chmod +x /usr/local/bin/clang-format /usr/local/bin/uv`,
  )
  const toolStarted = (marker) => {
    try {
      return Boolean(docker("exec", name, "cat", marker).trim())
    } catch {
      return false
    }
  }
  for (const [method, args, marker] of [
    ["language-tool", ["main.cpp", source, "format"], "/tmp/envoi-tool-started"],
    ["python-environment", ["uv"], "/tmp/envoi-python-started"],
  ]) {
    const job = call(method, args)
    const rejected = assert.rejects(job, /cancelled/)
    await waitFor(() => toolStarted(marker))
    const pid = docker("exec", name, "cat", marker).trim()
    await call("trust", [false])
    await rejected
    docker("exec", name, "sh", "-c", 'test ! -e "/proc/$1"', "sh", pid)
    if (method === "python-environment") docker("exec", name, "test", "!", "-e", "/workspace/.venv")
    await call("trust", [true])
  }
  docker("exec", name, "rm", "/tmp/envoi-tool-started")
  const peer = remote.get(1, state.root).peer
  await assert.rejects(
    peer.call("language-tool", ["main.cpp", source, "format"], 1000),
    /timed out/,
  )
  const timedOutPid = docker("exec", name, "cat", "/tmp/envoi-tool-started").trim()
  await waitFor(() => {
    try {
      docker("exec", name, "sh", "-c", 'test ! -e "/proc/$1"', "sh", timedOutPid)
      return true
    } catch {
      return false
    }
  })
  assert.equal(await call("ping"), true)
  console.log(
    "PASS remote cancellation: trust revocation, Python cleanup, RPC timeout and process termination",
  )
  await remote.disconnect(1)
  await assert.rejects(call("fs-read", ["main.cpp"]), /disconnected/)
  execFileSync(process.execPath, ["scripts/test-remote-ui.mjs"], {
    env: {
      ...process.env,
      ENVOI_TEST_SSH_CONFIG: config,
      ENVOI_TEST_SSH_HOST: "envoi-test",
      ENVOI_TEST_SSH_DIRECTORY: "/workspace",
      ENVOI_DESKTOP_TEST_HIDDEN: "1",
    },
    stdio: "inherit",
    windowsHide: true,
    timeout: 120000,
  })
  // A wrong host key must fail without any automatic acceptance or replacement.
  const badKey = path.join(temp, "wrong_host")
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", badKey], { windowsHide: true })
  const publicKey = (await readFile(badKey + ".pub", "utf8"))
    .trim()
    .split(" ")
    .slice(0, 2)
    .join(" ")
  await writeFile(path.join(temp, "known_hosts"), `[127.0.0.1]:${port} ${publicKey}\n`)
  await assert.rejects(
    remote.connect(1, { host: "envoi-test", directory: "/workspace" }),
    /HOST IDENTIFICATION|Host key verification|closed|protocol/i,
  )
  console.log(
    "Real SSH passed: deployment, host keys, files, conflict protection, trust, clangd completion/diagnostics/definition, PTY, Git, reconnect",
  )
} finally {
  await remote?.disconnect(1)
  try {
    docker("rm", "-f", name)
  } catch {
    /* Container may not have started. */
  }
  assert(temp.startsWith(path.join(tmpdir(), "envoi-ssh-live-")))
  await rm(temp, { recursive: true, force: true })
}
