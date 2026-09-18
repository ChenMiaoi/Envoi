export function loadPlugins<T>(manifests: T[]): {
  plugins: T[]
  errors: { id: string; message: string }[]
}
