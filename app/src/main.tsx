import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { HashRouter } from "react-router"
import "./index.css"
import App from "./App.tsx"
import { installErrorLogging, logError } from "./lib/logging"

installErrorLogging()
createRoot(document.getElementById("root")!, {
  onUncaughtError: (error) => logError("react.error", error),
  onCaughtError: (error) => logError("react.error", error),
  onRecoverableError: (error) => logError("react.error", error),
}).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
)
