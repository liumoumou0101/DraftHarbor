# GitHub update with local reader preservation

> **For agentic workers:** Execute the user-approved integration plan with superpowers:executing-plans. Track verification before completion.

**Goal:** Merge the remote writer and compendium updates while preserving local reader improvements, then package and update the existing launcher.

**Architecture:** Start from local `77359e9` in an isolated worktree and merge `origin/codex/reader-illustration-simple`. Keep the original working files, user profile, and previous binaries recoverable. Promote the verified integration to local main without pushing.

**Tech Stack:** Git, Node.js, Playwright, Electron 42.4.1, electron-builder 26.15.3.

**Spec:** User-approved plan in this conversation, 2026-10-22.

## Constraints and review focus

- Preserve all local reader source, nested fragment loading, reader test entries, and reader behavior.
- Resolve shared CSS moves without duplicate workflow marker definitions.
- Combine the precise bulk-add test locator with the local import-completion wait.
- Keep the 17 original untracked files and old reader worktree untouched.
- Test with isolated application data; preserve the existing user profile and binaries.
- Keep version and dependencies unchanged; do not publish or push.

## Tasks

- [x] Back up all Git refs, uncommitted files in both workspaces, launcher, and user profile; verify hashes and bundle.
- [x] Merge the remote branch, resolve the two known conflicts, verify reader preservation, and run the complete `npm test` suite.
- [ ] Review integration, build to a new release directory, compare packaged source, and run packaged Electron smoke with isolated data.
- [ ] Update the launcher to the verified package, record results and rollback, commit and fast-forward local main; verify original untracked files remain intact.

## Commands and expected evidence

- `npm run reader-core-test`: clean local reader baseline.
- `npm test`: exit 0 after lint, smoke, unit, and desktop mainline tests.
- Electron builder with local Electron ZIP: exit 0 and a new `win-unpacked/DraftHarbor.exe`.
- `DRAFTHARBOR_PACKAGED_EXE=<new exe> node tests/packaged-smoke.js`: exit 0; project creation, persistence, and backup work with isolated data/profile.
- Git ancestry checks, reader blob comparisons, backup manifest checks, and launcher target existence: all pass before completion.
