# Architecture follow-up review

Reviewed baseline: `f998a00`. Scope: project lifecycle and asynchronous cancellation, request compatibility, and Windows-sensitive behavior. Some lifecycle gaps already existed before the extraction; the review does not attribute every finding to that commit.

## Confirmed findings and repairs

- **P1 — late task startup after cancellation.** AI, lint and LSP requests could wait for a trust/file read, then dispatch after the owning window closed or workspace trust was revoked. Compile requests already had a reservation; other operations did not. Main-process reservations now cover these waits. Closing cancels every pending operation; explicit compile cancellation affects only compilation. LSP also rechecks after loading preferences. Worker cancellation continues to own already dispatched tasks.
- **P2 — stale project ownership.** Binding a different project did not invalidate an attached/pending watcher. An asynchronous project-binding request could also finish after close or a newer open request and reactivate the old root. Switching now stops the previous watch, and binding tickets reject stale completion. Project switching intentionally does not cancel authorized background AI work.
- **P2 — settings compatibility.** The new request schema required `model`, `context` and `tools`, although the service deliberately accepts partial settings and supplies defaults. Those request fields are optional again; invalid field types/enum values and unknown operations remain rejected. The returned settings type remains the normalized complete configuration.

## Regression evidence

`app/scripts/test-architecture.mjs` covers lifecycle ownership, binding tickets, cancellation scope, request compatibility and malformed inputs. Windows path tests run the production session manager with `path.win32` and cover case-insensitive drive paths, different drives, UNC shares and similarly named siblings.

`app/scripts/test-ipc-lifecycle.mjs` bundles the production IPC registrars and delays trust resolution deterministically. It verifies that close, destruction and restriction prevent late dispatch; stale project opens cannot reactivate a root; switching projects preserves authorized background AI. Preferences, native UI and project registration are isolated fixtures, so the tests never start a real AI request or modify user projects.

Before the repairs, partial-settings acceptance, watch invalidation and the three AI cancellation tests failed. They pass after the repairs. The required local suite now includes these tests. Type-check fixtures also verify that partial settings are accepted while malformed operation payloads remain rejected.

## Platform validation

Portable Windows path checks are not a substitute for Windows process/filesystem tests. The repository's existing `CI` workflow runs the full desktop suite on `macos-latest` and `windows-latest` for every trigger, including manual `workflow_dispatch`. Native validation must reference the exact review branch commit. GitHub runner tests skip TeX-dependent checks when the toolchain is unavailable, so their result does not certify a Windows TeX installation.

The first native full run exposed two desktop-test synchronization gaps: the library localization test injected a blocked response before navigation finished, and the chat test captured its baseline before Windows wheel animation ended. The tests now serve a fixed guest page and await navigation completion, and await the native `scrollend` event before measuring the reading position. The blocked-message and scroll-preservation assertions remain unchanged.

No data migration or public IPC channel rename is required by these repairs.
