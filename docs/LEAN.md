# Lean 4

Envoi includes the official `envoi.lean` extension. Open **Settings → Extensions → Lean 4** to enable it, install Lean, or select an existing `lean` executable.

- `.lean` files open in the source editor with syntax highlighting, nested comments and bracket support. `lean-toolchain` opens as text.
- The install button downloads a checksum-verified official Elan release and installs the stable Lean 4 toolchain, including Lake, in Envoi's managed language-server directory. It does not change the shell PATH or the user's existing Elan installation. Unsupported platforms do not offer installation.
- Existing installations are discovered on PATH and in `ELAN_HOME/bin` or `~/.elan/bin`. Elan selects the version in the project's `lean-toolchain`; the first use of another version may download that toolchain.
- Lake projects use `lake serve --`; standalone files use `lean --server`. Nested projects get separate server sessions. Completion, hover, in-project definition navigation, proof errors and Lean's enabled linter warnings use the existing editor and Problems panel.
- Optional formatting uses a separately installed, toolchain-compatible **lean-fmt** executable. Select its path in the extension's formatting settings. The existing format-on-save action sends the unsaved buffer through `lean-fmt format -`; Envoi applies successful output through its normal save flow. No dependency is added to the project automatically. Upstream currently describes Windows support as untested.
- SSH/WSL workspaces discover and run tools in that workspace's environment. Install Lean there using Elan; the local managed install is not copied to remote environments.

Lean's language server does not provide document formatting. Lint warnings come from Lean itself, so no separate linter installation is required. Project-specific lint options remain in the project's Lean configuration. This extension does not yet reproduce VS Code's Infoview, interactive proof widgets or Unicode abbreviation input. Lean 3 is outside its scope.

After editing a project's toolchain or Lake configuration, close its Lean editors and reopen them to restart the language service. If a first-time toolchain download exceeds the startup timeout, retry after installation completes.

## References

- [VS Code Lean 4 server selection](https://github.com/leanprover/vscode-lean4/blob/master/vscode-lean4/src/leanclient.ts)
- [Elan installation and project toolchains](https://github.com/leanprover/elan)
- [Lean's unused-variable linter](https://lean-lang.org/doc/api/Lean/Linter/UnusedVariables.html)
- [lean-fmt installation](https://github.com/jcreinhold/lean-fmt)
- [lean-fmt editor integration and stdin formatting](https://github.com/jcreinhold/lean-fmt/blob/main/docs/editor-setup.md)
