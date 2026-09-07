import { realpathSync, watch } from "node:fs"
export function watchProjectDirectory(root, notify, { delay = 180, maxDelay = 1000 } = {}) {
  let timer,
    maximum,
    closed = false
  const paths = new Set()
  const flush = () => {
    clearTimeout(timer)
    clearTimeout(maximum)
    timer = maximum = undefined
    if (closed || !paths.size) return
    const changed = [...paths]
    paths.clear()
    notify({ root, paths: changed })
  }
  // Windows can return long paths from ReadDirectoryChangesW while the
  // runner gives Node an 8.3 short path from os.tmpdir(). libuv aborts when
  // those prefixes differ, so watch the native canonical path instead.
  const watchRoot = process.platform === "win32" ? realpathSync.native(root) : root
  const watcher = watch(watchRoot, { recursive: true }, (_type, filename) => {
    const relative = filename?.toString().replaceAll("\\", "/") ?? ""
    // Library state is maintained by its own service, not the manuscript snapshot.
    if (relative === ".envoi/library" || relative.startsWith(".envoi/library/")) return
    if (
      relative
        .split("/")
        .some((part) => part.startsWith(".envoi-write-") || part === "node_modules") ||
      relative.startsWith(".git/objects/") ||
      relative.startsWith(".git/worktrees/")
    )
      return
    if (paths.size < 256) paths.add(relative)
    else paths.add("")
    clearTimeout(timer)
    timer = setTimeout(flush, delay)
    maximum ??= setTimeout(flush, maxDelay)
  })
  // FSEvents may start asynchronously; reconcile once after its startup window.
  const initial = setTimeout(() => {
    if (!closed) notify({ root, paths: [""] })
  }, 300)
  watcher.on("error", (error) => {
    if (!closed) notify({ root, paths: [], error: error.message })
  })
  return () => {
    closed = true
    clearTimeout(initial)
    clearTimeout(timer)
    clearTimeout(maximum)
    watcher.close()
  }
}
