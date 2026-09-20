import { createHash } from "node:crypto"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { spawnSync } from "node:child_process"

export const maxCacheAge = 24 * 60 * 60 * 1000
export const digest = (value) => createHash("sha256").update(value).digest("hex")

// Unknown files deliberately invalidate every suite. Keep exclusions narrow.
export function affectsStep(file, step) {
  if (step === "format") return true
  if (
    /^(README(?:\.[^/]+)?\.md|CONTRIBUTING\.md|AGENTS\.md|LICENSE|THIRD_PARTY[^/]*|docs\/)/.test(
      file,
    )
  )
    return false
  if (file.startsWith("app/tests/")) return ["lint", "unit"].includes(step)
  return true
}

export async function sourceSnapshot(root) {
  const result = spawnSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    },
  )
  if (result.status !== 0) throw new Error("Cannot enumerate validation inputs with git")
  const staged = spawnSync("git", ["ls-files", "--stage", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  })
  if (staged.status !== 0) throw new Error("Cannot enumerate Git submodules")
  const submodules = new Map(
    staged.stdout.split("\0").flatMap((entry) => {
      const match = entry.match(/^160000 ([a-f0-9]+) 0\t(.+)$/s)
      return match ? [[match[2], match[1]]] : []
    }),
  )
  return Promise.all(
    [...new Set(result.stdout.split("\0").filter(Boolean))].sort().map(async (file) => {
      if (submodules.has(file)) return [file, `gitlink:${submodules.get(file)}`]
      try {
        return [file, digest(await readFile(path.join(root, file)))]
      } catch (error) {
        if (error.code === "ENOENT") return [file, "missing"]
        throw error
      }
    }),
  )
}

export function stepKey(snapshot, step, context) {
  return digest(JSON.stringify([context, snapshot.filter(([file]) => affectsStep(file, step))]))
}

export function canReuse(entry, key, now = Date.now()) {
  return Boolean(
    entry && entry.key === key && now >= entry.passedAt && now - entry.passedAt < maxCacheAge,
  )
}

export async function artifactKey(root) {
  const files = []
  async function walk(relative) {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${relative}/${entry.name}`
      if (entry.isDirectory()) await walk(name)
      else files.push([name, digest(await readFile(path.join(root, name)))])
    }
  }
  try {
    await walk("app/dist")
    await walk("app/public/pdfjs")
    if (!files.some(([name]) => name === "app/dist/main/index.js")) return null
    return digest(JSON.stringify(files))
  } catch (error) {
    if (error.code === "ENOENT") return null
    throw error
  }
}
