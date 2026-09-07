# Diagnostic logging

Envoi uses electron-log 5.4.4 (MIT). The main process is the only file writer. Its Node entry point is used deliberately: renderer access goes through Envoi's restricted preload bridge, with no injected logger or console interception.

Logs are stored under the global Envoi data directory in `logs/main.log`. `ENVOI_DATA_DIR` also isolates logs in desktop tests. electron-log rotates files at approximately 5 MiB and retains `main.old.log`; a bounded final record may exceed that threshold slightly. Files are local only and no remote transport is enabled.

Records contain time, level, application version, session, module, event, operation ID and bounded operational metadata. IPC and backend operations share an ID using AsyncLocalStorage. Arguments, results, project paths, error messages, manuscript text, chat content, credentials and console output are never serialized. Error type, recognized system error code and relative application stack locations are retained. External stack frames are replaced by a marker. This intentionally sacrifices raw error text to avoid writing API/compiler responses or user content into diagnostic files.

Main IPC failures, backend results/exits, renderer errors/rejected promises, React errors and notification severity are recorded. Notifications contain no text in the log; their underlying IPC/backend failure records contain the diagnostic context. An uncaught-exception monitor records fatal errors without changing the process's normal exit behavior. A native crash may provide only the process exit reason, not a JavaScript stack.

Renderer messages accept only defined events and levels, discard arbitrary metadata and are limited to 100 records per window per minute. Diagnostic write failures do not fail application operations. `diagnosticsInfo().available` reports write failures. Settings provides **Open log folder** and **Export diagnostic logs**. Export asks for a destination and creates a JSON bundle containing platform, architecture, version and the two log files; it includes no project files. Exporting into the live log directory is rejected.

Use `diagnostics.write(level, module, event, metadata, error)` in the main process. Add event-specific context only through the allowlist in `logging.mjs`. Renderer operations use `logEvent` / `logError`; never send document or chat content. Do not replace `console` with a logger.

Validation: `node --test scripts/test-logging.mjs` and `node scripts/test-diagnostics-ui.mjs` from `app`, after a desktop build. Tests use isolated temporary directories.
