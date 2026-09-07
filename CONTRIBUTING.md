# Development

Use Node.js 22.12+ and install dependencies with `npm run setup` from the root. The dependency lockfile is `app/package-lock.json`; the root package only forwards commands and does not create a second dependency installation.

Run `npm run dev` to launch the Electron desktop application. The desktop shell and preload bridge live in `app/electron/`. Application code stays in `app/src/`; fixed local tool adapters are in `app/server/`. Tests and developer utilities stay beside that application in `app/tests/` and `app/scripts/`.

Before sharing a change:

1. Run `npm test` and `npm run build`.
2. For desktop changes, run `npm run test:desktop` after building; this uses temporary projects and data. For local tool changes, run `npm run test:local` on Windows or macOS.
3. For example changes, run `npm run demo:build` followed by `npm run test:demo`. Inspect the resulting PDF visually.
4. Keep generated compilation caches under the example’s ignored `build/`. Update both example source and bundled snapshot when changing the demonstration.

`npm run lint` runs the repository ESLint configuration and must pass cleanly. CI (`.github/workflows/ci.yml`) runs on Windows and macOS and enforces lint, build, `npm test`, `test:ai` and `test:local` on every push and pull request; without a TeX toolchain on the runner, TeX-dependent local tests self-skip. Native compiler tests exercise PDFLaTeX and XeLaTeX on both platforms; legacy sandbox tests remain macOS-only. Windows file-symlink tests skip when Developer Mode/elevation is unavailable. `test:demo` (which needs a compiled example PDF from `demo:build`) remains a per-machine step.

Project access uses one persistent workspace trust decision, shared by all desktop tools. Trusted AI sessions may run local commands. Do not reintroduce browser permission renewal or per-tool approvals. The preload bridge should expose defined application operations. Preserve source edits, report stale diagnostics, and avoid guessing source/PDF locations. Git status is read-only; creating a project must not automatically commit, configure identity or push.

This repository currently has no project-wide license. Licensing decisions belong to the owner; do not label contributions or the overall project with an invented license.

For independent demo Git status and history during desktop development, run `npm run demo:git` once, then open `examples/demo` as a project. This explicit development command creates a local baseline commit without a remote or persistent author configuration. It preserves an existing demo repository on subsequent runs. Demo sources remain tracked by Envoi as ordinary files; do not replace them with a submodule/gitlink.
