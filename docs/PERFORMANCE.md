# Renderer performance

Project and agent context values are stable selector stores. Subscribe to the fields a component renders with `useProject(selector)` / `useAgent(selector)` instead of subscribing to every draft or streamed message. Selections use shallow equality by default; custom equality is appropriate for projections such as file navigation. Read the latest complete project with `getProject()` inside save/action handlers. Do not use a metadata-only selection for editing or saving content.

Stores publish after the provider commits. Snapshots and selected values stay stable until their inputs change. Keep project files immutable so unchanged files retain their identities. The legacy no-argument hooks still subscribe to the full state for components that need it.

## Optimized paths

| Area                                                                    | Change                                                                                                                                             |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application shell, project identity, trust, settings and model controls | Subscribe to relevant identity/configuration/activity fields, avoiding updates for unrelated typing and streaming                                  |
| Git status                                                              | Compare saved file references/values without serializing every saved document on each keystroke                                                    |
| File navigation                                                         | Reuse the tree for content-only edits; index folders and Git decorations rather than searching all files for every row                             |
| AI transcript                                                           | Batch stream updates in 32 ms windows; flush the final events on completion, errors and cancellation; memoize completed Markdown/activity subtrees |
| PDF preview                                                             | Read SyncTeX only when its File changes; coalesce disk verification while typing; reuse digests of immutable source/File objects with weak caches  |
| Editor lint                                                             | Stop scheduling writer lint while the writer route is inactive; reinstall neither settings dependencies nor unload listeners on each edit          |

URL-only PDF inputs are deliberately re-read: external content can change without a new React object. A modified draft/PDF invalidates preview verification, and source-to-PDF navigation remains disabled until current inputs are verified. Draft persistence, save conflict detection and background AI execution retain their existing behavior.

## Regression checks

`npm test` checks stream ordering/final flush, saved-file invalidation, and PDF verification. Ten repeated verifications read each unchanged binary input once, while changed drafts and PDFs are rejected.

`npm run test:desktop:quick` includes `test-performance-ui.mjs`. It mounts the real project/agent selector hooks in Electron under React StrictMode. One hundred separate edits and one hundred streamed state changes cause **zero additional renders** in the fixture's navigation/model consumers; edited text and transcripts still update. Renaming, model changes and changing a selector's props must immediately show the current value.

These are deterministic regression measurements, not an end-to-end CPU or memory benchmark. Use the full desktop suite to cover project switching, save/compile, models, library and background tasks after changing subscription boundaries. Tiny static controls and components whose displayed content changes still render normally; memoization should not suppress required updates.
