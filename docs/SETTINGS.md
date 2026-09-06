# Settings

Settings have two scopes, global and current project, and four categories: general, editor, compile, references/version management. Each selection has a URL at `/settings/{global|project}/{general|editor|compile|references}`. Browser back/forward and refresh preserve this selection.

## Personal preferences

Global preferences are normalized and saved to this browser's local storage (`paperdesk.preferences.v1`). They update immediately and synchronize between tabs. Storage failures are shown instead of claiming durable persistence.

Three independent typography groups are available:

- General / interface: font family and 12–16 px base size, default 13. Existing interface text hierarchy scales proportionally; compact control rows grow to accommodate it.
- Editor / source: monospaced font family, 11–18 px size, line height and tab display width. Applies to Writer and Reader source editing/highlighting. Existing saved editor preferences remain in this group during migration.
- General / reader text: font family and 12–20 px size, default 14. Applies to Markdown and bibliography cards; Markdown headings retain relative sizes. Code blocks retain a monospace family. Actual PDF pages and LaTeX document typography are unaffected.

Font choices are named CSS families with system fallbacks, not a claim to enumerate installed fonts. All typography groups remain personal and are never written into project configuration. Global settings also control accent color, default compiler, ChkTeX enablement/disabled rules and the default Git checkbox for new projects.

## Project inheritance

A connected writable project can override compiler, ChkTeX enablement and disabled rules independently. Removing an override restores the current global value. New projects inherit defaults; older projects with a top-level engine retain that explicit selection until inheritance is restored. The main TeX file belongs only to the project.

Overrides are stored in `.paperdesk/project.json`:

```json
{"main":"main.tex","settings":{"version":1,"overrides":{"engine":"xelatex","disabledRules":[26]}}}
```

New `.paperdesk/project.json` takes precedence over legacy root `paperdesk.json`. A settings save migrates known shareable metadata and explicit overrides, retaining the untouched legacy file as a backup so unknown fields are not deleted or copied into shared configuration. Competing or externally changed new files are rejected. Git rules expose only `.paperdesk/project.json`; other management files remain ignored. Writes preserve unrelated new-project metadata and reject dirty or externally changed configuration files. A project change does not modify another project's configuration. Built-in snapshots, unavailable permissions and moved directories disable project settings with an explanation. After a directory move, open its new location; repeated Git authorization cannot restore the old filesystem handle.

No AI credentials or external service secrets are stored in project settings. AI and Zotero configuration is omitted because those integrations do not have working backends.

## Local tools

Compile / global detects existing TeX, ChkTeX and TexLab. No installation is performed. ChkTeX can use automatic detection or an absolute executable path; validation resolves the file, requires an executable named `chktex`, and checks its version without a shell. Command strings and other programs are rejected. An explicit saved path resides in `~/.config/paperdesk/tools.json` with user-only file permissions, separately from browser preferences and project files.

Disabled ChkTeX rules must be integers 1–42. Checks apply fixed arguments and these validated rule numbers to the current unsaved source snapshot. Native project/user configuration is not loaded, and included files are not followed.

TexLab detection is informational; LSP sessions, completion and diagnostics are not integrated. The LaTeX isolation adapter detects the installed binary directory from PATH (or PAPERDESK_TEX_BIN) and derives TeX data/binary roots. It still requires macOS sandbox-exec and validates the required engine tools before reporting availability. Static hosting does not supply these local tool endpoints.

## Verification

Automated coverage includes route history/direct entry, preference normalization and typography migration, project override/reset isolation with real write/read semantics in a directory fixture, actual installed ChkTeX suppression and executable-path rejection. Browser verification is a separate check; fixture tests do not establish native directory-picker success.

## Keyboard shortcuts

General settings contain an entry to `/settings/global/shortcuts`. This separate page supports command search, categories, key capture, individual reset and reset all. Personal key overrides are normalized into browser preferences. Conflicts and reserved browser/system/editor keys are rejected. All commands use one registry for display and dispatch; Mac accepts both Command and Control equivalents. The default save is Ctrl/Command+S and saves all dirty project files immediately, without waiting for blur or a timer and without compiling. Changing that binding changes the active save key; the browser's webpage-save action remains suppressed.

The default commands are save, command palette, reader, writer, open project and compile. No experimental or unimplemented commands are registered.
