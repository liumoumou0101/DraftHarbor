# 工作流布局第一版 Design QA

## Comparison target

- Source visual truth: `C:/Users/MSN/AppData/Local/Temp/codex-clipboard-569ad8f4-64f4-40c2-99d2-23691aea571f.png`
- Implementation screenshot: `H:/soft/DraftHarbor/docs/workflow-layout-v1-implementation-final.png`
- Viewport: source 2048 × 1124; implementation 1280 × 720; both desktop, dark theme, no project opened, continuation mode.
- Density normalization: screenshots were compared as desktop layout references; browser chrome and pixel density were not treated as product content.

## Evidence

The source puts the complete creation form in a narrow left sidebar while the main area is largely empty and also shows an active-run lock panel in the no-project state. The implementation moves the launcher into the main content region, leaves the sidebar for workflow identity/status/history, hides the inactive run-lock panel, and lays the form into wide fields with a two-column creation layout.

Focused regions checked:

- Workflow sidebar: now contains project state, workflow explanation, AI connection summary, and run history only.
- Launcher form: model controls, brief inputs, creation fields, and lock controls now use the main workspace width.
- Empty state: the current-run lock board is hidden when there is no active run.

## Findings

No actionable P0/P1/P2 findings remain for this first layout pass.

P3 follow-up polish:

- The main setup card is intentionally scrollable on a 720px-high viewport; a later pass could add a compact sticky action footer after the form content is stable.
- The source and implementation were captured at different window sizes, so typography should receive a final pass at the product's preferred 1440px viewport.

## Interaction checks

- Switched workflow type between continuation and creation; both layouts reflowed without losing controls.
- Existing guided, creation-guided, and graph UI tests passed.
- Browser console errors/warnings: none observed.

## Comparison history

1. Initial layout pass: moved the launcher to the main workspace and narrowed the sidebar. The first screenshot exposed narrow textareas caused by sidebar-only width rules and a sticky action overlapping the lock area.
2. Revision: added main-workspace control sizing, responsive form grids, removed the overlapping sticky positioning, and added an explicit hidden-state rule for inactive lock boards. The revised screenshot shows the intended hierarchy and no P0/P1/P2 issues.

## Implementation checklist

- [x] Move creation setup out of the narrow sidebar.
- [x] Keep existing `data-workflow-*` bindings and interactions intact.
- [x] Reflow continuation and creation forms responsively.
- [x] Hide current-run-only controls when no run exists.
- [x] Verify primary workflow UI interactions and console state.

final result: passed
