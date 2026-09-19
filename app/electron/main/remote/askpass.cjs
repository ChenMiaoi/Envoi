// Runs under Electron's Node mode; credentials travel over a private local pipe.
const net = require("node:net")
const socket = net.connect(process.env.ENVOI_ASKPASS_PIPE)
socket.setEncoding("utf8")
socket.on("connect", () =>
  socket.write(
    JSON.stringify({
      token: process.env.ENVOI_ASKPASS_TOKEN,
      prompt: process.argv.slice(2).join(" "),
    }) + "\n",
  ),
)
let result = ""
socket.on("data", (chunk) => {
  result += chunk
  if (result.includes("\n")) {
    process.stdout.write(JSON.parse(result).answer + "\n")
    socket.end()
  }
})
socket.on("error", () => process.exit(1))
setTimeout(() => process.exit(1), 120000).unref()
