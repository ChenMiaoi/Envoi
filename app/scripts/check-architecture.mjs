import { existsSync } from "node:fs"
import { builtinModules } from "node:module"
import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import ts from "typescript"

const root = path.resolve(import.meta.dirname, "..")
const layers = ["src", "server", "electron", "shared"]
const errors = []
const nodeModules = new Set(builtinModules.flatMap((name) => [name, name.replace(/^node:/, "")]))
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      await scan(file)
      continue
    }
    if (!/\.(?:ts|tsx|mjs)$/.test(file)) continue
    const relative = path.relative(root, file).replaceAll(path.sep, "/")
    const ast = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    )
    function check(specifier) {
      const target = specifier.startsWith("@/")
        ? "src/" + specifier.slice(2)
        : specifier.startsWith(".")
          ? path
              .relative(root, path.resolve(path.dirname(file), specifier))
              .replaceAll(path.sep, "/")
          : specifier
      const layer = relative.split("/")[0]
      if (layer === "shared" && specifier.startsWith(".")) {
        const base = path.resolve(root, target)
        const candidates = [
          base,
          ...[".ts", ".tsx", ".mjs", ".d.mts", "/index.ts"].map((suffix) => base + suffix),
        ]
        if (!candidates.some(existsSync))
          errors.push(`${relative}: unresolved shared import ${specifier}`)
      }

      if (layer === "server" && /^(src|electron)\//.test(target))
        errors.push(`${relative}: backend depends on ${specifier}`)
      if (layer === "src" && /^(server|electron)\//.test(target))
        errors.push(`${relative}: renderer depends on ${specifier}`)
      if (
        layer === "shared" &&
        (/^(src|server|electron)\//.test(target) ||
          nodeModules.has(target) ||
          /^(node:|electron(?:\/|$)|react(?:-dom)?(?:\/|$))/.test(target))
      )
        errors.push(`${relative}: shared code depends on ${specifier}`)
      if (
        layer === "server" &&
        !relative.startsWith("server/http/") &&
        target.startsWith("server/http/")
      )
        errors.push(`${relative}: service depends on HTTP adapter`)
    }
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        check(node.moduleSpecifier.text)
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        ts.isStringLiteral(node.arguments[0])
      )
        check(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
}
for (const layer of layers) await scan(path.join(root, layer))
assert.deepEqual(errors, [], errors.join("\n"))
const program = ts.createProgram([path.join(root, "tests/contracts.types.ts")], {
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
})
const diagnostics = ts.getPreEmitDiagnostics(program)
if (diagnostics.length)
  throw Error(
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }),
  )
console.log("Architecture boundaries and contract types passed.")
