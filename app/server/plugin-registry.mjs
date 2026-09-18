import cpp from "../plugins/cpp/manifest.json" with { type: "json" }
import python from "../plugins/python/manifest.json" with { type: "json" }
import rust from "../plugins/rust/manifest.json" with { type: "json" }

export const PLUGIN_API_VERSION = 1
const contributionTypes = new Set([
  "languages",
  "tools",
  "languageServers",
  "commands",
  "settings",
  "themes",
])
const capabilityTypes = new Set(["files", "process", "network", "connection"])

export function registerPlugins(manifests) {
  const ids = new Set(),
    languages = new Set(),
    tools = new Set(),
    extensions = new Set()
  for (const manifest of manifests) {
    if (
      !manifest ||
      typeof manifest.id !== "string" ||
      !/^envoi\.[a-z][a-z-]*$/.test(manifest.id) ||
      ids.has(manifest.id)
    )
      throw Error(`Invalid or duplicate plugin ID: ${manifest?.id}`)
    if (manifest.apiVersion !== PLUGIN_API_VERSION)
      throw Error(`Incompatible plugin API: ${manifest.id}`)
    if (
      typeof manifest.version !== "string" ||
      !/^\d+\.\d+\.\d+$/.test(manifest.version) ||
      typeof manifest.displayNameKey !== "string" ||
      typeof manifest.descriptionKey !== "string"
    )
      throw Error(`Invalid plugin manifest: ${manifest.id}`)
    if (
      !Array.isArray(manifest.capabilities) ||
      manifest.capabilities.some((capability) => !capabilityTypes.has(capability))
    )
      throw Error(`Invalid plugin capabilities: ${manifest.id}`)
    if (
      !Array.isArray(manifest.activationEvents) ||
      manifest.activationEvents.some(
        (event) =>
          typeof event !== "string" ||
          !/^onLanguage:[a-z]+$|^onCommand:[\w.-]+$|^onConnection$/.test(event),
      )
    )
      throw Error(`Invalid activation event: ${manifest.id}`)
    if (
      !manifest.contributes ||
      Object.keys(manifest.contributes).some((type) => !contributionTypes.has(type))
    )
      throw Error(`Invalid plugin contribution: ${manifest.id}`)
    for (const [type, seen] of [
      ["languages", languages],
      ["tools", tools],
    ]) {
      for (const item of manifest.contributes[type] ?? []) {
        if (!item || typeof item.id !== "string" || seen.has(item.id))
          throw Error(`Duplicate or invalid ${type} contribution: ${item?.id}`)
        seen.add(item.id)
        if (type === "languages")
          for (const extension of item.extensions ?? []) {
            if (
              typeof extension !== "string" ||
              !/^\.[\w+]+$/.test(extension) ||
              extensions.has(extension)
            )
              throw Error(`Duplicate or invalid file extension: ${extension}`)
            extensions.add(extension)
          }
      }
    }
    ids.add(manifest.id)
  }
  return manifests
}

// Fixed official list. No arbitrary directory is scanned or executed.
export const builtinPlugins = registerPlugins([cpp, python, rust])

export function pluginForLanguage(language) {
  return builtinPlugins.find((plugin) =>
    plugin.contributes.languages?.some((item) => item.id === language),
  )
}

export function pluginLanguageForPath(file) {
  const name = file.split(/[\\/]/).at(-1) ?? ""
  if (/\.[CH]$/.test(name)) return "cpp"
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0]
  for (const plugin of builtinPlugins)
    for (const language of plugin.contributes.languages ?? [])
      if (language.extensions.includes(extension)) return language.id
}
