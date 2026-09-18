import { StrictMode, useLayoutEffect, useState, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { ProjectContext, useProject, type ProjectState } from "../src/project/context"
import { AgentContext, useAgent, type AgentState } from "../src/agent/context"
import { useProvidedStore } from "../src/lib/selectorStore"
import type { PaperProject } from "../src/lib/projectFiles"
import { sameFileNavigation } from "../src/lib/projectPerformance"

const counts = { navigation: 0, editor: 0, model: 0, transcript: 0 }
const controls = {} as {
  edit(text: string): void
  rename(path: string): void
  stream(text: string): void
  model(name: string): void
  choose(id: string): void
}
Object.assign(window, { performanceFixture: { counts, controls } })
const initial: PaperProject = {
  id: "project",
  name: "Project",
  rootId: "main",
  directories: [],
  files: [
    { id: "main", path: "main.tex", kind: "latex", text: "initial" },
    { id: "other", path: "other.tex", kind: "latex", text: "other text" },
  ],
}
const noop = () => {}
const asyncNoop = async () => {}
export function ProjectOwner({ children }: { children: ReactNode }) {
  const [project, setProject] = useState(initial)
  const state: ProjectState = {
    project,
    setProject,
    getProject: () => project,
    closeProject: asyncNoop,
    saveAll: async () => true,
    saving: false,
    edit: noop,
    message: "",
    setMessage: noop,
    busy: false,
    agentWriting: false,
    navigationBusy: false,
    setAgentBusy: noop,
    setBusy: noop,
  }
  const store = useProvidedStore(state)
  useLayoutEffect(() => {
    controls.edit = (text) =>
      setProject((current) => ({
        ...current,
        files: current.files.map((file, i) => (i ? file : { ...file, text })),
      }))
    controls.rename = (path) =>
      setProject((current) => ({
        ...current,
        files: current.files.map((file, i) => (i ? file : { ...file, path })),
      }))
  }, [])
  return <ProjectContext.Provider value={store}>{children}</ProjectContext.Provider>
}
export function AgentOwner({ children }: { children: ReactNode }) {
  const [text, setText] = useState("")
  const [scope, setScope] = useState("model-a")
  const store = useProvidedStore<AgentState>({
    status: null,
    scope,
    record: {
      id: "record",
      name: "Test",
      status: "running",
      messages: [{ id: "message", role: "assistant", text }],
    },
    sessions: [],
    busy: false,
    navigating: false,
    error: "",
    ready: true,
    config: null,
    refresh: asyncNoop,
    select: asyncNoop,
    newSession: asyncNoop,
    send: asyncNoop,
    stop: noop,
    remove: asyncNoop,
  })
  useLayoutEffect(() => {
    controls.stream = setText
    controls.model = setScope
  }, [])
  return <AgentContext.Provider value={store}>{children}</AgentContext.Provider>
}
export function Navigation() {
  const files = useProject((state) => state.project.files, sameFileNavigation)
  counts.navigation++
  return <div id="navigation">{files[0].path}</div>
}
export function Editor() {
  const [id, setId] = useState("main")
  useLayoutEffect(() => {
    controls.choose = setId
  }, [])
  const text = useProject((state) => state.project.files.find((file) => file.id === id)?.text)
  counts.editor++
  return <div id="editor">{text}</div>
}
export function Model() {
  const { scope } = useAgent((state) => ({ scope: state.scope }))
  counts.model++
  return <div id="model">{scope}</div>
}
export function Transcript() {
  const text = useAgent((state) => state.record?.messages[0].text)
  counts.transcript++
  return <div id="transcript">{text}</div>
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ProjectOwner>
      <AgentOwner>
        <Navigation />
        <Editor />
        <Model />
        <Transcript />
      </AgentOwner>
    </ProjectOwner>
  </StrictMode>,
)
