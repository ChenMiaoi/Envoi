import { localDataPlugin } from "./server/http/local-data.mjs"
import { compilerPlugin } from "./server/http/compiler.mjs"
import { agentPlugin } from "./server/http/agent.mjs"
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import tailwindcss from "@tailwindcss/vite"
import { inspectAttr } from "kimi-plugin-inspect-react"

// https://vite.dev/config/
export default defineConfig({
  base: "/",
  plugins: [
    tailwindcss(),
    localDataPlugin(),
    compilerPlugin(),
    agentPlugin(),
    inspectAttr(),
    react(),
  ],
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
})
