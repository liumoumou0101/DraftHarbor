# Simple Illustrated Reader Implementation Plan

> **For agentic workers:** Use focused parallel implementation with disjoint file ownership and a fresh final reviewer. Follow test-driven-development for behavior changes.

**Goal:** Deliver the user-approved simple left-text/right-image reader with large-image switching and automatic content ranges.

**Architecture:** Persist optional half-open content ranges on illustrations, select all visible intersecting groups, and render one image at a time. Keep text page geometry stable across empty and illustrated pages; use a shared dialog for enlarged and compact-window viewing.

**Tech Stack:** Existing vanilla JS, CSS, Electron/local HTTP test shell, Node assert, Playwright test harness.

**Spec:** `docs/superpowers/specs/2026-10-05-simple-illustrated-reader.md` (the confirmed in-chat design; implementation explicitly authorized by the user).

## Global Constraints

- No added dependencies, remote resources, AI generation, or ebook export.
- Preserve existing images and original files; optional fields must round-trip old records.
- Same-chapter half-open range overlap; content positions, never display page numbers.
- Keep text geometry stable when the illustration pane appears or disappears.
- Focus mode remains read-only; image navigation and viewer remain usable.
- All asynchronous writes capture document/revision identity before the first await.
- Work on `codex/reader-illustration-simple`. Implementation and verification are complete; the user authorized committing and publishing this independent branch on 2026-10-05. Keep the pull request in draft for user testing; merging remains the user's decision.

## Review Focus

- A page containing multiple separate image anchors must offer every matching image.
- Returning from image viewer must preserve reading position and keyboard focus.
- Upload during book switch must keep every image in the original document.
- Narrow/low-height readers must retain access to pictures and meaningful upload targets.
- Existing range-less records must remain usable without whole-chapter persistence.

## Task 1: Range selection and persistence

Files: `src/core/document/reader-illustration.js`, `desktop/storage/reader-illustration-store.js`, `tests/reader-illustration.js`, `tests/reader-illustration-store.js`.

Interface: `createReaderIllustration` accepts optional `revisionId` and `range: {start:{blockId,offset},end:{blockId,offset}}`; absent range stays absent. `activeIllustrationsForPage(items,chapter,page,{revisionId})` returns all overlaps in content order, retaining upload order for equal ranges. Legacy records only match the anchor-containing page/paragraph. Reject malformed/reversed ranges and out-of-chapter positions. Revision-bearing records only match their own revision.

- [x] Write and run failing tests for scope expiry, half-open boundaries, same-page groups, repagination, revision mismatch and persistence.
- [x] Implement minimal normalization/selection and persistence support.
- [x] Run the core and store illustration tests; report RED/GREEN evidence (core and store regression suites also passed).

## Task 2: Single image presentation and viewer

Files: `src/desktop/shell/reader-illustrations.js`, `src/styles/desktop/reader-illustrations.css`, `desktop/fragments/reader.html`, `tests/reader-illustrated-ui.js`.

Consumes Task 1 optional range contract. `appendReaderIllustrationPane(deck,page,effectiveMode)` returns/sets a visible count and pane-state marker. `decorateReaderIllustrationBlockNode` remains supported. Add a flow/compact illustration refresh hook callable after rendering and visible position changes.

- [x] Write and observe a failing real-image UI regression using isolated fixture data.
- [x] Replace gallery grid with a single main image, count and prev/next, compact controls and themed viewer.
- [x] Auto-capture current content range; freeze uploads and isolate responses; remove silent four-file truncation.
- [x] Keep narrow and focus-mode viewing accessible; preserve focus and text position.
- [x] Verify own tests and report evidence. Do not modify core/store or reader-reading files.

## Task 3: Rendering integration and regression checks

Files: `src/desktop/shell/reader-reading.js`, `src/core/document/reader-layout.js`, `src/desktop/shell/reader-input-coordinator.js`, relevant shell tests and `package.json`.

- [x] Add stable illustrated page-width marker and renderer hooks for paged and flow states.
- [x] Prevent image-side wheel/swipe from advancing text (input and navigation regressions pass).
- [x] Update stale structural expectations and register meaningful UI tests.
- [x] Run reader-core/storage/protocol/shell, targeted visual/accessibility and lint checks (final complete shell, layout, accessibility and lint runs passed).

## Task 4: Verify and review

- [x] Inspect no-image, main image/multi-image, viewer, narrow and low-height screenshots.
- [x] Dispatch fresh review of full diff and spec; resolve important findings and verify again.
- [x] Summarize delivered behavior and any concrete limitations; leave source and plan reviewable.
