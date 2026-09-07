import electronLog from "electron-log/node.js"
import { randomUUID } from "node:crypto"
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises"
import { statSync } from "node:fs"
import path from "node:path"
import { safeError } from "../../shared/log-record.ts"

export const LOG_MAX_SIZE = 5 * 1024 * 1024
// The library's shared file registry reports creation errors through its default logger.
// Suppress that raw console fallback; expose failure through diagnosticsInfo instead.
electronLog.transports.console = Object.assign(() => {}, { level: false })
export function createDiagnostics(directory, version, maxSize = LOG_MAX_SIZE) {
  const log = electronLog.create({ logId: `envoi-${randomUUID()}` })
  const session = randomUUID()
  let failed = false
  const silentConsole = () => {
    failed = true
  }
  silentConsole.level = false
  log.transports.console = silentConsole
  if (log.transports.ipc) log.transports.ipc.level = false
  if (log.transports.remote) log.transports.remote.level = false
  log.transports.file.resolvePathFn = () => path.join(directory, "main.log")
  log.transports.file.maxSize = maxSize
  log.transports.file.level = "debug"
  log.transports.file.format = "{text}"
  log.transports.file.sync = true
  log.transports.file.writeOptions = { flag: "a", encoding: "utf8", mode: 0o600 }
  log.processInternalErrorFn = () => {
    failed = true
  }
  try {
    const file = log.transports.file.getFile()
    file.on("error", () => {
      failed = true
    })
    if (!statSync(file.path).isFile()) failed = true
  } catch {
    failed = true
  }
  function write(level, module, event, context = {}, error) {
    try {
      // Context is deliberately allowlisted. Never serialize arguments, results or free-form text.
      const details = {}
      for (const key of ["operationId", "method", "backend", "reason"]) {
        if (typeof context[key] === "string" && /^[a-zA-Z0-9:._-]{1,100}$/.test(context[key]))
          details[key] = context[key]
      }
      for (const key of ["durationMs", "exitCode", "pending"]) {
        if (typeof context[key] === "number" && Number.isFinite(context[key]))
          details[key] = context[key]
      }
      log[level](
        JSON.stringify({
          time: new Date().toISOString(),
          session,
          version,
          level,
          module,
          event,
          ...details,
          ...(error ? { error: safeError(error) } : {}),
        }),
      )
    } catch {
      failed = true
    }
  }
  return {
    directory,
    write,
    info: () => ({ directory, maxFileBytes: maxSize, files: 2, available: !failed }),
    async open() {
      await mkdir(directory, { recursive: true })
      return directory
    },
    async export(destination) {
      const relative = path.relative(directory, path.resolve(destination))
      if (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative))
        throw Error("Choose an export destination outside the log directory")
      const logs = []
      for (const name of ["main.old.log", "main.log"]) {
        const file = path.join(directory, name)
        try {
          const stat = await lstat(file)
          if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxSize + 65536)
            throw Error("Invalid diagnostic file")
          logs.push({ name, content: await readFile(file, "utf8") })
        } catch (error) {
          if (error.code !== "ENOENT") throw error
        }
      }
      if (!logs.length || failed) throw Error("Diagnostic logs unavailable")
      await writeFile(
        destination,
        JSON.stringify(
          {
            format: 1,
            version,
            platform: process.platform,
            arch: process.arch,
            exportedAt: new Date().toISOString(),
            logs,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
    },
  }
}
