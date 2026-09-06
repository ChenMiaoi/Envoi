# Development

Use Node.js 22.12+ and install dependencies with `npm run setup` from the root. The dependency lockfile is `app/package-lock.json`; the root package only forwards commands and does not create a second dependency installation.

Run `npm run dev` for the local interface at port 3000. Application code stays in `app/src/`; fixed local tool adapters are in `app/server/`. Tests and developer utilities stay beside that application in `app/tests/` and `app/scripts/`.

Before sharing a change:

1. Run `npm test` and `npm run build`.
2. For local tool changes, run `npm run test:local` on a compatible Mac.
3. For example changes, run `npm run demo:build` followed by `npm run test:demo`. Inspect the resulting PDF visually.
4. Keep generated compilation caches under the example’s ignored `build/`. Update both example source and bundled snapshot when changing the demonstration.

`npm run lint` runs the repository ESLint configuration and must pass cleanly. CI (`.github/workflows/ci.yml`) runs on macOS — matching the compilation target — and enforces lint, build, `npm test`, `test:ai` and `test:local` on every push and pull request; without a TeX toolchain on the runner, TeX-dependent local tests self-skip. `test:demo` (which needs a compiled example PDF from `demo:build`) remains a per-machine step.

Project file access must remain explicitly authorized. Local adapters should accept narrowly defined operations, not arbitrary shell commands. Preserve source edits, report stale diagnostics, and avoid guessing source/PDF locations. Git status is read-only; creating a project must not automatically commit, configure identity or push.

This repository currently has no project-wide license. Licensing decisions belong to the owner; do not label contributions or the overall project with an invented license.
