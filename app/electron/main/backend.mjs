const parentPort = process.parentPort
import { compileSnapshot, runtimeInfo } from "../../server/compiler.mjs"
import { lintText } from "../../server/lint.mjs"
import { configureTools, toolInfo } from "../../server/tool-config.mjs"
import { gitInitAt, gitLogAt, gitRuntime, gitShowAt, gitStatusAt } from "../../server/git.mjs"
import { TaskRegistry } from "./task-registry.mjs"
const tasks = new TaskRegistry()
let agent, loadingAgent
async function ai() {
  if (agent) return agent
  loadingAgent ??= import("../../server/agent.mjs")
    .then((module) => (agent = module.createAgentCore({ trustedDesktop: true })))
    .catch((error) => {
      loadingAgent = undefined
      throw error
    })
  return loadingAgent
}
const git = { gitInit: gitInitAt, gitStatus: gitStatusAt, gitLog: gitLogAt, gitShow: gitShowAt }
async function dispatch(message) {
  const { id, method, args, owner, root } = message
  if (method === "shutdown") {
    await tasks.cancel()
    await agent?.dispose()
    return null
  }
  if (method === "cancel") {
    await tasks.cancel(owner, root)
    return null
  }
  if (method === "runtime") return runtimeInfo({ trusted: true })
  if (method === "gitRuntime") return gitRuntime()
  if (method in git) return git[method](...args)
  if (method === "tools") return { ...toolInfo(), latex: runtimeInfo({ trusted: true }) }
  if (method === "configureTools")
    return { ...(await configureTools(args[0])), latex: runtimeInfo({ trusted: true }) }
  if (method === "compile")
    return tasks.run("compile:" + root, owner, root, (signal) =>
      compileSnapshot(args[0], {
        signal,
        trustedRoot: root,
        sourceRoot: args[0].drafts ? root : undefined,
        onResource: (resource) => parentPort.postMessage({ resource }),
      }),
    )
  if (method === "lint")
    return tasks.run("lint:" + owner + ":" + id, owner, root, (signal) =>
      lintText(args[0], { signal, trustedRoot: root }),
    )
  if (method === "agentStatus") return (await ai()).status()
  if (method === "agentRequest") {
    const core = await ai()
    if (args[1]?.projectId) core.bind(args[1].projectId)
    return core.request(...args)
  }
  if (method === "agentChat") {
    return tasks.run("chat:" + args[0].projectId, owner, root, async (signal) => {
      const core = await ai()
      signal.throwIfAborted()
      core.bind(args[0].projectId)
      return core.chat(args[0], {
        signal,
        onEvent: (event) => parentPort.postMessage({ id, event }),
      })
    })
  }
  throw Error("未知后台操作")
}
parentPort.on("message", ({ data }) => {
  if (!data || typeof data.id !== "number") return
  void dispatch(data).then(
    (result) => parentPort.postMessage({ id: data.id, result }),
    (error) => parentPort.postMessage({ id: data.id, error: error.message }),
  )
})
