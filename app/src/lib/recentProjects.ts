import { nativeBasename, nativePathWithin } from "@/lib/nativePath"
import { envoi } from "./desktop"
import { translate } from "@/i18n/runtime"
import { nativeMigrateCache, nativePut, nativeGet, encodeNative } from "./localData"
import { projectConfigFile } from "./managementDir"
import { isRemoteWorkspace, type WorkspaceLocation } from "./workspaceLocation"
export interface RecentProject {
  id: string
  name: string
  projectId?: string
  path?: string
  updated: number
  location?: WorkspaceLocation
}
async function database() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("paperdesk-projects", 2)
    request.onupgradeneeded = () => {
      for (const name of ["recent", "roots"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
async function cachedRecentProjects(): Promise<RecentProject[]> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("recent").objectStore("recent").getAll()
      request.onsuccess = () =>
        resolve(
          (request.result as (RecentProject & { directory?: unknown })[])
            .map((value) => {
              const entry = { ...value }
              delete entry.directory
              return entry
            })
            .sort((a, b) => b.updated - a.updated),
        )
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
async function remember(store: "recent" | "roots", rootPath: string) {
  rootPath = await envoi().canonicalDirectory(rootPath)
  const previous = await (store === "recent" ? recentProjects() : authorizedRoots())
  let identity: string | undefined
  try {
    identity = /^(ssh|wsl):\/\//.test(rootPath)
      ? "remote-" + new URL(rootPath).hostname
      : JSON.parse((await projectConfigFile(rootPath))?.text ?? "{}").projectId
  } catch {
    /* Authorized roots need not be projects. */
  }
  const existing =
    previous.find((entry) => entry.path === rootPath) ??
    previous.find((entry) => identity && entry.projectId === identity)
  const id = existing?.id ?? identity ?? crypto.randomUUID()
  const connection = isRemoteWorkspace(rootPath)
    ? (await envoi().remoteList()).find((entry) => entry.root === rootPath)
    : undefined
  const location = connection
    ? {
        kind: connection.kind ?? ("ssh" as const),
        host: connection.host,
        directory: connection.directory,
      }
    : undefined
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(store, "readwrite")
      transaction.objectStore(store).put({
        id,
        name: nativeBasename(location?.directory ?? rootPath),
        ...(location ? { location } : {}),
        projectId: identity,
        path: rootPath,
        updated: Date.now(),
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
  await syncRegistry(store, [], [id])
}
export const rememberProject = (rootPath: string) => remember("recent", rootPath)
export const rememberRoot = (rootPath: string) => remember("roots", rootPath)
async function cachedAuthorizedRoots(): Promise<RecentProject[]> {
  const db = await database()
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("roots").objectStore("roots").getAll()
      request.onsuccess = () =>
        resolve(
          (request.result as (RecentProject & { directory?: unknown })[])
            .map((value) => {
              const entry = { ...value }
              delete entry.directory
              return entry
            })
            .sort((a, b) => b.updated - a.updated),
        )
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}
export async function forgetRecentProject(id: string) {
  await forgetDeletedRecords([{ store: "recent", id }])
}
export async function matchingProjectRecords(rootPath: string) {
  const recent = await recentProjects(),
    roots = await authorizedRoots()
  const ids: { store: string; id: string }[] = []
  for (const [store, entries] of [
    ["recent", recent],
    ["roots", roots],
  ] as const)
    for (const entry of entries)
      if (entry.path && nativePathWithin(entry.path, rootPath)) ids.push({ store, id: entry.id })
  return ids
}
export async function forgetDeletedRecords(ids: { store: string; id: string }[]) {
  const db = await database()
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["recent", "roots"], "readwrite")
      for (const item of ids) tx.objectStore(item.store).delete(item.id)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
  for (const store of ["recent", "roots"] as const) {
    const removed = ids.filter((item) => item.store === store).map((item) => item.id)
    if (removed.length) await syncRegistry(store, removed)
  }
}

async function records(store: "recent" | "roots"): Promise<RecentProject[]> {
  const cached = await (store === "recent" ? cachedRecentProjects() : cachedAuthorizedRoots())
  if (typeof window === "undefined") return cached
  try {
    const native = await nativeMigrateCache(store, await encodeNative(cached))
    return (native.value as RecentProject[]).sort((a, b) => b.updated - a.updated)
  } catch (error) {
    window.dispatchEvent(
      new CustomEvent("envoi:storage-warning", {
        detail: translate("project.recentDisconnected") + (error as Error).message,
      }),
    )
    return cached
  }
}
export async function recentProjects(): Promise<RecentProject[]> {
  const rows = await records("recent")
  if (!rows.some((entry) => isRemoteWorkspace(entry.path))) return rows
  const connections = await envoi()
    .remoteList()
    .catch(() => [])
  return rows.map((entry) => {
    const remote = connections.find((connection) => connection.root === entry.path)
    if (!remote) {
      if (
        isRemoteWorkspace(entry.path) &&
        !entry.location &&
        entry.name === new URL(entry.path!).hostname
      )
        return {
          ...entry,
          name: translate(entry.path!.startsWith("wsl://") ? "wsl.title" : "remote.title"),
        }
      return entry
    }
    return {
      ...entry,
      name: nativeBasename(remote.directory),
      location: {
        kind: remote.kind ?? "ssh",
        host: remote.host,
        directory: remote.directory,
      },
    }
  })
}
export const authorizedRoots = () => records("roots")
async function syncRegistry(
  store: "recent" | "roots",
  remove: string[] = [],
  changed: string[] = [],
) {
  if (typeof window === "undefined") return
  const cached = await (store === "recent" ? cachedRecentProjects() : cachedAuthorizedRoots())
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await nativeGet<RecentProject[]>(store)
    const merged = new Map((current?.value ?? []).map((entry) => [entry.id, entry]))
    for (const entry of cached.filter((entry) => changed.includes(entry.id)))
      merged.set(entry.id, { ...merged.get(entry.id), ...entry })
    for (const id of remove) merged.delete(id)
    try {
      await nativePut(store, await encodeNative([...merged.values()]), "default", {
        expectedRevision: current?.revision ?? 0,
      })
      return
    } catch (error) {
      if (attempt === 2 || !String((error as Error).message).includes("另一窗口修改")) throw error
    }
  }
}
