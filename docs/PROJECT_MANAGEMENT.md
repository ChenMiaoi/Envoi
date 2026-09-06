# Project management

The project menu provides **Close current project** and **Manage projects / remove / delete**.

- Close returns to an empty workspace and persists that choice so refresh does not reopen a recent project. Files, directory authorizations and recent records remain. Dirty buffers require save or explicit discard. Save/compile/project operations must finish first. Session-write failure leaves the project open; new input during the close check prevents closing.
- Remove recent record deletes only that selected record. It does not close the active project, revoke its directory handle, delete files, change another record, or touch the personal library/preferences.
- Delete directory is a separate permanent filesystem operation. Select the project's direct parent directory, verify the target, then type the complete child-directory name and confirm. It does not use the trash. The UI shows the verified parent/child names because browsers do not expose a trustworthy absolute filesystem path.

Deletion accepts no arbitrary path string. The selected parent must resolve the existing target to exactly one child component; the child handle must still identify the same directory. Verification is repeated immediately before `removeEntry`. Parent/root targets, multi-level/traversal names, replaced or moved targets, unavailable permissions, and application/code directories containing `package.json` are rejected. The target must contain a root TeX source or a project configuration referencing an existing project-relative TeX file. Unsupported, aliased or unresolvable native handles are rejected rather than converted into shell paths. No server-side recursive shell delete endpoint is added.

This depends on the browser's native directory-handle deletion support. If it cannot supply the needed parent, identity or write capability, use the system file manager. The browser API does not expose a separate symlink inspection facility; the application does not resolve links itself or offer a string-path fallback. Native deletion may fail after removing some files; that condition is reported explicitly and drafts remain in the application. A failed operation is never treated as a successful deletion.

After confirmed filesystem deletion, matching target/descendant recent/authorization records and target/descendant connection bindings are cleaned up. Deleting the current project switches to an empty session. Cleanup/storage failures are reported separately; unrelated project records, global settings and the personal paper library remain untouched.

Verification uses isolated IndexedDB data and controlled native-handle fixtures for close guards, cancellation-by-no-confirmation, identity replacement, boundary rejection, deletion failure and record isolation. No user directory was deleted and no new user-browser operation was performed during implementation.
