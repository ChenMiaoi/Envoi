import { translate } from "@/i18n/runtime"
import { nativeGet, nativePut, nativeMigrateCache, encodeNative, decodeNative } from "./localData"
import { parseBibliography } from "./bibliography"
export interface LibraryPaper {
  id: string
  title: string
  author: string
  year: string
  venue: string
  tags: string[]
  collection: string
  status: "待读" | "在读" | "已读"
  notes: string
  created: number
  attachment?: Blob
  attachmentName?: string
  contentHash?: string
  bib?: string
  citationKey?: string
}
export function createLibraryStore(name = "paperdesk-library-v1") {
  const database = () =>
    new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => request.result.createObjectStore("papers", { keyPath: "id" })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  const cache = {
    async list(): Promise<LibraryPaper[]> {
      const db = await database()
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction("papers").objectStore("papers").getAll()
          request.onsuccess = () => resolve(request.result)
          request.onerror = () => reject(request.error)
        })
      } finally {
        db.close()
      }
    },
    async put(papers: LibraryPaper[]) {
      const db = await database()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("papers", "readwrite")
          for (const paper of papers) transaction.objectStore("papers").put(paper)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () =>
            reject(transaction.error ?? Error(translate("library.writeFailed")))
          transaction.onerror = () => reject(transaction.error)
        })
      } finally {
        db.close()
      }
    },
    async remove(id: string) {
      const db = await database()
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction("papers", "readwrite")
          transaction.objectStore("papers").delete(id)
          transaction.oncomplete = () => resolve()
          transaction.onabort = () => reject(transaction.error)
          transaction.onerror = () => reject(transaction.error)
        })
      } finally {
        db.close()
      }
    },
  }
  if (name !== "paperdesk-library-v1") return cache
  return {
    async list(): Promise<LibraryPaper[]> {
      const legacy = await cache.list()
      try {
        const native = await nativeMigrateCache("library", await encodeNative(legacy))
        return decodeNative(native.value) as LibraryPaper[]
      } catch (error) {
        window.dispatchEvent(
          new CustomEvent("envoi:storage-warning", {
            detail: translate("library.disconnected") + (error as Error).message,
          }),
        )
        return legacy
      }
    },
    async put(papers: LibraryPaper[]) {
      const record = await nativeGet<unknown>("library")
      const current = record ? (decodeNative(record.value) as LibraryPaper[]) : await cache.list()
      const next = [...current.filter((item) => !papers.some((p) => p.id === item.id)), ...papers]
      await nativePut("library", await encodeNative(next), "default", {
        expectedRevision: record?.revision ?? 0,
      })
      await cache.put(papers)
    },
    async remove(id: string) {
      const record = await nativeGet<unknown>("library")
      if (!record) throw Error(translate("library.migrateFirst"))
      const next = (decodeNative(record.value) as LibraryPaper[]).filter((item) => item.id !== id)
      await nativePut("library", await encodeNative(next), "default", {
        expectedRevision: record.revision,
      })
      await cache.remove(id)
    },
  }
}
export const paperLibrary = createLibraryStore()
export type LibrarySort = "created" | "title" | "year"
export function filterLibrary(
  papers: LibraryPaper[],
  query: string,
  collection: string,
  status: string,
  year = "",
  sort: LibrarySort = "created",
) {
  const terms = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean)
  const sorted = (a: LibraryPaper, b: LibraryPaper) =>
    sort === "title"
      ? a.title.localeCompare(b.title)
      : sort === "year"
        ? b.year.localeCompare(a.year)
        : b.created - a.created
  return papers
    .filter(
      (paper) =>
        (!collection || paper.collection === collection) &&
        (!status || paper.status === status) &&
        (!year || paper.year === year) &&
        terms.every((term) =>
          [
            paper.title,
            paper.author,
            paper.year,
            paper.venue,
            ...paper.tags,
            paper.citationKey ?? "",
          ]
            .join(" ")
            .toLocaleLowerCase()
            .includes(term),
        ),
    )
    .sort(sorted)
}
export async function fingerprintPdf(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.slice(0, 65536).arrayBuffer())
  return `${file.size}:${Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")}`
}
export function dedupeImported(existing: LibraryPaper[], imported: LibraryPaper[]) {
  const keys = new Set(existing.map((p) => p.citationKey).filter(Boolean)),
    hashes = new Set(existing.map((p) => p.contentHash).filter(Boolean))
  const added = imported.filter(
    (paper) =>
      !(paper.citationKey && keys.has(paper.citationKey)) &&
      !(paper.contentHash && hashes.has(paper.contentHash)),
  )
  return { added, skipped: imported.length - added.length }
}
export async function validateLibraryPdf(file: Blob) {
  if (file.size > 100_000_000) throw Error(translate("library.pdfTooLarge"))
  if (!(await file.slice(0, 1024).text()).includes("%PDF-"))
    throw Error(translate("library.notPdf"))
}
export async function importLibraryFiles(files: File[]): Promise<LibraryPaper[]> {
  const records: LibraryPaper[] = []
  for (const file of files) {
    const base = {
      author: "",
      year: "",
      venue: "",
      tags: [],
      collection: "",
      status: "待读" as const,
      notes: "",
      created: Date.now(),
    }
    if (/\.pdf$/i.test(file.name)) {
      await validateLibraryPdf(file)
      records.push({
        ...base,
        id: crypto.randomUUID(),
        title: file.name.replace(/\.pdf$/i, ""),
        attachment: file,
        attachmentName: file.name,
        contentHash: await fingerprintPdf(file),
      })
    } else if (/\.bib$/i.test(file.name)) {
      if (file.size > 5_000_000) throw Error(translate("library.bibTooLarge"))
      for (const entry of parseBibliography(await file.text()))
        records.push({
          ...base,
          id: crypto.randomUUID(),
          title: entry.title === translate("bib.noTitle") ? "" : entry.title,
          author: entry.author === translate("bib.noAuthor") ? "" : entry.author,
          year: entry.year,
          venue: entry.venue,
          bib: entry.raw,
          citationKey: entry.key,
        })
    } else throw Error(translate("library.importUnsupported", { name: file.name }))
  }
  return records
}
export function libraryAttachment(paper: LibraryPaper) {
  if (!paper.attachment) throw Error(translate("library.noAttachment"))
  return new File([paper.attachment], paper.attachmentName ?? `${paper.title || "paper"}.pdf`, {
    type: "application/pdf",
  })
}
