import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  emptyRtlConfiguration,
  loadRtlConfiguration,
  resolveRtlFiles,
  saveRtlConfiguration,
} from "../electron/main/rtl-config.mjs"
import {
  parseVivadoExport,
  runVivadoCheck,
  vivadoParserPath,
} from "../electron/main/rtl-vivado.mjs"
import { rtlCommand, rtlDiagnostics, runRtlCommand } from "../electron/main/rtl-tools.mjs"
import { rtlProjectRequest } from "../electron/main/rtl-project.mjs"
import { installedRtlTool, rtlInstallPlan } from "../electron/main/rtl-installer.mjs"
import { pluginLanguageForPath } from "../server/plugin-registry.mjs"

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "envoi-rtl-")))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}
test("RTL registration recognizes headers and only offers published binary targets", () => {
  for (const extension of ["v", "vh", "sv", "svh"])
    assert.equal(
      pluginLanguageForPath(`TOP.${extension.toUpperCase()}`),
      extension.startsWith("s") ? "systemverilog" : "verilog",
    )
  assert.equal(rtlInstallPlan("slangServer", "win32", "arm64").target, "windows-arm64.zip")
  assert.equal(rtlInstallPlan("veribleLsp", "win32", "arm64"), null)
  assert.equal(rtlInstallPlan("veribleLsp", "darwin", "x64"), null)
  assert.equal(rtlInstallPlan("veribleLint", "linux", "arm64").package, "verible")
  assert.equal(rtlInstallPlan("verilator"), null)
})
test("nested filelists preserve order, macros and spaced paths without shell interpretation", async (t) => {
  const root = await fixture(t)
  await mkdir(path.join(root, "sub dir"))
  await writeFile(path.join(root, "sub dir/pkg.sv"), "package pkg; endpackage\n")
  await writeFile(path.join(root, "top.sv"), "module top; endmodule\n")
  await writeFile(path.join(root, "sub dir/list.f"), '"pkg.sv"\n-I .\n-D MASK=8\'hff\n')
  await writeFile(
    path.join(root, "files.f"),
    '# comment\n-F "sub dir/list.f"\ntop.sv // comment\n+define+SYNTHESIS\n',
  )
  const config = {
    ...emptyRtlConfiguration(),
    top: "top",
    filelist: "files.f",
    parameters: ["WIDTH=8"],
  }
  const resolved = await resolveRtlFiles(root, config)
  assert.deepEqual(resolved.files, [path.join(root, "sub dir/pkg.sv"), path.join(root, "top.sv")])
  assert.deepEqual(resolved.defines, ["MASK=8'hff", "SYNTHESIS"])
  assert.deepEqual(resolved.includeDirs, [path.join(root, "sub dir")])
  await mkdir(path.join(root, ".slang"))
  await writeFile(
    path.join(root, ".slang/server.json"),
    JSON.stringify({ flags: "--single-unit", index: { threads: 2 } }),
  )
  await saveRtlConfiguration(root, config)
  await saveRtlConfiguration(root, config)
  const server = JSON.parse(await readFile(path.join(root, ".slang/server.json"), "utf8"))
  assert.equal(server.flags, "--single-unit -f .envoi/rtl.f")
  assert.deepEqual(server.index, { threads: 2 })
  assert.deepEqual(await loadRtlConfiguration(root), config)
  assert.match(await readFile(path.join(root, ".envoi/rtl.f"), "utf8"), /-G "WIDTH=8"/)
  await writeFile(path.join(root, "files.f"), "-f files.f\n")
  await assert.rejects(resolveRtlFiles(root, config), /Recursive/)
  await writeFile(path.join(root, "files.f"), "-y vendor\n")
  await assert.rejects(resolveRtlFiles(root, config), /Unsupported RTL filelist option/)
})
test("configuration cannot write through a directory junction or run after cancellation", async (t) => {
  const root = await fixture(t),
    outside = await fixture(t)
  await symlink(
    outside,
    path.join(root, ".envoi"),
    process.platform === "win32" ? "junction" : "dir",
  )
  await assert.rejects(saveRtlConfiguration(root, emptyRtlConfiguration()), /outside the project/)
  await assert.rejects(readFile(path.join(root, ".slang/server.json")), { code: "ENOENT" })
  const controller = new AbortController()
  controller.abort(Error("workspace closed"))
  await assert.rejects(
    rtlProjectRequest(root, { action: "check", tool: "vivado" }, { signal: controller.signal }),
    /workspace closed/,
  )
})
test("diagnostics retain Windows drive letters and distinguish warning from syntax failure", () => {
  assert.deepEqual(
    rtlDiagnostics("C:\\rtl\\top.sv:3:8-12: syntax error, unexpected token", "Verible"),
    [
      {
        path: "C:\\rtl\\top.sv",
        line: 3,
        column: 8,
        message: "syntax error, unexpected token",
        severity: "error",
        source: "Verible",
      },
    ],
  )
  assert.equal(
    rtlDiagnostics("%Warning-WIDTH: /rtl/top.sv:2:9: bad width", "Verilator")[0].severity,
    "warning",
  )
  assert.equal(
    rtlDiagnostics("ERROR: [VRFC 10-123] missing identifier [C:/rtl/top.sv:4]", "Vivado")[0].path,
    "C:/rtl/top.sv",
  )
  assert.equal(rtlDiagnostics("ERROR: failed to elaborate", "Vivado").length, 0)
})
test("Vivado import preserves source order, HDL library and explicit SystemVerilog type", async (t) => {
  const root = await fixture(t)
  const row = (type, ...values) =>
    ["ENVOI_RTL", type, ...values.map((value) => Buffer.from(value).toString("base64"))].join("\t")
  const config = parseVivadoExport(
    root,
    [
      row("top", "top"),
      row("file", path.join(root, "pkg.v"), "custom", "SystemVerilog"),
      row("file", path.join(root, "top.sv"), "xil_defaultlib", "SystemVerilog"),
      row("define", "WIDTH=32"),
    ].join("\n"),
  )
  assert.deepEqual(config.files, ["pkg.v", "top.sv"])
  assert.equal(config.libraries["pkg.v"], "custom")
  assert.deepEqual(config.systemVerilogFiles, ["pkg.v", "top.sv"])
  assert.throws(() => parseVivadoExport(root, "no sources"), /exported no/)
})
test("managed metadata cannot escape its release directory", async (t) => {
  const root = await fixture(t)
  await mkdir(path.join(root, "verible/v1"), { recursive: true })
  await writeFile(path.join(root, "outside.exe"), "fixture")
  await writeFile(
    path.join(root, "verible/current.json"),
    JSON.stringify({
      package: "verible",
      version: "v1",
      binaries: { veribleLint: "../../outside.exe" },
    }),
  )
  assert.equal(await installedRtlTool(root, "veribleLint"), null)
})
test("Vivado batch adapter quotes spaces and rejects command expansion", async (t) => {
  for (const argument of ["x&whoami", "%PATH%", 'x"y', "a\nb", "!x!"])
    assert.throws(
      () => rtlCommand("C:\\Vivado\\xvlog.bat", [argument], "win32"),
      /unsupported shell/,
    )
  if (process.platform !== "win32") return
  const root = await fixture(t)
  const command = path.join(root, "echo args.bat")
  await writeFile(command, "@echo off\r\necho [%~1]\r\nexit /b 0\r\n")
  const result = await runRtlCommand(command, ["source dir/top.sv"], { cwd: root })
  assert.equal(result.code, 0)
  assert.match(result.stdout, /\[source dir\/top.sv\]/)
})
test("Vivado checks preserve parser warnings and propagate elaboration failures", async (t) => {
  const root = await fixture(t)
  const win = process.platform === "win32"
  const launch = async (name, body) => {
    const file = path.join(root, name + (win ? ".bat" : ""))
    await writeFile(file, win ? `@echo off\r\n${body}\r\n` : `#!/bin/sh\n${body}\n`, {
      mode: 0o755,
    })
    return file
  }
  const parser = await launch(
    "xvlog",
    win
      ? "type sources.prj\r\necho WARNING: [VRFC 10-1] parser warning [top.sv:1]\r\nexit /b 0"
      : "cat sources.prj\nprintf 'WARNING: [VRFC 10-1] parser warning [top.sv:1]\\n'\nexit 0",
  )
  await launch(
    "xelab",
    win
      ? "echo ERROR: elaboration failed\r\nexit /b 1"
      : "echo 'ERROR: elaboration failed'\nexit 1",
  )
  const vivado = await launch("vivado", win ? "exit /b 0" : "exit 0")
  assert.equal(vivadoParserPath(vivado), parser)
  const config = {
    ...emptyRtlConfiguration(),
    top: "top",
    files: [path.join(root, "top.v")],
    libraries: { "top.v": "custom" },
    systemVerilogFiles: ["top.v"],
  }
  const result = await runVivadoCheck(root, config, parser, root)
  assert.equal(result.code, 1)
  assert.match(result.stdout, /sv custom/)
  assert.match(result.stdout, /parser warning/)
  assert.match(result.stdout, /elaboration failed/)
})
