# Development

Use Node.js 24+ and install dependencies with `npm run setup` from the root. The dependency lockfile is `app/package-lock.json`; the root package only forwards commands and does not create a second dependency installation.

Run `npm run dev` to launch the Electron desktop application. The desktop shell and preload bridge live in `app/electron/`. Application code stays in `app/src/`; fixed local tool adapters are in `app/server/`. Tests and developer utilities stay beside that application in `app/tests/` and `app/scripts/`.

Before sharing a change:

1. Run `npm test` and `npm run build`.
2. For desktop changes, run `npm run test:desktop` after building; this uses temporary projects and data without showing test windows. The commit gate runs `test:desktop:quick`; the complete suite runs nightly and on manual CI dispatch. Use `npm run test:desktop:visible` for screenshot and PDF scrolling checks. For local tool changes, run `npm run test:local` on Windows or macOS.
3. For example changes, run `npm run demo:build` followed by `npm run test:demo`. Inspect the resulting PDF visually.
4. Keep generated compilation caches under the example’s ignored `build/`. Update both example source and bundled snapshot when changing the demonstration.

`npm run lint` runs the repository ESLint configuration and must pass cleanly. CI (`.github/workflows/ci.yml`) runs on Windows and macOS and enforces lint, build, `npm test`, `test:ai`, `test:local`, and `test:desktop:quick` on every push and pull request. The full desktop suite runs nightly and on manual CI dispatch. Without a TeX toolchain on the runner, TeX-dependent local tests self-skip. Native compiler tests exercise PDFLaTeX and XeLaTeX on both platforms; legacy sandbox tests remain macOS-only. Windows file-symlink tests skip when Developer Mode/elevation is unavailable. `test:demo` (which needs a compiled example PDF from `demo:build`) remains a per-machine step.

Releases are created by pushing an annotated tag whose name and package versions match `v<major>.<minor>.<patch>`, for example `v0.1.0`. See [release instructions](docs/RELEASE.md). The release workflow validates formatting, lint, build and tests, then packages Windows and macOS installers and attaches them to the GitHub Release.

Project access separates opening from one persistent workspace trust decision shared by all desktop tools. Restricted projects allow reading and manual editing/saving within the opened directory; execution requires trust enforced by the main process. Trusted AI sessions may run local commands. Do not reintroduce browser permission renewal or per-tool approvals. The preload bridge should expose defined application operations. Preserve source edits, report stale diagnostics, and avoid guessing source/PDF locations. Git status is read-only; creating a project must not automatically commit, configure identity or push.

Envoi's original code is licensed under Apache-2.0; see the root `LICENSE` file. Contributions are accepted under the same license unless a separate written agreement says otherwise. Do not relicense third-party components, paper templates, or user-owned research materials.

The example button creates an independent project with five demonstration Git commits under the global data directory in development and packaged builds alike. `npm run demo:git` creates the same project from the command line and prints its path. Never edit the template through the runtime example flow or initialize a nested repository there. `test:desktop` validates creation, independent identities/history, normal saves and reopening; when TeX is installed it also compiles the generated example.
