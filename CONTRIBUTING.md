# Development

Use Node.js 24+ and install dependencies with `npm run setup` from the root. The dependency lockfile is `app/package-lock.json`; the root package only forwards commands and does not create a second dependency installation.

Run `npm run dev` to launch the Electron desktop application. The desktop shell and preload bridge live in `app/electron/`. Application code stays in `app/src/`; fixed local tool adapters are in `app/server/`. Tests and developer utilities stay beside that application in `app/tests/` and `app/scripts/`.

During development, run `npm run check:local` before committing. It reuses successful check results for unchanged inputs for up to 24 hours, including across commits. A cold run executes the entire check suite. Documentation-only changes rerun formatting; changes under `app/tests/` rerun formatting, lint and unit tests. Other inputs conservatively invalidate every step. New, deleted and untracked (non-ignored) files are included. Results live under ignored `app/tmp/`; deleting the cache causes a cold run.

Dependency installation is reused when the lockfile, package manifest, Node version and platform match. A changed installation lock or missing direct dependency causes reinstallation. `npm run setup` always performs a clean install. Build results are reused only while generated output contents match. Failed or interrupted validation does not publish reusable results, and modifying source during a run requires another check.

Use `npm run check:local -- --force` to rerun every check. Run `npm run ci:check` after changing external tools (such as TeX or Git), system configuration, or the validation workflow: local caching cannot detect every external change or manual modification inside `node_modules`. CI always executes all check steps without reusing test results. Each executed step reports its duration.

Before sharing a change:

1. Run `npm run ci:check` for formatting, lint, build and every standard desktop test group. This is the same full validation profile used by GitHub CI.
2. For desktop changes, run `npm run test:desktop` after building when focused iteration is useful; this uses temporary projects and data without showing test windows. The cached `check:local` commit gate runs `test:desktop:quick`. Use `npm run test:desktop:visible` for screenshot and PDF scrolling checks. For local tool changes, run `npm run test:local` on Windows or macOS.
3. For example changes, run `npm run demo:build` followed by `npm run test:demo`. Inspect the resulting PDF visually.
4. Keep generated compilation caches under the example’s ignored `build/`. Update both example source and bundled snapshot when changing the demonstration.

`npm run lint` runs the repository ESLint configuration and must pass cleanly. CI (`.github/workflows/ci.yml`) runs the same `npm run ci:check` profile on Windows and macOS for pushes, pull requests and manual dispatches. It enforces lint, build, `npm test`, `test:ai`, `test:local`, and the full `test:desktop` suite. Without a TeX toolchain on the runner, TeX-dependent local tests self-skip. Native compiler tests exercise PDFLaTeX and XeLaTeX on both platforms; legacy sandbox tests remain macOS-only. Windows file-symlink tests skip when Developer Mode/elevation is unavailable. `test:demo` (which needs a compiled example PDF from `demo:build`) remains a per-machine step.

For renderer changes, follow the [performance guidelines and regression checks](docs/PERFORMANCE.md) when changing subscriptions, streaming updates, or PDF verification.

Releases are created by pushing an annotated tag whose name and package versions match `v<major>.<minor>.<patch>`, for example `v0.1.0`. See [release instructions](docs/RELEASE.md). The release workflow validates formatting, lint, build and tests, then packages Windows and macOS installers and attaches them to the GitHub Release.

Project access separates opening from one persistent workspace trust decision shared by all desktop tools. Restricted projects allow reading and manual editing/saving within the opened directory; execution requires trust enforced by the main process. Trusted AI sessions may run local commands. Do not reintroduce browser permission renewal or per-tool approvals. The preload bridge should expose defined application operations. Preserve source edits, report stale diagnostics, and avoid guessing source/PDF locations. Git status is read-only; creating a project must not automatically commit, configure identity or push.

Envoi's original code is licensed under Apache-2.0; see the root `LICENSE` file. Contributions are accepted under the same license unless a separate written agreement says otherwise. Do not relicense third-party components, paper templates, or user-owned research materials.

The example button creates an independent project with five demonstration Git commits under the global data directory in development and packaged builds alike. `npm run demo:git` creates the same project from the command line and prints its path. Never edit the template through the runtime example flow or initialize a nested repository there. `test:desktop` validates creation, independent identities/history, normal saves and reopening; when TeX is installed it also compiles the generated example.

### CI desktop shards

CI runs two independent validation jobs per platform. Each job runs the complete non-desktop checks and half of the full desktop suite (`ENVOI_DESKTOP_TEST_SHARD=1/2` or `2/2`). Each platform's two shards preserve identical coverage and Windows/macOS results stay comparable. Separate machines isolate Electron processes and fixture cleanup. This trades extra installation/build time for a shorter critical path; it does not reduce total runner usage.

Each desktop test launches an isolated Electron instance with its own data directory, output is buffered per test and released when it finishes, and failed tests get one retry before the run reports every failure together. Canonical local and hosted `ci:check` runs use concurrency 2 after synchronizing trust and workspace transitions; direct desktop-test commands default to 4. Override either with `ENVOI_DESKTOP_TEST_CONCURRENCY`. The test plan pairs measured slow groups across the two CI shards so their critical paths remain balanced.

The existing `check (macos-latest)` and `check (windows-latest)` gates succeed only after every validation job succeeds. Failed, cancelled or skipped validation cannot produce a green gate. A new run cancels older runs only for the same workflow, event and ref; push, pull-request and manual runs remain independent. Validation jobs have a 30-minute timeout.

Local commands remain unsharded. CI shards never publish reusable local check results, and `check:local` rejects a shard setting. `npm run ci:check` without a shard still runs all checks normally.
