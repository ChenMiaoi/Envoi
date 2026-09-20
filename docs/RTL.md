# RTL (Verilog / SystemVerilog)

Open **Settings → Extensions → RTL** to enable the built-in `envoi.rtl` plugin. `.v`, `.vh`, `.sv` and `.svh` files have source editing, syntax highlighting and HDL file icons.

## Editor tools

- **slang-server** is the preferred language server for semantic diagnostics, completion, hover and in-project definition navigation. **Verible LSP** is an alternative with syntax/style diagnostics and its own navigation capabilities; the two servers do not provide identical semantic analysis.
- Install either server from the RTL extension. Verible formatting and lint tools can also be installed from their respective sections. Downloads use official GitHub releases and verify their SHA-256 digests. Installs live in Envoi's managed directories and do not change PATH. Only published platform/architecture combinations are offered.
- Verible format-on-save uses the current editor buffer. The live Verible checker also checks unsaved text without replacing the source on disk. Closest ancestor `.rules.verible_format` and `.rules.verible_lint` files within the workspace supply formatting flags and lint rules, respectively.
- LSP and live lint diagnostics appear in the editor and its Problems panel. Disabling the plugin preserves basic text editing.

## Configure a project

In the expanded RTL card, set the top module and source files in compile order, or supply a `.f` filelist. Include directories, macros and top-level parameter overrides are separate multiline fields. Paths are relative to the workspace unless absolute. Headers can be listed, but are not compiled as standalone modules.

Filelists support source paths, double-quoted paths containing spaces, `-f` / `-F`, `-I` / `-D`, `+incdir+` / `+define+`, and line comments. Nested `-F` paths use that filelist's directory; `-f` retains its caller's base directory. Other simulator flags are rejected with an explanation. Environment-variable expansion, shell substitution and arbitrary build commands are not evaluated.

Saving creates `.envoi/rtl.json`, `.envoi/rtl.f`, `.envoi/verible.filelist`, and adds the managed filelist to `.slang/server.json` while preserving its other settings. Reopen RTL editors after configuration changes to restart indexing. Existing advanced slang options may be kept in `.slang/server.json`; avoid adding the same sources twice through independent filelists. Verible's filelist supplies source indexing, not the full elaboration context available to slang.

## Project checks and Vivado

**Save and check with Verilator** saves current drafts and runs `verilator --lint-only -Wall -Wno-fatal` with the configured sources, top, includes, macros and parameters. Warnings remain visible but do not fail the check. Install Verilator in the selected environment and select its executable if it is not on PATH; Envoi does not bundle a Verilator toolchain.

**Import Vivado project** uses an installed Vivado executable to open an `.xpr` read-only and extract its synthesis compile order, source files, HDL libraries, explicit SystemVerilog file types, includes, macros, parameters and top. Imported settings are shown for review and take effect when saved. Generate required IP sources in Vivado before importing. This workflow does not generate IP, import constraints or reproduce synthesis/implementation runs. Mixed VHDL projects are rejected in this version.

**Save and check with Vivado** runs `xvlog` then `xelab` in a temporary directory. This is a compile/elaboration check, not a Vivado language server. Both stages' warnings and errors appear with the full tool output in the RTL settings panel. Source files and the original Vivado project are not rewritten. Windows `.bat` launchers are supported, including paths with spaces; shell expansion characters in batch arguments are rejected. Vivado and its license must already be available. Tools are discovered through PATH or `XILINX_VIVADO/bin`, with manual executable selection in settings.

Multiple HDL libraries are preserved for Vivado checks. Verilator checks reject projects with multiple libraries rather than flattening their resolution rules. Generic slang/Verible indexing does not replace Vivado's vendor library and IP elaboration behavior.

SSH and WSL run these operations in the active workspace's environment; local executable preferences are never sent to the remote host. Install the required tools on that host. Remote managed installation and per-tool path selection remain outside this version. Workspace trust is required, and closing/disconnecting the workspace cancels running checks.

## Upstream references

- [slang-server configuration](https://hudson-trading.github.io/slang-server/start/config/)
- [Verible language server](https://github.com/chipsalliance/verible/tree/master/verible/verilog/tools/ls)
- [Verible formatter](https://chipsalliance.github.io/verible/verilog_format.html)
- [Verilator command line](https://verilator.org/guide/latest/exe_verilator.html)
- [Vivado simulation tools](https://docs.amd.com/r/en-US/ug900-vivado-logic-simulation/Parsing-Design-Files-xvhdl-and-xvlog)
