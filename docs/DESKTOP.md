# Envoi desktop

Envoi runs in Electron. React talks to a typed preload bridge; the main process owns workspace trust and file access, while Git/tool detection, compilation, and AI execute in separate utility processes. The desktop build does not start Vite or a localhost HTTP service at runtime.

## Run and package

From the repository root:

```sh
npm run setup
npm run dev
npm run build
npm run test:desktop
npm run package:mac # macOS
npm run package:win # Windows
```

`dev:desktop` and `build:desktop` are explicit aliases. `app/release/` contains platform-specific output. The current packaging configuration produces unsigned local builds; distribution signing and notarization require the project owner's Apple credentials. TeX Live, Git and optional ChkTeX/Biber are detected on the machine, not bundled. Windows and macOS are supported. Windows packaging reuses the installed Electron runtime and produces an NSIS installer; Windows distribution signing is not configured.

## One workspace trust decision

Opening a folder asks whether to trust its files. Accepting enables Git, LaTeX, AI and file operations together. Declining cancels the opening and leaves the current project intact. Trust is stored outside projects in `~/.envoi/workspace-trust.json` (or `ENVOI_DATA_DIR`) and survives application restarts. Canonical paths prevent duplicate prompts through aliases. Descendants inherit trust; sibling folders do not.

The application no longer uses browser directory handles, permission renewal, Git/agent proof files, manual absolute-path binding, or separate AI read/write approval. The directory picker supplies the path. Browsing a saved location does not create project metadata; opening a project registers its identity. A copied project gets a separate identity if its original directory still exists.

Trusted compilation uses the user's environment and TeX configuration, enables shell escape, and supports Biber when installed. The backend copies project inputs directly into a temporary build folder and overlays unsaved text from the editor, with original project paths available to TeX. Large binary inputs no longer travel through renderer Base64 encoding. It does not use the old browser service's macOS sandbox or snapshot size/time approval restrictions. Cancellation still stops the running process. Existing HTTP adapters remain for legacy service tests, with their own defaults; they are not used by Electron.

Trusted AI sessions enable local coding tools, including reading, writing and commands. Old per-tool permission settings no longer restrict desktop sessions. Before a writing task, the editor saves drafts automatically; a save conflict prevents the task from discarding unsaved work. Provider sign-in remains necessary to use a provider account.

Unsaved-work checks, explicit permanent deletion confirmation, malformed-input validation, and Electron's isolated renderer are separate from workspace trust. Operating-system filesystem permissions and missing executables are reported as operating-system/tool errors, not requests to authorize Git or LaTeX again.

## Persistence and verification

File saves are serialized in the backend, check the editor's original disk contents, stage sibling temporary files, and replace each destination atomically. The backend reports which files were committed if a later file fails. This is not a cross-file transaction or an operating-system lock against unrelated editors: a final external write race remains possible. Existing symlinks and executable modes are preserved by ordinary writes; deleting a symlink removes the link itself.

A recursive filesystem watcher refreshes clean files and retains dirty buffers with their original baseline, including drafts whose disk file was deleted. Binary asset URLs carry disk versions. Watch events are coalesced, and a startup reconciliation covers asynchronous watcher initialization. Git/AI/compilation retain a single shared workspace trust decision.

Compilation tasks are reserved per project, and cancellation is scoped to the calling window. Window destruction cancels its tasks. Application shutdown drains work before stopping utility processes; an exited worker rejects pending calls and starts again on the next request. Compiler process groups and temporary directories are tracked for cleanup if its worker exits. Model registry initialization is shared across concurrent requests and cached briefly, with file-change and explicit-refresh invalidation. AI completion is emitted after history persistence.

Local data remains in `~/.envoi/`; the renderer retains IndexedDB recovery copies. Queued snapshots of the same project are coalesced while preserving project-switch order and completion promises. Legacy records with browser-only directory handles require selecting the folder once because those handles do not contain a native path. Files remain ordinary files in the selected workspace.

Packaged navigation uses hash routes. Local assets use the `envoi:` protocol, including PDF fetches. External web links open in the default browser.

`test:desktop` launches the built application against temporary data and project directories. It checks opening through the project menu, one trust prompt, repeated binding, nested writes, Git initialization/status, AI session access, compilation when TeX is installed, local PDF fetching, reopening after restart, external file refresh, save conflicts, native draft compilation, compiler cancellation, and utility-process crash recovery. Backend unit tests also cover concurrent saves, permissions/symlinks, task isolation, and watcher cleanup. Native dialogs are answered by the test only for its temporary fixtures. `ENVOI_DESKTOP_EXECUTABLE` can point at a packaged application executable for the same checks. It does not spend model API credits.

## Closing and removing projects

Closing stops the window's project tasks and watcher, records an empty workspace, and clears the editor view. Unsaved changes must be saved or explicitly discarded. Discard also clears those buffers from the per-project recovery snapshot, so reopening does not resurrect them. A closed workspace stays empty after restart.

Removing a recent project preserves disk files and workspace trust. Removing the currently open project first uses the close/discard flow. It also removes the exact folder shortcut, comparing canonical paths so aliases such as macOS `/var` and `/private/var` cannot leave duplicate entries; parent shortcuts remain. Permanent directory deletion is a separate, named confirmation and recognizes hidden project metadata for nested TeX entry points.

Desktop regression tests exercise close/discard/reload/reopen, removal without deleting files, and permanent deletion against temporary fixtures only.

## Startup measurements

`cd app && npm run measure:startup` measures three launches of the built application with temporary empty profiles. Add `-- --project` to restore a temporary copy of the demo, leaving the real demo untouched. `ENVOI_DESKTOP_EXECUTABLE` selects a packaged executable. Results include window readiness, first Git response, and browser paint timings; they are local repeated-launch measurements, not a guarantee of first-install cold-start performance.

Views load on demand. Git and compilation workers do not load the AI SDK; the AI worker loads it only for AI requests. An empty workspace does not automatically request model discovery.

## Welcome page

A workspace with no open project shows the Envoi welcome page with new/open/example actions, recent projects, settings, shortcuts and LaTeX documentation. Closing a project returns here even from Settings. Successful startup restoration reopens the project; a failed restoration returns here with the reason and a separate recoverable-draft action.

Recent entries open directly and can be removed without deleting files. Every use of Open example project creates a fresh local project under the global data directory's `examples/demo-<unique id>` directory, in both development and packaged builds. The application prepares five real demonstration Git commits and a new project identity before opening it. Previous copies remain available from Recent Projects. Template sources, old build output, AI configuration and identities are not copied. There is no timed splash screen or startup animation, and no extra permissions beyond the existing workspace trust decision.

## Windows setup and automatic detection

Use Node.js 22.12+ and run `npm run setup`, then `npm run dev` in PowerShell from the repository root. No Bash shell is needed for these commands. AI shell tools may require their own shell installation.

Settings show the operating system, native machine architecture, running Node architecture, Git version/path, LaTeX root and optional Biber/ChkTeX availability. Tool discovery checks `ENVOI_TEX_BIN` (an optional explicit override), PATH, then common Git, MiKTeX and default TeX Live year directories. Quoted PATH entries and `.exe` names are supported. Nonstandard installations should be added to PATH; there is no full-drive scan or automatic installation. Restart the app after changing the system PATH. Detected fallback directories are also passed to backend and AI processes.

The Windows validation uses TeX Live 2026; finding MiKTeX executables does not certify every MiKTeX configuration. Compilation requires the PDFLaTeX/XeLaTeX, BibTeX and xdvipdfmx programs from the selected TeX directory. Biber remains optional. Windows cancellation stops the compiler process tree. Existing user data stays under `%USERPROFILE%/.envoi` and tool preferences under `%USERPROFILE%/.config/envoi`.

## Example project creation

The bundled demo is a read-only source template. Creation runs Git asynchronously in a private staging directory, with explicit demonstration authorship, current timestamps, no hooks/signing inherited from user configuration, and no remote. Five commits develop the research question, model/design, synthetic evaluation, discussion, and reproducibility documentation. Only the completed, clean repository is published and opened through the ordinary trusted-project flow. Git is required; missing tools or template failures report an error and do not expose a partial project.

Figure regeneration is self-contained in `tools/generate-figures.py`. PDF generation uses the ordinary project compiler and writes ignored build output. Opening a saved copy through Recent Projects never recreates it. `npm run demo:git` is a compatibility command that creates a new global-data demo and prints its path; it no longer initializes a nested repository in the template.

First-run data migration now creates-or-preserves the store under the backend lock. Concurrent initialization cannot race on revision zero; conflicting legacy snapshots are archived without replacing current data. Project binding writes are serialized within a renderer. Normal compare-and-swap checks still reject divergent stale writes.
