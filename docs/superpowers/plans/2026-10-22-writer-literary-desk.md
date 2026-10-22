# Literary Desk Integration Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement the tasks below. User approved retaining existing capabilities and migrating their entry points; previous visual prototype and subsequent readability/range feedback are the accepted design.

**Goal:** Bring the approved literary writing desk into the real desktop application without dropping its existing writing capabilities, then verify and package it locally.

**Architecture:** Retain the vanilla desktop shell, current project/scene schema, native textarea, generation services, save/export safeguards and all existing data-native controls. Add a scoped writing-desk presentation/controller layer that relocates existing nodes and routes simplified writing/conceiving/revision actions to existing handlers. Keep advanced tools discoverable on demand. No React migration or production data import.

**Tech Stack:** Existing HTML/CSS/JavaScript, local Node/Electron, existing test harness.

**Spec:** Accepted prototype at `H:/soft/DraftHarbor/.ai_state/writer-exploration/prototype`; source direction `concepts/literary-desk.png`; user feedback: 24px default prose, 44px undo action, persistent exact revision highlighting. Capability inventory in `docs/audits/2026-10-22-writer-capability-migration.md`.

## Global Constraints

- Preserve project → chapter → scene structure, identifiers, backend APIs, reader work and existing user data.
- Keep all existing production capabilities and their bound controls reachable; no dead demo controls or fixed AI responses in production.
- Use an isolated native worktree and verified source/data backup. Keep previous installed directory available for rollback.
- Existing font preferences remain configurable; provide readable defaults and reduced motion. No external font/model requests for visual QA.
- Use temporary projects/profiles for verification. Do not call paid real models without task need.

## Review Focus

- Moving panels must retain event handlers, unique selectors, keyboard navigation and correct state after project/scene switches.
- Selection highlighting must follow the actual captured rewrite/regeneration range; stale text and foreign scenes must never be highlighted or overwritten.
- Existing saves/exports/summary/reference generation, reasoning streams and error recovery retain their guards.
- Layout must fit 1280×720 and 2560×1440; composer and candidates must not cover editable prose or hide acceptance controls.
- Focus, dialogs, textarea scrolling, IME and reduced motion must remain predictable.

### Task 1: Capability map and navigation contract

- [x] Inventory existing controls and document their new destinations and validation evidence.
- [x] Keep low-frequency features behind tool/context/settings entry points, including prompt stack, style guards, summaries, search/replace, exports and cross-module transfers.

### Task 2: Production desk shell

Files: new `src/desktop/shell/writer-desk.js`; existing writer HTML, core preferences and bootstrap integration as necessary.

- [x] Add writing/conceiving/revision navigation and a central composer using existing controls.
- [x] Preserve existing full tools and reference panels; provide a calm default scene/reference sidebar.
- [x] Wire typography, theme/focus/reduced-motion controls to real state; retain chapter/scene management.
- [x] Add meaningful tests for routing, state/selection preservation and capability reachability.

### Task 3: Exact revision range feedback

Files: new `src/desktop/shell/writer-revision-range.js` and its focused tests; minimal existing rewrite render hooks if necessary.

- [x] Test snapshot/scene/range validity and lifecycle before implementation.
- [x] Render a typography-matched background mirror, original excerpt and location/reselect controls for the real rewrite/regeneration target.
- [x] Clear stale highlights; retain real acceptance/undo protections. Test typing, scrolling, large fonts, switching scene and generation outcomes.

### Task 4: Visual implementation

Files: new scoped `src/styles/desktop/writer-literary-desk.css`, licensed font assets if needed.

- [x] Implement warm paper, charcoal chapter navigation, restrained accent, night mode and focus transitions following the accepted prototype.
- [x] Set readable control hierarchy and reserve real space for composer/result controls.
- [x] Inspect actual local application screenshots at small and 2K viewports; correct clipping/overlap and verify motion preference.

### Task 5: Integration, packaging and rollback

- [x] Run writer reasoning/save/interaction tests, capability test and full repository checks; investigate failures without relaxing safety assertions.
- [x] Independent code review and browser QA using isolated project/server data.
- [x] Package to `release/writer-desk-20261022/`, verify packaged resources and isolated packaged smoke.
- [x] Integrate the validated commit to local main, update `启动新版稿湾.cmd`, preserve previous package and record rollback instructions. No push or external publication.

Baseline at `0120d908`: writer-reasoning-test and writer-save-test passed before changes.
