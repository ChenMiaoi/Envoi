import { translate } from "@/i18n/runtime"
import { envoi, ipcError } from "@/lib/desktop"
export interface NativeValue<T> {
  revision: number
  value: T
  migration?: { archived: boolean; new: boolean }
}
export const nativeGet = <T>(store: string, key = "default") =>
  envoi()
    .dataGet(store, key)
    .catch((error) => {
      throw ipcError(error)
    }) as Promise<NativeValue<T> | null>
export const nativePut = <T>(
  store: string,
  value: T,
  key = "default",
  options: { migrate?: boolean; expectedRevision?: number } = {},
) =>
  envoi()
    .dataPut(store, value, key, options)
    .catch((error) => {
      throw ipcError(error)
    }) as Promise<NativeValue<T>>
export async function encodeNative(value: unknown): Promise<unknown> {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer())
    let binary = ""
    for (let i = 0; i < bytes.length; i += 32768)
      binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
    return {
      $blob: btoa(binary),
      type: value.type,
      name: value instanceof File ? value.name : undefined,
      lastModified: value instanceof File ? value.lastModified : undefined,
    }
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodeNative))
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      if (
        ["directory", "handle"].includes(key) ||
        (key === "url" && typeof entry === "string" && entry.startsWith("blob:"))
      )
        continue
      result[key] = await encodeNative(entry)
    }
    return result
  }
  return value
}
export function decodeNative(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeNative)
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>
    if (typeof raw.$blob === "string") {
      const bytes = Uint8Array.from(atob(raw.$blob), (c) => c.charCodeAt(0))
      return raw.name
        ? new File([bytes], String(raw.name), {
            type: String(raw.type ?? ""),
            lastModified: Number(raw.lastModified) || 0,
          })
        : new Blob([bytes], { type: String(raw.type ?? "") })
    }
    return Object.fromEntries(Object.entries(raw).map(([key, entry]) => [key, decodeNative(entry)]))
  }
  return value
}
// The backend resolves create-or-preserve under its store lock. A read followed
// by expectedRevision:0 races with StrictMode initialization and other consumers.
export async function nativeMigrate<T>(store: string, legacy: T, key = "default") {
  const result = await nativePut(store, legacy, key, { migrate: true })
  if (result.migration?.new && typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent("envoi:storage-warning", { detail: translate("storage.legacyArchived") }),
    )
  return result
}

// Browser caches remain writable after migration. They are no longer legacy imports.
const migratedCaches = new Set<string>()
const cacheMigrations = new Map<string, Promise<NativeValue<unknown>>>()
export async function nativeMigrateCache<T>(
  store: string,
  legacy: T,
  key = "default",
): Promise<NativeValue<T>> {
  const marker = `envoi:migrated-cache:${store}:${key}`
  let migrated = migratedCaches.has(marker) || cacheMigrations.has(marker)
  try {
    migrated ||= globalThis.localStorage?.getItem(marker) === "1"
  } catch {
    /* Storage can be unavailable. */
  }
  if (migrated) {
    await cacheMigrations.get(marker)
    const current = await nativeGet<T>(store, key)
    if (current) return current
  }
  const operation = nativeMigrate(store, legacy, key)
  cacheMigrations.set(marker, operation)
  try {
    const result = await operation
    migratedCaches.add(marker)
    cacheMigrations.delete(marker)
    try {
      globalThis.localStorage?.setItem(marker, "1")
    } catch {
      /* Keep the in-memory marker. */
    }
    return result
  } catch (error) {
    cacheMigrations.delete(marker)
    throw error
  }
}
