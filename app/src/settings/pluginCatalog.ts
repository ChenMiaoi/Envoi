import cpp from "../../plugins/cpp/manifest.json"
import python from "../../plugins/python/manifest.json"
import rust from "../../plugins/rust/manifest.json"

export const languagePlugins = [cpp, python, rust]

export function pluginForLanguage(language?: string) {
  return languagePlugins.find((plugin) =>
    plugin.contributes.languages.some((entry) => entry.id === language),
  )?.id
}
