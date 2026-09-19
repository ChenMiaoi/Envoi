import { EventEmitter } from "node:events"
const MAX_FRAME = 64 * 1024 * 1024

// Newline framing is confined to JSON, never mixed with shell/terminal output.
export class RpcPeer extends EventEmitter {
  constructor(input, output, dispatch) {
    super()
    this.output = output
    this.pending = new Map()
    this.serial = 0
    this.closed = false
    let buffer = ""
    input.setEncoding("utf8")
    input.on("data", (chunk) => {
      buffer += chunk
      if (buffer.length > MAX_FRAME) return this.close(Error("Remote frame too large"))
      let end
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end)
        buffer = buffer.slice(end + 1)
        try {
          const message = JSON.parse(line)
          if (message.method && dispatch) {
            Promise.resolve()
              .then(() => dispatch(message.method, message.args ?? []))
              .then(
                (result) => this.send({ id: message.id, result }),
                (error) => this.send({ id: message.id, error: String(error.message ?? error) }),
              )
              .catch(() => {})
          } else if (message.event) this.emit("event", message.event)
          else {
            const pending = this.pending.get(message.id)
            if (!pending) continue
            this.pending.delete(message.id)
            clearTimeout(pending.timer)
            if (message.error) pending.reject(Error(message.error))
            else pending.resolve(message.result)
          }
        } catch {
          this.close(Error("Invalid remote protocol"))
          return
        }
      }
    })
    input.on("end", () => this.close(Error("SSH connection closed")))
    input.on("error", (error) => this.close(error))
    output.on("error", (error) => this.close(error))
  }
  send(message) {
    if (this.closed) throw Error("SSH connection is disconnected")
    const frame = JSON.stringify(message) + "\n"
    if (Buffer.byteLength(frame) > MAX_FRAME) throw Error("Remote frame too large")
    this.output.write(frame)
  }
  call(method, args = [], timeout = 60000) {
    if (this.closed) return Promise.reject(Error("SSH connection is disconnected"))
    return new Promise((resolve, reject) => {
      const id = ++this.serial
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(
          Error(
            `Remote operation timed out: ${method}. Check remote state before retrying a write.`,
          ),
        )
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ id, method, args })
      } catch (error) {
        clearTimeout(timer)
        this.pending.delete(id)
        reject(error)
      }
    })
  }
  close(error = Error("Remote connection closed")) {
    if (this.closed) return
    this.closed = true
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer)
      reject(error)
    }
    this.pending.clear()
    this.emit("close", error)
  }
}
