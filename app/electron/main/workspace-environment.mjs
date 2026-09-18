import { spawn } from "node:child_process"
import { readFile, readdir, stat } from "node:fs/promises"
import { realpathSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { projectPath, atomicProjectWrite } from "./file-service.mjs"
import { restrictedPath } from "./restricted-path.mjs"
import { watchProjectDirectory } from "./project-watch.mjs"
import { detectTool } from "../../server/tool-config.mjs"

function within(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

export function createLocalWorkspaceEnvironment(root) {
  const canonical = realpathSync(root)
  const paths = {
    resolve(relative) {
      return projectPath(canonical, relative)
    },
    uri(relative) {
      return pathToFileURL(projectPath(canonical, relative)).href
    },
  }
  return {
    identity: {
      id: `local:${canonical}`,
      generation: 0,
      platform: process.platform,
      arch: process.arch,
      capabilities: ["files", "process", "watch", "tools"],
    },
    root: canonical,
    paths,
    fs: {
      async read(relative) {
        return readFile(await restrictedPath(canonical, relative))
      },
      async write(relative, content) {
        await restrictedPath(canonical, relative)
        return atomicProjectWrite(canonical, relative, content)
      },
      async list(relative = "") {
        return readdir(relative ? await restrictedPath(canonical, relative) : canonical, {
          withFileTypes: true,
        })
      },
      async stat(relative = "") {
        return stat(relative ? await restrictedPath(canonical, relative) : canonical)
      },
      watch(notify) {
        return watchProjectDirectory(canonical, notify)
      },
    },
    process: {
      spawn(command, args, options = {}) {
        if (
          typeof command !== "string" ||
          !command ||
          !Array.isArray(args) ||
          args.some((argument) => typeof argument !== "string")
        )
          throw Error("Invalid process command")
        const cwd = options.cwd ?? canonical
        if (!within(canonical, realpathSync(cwd)))
          throw Error("Process directory is outside workspace")
        return spawn(command, args, { ...options, cwd, windowsHide: true })
      },
    },
    tools: { resolve: detectTool },
    terminal: {
      create() {
        throw Error("Interactive terminals are not available in this environment")
      },
    },
  }
}
