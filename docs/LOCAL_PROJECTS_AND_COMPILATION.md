# PaperDesk local project demo

The web UI is a desktop-app prototype. `app/src/lib/projectFiles.ts` is the filesystem adapter; `app/src/lib/recentProjects.ts` stores browser-granted root handles separately from recently opened child projects. A future desktop bridge can replace these adapters without replacing the project windows.

## Project workflow

Click PaperDesk, then New/Open Project. The app window browses only granted locations. “选择本地位置 / 授权目录” invokes Chrome's native permission picker once for a location. Stored roots are queried on restoration, with explicit renewal only when permission is no longer granted. Browser data clearing, revoked permissions, moved folders, and another origin/port may require authorization again.

A project is one selected directory. New projects create a unique child folder with `main.tex`, `chapters/introduction.tex`, `references.bib`, `assets/`, `data/`, `build/`, `.gitignore`, project metadata, and template provenance. Existing names are rejected. New files are plain text and cannot overwrite existing files. Opening a project changes the directory tree, editable sources, outline, Bib input, assets, and available PDFs. Choose the main TeX source in Settings → Current project → Compile if automatic `main.tex` detection is unsuitable.

Edits are shared across the reading/writing views. “保存全部” writes modified text files to disk. Saves preflight against the originally read file contents and refuse external changes; completed writes remain marked saved if a later write fails. Multi-file saves are not filesystem transactions. Switching with dirty files requires explicit discard or saving first. Closing/reloading uses the browser's unsaved-change warning. No autosave or external-file watcher is implemented; reopen a directory to refresh disk content. `.git`, `.paperdesk`, `node_modules`, and `.DS_Store` are not read; the visible tree also hides management files, build/output folders, and TeX auxiliaries while retaining PDF inputs under assets; text files above 5MB stop loading with an error.

## Real compilation

From the repository root, run `npm run dev` (the wrapper runs the app at 127.0.0.1:3000). The Vite plugin in `app/server/compiler.mjs` supplies a same-origin, token-protected local compile API. Static production hosting does not contain this Node service. This adapter currently supports this Mac's TeX Live/Homebrew paths and requires macOS `sandbox-exec`; unsupported hosts fail closed.

“编译当前正文” compiles a snapshot including unsaved editor text, without saving source text. Select pdfLaTeX or XeLaTeX. The main file is compiled three passes, with BibTeX when citations/bibliography require it. XeLaTeX produces XDV followed by a fixed `xdvipdfmx` pass. Biber and shell-escape-dependent packages are not supported. Chinese source needs an appropriate preamble/font setup, such as `ctex` with `fontset=fandol` under XeLaTeX; the bundled English ACM example uses pdfLaTeX; arbitrary user files are not rewritten.

Only a successful real PDF replaces the last result. Failure/cancellation preserves it; subsequent edits label it as an older result. Successful output for an authorized project is written to `build/main.pdf` and `build/compile.log`. Failures retain the previous PDF; write failures are shown distinctly. Internal TeX auxiliaries also live in an isolated build directory and are removed after the job. The bundled snapshot remains in-memory. The source must be explicitly saved using the project menu. Logs contain the real engine output. PDFs render through PDF.js.

The compile service accepts only an allowlisted engine and project-relative file paths, not command strings or host paths. Limits: one concurrent compilation, 40MB decoded inputs, 1500 files, 90 seconds, and 2MB log output. TeX uses a fresh temporary project, no shell escape, restricted `openin/openout`, isolated HOME/config/cache, and a macOS policy that denies by default and grants project/runtime reads, temporary writes, and only fixed TeX executable paths. Network operations are not granted. Jobs and temporary files are cleaned up after completion/error/timeout; client disconnect cancels the running process group. This is a local prototype adapter, not a public multi-tenant compilation service.

## Initial template catalog

Only templates that passed actual isolated compilation on this machine are shown:

| Catalog item | Official implementation | Scope | Source / license |
| --- | --- | --- | --- |
| Article | LaTeX `article` | General | https://www.latex-project.org/ — LPPL |
| ACM conference | `acmart` / `sigconf` | Template family | https://www.acm.org/publications/proceedings-template — LPPL 1.3+ |
| ACM journal | `acmart` / `acmsmall` | Template family | Same ACM source/license |
| IEEE conference | `IEEEtran[conference]` | Template family | https://conferences.ieeeauthorcenter.ieee.org/write-your-paper/authoring-tools-and-templates/ — LPPL 1.3 |
| IEEE journal | `IEEEtran[journal]` | Template family | https://www.michaelshell.org/tex/ieeetran/ — LPPL 1.3 |
| Springer LNCS | `llncs` / `splncs04` | Proceedings family | https://www.springer.com/gp/computer-science/lncs/forthcoming-proceedings — CC BY 4.0, Springer |
| Elsevier journal | `elsarticle` | Journal family | https://ctan.org/pkg/elsarticle — LPPL 1.3+ |
| PMLR | `jmlr[pmlr]` | ML proceedings family | https://proceedings.mlr.press/faq.html — LPPL 1.3+ |

The skeleton text is original; official class/bibliography files are provided by the installed TeX distribution, not modified or copied into generated projects. Each generated project includes `TEMPLATE.md`. The catalog distinguishes conference/journal/general categories; its schema reserves optional venue and year fields for future verified venue-specific releases. No specific conference-year submission compliance is claimed. ACM starts with `nonacm` for drafting; users must apply the target venue's submission settings/metadata before submission. JMLR's current journal style is `jmlr2e`, distinct from PMLR's `jmlr`, and is not presented as implemented here.

## Checks

- `npm run test:references`: reference/asset parsing, file-model creation and conflicts, saved state, root-permission reuse and independent persistence (memory handles and fake IndexedDB, not native picker end-to-end).
- `node scripts/test-compiler.mjs`: real isolated external-read prevention, disabled shell escape, timeout, cancellation, and TeX syntax errors.
- `node scripts/test-templates.mjs`: all eight actual template compilations, logs/PDFs under `tmp/compile-check/`.
- `npm run build`: frontend and service integration type/build checks.

Native directory selection was not automated where the official browser tool disallowed file selection. This is a verification limitation, not an instruction to bypass permissions.

## Local Git and directory binding

Git defaults on, with branch `main`. The local service detects `/usr/bin/git`; no Git installation or JavaScript replacement is performed. When Git is missing, the new-project dialog warns and switches the option off so ordinary creation can continue. An unavailable local service is reported separately; the user can create with Git disabled.

A browser directory handle has no absolute host path. For Git, the user supplies the selected location's absolute path. The authorized newly created child folder receives a random 256-bit proof in `.paperdesk/git-proof`. The local same-origin/token-protected endpoint verifies the exact proof at that path (including symlink checks), then runs only fixed Git detection/init/verification commands. There is no shell-command input. Existing repositories, parent repositories and existing `.git` entries are preserved and rejected for reinitialization. A binding/init error leaves the created skeleton intact and reports partial completion. Proofs are removed afterward. No commit, identity, remote, or push is created.

`node scripts/test-git.mjs` verifies real Git, main, absence of commits/remotes, bad-proof rejection, and existing-repository protection. Native picker end-to-end testing remains subject to browser-tool limitations.

## English demonstration

`../examples/demo/build/main.pdf` is a real nine-page ACM-family manuscript with six high-resolution PNG inputs, four verified public bibliography records, generated tables and cross-references. All performance data are explicitly synthetic. Sources, generator, and CSV are in `../examples/demo`; retained vector figures live under its hidden `.paperdesk/figure-sources/`. The initial Writer view is a labelled bundled snapshot, not an implicit filesystem grant. Use Open Project to authorize the actual directory.

## Automatic outline and paper preview

The Writer outline statically expands common `input`/`include` statements in their actual source positions, balances nested title braces, numbers sections/subsections and appendices, and offers Abstract/References entries. Headings have collapsible children, full wrapping titles, and original cross-file source offsets. It does not execute arbitrary TeX macros or conditional branches; unsupported structures may require source navigation. Starred headings do not advance counters. Cycles/missing files are reported.

Writer previews only the current paper output, with one compilation toolbar and on-demand logs. Other PDFs remain accessible in Reader. Pages touch without added page-number labels; a low-contrast 1px overlay separates adjacent pages without changing their geometry or the original PDF content.

Directory navigation uses actual PDF bookmark XYZ destinations, not guessed pages. `build/preview.json` records SHA-256 fingerprints of the compilation inputs and PDF. This hidden build artifact lets reopened projects verify that their PDF still matches the source. A unique matching bookmark is required; edits, mismatched/foreign PDFs, or absent destinations cause source-only navigation with a light explanation. The current successful in-memory result uses its exact compilation signature. `scripts/test-demo-navigation.mjs` verifies all 43 demo destinations and rejects edited source/replaced PDF.

Line-level synchronisation is real SyncTeX: the sandboxed compiler always passes `-synctex=1` and returns `paperdesk.synctex.gz` alongside the PDF; successful builds also persist it as `build/main.synctex.gz` so reopened projects keep the mapping. `src/lib/syncTex.ts` parses records into PDF points (top-left origin, matching pdf.js scale-1 viewports) and maps sandbox-absolute input paths back to project-relative paths by longest suffix. Double-clicking source text scrolls the preview to the nearest record at or before that line with a brief highlight; clicking PDF body text (outside links and active selections) locates the nearest record by vertical distance and selects the corresponding source line. Records from non-project inputs (system packages) never match. Stale mappings after source edits degrade to nearest-line jumps until the next compile.

The active project and draft text are cached in browser IndexedDB and retained across hot updates. Reload queries existing permission without prompting, rereads disk when granted, and overlays unsaved drafts while retaining their original save-conflict baseline. Missing permission or failed reads preserve the cached project with an explicit warning. Clearing browser storage removes this recovery cache; it is not a substitute for saving source files. Source text is never silently autosaved to the project directory.

## Project connection, Git status and editor diagnostics

Project-local connection is shared by tools. A stored root handle can resolve an authorized child handle to a relative path; the known root path is reused and verified with a proof file before invoking local tools. Unknown paths are collected once in the project-open/connection UI, not in the Git status panel. The known demo directory has a one-time verified migration record in ignored `.paperdesk/connection.json`; it is a candidate until the same proof check succeeds. Browser permission and host-path binding are distinct states, never inferred from a directory basename.

The footer Git entry reads the installed Git branch and porcelain status with optional index locks and fsmonitor disabled. The panel shows untracked, staged, working-tree and conflict states without staging, committing, switching branches or pushing. Refresh and source-save changes re-read disk status. Status is limited to the authorized project subtree. The temporary proof file itself is excluded from displayed status.

The History view (`/history`) renders the commit graph for the bound repository. A `git-log` bridge endpoint returns up to 500 topo-ordered commits with parents, refs (branch/tag/remote) and HEAD decoration; a `git-show` endpoint returns one commit's message and `--numstat` file list, with merges described against their first parent and commit hashes validated before any invocation. Both endpoints compare `rev-parse --show-toplevel` with the authorized root: a directory nested inside a foreign repository reports `nested` with the enclosing path instead of showing that repository's history. The graph assigns swimlanes client-side in `src/lib/gitGraph.ts`; selecting a commit lists its changed files. Both endpoints stay read-only under the same proof-file binding as status.

Compilation diagnostics are parsed from the final TeX pass plus BibTeX messages, including wrapped temporary paths. Entries only navigate to known project text files with valid line numbers. A click selects and highlights the whole source line (red error, yellow warning). Global/unsupported locations show sanitized logs. Old diagnostics are marked stale after source changes; starting or cancelling a compile does not erase the previous completed result. `build/diagnostics.json` stores result, locations, engine, root, timestamp, signature and log; browser recovery also retains it. Legacy `build/compile.log` can be recovered, with source/PDF fingerprint verification before locations are treated as current.

The installed ChkTeX 1.7.9 checks the current unsaved `.tex` buffer after 700ms idle. It reads stdin with include traversal disabled, no user/global configuration, an isolated temporary HOME/cwd, a five-second bound, and abort handling for obsolete requests. It does not compile or save source files. Its style warnings are labelled ChkTeX separately from compile diagnostics; it is not a full TexLab/LSP implementation. Missing tools or disconnected services appear explicitly. No environment was installed for this feature.

Checks: `test-git-status.mjs`, `test-git-log.mjs`, `test-diagnostics.mjs`, `test-diagnostic-restore.mjs`, and `test-lint.mjs` exercise real local tools; repository unit tests cover parsing, navigation, persistence and stale-state safeguards. `test-git-graph.mjs` covers client swimlane assignment. Any fixture staging is confined to a temporary test repository; the real demo remains uncommitted.


Repository layout: application commands and tool-test paths in this document run from `app/` unless explicitly prefixed with `app/`; root npm scripts wrap the common workflows. Example sources now live in `examples/demo/`. Legacy `/demo/` assets remain for manually recovered sessions only. `npm run demo:snapshot` exports to the explicit example build directory and never injects startup data.

## Web page routes and hosting

The URL selects the primary page: `/reader`, `/writer`, `/library`, and `/settings`. `/settings` redirects to `/settings/global/general`; every scope/category has its own URL (see [Settings](SETTINGS.md)). `/` redirects with history replacement to `/writer`; trailing slashes canonicalize. Unknown paths show a not-found page without discarding the project. Activity links, keyboard shortcuts, command-palette navigation, file-open actions, and problem-list jumps all use React Router navigation. Browser back/forward and direct refresh follow the URL. No local filesystem paths, directory handles, or permission tokens are encoded in it.

The project provider and workspace shell remain mounted across page URLs. Already visited page components remain mounted but hidden, preserving editor state and in-flight compilation. Browser reload still uses the existing project/draft recovery mechanism; a route does not grant filesystem permissions.

Vite development and preview servers provide SPA history fallback. Production static hosting must serve `app/dist/index.html` for page routes and unknown application paths, while serving actual `/assets/*`, `/pdfjs/*`, and `/demo/*` resources as files. Do not rewrite missing static assets or `/api/*` to HTML. Example Nginx routing for a domain-root deployment:

```nginx
location /assets/ { try_files $uri =404; }
location /pdfjs/  { try_files $uri =404; }
location /demo/   { try_files $uri =404; }
location /api/    { return 404; } # Or route to a separately configured local adapter.
location /       { try_files $uri $uri/ /index.html; }
```

The current build uses Vite `base: '/'` and expects domain-root hosting. Hosting under a subpath requires configuring both Vite's base and BrowserRouter's basename together. Static hosting alone does not run the local TeX/Git/ChkTeX adapters. The route tests cover resolution, direct entry and history navigation; deployment configuration must also be checked on the actual host.

The Writer source editor soft-wraps to its available width, including long unbroken commands. Logical line numbers, diagnostic bands and source navigation use measured wrapped line geometry. Wrapping never inserts source newlines.

Compilation runs in a disposable isolated temporary directory, which is removed afterward. For a writable connected project, the browser writes `build/main.pdf`, `build/compile.log`, `build/preview.json` and `build/diagnostics.json` beneath that selected project handle. Failed compilation updates logs/diagnostics while keeping the previous PDF. Permission or output-write failures are shown as unsaved or partially saved output; built-in snapshots report browser-only output. No success status implies that source edits were saved.
