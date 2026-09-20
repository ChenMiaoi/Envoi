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

export async function runWsl(host, script, args = [], options = {}) {
  validateWslTarget({ kind: "wsl", host, directory: "/" })
  if (process.platform !== "win32") throw Error("WSL workspaces require Windows")
  try {
    const { stdout } = await promisify(execFile)(
      "wsl.exe",
      ["--distribution", host, "--cd", "~", "--exec", "sh", "-c", script, "envoi", ...args],
      { windowsHide: true, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024, ...options },
    )
    return stdout
  } catch (error) {
    if (options.signal?.aborted) throw error
    throw Error(
      error.stderr?.trim() || `WSL command failed in ${host}: ${error.code ?? "unknown error"}`,
      { cause: error },
    )
  }
}

export function parseWslDirectories(output) {
  const [home, directory, ...entries] = output.split("\0")
  if (!home?.startsWith("/") || !directory?.startsWith("/"))
    throw Error("Invalid WSL directory response")
  return {
    home,
    directory,
    directories: entries
      .filter((entry) => entry.startsWith("/") && !/[\0\r\n]/.test(entry))
      .sort()
      .slice(0, 200),
  }
}

export async function browseWslDirectories(host, input = "") {
  if (typeof input !== "string" || /[\0\r\n]/.test(input) || input.length > 4096)
    throw Error("Invalid WSL directory")
  const script = [
    "set -eu",
    "p=$1",
    'case "$p" in ""|"~") p="$HOME/" ;; "~/"*) p="$HOME/"${p#\\~/} ;; /*) ;; *) p="$HOME/$p" ;; esac',
    'case "$p" in */) base=$p; prefix="" ;; *) base=${p%/*}/; prefix=${p##*/} ;; esac',
    'test -d "$base" && test -r "$base" || { echo "Directory is unavailable or unreadable" >&2; exit 1; }',
    'printf "%s\\0%s\\0" "$HOME" "$p"',
    "count=0",
    'for entry in "$base"* "$base".[!.]* "$base"..?*; do',
    'test -d "$entry" || continue',
    "name=${entry##*/}",
    'case "$name" in "$prefix"*) printf "%s/\\0" "$entry"; count=$((count + 1));; esac',
    'test "$count" -lt 200 || break',
    "done",
  ].join("\n")
  return parseWslDirectories(await runWsl(host, script, [input]))
}
