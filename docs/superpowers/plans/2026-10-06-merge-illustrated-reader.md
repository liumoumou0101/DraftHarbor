# Illustrated reader merge and local upgrade

**Goal:** Integrate `cfa7464` with the local reader fixes in `8ed585c`, produce a tested runnable build, and preserve a usable rollback.

**Spec:** `docs/superpowers/specs/2026-10-05-simple-illustrated-reader.md`, plus the user's approval in this task to upgrade and retain rollback.

**Architecture:** Use the managed `reader-illustration-upgrade` worktree. Keep the local responsive geometry, HUD/input protections and position restoration while adding scoped image groups, the single-image pane and viewer. Persist the incoming optional image range/revision fields without altering old assets.

## Constraints and review focus

- Keep both sets of reader tests and the existing OpenCode tests wired into package.json.
- Maintain one source of truth for measured and live page widths. Illustrated layouts use the wider pane threshold while respecting font, margin and text width preferences.
- Flow image ranges must begin below reserved top chrome, matching the existing locator capture/restore origin.
- Keep shortcut/menu input protections alongside image-side input isolation and touch HUD reveal.
- Preserve old image files, empty-pane text width, narrow/low-height access, focus and upload isolation.
- Work on an integration branch; update local main only after verification. Keep the 17 unrelated experimental files outside commits.
- Keep version 1.2.6 as a local source build. The user has not requested a new public release or remote publication.

## Work and verification

- [x] Save the original main commit, Git bundle, runnable packages and project/library/configuration data under `H:/soft/DraftHarbor/.ai_state/rollback-before-illustration-20261006/`; keep branch `codex/rollback-before-illustration-20261006`.
- [x] Resolve seven merge conflicts, retaining both independent flow helpers/cases and both input protections. Layout/input and fragment/CSS workers own disjoint files; the coordinator owns rendering, range alignment, package wiring and flow/UI regression integration.
- [x] Add a regression proving a flow image upload begins at the same visible line as the HUD-aware reading locator. Observe it fail, then align image range capture and verify it passes. Run reader illustrated, core/shell and full `npm test`, plus backup checks.
- [x] Perform a fresh independent review of the integrated tree, resolve important findings, commit the merge and fast-forward the original local checkout after checking its identity and experimental file hashes.
- [x] Build NSIS/portable, run packaged and temporary installed smoke checks, compare shipped source to the checkout, and copy verified packages/evidence into the original checkout. Delivery checksums and rollback references are saved beside the local packages.
- [x] Prepare rollback launchers and instructions linking the saved old runtime and source commit. They run against copied old data with separate browser profiles; no live data restoration is performed.

## Evidence and decisions

- Before implementation, Git's simulated merge reported seven conflicts. The isolated incoming branch passed its illustrated/core/layout/flow/navigation checks.
- The existing project has no tracked uncommitted changes, and all 17 experimental files remain untracked. There was no running DraftHarbor/Electron process when the rollback snapshot was taken.
- The rollback Git bundle was verified to contain the complete original main history.
- All 1556 data/program backup files were checked byte for byte. The old backup runtime passed isolated packaged smoke.
- The new flow-start regression failed at offset 38 versus visible locator 154, then passed after alignment with `readerFlowVisibleTop`.
- Independent review found one important lower-boundary issue. The upload end regression failed at offset 221 versus visible end 116, then passed after adding the reserved bottom boundary shared by upload capture and active-image selection.
- Combined UI needs 360px height for the low-height fallback fixture: at 400px the retained full-height local reader still has 256px paged space, above the 240px threshold. Assertions on actual flow mode and image access were retained.
- The combined reader fragment exceeded its unchanged 400-line composition gate. The image viewer was extracted into its own fragment. Its new presence assertion failed before nested fragment loading and passed after loading descendants before shell binding; recursive includes are rejected.
- One full run reported an unclassified local `fetch failed` in the unchanged workflow creation test. Its independent rerun passed; the final full `npm test` also passed, including that service and all desktop suites.
- Final build, packaged smoke, installed smoke and backup checks passed. The 267 shipped application/asset files matched the integration checkout; the new viewer fragment was included, and no test/project/settings data was packaged.
- Actual screenshots and metrics confirmed the same live/probe text width at 1280 and 1600 pixels, centered empty layouts and accessible 720px image viewing.
- The merge was committed as `e15e20fca21fcd54ec755a478203626ef5d54f6a` with parents `8ed585c` and `cfa7464`, then fast-forwarded into the original local main after verifying its unchanged identity and all 17 experimental hashes.
- The copied runtime passed startup/save/reload/backup smoke in the original checkout. All 267 shipped files matched the final application sources; checkout CRLF conversion accounted for 72 newline-only differences.
- The local builder emitted no update metadata, so the old metadata was preserved with the rollback package and current installer size/SHA-512 metadata was regenerated. No public release was published.
- Rollback launchers and instructions are in the original checkout's ignored backup directory and reference the exact merge to revert. The saved runtime uses copied pre-upgrade data, keeping newer live edits separate.
