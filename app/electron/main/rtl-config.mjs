import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import path from "node:path"

/** @returns {import("../../shared/rtl").RtlConfiguration} */
export const emptyRtlConfiguration = () => ({
  version: 1,
  files: [],
  filelist: "",
  includeDirs: [],
  defines: [],
  parameters: [],
  top: "",
  libraries: {},
  systemVerilogFiles: [],
})
function line(value) {
  if (typeof value !== "string" || value.length > 4096 || /[\r\n\0]/.test(value))
    throw Error("Invalid RTL configuration value")
  return value.trim()
}
export function validateRtlConfiguration(value) {
  if (!value || value.version !== 1) throw Error("Unsupported RTL configuration version")
  const result = emptyRtlConfiguration()
  for (const key of ["files", "includeDirs", "defines", "parameters", "systemVerilogFiles"]) {
    if (!Array.isArray(value[key]) || value[key].length > 10000) throw Error(`Invalid RTL ${key}`)
    result[key] = [...new Set(value[key].map(line).filter(Boolean))]
  }
  for (const key of ["filelist", "top"]) result[key] = line(value[key])
  if (result.top && !/^[a-zA-Z_][\w$]*$/.test(result.top)) throw Error("Invalid RTL top module")
  for (const item of result.defines)
    if (!/^[a-zA-Z_][\w$]*(?:=.*)?$/.test(item)) throw Error("Invalid RTL macro definition")
  for (const item of result.parameters)
    if (!/^[a-zA-Z_][\w$]*=.+$/.test(item)) throw Error("Invalid RTL parameter override")
  if (!value.libraries || typeof value.libraries !== "object" || Array.isArray(value.libraries))
    throw Error("Invalid RTL library mapping")
  if (Object.keys(value.libraries).length > 10000) throw Error("RTL library mapping is too large")
  for (const [file, library] of Object.entries(value.libraries)) {
    if (!/^[a-zA-Z_][\w$]*$/.test(library)) throw Error("Invalid RTL library name")
    result.libraries[line(file)] = library
  }
  return result
}
export async function confinedFile(root, relative) {
  const target = path.resolve(root, relative)
  if (!target.startsWith(root + path.sep)) throw Error("RTL configuration is outside the project")
  let current = target
  while (current !== root) {
    try {
      const actual = await realpath(current)
      if (actual !== root && !actual.startsWith(root + path.sep))
        throw Error("RTL configuration follows a link outside the project")
      break
    } catch (error) {
      if (error.code !== "ENOENT") throw error
    }
    current = path.dirname(current)
  }
  return target
}
export async function loadRtlConfiguration(root) {
  try {
    const file = await confinedFile(root, ".envoi/rtl.json")
    if ((await stat(file)).size > 2_000_000) throw Error("RTL configuration is too large")
    return validateRtlConfiguration(JSON.parse(await readFile(file, "utf8")))
  } catch (error) {
    if (error.code === "ENOENT") return emptyRtlConfiguration()
    throw error
  }
}
export function filelistTokens(text) {
  const tokens = []
  let token = "",
    quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (!quoted && !token && (char === "#" || (char === "/" && text[i + 1] === "/"))) {
      while (i < text.length && text[i] !== "\n") i++
    } else if (char === '"') {
      quoted = !quoted
      token += char
    } else if (char === "\\" && quoted && text[i + 1] === '"') {
      token += char + text[++i]
    } else if (!quoted && /\s/.test(char)) {
      if (token) tokens.push(token)
      token = ""
    } else token += char
  }
  if (quoted) throw Error("Unterminated quote in RTL filelist")
  if (token) tokens.push(token)
  return tokens.map((value) =>
    value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1).replaceAll('\\"', '"')
      : value,
  )
}
export async function resolveRtlFiles(root, configuration, { signal } = {}) {
  const config = validateRtlConfiguration(configuration)
  const files = config.files.map((file) => path.resolve(root, file))
  const includeDirs = config.includeDirs.map((file) => path.resolve(root, file))
  const defines = [...config.defines]
  const active = new Set()
  async function readList(filename, cwd, depth) {
    signal?.throwIfAborted()
    const full = await realpath(filename)
    if (active.has(full) || depth > 16) throw Error("Recursive RTL filelist")
    if ((await stat(full)).size > 2_000_000) throw Error("RTL filelist is too large")
    active.add(full)
    const tokens = filelistTokens(await readFile(full, "utf8"))
    for (let index = 0; index < tokens.length; index++) {
      const item = tokens[index]
      const next = () => {
        if (!tokens[index + 1]) throw Error(`Missing RTL filelist argument: ${item}`)
        return tokens[++index]
      }
      if (item === "-f" || item === "-F") {
        const nested = path.resolve(cwd, next())
        await readList(nested, item === "-F" ? path.dirname(nested) : cwd, depth + 1)
      } else if (item === "-I") includeDirs.push(path.resolve(cwd, next()))
      else if (item.startsWith("-I")) includeDirs.push(path.resolve(cwd, item.slice(2)))
      else if (item === "-D") defines.push(next())
      else if (item.startsWith("-D")) defines.push(item.slice(2))
      else if (item.startsWith("+incdir+"))
        includeDirs.push(
          ...item
            .slice(8)
            .split("+")
            .filter(Boolean)
            .map((value) => path.resolve(cwd, value)),
        )
      else if (item.startsWith("+define+"))
        defines.push(...item.slice(8).split("+").filter(Boolean))
      else if (/^[+-]/.test(item))
        throw Error(
          `Unsupported RTL filelist option: ${item}; use source files, -f/-F, -I/-D or +incdir+/+define+`,
        )
      else files.push(path.resolve(cwd, item))
      if (files.length > 10000 || includeDirs.length > 10000 || defines.length > 10000)
        throw Error("RTL filelist is too large")
    }
    active.delete(full)
  }
  if (config.filelist) await readList(path.resolve(root, config.filelist), root, 0)
  const uniqueFiles = [...new Set(files)]
  for (const file of uniqueFiles) {
    signal?.throwIfAborted()
    if (!/\.(v|sv|vh|svh)$/i.test(file) || !(await stat(file)).isFile())
      throw Error(`Not a Verilog/SystemVerilog source: ${file}`)
  }
  for (const directory of includeDirs)
    if (!(await stat(directory)).isDirectory())
      throw Error(`Not an include directory: ${directory}`)
  validateRtlConfiguration({ ...config, defines })
  return {
    ...config,
    files: uniqueFiles,
    includeDirs: [...new Set(includeDirs)],
    defines: [...new Set(defines)],
  }
}
export const flagQuote = (value) => JSON.stringify(value.replaceAll("\\", "/"))
export function slangFilelist(config) {
  return (
    [
      ...config.includeDirs.map((value) => `-I ${flagQuote(value)}`),
      ...config.defines.map((value) => `-D ${JSON.stringify(value)}`),
      ...config.parameters.map((value) => `-G ${JSON.stringify(value)}`),
      ...(config.top ? [`--top ${config.top}`] : []),
      ...config.files.filter((file) => !/\.(vh|svh)$/i.test(file)).map(flagQuote),
    ].join("\n") + "\n"
  )
}
export async function saveRtlConfiguration(root, configuration, { signal } = {}) {
  const config = validateRtlConfiguration(configuration)
  const resolved = await resolveRtlFiles(root, config, { signal })
  const managed = "-f .envoi/rtl.f"
  const serverFile = await confinedFile(root, ".slang/server.json")
  let server = {}
  try {
    if ((await stat(serverFile)).size > 2_000_000)
      throw Error("Existing slang configuration is too large")
    server = JSON.parse(await readFile(serverFile, "utf8"))
  } catch (error) {
    if (error.code !== "ENOENT") throw error
  }
  if (
    !server ||
    Array.isArray(server) ||
    typeof server !== "object" ||
    (server.flags !== undefined && typeof server.flags !== "string")
  )
    throw Error("Invalid existing .slang/server.json")
  const flags = server.flags ?? ""
  server.flags = flags.includes(managed) ? flags : [flags, managed].filter(Boolean).join(" ")
  const writes = [
    [".envoi/rtl.f", slangFilelist(resolved)],
    [".envoi/verible.filelist", resolved.files.join("\n") + "\n"],
    [".slang/server.json", JSON.stringify(server, null, 2) + "\n"],
    [".envoi/rtl.json", JSON.stringify(config, null, 2) + "\n"],
  ]
  const pending = []
  try {
    for (const [relative, contents] of writes) {
      signal?.throwIfAborted()
      const destination = await confinedFile(root, relative)
      const temporary = await confinedFile(root, `${relative}.${randomUUID()}.tmp`)
      pending.push({ destination, temporary, contents })
    }
    for (const entry of pending) {
      await mkdir(path.dirname(entry.destination), { recursive: true })
      await writeFile(entry.temporary, entry.contents, { flag: "wx" })
    }
    signal?.throwIfAborted()
    for (const entry of pending) await rename(entry.temporary, entry.destination)
  } finally {
    await Promise.all(pending.map((entry) => rm(entry.temporary, { force: true })))
  }
  return { configuration: config, files: resolved.files.length }
}
