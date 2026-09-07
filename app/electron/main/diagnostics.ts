import { app } from "electron"
import path from "node:path"
import { dataDir } from "../../server/local-data.mjs"
import { createDiagnostics } from "./logging.mjs"
import { AsyncLocalStorage } from "node:async_hooks"

export const operationContext = new AsyncLocalStorage<string>()
export const diagnostics = createDiagnostics(path.join(dataDir, "logs"), app.getVersion())
