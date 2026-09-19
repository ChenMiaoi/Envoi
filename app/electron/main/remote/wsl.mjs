import { execFile } from "node:child_process"
import path from "node:path"
import { promisify } from "node:util"

export function validateWslTarget(target) {
  if (
    !target ||
    target.kind !== "wsl" ||
    typeof target.host !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(target.host)
  )
    throw Error("Select an installed WSL distribution")
  if (
    typeof target.directory !== "string" ||
    !target.directory.startsWith("/") ||
    /[\0\r\n]/.test(target.directory) ||
    target.directory.length > 4096
  )
    throw Error("Enter an absolute Linux directory")
  if (target.port !== undefined || target.configFile !== undefined)
    throw Error("SSH options are not valid for WSL")
  return { kind: "wsl", host: target.host, directory: path.posix.normalize(target.directory) }
}

export function parseWslDistributions(bytes) {
  const text = Buffer.isBuffer(bytes)
    ? bytes.toString(bytes.includes(0) ? "utf16le" : "utf8")
    : bytes
  return [
    ...new Set(
      text
        .replace(/^\uFEFF/, "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(line)),
    ),
  ]
}

export async function listWslDistributions() {
  if (process.platform !== "win32") throw Error("WSL workspaces require Windows")
  const { stdout } = await promisify(execFile)("wsl.exe", ["--list", "--quiet"], {
    windowsHide: true,
    encoding: "buffer",
    timeout: 20000,
    maxBuffer: 1024 * 1024,
  })
  return parseWslDistributions(stdout)
}

export function wslArguments(target, script) {
  validateWslTarget(target)
  return ["--distribution", target.host, "--cd", "~", "--exec", "sh", "-c", script]
}
