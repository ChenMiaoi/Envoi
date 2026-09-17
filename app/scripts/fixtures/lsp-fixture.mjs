let buffer = Buffer.alloc(0)
function send(message) {
  const bytes = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }))
  process.stdout.write(`Content-Length: ${bytes.length}\r\n\r\n`)
  process.stdout.write(bytes)
}
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  while (true) {
    const end = buffer.indexOf("\r\n\r\n")
    if (end < 0) break
    const length = Number(
      buffer
        .subarray(0, end)
        .toString()
        .match(/Content-Length: (\d+)/i)?.[1],
    )
    if (buffer.length < end + 4 + length) break
    const value = JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString())
    buffer = buffer.subarray(end + 4 + length)
    if (value.method === "initialize") send({ id: value.id, result: { capabilities: {} } })
    if (value.method === "textDocument/didOpen" || value.method === "textDocument/didChange")
      send({
        method: "textDocument/publishDiagnostics",
        params: {
          uri: value.params.textDocument.uri,
          diagnostics: [
            {
              range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
              message: value.method,
            },
          ],
        },
      })
    if (value.method === "textDocument/completion")
      send({
        id: value.id,
        result: [{ label: `${value.params.position.line}:${value.params.position.character}` }],
      })
  }
})
