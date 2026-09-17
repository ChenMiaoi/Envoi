import { createRequire } from "node:module"
import { access } from "node:fs/promises"
import { constants } from "node:fs"

const require = createRequire(import.meta.url)
const electronPath = require("electron")
await access(electronPath, constants.X_OK)
