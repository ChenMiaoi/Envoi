import { translate } from "@/i18n/runtime"
import type { PaperProject } from "./projectFiles"
export function emptyProject(): PaperProject {
  return {
    id: "empty",
    name: translate("project.noProject"),
    files: [],
    directories: [],
    rootId: "",
  }
}
export function initialProject(cached?: PaperProject) {
  return cached && !(cached.id === "demo" && !cached.rootPath) ? cached : emptyProject()
}
