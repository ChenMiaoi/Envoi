# Application architecture

Envoi remains one desktop application under `app/`. The renderer, privileged main process and utility workers have separate responsibilities; this organization does not introduce additional services, packages or data migrations.

## Dependency direction

- `shared/` contains platform-neutral contracts, transport models and pure rules. It may import plugin JSON and validation libraries, but not React, Electron, Node APIs or application implementation directories.
- `src/` contains renderer state and presentation. It consumes `shared/bridge.ts` through `lib/desktop.ts`; it never imports Electron or server implementations.
- `server/` contains local domain services. These may use Node and external SDKs, but never import the renderer or Electron.
- `electron/` adapts domain services to IPC, utility processes, windows and native file access.
- `server/http/` contains development and integration-test middleware. It is wired only by the web Vite configuration and explicit test fixtures. Services never import these adapters, and the desktop build does not register them.

`npm run lint` includes `app/scripts/check-architecture.mjs`, which checks these import boundaries and compiles negative contract examples. The existing small compatibility re-exports keep established renderer and server imports working while their implementations live in `shared/`.

## Desktop composition and resource ownership

`electron/main/index.ts` owns application/window startup. `runtime.ts` constructs services and injects only the capabilities required by each `ipc/` registration module. Registration modules group projects, files, tools, languages, research, AI, data, diagnostics and updates.

`services/project-sessions.ts` owns project identities, active window roots, resource tokens, watcher tickets, pending compilation reservations and paper-browser cancellation. Closing a project or destroying its window invalidates pending watcher attachment, disposes language sessions and cancels browsing and pending compile reservations. IPC and window adapters additionally cancel utility-worker tasks. Restricting a root cancels operations on its registered descendants. Deleting a root clears every active owner and revokes its resource token.

`asset-protocol.ts` serves project resources through the existing path/trust checks. `paper-browser.ts` imports downloads only while their originating project/window binding is still current. Pure relative-path syntax is shared; realpath, symlink and workspace-trust checks remain privileged operations.

## Contracts

`shared/bridge.ts` defines the preload surface. `shared/contracts.ts` maps library actions, workspace actions and AI routes to their request and response types. Callers infer results from the operation instead of selecting an arbitrary return type. The corresponding IPC handlers parse requests before dispatch; existing domain validation and permission checks remain in place.

`shared/backend-contract.ts` maps utility-worker methods to argument tuples and results. `BackendHost.call` is constrained by that map, and the worker validates incoming method arguments before dispatch. Runtime validation is for requests; responses rely on domain implementations and integration tests rather than claiming complete runtime response validation.

To add an operation, update its contract, domain handler and transport adapter together. Add runtime malformed-input cases and a compile-time contract example when introducing a new request shape.

## AI services

`server/agent.mjs` is the composition facade and request coordinator. Its `agent/` modules separate model discovery/SDK authentication adaptation, authentication workflows, configuration, session persistence, project tools, SDK event translation and chat execution. Runtime reservations are intentionally shared by authentication, session operations and the chat runner: credentials must not change during active tasks, and one project cannot run concurrent chats. The facade owns disposal.

## Renderer state

`src/project/model.ts` contains project/file types, without importing their file-loading implementation. `ProjectProvider` coordinates editing, restoration and saving; disk watching/merging lives in `useProjectDiskSync`, and save serialization remains in `projectSaver`.

`src/features/library/` owns the paper workspace and its note, attachment and chat hooks. Notes retain revision conflict handling, serialized saves, debounced persistence and unload protection. Attachments own PDF loading and reading position. Chat owns streaming/history state and uses the note hook to flush and refresh notes around a conversation. `views/LibraryView.tsx` coordinates the library overview and selection.

`settings/useExtensionTools.ts` owns discovery, path verification, installation and preference synchronization. `ExtensionsSettings.tsx` renders those states. Generic controls remain in `components/ui/`. Existing selector stores and process isolation are retained.

## Verification

- `npm run lint`: lint plus dependency/contract checks. ESLint also checks the extracted AI, HTTP and shared JavaScript modules.
- `npm run test:local`: includes lifecycle, malformed-request and shared-file-rule regression tests.
- `npm run test:ai`: exercises native SDK streaming, authentication, isolation, cancellation and data migration, including the explicit HTTP test adapters.
- `ENVOI_DESKTOP_TEST_FULL=1 npm run ci:check`: runs the full validation pipeline and all desktop scenarios, including library, workspaces, background AI, settings, editing and compilation.

The architecture refactor preserves on-disk formats, IPC channel names and public user flows. Future directory moves should follow feature ownership rather than file-size targets.
