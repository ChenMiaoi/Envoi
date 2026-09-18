# Commit requirements

These rules apply to every commit in this repository.

## Commit message

- Use the repository's Conventional Commit style: `<type>(<scope>): <summary>`.
- Use a specific, imperative English summary without a trailing period.
- Keep the subject concise and describe one logical change.
- Use a body only when the change needs context, risk, migration, or validation details.
- Use `!` and a `BREAKING CHANGE` footer for breaking changes.
- Prefer the existing types and scopes, such as `feat`, `fix`, `refactor`, `test`, `ci`, `docs`, and `release`.

## Commit contents

- Keep each commit atomic and focused on one logical change.
- Inspect `git status --short`, `git diff`, and `git diff --stat` before staging.
- Stage only intentional files for the current change; never include secrets, credentials, local configuration, caches, logs, generated artifacts, or unrelated user changes.
- Review `git diff --cached` and `git diff --cached --stat` before committing.
- Do not use `--amend`, `--no-verify`, `--allow-empty`, reset, rebase, or forceful history changes unless explicitly requested.

## Required validation

- Before every commit, run `npm run check:local` from the repository root; it must exit successfully with `Local checks passed.` (or `CI checks passed.` in CI).
- Local checks may reuse successful results for unchanged inputs for up to 24 hours. Commit-only changes do not require repeating the full suite.
- Run `npm run ci:check` before sharing changes and after changing the validation workflow or external tools/environment. This always runs all check steps and must finish with `CI checks passed.`.
- Use `npm run check:local -- --force` to rerun all steps without cached results, and `npm run setup` to recreate dependencies when diagnosing installation problems.
- Do not bypass or weaken the local check to make a commit pass.
- If the check fails, fix the failure or report the blocker; do not commit the unvalidated change.
