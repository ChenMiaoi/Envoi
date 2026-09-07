import path from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

// main 使用 ESM；sandbox preload 使用 CJS。
// renderer 复用浏览器版的 react 插件与 @ alias，但不加载 HTTP middleware 插件。
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: { index: path.resolve(import.meta.dirname, "electron/main/index.ts"), backend: path.resolve(import.meta.dirname, "electron/main/backend.mjs") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: { index: path.resolve(import.meta.dirname, "electron/preload/index.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: import.meta.dirname,
    base: "./",
    plugins: [tailwindcss(), react()],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
      },
    },
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: { index: path.resolve(import.meta.dirname, "index.html") },
      },
    },
  },
})
