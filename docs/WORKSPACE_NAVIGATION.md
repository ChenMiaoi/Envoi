# Project and environment navigation

Envoi distinguishes three concepts:

| Concept              | Meaning                                           | Entry point                                                   |
| -------------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| Project              | The directory currently being edited              | Project-name switcher and recent projects                     |
| Environment          | Where files and processes live: local, SSH or WSL | Connection control beside the project name                    |
| Experiment workspace | A Git worktree used for a research variant        | Versions and experiments; the workspace badge on wide windows |

## Current navigation and recovery

- The project-name switcher lists recent projects with their locations and provides local, SSH and WSL opening actions. Project removal and trash operations remain in the separate management dialog.
- The welcome page exposes SSH and, on Windows, WSL. The same recent-project activation path is used from the welcome page, project switcher and folder dialog.
- Remote records retain an internal environment-qualified URI and a human-readable host, directory and name. Legacy records are resolved against saved connection profiles when displayed.
- Opening prepares the candidate project without replacing the active session. Only after loading and parsing the candidate and persisting the outgoing drafts does activation stop the previous workspace's resources. Preparation grants only the remote reads needed to load the candidate, not tool execution or file writes. Failed preparation is cancelled and leaves the current project active.
- SSH and WSL maintain separate form values. Reopening WSL keeps the selected distribution and directory. Closing a connection dialog cancels that opening request, and a late response cannot switch the editor. Cancellation is scoped to the requesting window and request, including runtime preparation.
- Header navigation participates in the same layout as the project controls. Compact windows keep the project switcher and page navigation; experiment management remains available in Versions and experiments.

## Remote feature boundaries

Remote Git history does not depend on experiment workspace management. Unsupported project AI and research-library views explain their availability before accepting work. External file import and whole-project deletion remain unavailable remotely; this does not prevent supported in-project file operations.

Remote language switches distinguish global defaults from project overrides. Tool detection remains explicitly tied to the current remote environment. Remote tool installation and executable-path selection are still not implemented.

The remote terminal is a resizable bottom panel with its environment and directory visible. Hiding the panel preserves the terminal; ending it explicitly stops it. Terminal requests carry their workspace root, preventing a late input from reaching a newly selected workspace. Local interactive terminals remain a separate implementation task.

## Remaining design work

- A shared environment-first folder picker, including SSH directory browsing, editable connection profiles and profile removal.
- Lazy directory expansion and on-demand file loading for large repositories and datasets; current snapshot size limits remain in force.
- Local terminal support and a consistent task/output model across environments.
- Remote experiment workspaces, retained results and the workflow from experiment outputs to manuscript assets.

## Verification

`npm run ci:check` includes desktop navigation regression coverage with isolated application data and simulated connection responses. It checks form isolation, cancellation, failed project preparation, the project switcher and narrow-window layout. Backend tests check preparation isolation and restricted access to candidate workspaces.

The separate real SSH and WSL acceptance commands are documented in [Remote SSH](REMOTE_SSH.md) and [WSL](WSL.md). Simulated connection tests do not replace them.
