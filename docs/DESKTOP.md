# Envoi desktop

Envoi runs in Electron. React talks to a typed preload bridge; the main process owns workspace trust and file access, while Git/tool detection, compilation, and AI execute in separate utility processes. The desktop build does not start Vite or a localhost HTTP service at runtime.

## Run and package

From the repository root:

```sh
npm run setup
npm run dev
npm run build
npm run test:desktop
npm run package:mac
```

`dev:desktop` and `build:desktop` are explicit aliases. `app/release/` contains macOS output. The current packaging configuration produces unsigned local builds; distribution signing and notarization require the project owner's Apple credentials. TeX Live, Git and optional ChkTeX/Biber are detected on the machine, not bundled. macOS is the validated platform.

## One workspace trust decision

Opening a folder asks whether to trust its files. Accepting enables Git, LaTeX, AI and file operations together. Declining cancels the opening and leaves the current project intact. Trust is stored outside projects in `~/.envoi/workspace-trust.json` (or `ENVOI_DATA_DIR`) and survives application restarts. Canonical paths prevent duplicate prompts through aliases. Descendants inherit trust; sibling folders do not.

The application no longer uses browser directory handles, permission renewal, Git/agent proof files, manual absolute-path binding, or separate AI read/write approval. The directory picker supplies the path. Browsing a saved location does not create project metadata; opening a project registers its identity. A copied project gets a separate identity if its original directory still exists.

Trusted compilation uses the user's environment and TeX configuration, enables shell escape, and supports Biber when installed. The backend copies project inputs directly into a temporary build folder and overlays unsaved text from the editor, with original project paths available to TeX. Large binary inputs no longer travel through renderer Base64 encoding. It does not use the old browser service's macOS sandbox or snapshot size/time approval restrictions. Cancellation still stops the running process. Existing HTTP adapters remain for legacy service tests, with their own defaults; they are not used by Electron.

Trusted AI sessions enable local coding tools, including reading, writing and commands. Old per-tool permission settings no longer restrict desktop sessions. Before a writing task, the editor saves drafts automatically; a save conflict prevents the task from discarding unsaved work. Provider sign-in remains necessary to use a provider account.

Unsaved-work checks, explicit permanent deletion confirmation, malformed-input validation, and Electron's isolated renderer are separate from workspace trust. macOS filesystem permissions and missing executables are reported as operating-system/tool errors, not requests to authorize Git or LaTeX again.

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
