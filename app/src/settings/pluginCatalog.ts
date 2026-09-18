import cpp from "../../plugins/cpp/manifest.json"
import python from "../../plugins/python/manifest.json"
import rust from "../../plugins/rust/manifest.json"

export const languagePlugins = [cpp, python, rust]

export function pluginForLanguage(language?: string) {
  return languagePlugins.find((plugin) =>
    plugin.contributes.languages.some((entry) => entry.id === language),
  )?.id
}

export function pluginLanguageForPath(file: string) {
  const name = file.split(/[\\/]/).at(-1) ?? ""
  if (/\.[CH]$/.test(name)) return "cpp"
  const extension = name.toLowerCase().match(/\.[^.]+$/)?.[0]
  for (const plugin of languagePlugins)
    for (const language of plugin.contributes.languages)
      if (language.extensions.includes(extension ?? "")) return language.id
}
