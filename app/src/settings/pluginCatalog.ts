import { pluginForLanguage as findPlugin } from "../../shared/plugin-registry.mjs"
export {
  builtinPlugins as languagePlugins,
  pluginLoadErrors,
  pluginLanguageForPath,
} from "../../shared/plugin-registry.mjs"
export function pluginForLanguage(language?: string) {
  return language ? findPlugin(language)?.id : undefined
}
