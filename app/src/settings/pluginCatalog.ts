import cpp from "../../plugins/cpp/manifest.json"
import python from "../../plugins/python/manifest.json"
import rust from "../../plugins/rust/manifest.json"

import { loadPlugins } from "../../server/plugin-registry.mjs"
export const { plugins: languagePlugins, errors: pluginLoadErrors } = loadPlugins([
  cpp,
  python,
  rust,
])

export function pluginForLanguage(language?: string) {
  return languagePlugins.find((plugin) =>
    plugin.contributes.languages.some((entry) => entry.id === language),
  )?.id
}

export function pluginLanguageForPath(file: string) {
  const name = file.split(/[\\/]/).at(-1) ?? ""
  if (/\.[CH]$/.test(name) && pluginForLanguage("cpp")) return "cpp"
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0]
  for (const plugin of languagePlugins)
    for (const language of plugin.contributes.languages)
      if (language.extensions.includes(extension ?? "")) return language.id
}
