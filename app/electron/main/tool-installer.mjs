import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import * as tar from "tar"
import { download, findBinary, json, unzip, verify } from "./installer-utils.mjs"
import { detectTool, executableName, probeToolPath } from "../../server/tool-config.mjs"
import { toolCatalog } from "../../server/tool-registry.mjs"

const executeFile = promisify(execFile)
const installs = new Map()
const label = "Tool"

// GitHub 官方 Release 独立二进制，资产元数据带 sha256 摘要。
const githubTools = {
  ruff: {
    repository: "astral-sh/ruff",
    targets: {
      darwin: { arm64: "aarch64-apple-darwin.tar.gz", x64: "x86_64-apple-darwin.tar.gz" },
      linux: {
        arm64: "aarch64-unknown-linux-musl.tar.gz",
        x64: "x86_64-unknown-linux-musl.tar.gz",
      },
      win32: { arm64: "aarch64-pc-windows-msvc.zip", x64: "x86_64-pc-windows-msvc.zip" },
    },
  },
}
// npm 第三方打包的官方 LLVM 二进制，注册表提供 sha512 完整性校验；仅覆盖其发布平台。
const npmTools = {
  "clang-format": {
    package: "clang-format",
    binaries: {
      darwin: { x64: "bin/darwin_x64/clang-format" },
      linux: { x64: "bin/linux_x64/clang-format" },
      win32: { x64: "bin/win32/clang-format.exe" },
    },
  },
}
// macOS 系统包管理器（clang-tidy 仅随完整 LLVM 公式发布）。
const brewTools = { "clang-format": "clang-format", "clang-tidy": "llvm" }
// Rust 组件经 rustup 官方渠道安装。
const rustupTools = { rustfmt: "rustfmt", "cargo-clippy": "clippy" }

function toolOf(id) {
  const tool = toolCatalog.find((entry) => entry.id === id)
  return tool?.binary && tool.kind !== "lsp" ? tool : undefined
}

export function toolInstallPlan(
  id,
  {
    platform = process.platform,
    arch = process.arch,
    brew = !!detectTool("brew"),
    rustup = !!detectTool("rustup"),
  } = {},
) {
  const binary = toolOf(id)?.binary
  if (!binary) return null
  if (rustupTools[binary])
    return rustup ? { method: "rustup", component: rustupTools[binary], binary } : null
  if (platform === "darwin" && brewTools[binary] && brew)
    return { method: "brew", formula: brewTools[binary], binary }
  const target = githubTools[binary]?.targets[platform]?.[arch]
  if (target)
    return {
      method: "github",
      repository: githubTools[binary].repository,
      target,
      binary,
      platform,
    }
  const packed = npmTools[binary]?.binaries[platform]?.[arch]
  if (packed)
    return {
      method: "npm",
      package: npmTools[binary].package,
      binaryPath: packed,
      binary,
      platform,
    }
  return null
}

export async function installedTool(directory, id) {
  const binary = toolOf(id)?.binary
  if (!binary) return null
  try {
    const metadata = JSON.parse(
      await readFile(path.join(directory, binary, "current.json"), "utf8"),
    )
    if (metadata.id !== binary || !/^[\w.-]+$/.test(metadata.version)) return null
    const base = path.join(directory, binary, metadata.version)
    const resolved = path.resolve(base, metadata.binary)
    if (!resolved.startsWith(`${base}${path.sep}`) || !(await stat(resolved)).isFile()) return null
    return { id, path: resolved, version: metadata.version }
  } catch {
    return null
  }
}

async function installRustupComponent(id, plan) {
  const rustup = detectTool("rustup")
  if (!rustup) throw Error("rustup is not available")
  await executeFile(rustup, ["component", "add", plan.component], {
    timeout: 300_000,
    windowsHide: true,
    maxBuffer: 1_000_000,
  })
  const binary = detectTool(plan.binary)
  if (!binary) throw Error(`${plan.component} was installed but ${plan.binary} was not found`)
  return { id, ...(await probeToolPath(id, binary)) }
}

async function installBrewFormula(id, plan) {
  const brew = detectTool("brew")
  if (!brew) throw Error("Homebrew is not available")
  await executeFile(brew, ["install", plan.formula], {
    timeout: 900_000,
    windowsHide: true,
    maxBuffer: 1_000_000,
  })
  const { stdout } = await executeFile(brew, ["--prefix", plan.formula], {
    timeout: 30_000,
    windowsHide: true,
  })
  const binary = path.join(stdout.trim(), "bin", executableName(plan.binary))
  return { id, ...(await probeToolPath(id, binary)) }
}

async function archiveRelease(plan) {
  if (plan.method === "github") {
    const metadata = await json(`https://api.github.com/repos/${plan.repository}/releases/latest`)
    const name = `${plan.binary}-${plan.target}`
    const asset = metadata.assets?.find((entry) => entry.name === name)
    if (!asset || !/^sha256:[0-9a-f]{64}$/i.test(asset.digest ?? ""))
      throw Error("Verified tool archive is unavailable")
    if (
      !asset.browser_download_url?.startsWith(
        `https://github.com/${plan.repository}/releases/download/`,
      )
    )
      throw Error("Invalid tool download URL")
    return {
      version: metadata.tag_name,
      url: asset.browser_download_url,
      digest: asset.digest,
      format: name.endsWith(".zip") ? "zip" : "tar",
    }
  }
  const metadata = await json(
    `https://registry.npmjs.org/${plan.package}/latest`,
    "application/json",
  )
  const url = metadata.dist?.tarball
  const pattern = new RegExp(
    `^https://registry\\.npmjs\\.org/${plan.package}/-/${plan.package}-[\\w.-]+\\.tgz$`,
  )
  if (!pattern.test(url)) throw Error(`Invalid ${plan.package} package URL`)
  if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(metadata.dist?.integrity ?? ""))
    throw Error(`${plan.package} package integrity is unavailable`)
  return { version: metadata.version, url, digest: metadata.dist.integrity, format: "tar" }
}

async function installArchive(directory, id, plan) {
  const selected = await archiveRelease(plan)
  if (!/^[\w.-]+$/.test(selected.version)) throw Error("Invalid tool version")
  const parent = path.join(directory, plan.binary)
  await mkdir(parent, { recursive: true })
  const staging = await mkdtemp(path.join(parent, ".install-"))
  const archive = path.join(tmpdir(), `envoi-tool-${plan.binary}-${path.basename(staging)}.archive`)
  try {
    await download(selected.url, archive, label)
    await verify(archive, selected.digest, label)
    if (selected.format === "zip") await unzip(archive, staging, label)
    else
      await tar.x({
        file: archive,
        cwd: staging,
        strip: 1,
        filter: (_name, entry) => entry.type === "File" || entry.type === "Directory",
      })
    const binary = plan.binaryPath
      ? path.join(staging, plan.binaryPath)
      : await findBinary(staging, executableName(plan.binary))
    if (!binary || !existsSync(binary)) throw Error("Tool executable was not found in the archive")
    if (plan.platform !== "win32") await chmod(binary, 0o755)
    const relativeBinary = path.relative(staging, binary)
    const installed = path.join(parent, selected.version)
    if (existsSync(installed)) {
      const previous = await installedTool(directory, id)
      if (!previous || previous.version !== selected.version)
        await rm(installed, { recursive: true, force: true })
    }
    if (!existsSync(installed)) await rename(staging, installed)
    const metadata = { id: plan.binary, version: selected.version, binary: relativeBinary }
    const temporary = path.join(parent, `current-${path.basename(staging)}.json`)
    await writeFile(temporary, JSON.stringify(metadata))
    await rename(temporary, path.join(parent, "current.json"))
    const managed = await installedTool(directory, id)
    if (!managed) throw Error("Tool installation failed")
    return managed
  } finally {
    await rm(archive, { force: true })
    await rm(staging, { recursive: true, force: true })
  }
}

export function installTool(directory, id, env) {
  const plan = toolInstallPlan(id, env)
  if (!plan) return Promise.reject(Error("No installation source is available for this tool"))
  if (installs.has(id)) return installs.get(id)
  const pending = (
    plan.method === "rustup"
      ? installRustupComponent(id, plan)
      : plan.method === "brew"
        ? installBrewFormula(id, plan)
        : installArchive(directory, id, plan)
  ).finally(() => installs.delete(id))
  installs.set(id, pending)
  pending.catch(() => {})
  return pending
}
