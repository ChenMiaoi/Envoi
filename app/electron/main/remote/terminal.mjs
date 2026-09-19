import { spawn } from "node:child_process"

// Python's standard PTY API avoids shipping a native Node addon for each remote ABI.
const helper = String.raw`
import os, pty, sys, json, select, fcntl, termios, struct, signal
pid, fd = pty.fork()
if pid == 0:
    shell = os.environ.get('SHELL', '/bin/sh')
    os.execv(shell, [shell, '-l'])
try:
    pending = b''
    while True:
        ready, _, _ = select.select([fd, sys.stdin.fileno()], [], [])
        if fd in ready:
            try: data = os.read(fd, 65536)
            except OSError: break
            if not data: break
            os.write(sys.stdout.fileno(), data)
        if sys.stdin.fileno() in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data: break
            pending += data
            while b'\n' in pending:
                line, pending = pending.split(b'\n', 1)
                msg = json.loads(line)
                if 'data' in msg: os.write(fd, msg['data'].encode())
                if 'cols' in msg:
                    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', msg['rows'], msg['cols'], 0, 0))
finally:
    try: os.killpg(pid, signal.SIGHUP)
    except ProcessLookupError: pass
    os.close(fd)
`
export function createRemoteTerminal(root, publish) {
  const child = spawn("python3", ["-u", "-c", helper], {
    cwd: root,
    env: { ...process.env, TERM: "xterm-256color" },
    stdio: "pipe",
  })
  let output = ""
  child.stdout.setEncoding("utf8")
  child.stderr.setEncoding("utf8")
  const data = (data) => {
    output = (output + data).slice(-128000)
    publish({ type: "terminal", data })
  }
  child.stdout.on("data", data)
  child.stderr.on("data", data)
  child.on("error", (error) => data(error.message))
  child.stdin.on("error", () => {})
  child.on("close", (code) => publish({ type: "terminal", exit: code ?? -1 }))
  return {
    snapshot: () => output,
    write(message) {
      if (typeof message.data === "string" && message.data.length <= 65536)
        child.stdin.write(JSON.stringify({ data: message.data }) + "\n")
      else if (
        Number.isInteger(message.cols) &&
        Number.isInteger(message.rows) &&
        message.cols > 0 &&
        message.cols < 1000 &&
        message.rows > 0 &&
        message.rows < 1000
      )
        child.stdin.write(JSON.stringify({ cols: message.cols, rows: message.rows }) + "\n")
      else throw Error("Invalid terminal input")
    },
    dispose: () => child.stdin.end(),
  }
}
