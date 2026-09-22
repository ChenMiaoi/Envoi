const ansi = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  bold: "\u001b[1m",
  cyan: "\u001b[36m",
  blue: "\u001b[34m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  red: "\u001b[31m",
  gray: "\u001b[90m",
}

function stripAnsi(value) {
  let plain = ""
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\u001b" && value[index + 1] === "[") {
      let end = index + 2
      while (end < value.length && "0123456789;".includes(value[end])) end += 1
      if (value[end] === "m") {
        index = end
        continue
      }
    }
    plain += value[index]
  }
  return plain
}

const statusColors = {
  DEBUG: ansi.gray,
  INFO: ansi.blue,
  WARN: ansi.yellow,
  ERROR: ansi.red,
  START: ansi.blue,
  PASS: ansi.green,
  FAIL: ansi.red,
  SKIP: ansi.gray,
  RETRY: ansi.yellow,
}

function token(value, name) {
  value = String(value)
  if (!/^[a-zA-Z0-9:._/-]{1,100}$/.test(value)) throw Error("Invalid log " + name + ": " + value)
  return value
}

function fieldValue(value) {
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  if (value === null) return "null"
  if (typeof value === "string" && /^[a-zA-Z0-9:._/@+-]+$/.test(value)) return value
  return JSON.stringify(value)
}

function segment(value, color, enabled) {
  const text = "[" + value + "]"
  return enabled ? color + text + ansi.reset : text
}

export function formatLogLine(
  { time = new Date().toISOString(), scope, status, event, message = "", fields = {} },
  { color = false } = {},
) {
  const normalizedStatus = token(status, "status").toUpperCase()
  const prefix = [
    segment(time, ansi.dim, color),
    segment(token(scope, "scope"), ansi.cyan, color),
    segment(normalizedStatus, statusColors[normalizedStatus] ?? ansi.blue, color),
    segment(token(event, "event"), ansi.bold, color),
  ].join("")
  const details = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => token(key, "field") + "=" + fieldValue(value))
  const suffix = [message, ...details].filter(Boolean).join(" ")
  return suffix ? prefix + " " + suffix : prefix
}

export function logColorEnabled({ env = process.env, stream = process.stdout } = {}) {
  if (Object.hasOwn(env, "NO_COLOR")) return false
  const configured = env.ENVOI_COLOR ?? "auto"
  if (!["auto", "always", "never"].includes(configured))
    throw Error("Invalid ENVOI_COLOR: " + configured)
  if (configured === "always") return true
  if (configured === "never") return false
  return !!stream?.isTTY || env.GITHUB_ACTIONS === "true"
}

export function isFormattedLogLine(value) {
  const plain = stripAnsi(String(value))
  return /^(?:\[[^\]\r\n]+\]){4}(?: |$)/.test(plain)
}
