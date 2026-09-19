import { builtinPlugins, pluginForLanguage as findPlugin } from "../../shared/plugin-registry.mjs"
export { pluginLoadErrors, pluginLanguageForPath } from "../../shared/plugin-registry.mjs"
export function pluginForLanguage(language?: string) {
  return language ? findPlugin(language)?.id : undefined
}

export const languagePlugins = builtinPlugins.filter(
  (plugin) => plugin.contributes.languages.length > 0,
)
