export function loadPlugins<T>(manifests: T[]): {
  plugins: T[]
  errors: { id: string; message: string }[]
}

type Manifest =
  | typeof import("../plugins/remote-ssh/manifest.json")
  | typeof import("../plugins/wsl/manifest.json")
  | typeof import("../plugins/cpp/manifest.json")
  | typeof import("../plugins/python/manifest.json")
  | typeof import("../plugins/rust/manifest.json")
export const builtinPlugins: Manifest[]
export const pluginLoadErrors: { id: string; message: string }[]
export function pluginForLanguage(language: string): Manifest | undefined
export function pluginLanguageForPath(file: string): string | undefined
