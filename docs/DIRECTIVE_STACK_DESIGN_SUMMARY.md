---
title: Directive Stack Design Summary
status: Draft
revision: 3
date: 2026-08-03
full_design: docs/DIRECTIVE_STACK_DESIGN.md
---

# Design Summary: 指令栈（Directive Stack）— rev 3

**Full design:** [`docs/DIRECTIVE_STACK_DESIGN.md`](./DIRECTIVE_STACK_DESIGN.md)  
**Temp copy:** `C:\Users\10937\AppData\Local\Temp\grok-10937\grok-design-doc-aa14c2ef.md`

## Problem

Flat `settings.globalPrompt` is prepended on every `streamGeneration` **and** re-embedded in workflow user JSON `globalContext.globalPrompt`. No task scope, dual-channel pollution, weak workshop anti-dilution, no budget/preview; partial settings saves break naive dual-write.

## Solution

**Directive Stack** (layers 1–6 only; templates stay builder-owned).  
**`streamGeneration` sole mutator** of messages for stack injection.  
**`directiveStackMode` gate:**

| Mode | When | Inject |
|------|------|--------|
| `parity` | **PR1 default** | `prependGlobalPrompt(config.globalPrompt)` only — behavior = today |
| `scoped` | **PR2+ default** | `compile(taskKind)` + apply once; never also unscoped prepend |

**Presence of normalized `directiveStack` alone does not enable scoped compile.**

## taskKind transport

Resolution order (scoped mode):

1. `config.taskKind`
2. `prompt.meta.taskKind`
3. `TARGET_TYPE_TASK_KIND[aiTask.target.type]` — authoritative for multi-kind domains
4. `SAFE_DOMAIN_ACTION_KIND[domain:action]` — prose/draw/rewrite only; **no** ambiguous `compendium:extract|update`
5. `TASK_KIND_ALIASES[prompt.meta.task]` — e.g. `fiction-prose` → `writer-prose`
6. `WORKFLOW_NODE_TASK_KIND[nodeId]`
7. default `unknown` (fail-closed structured)

**AITaskRunner (PR2):** must set `providerConfig.taskKind` + attach `aiTask` summary from task; unit-test agent (`compendium-agent-analysis`) vs reader (`reader-transfer-chunk`) vs draw.

## Dual channel

- **System** isolation: PR2 (`scoped` compile)
- **User envelope** isolation: PR4 (`buildGlobalContextEnvelope`) — do **not** claim JSON fully clean after PR2

## Dual-write merge

Partial `{ globalPrompt }` patch → update `userGlobal` content/enabled, **preserve scopes**; deep-merge in `updateSettings`.

## Default user_global scopes

`writer-prose | writer-rewrite | workshop-chat | workflow-draft | workflow-rewrite | workflow-repair`  

Not default: workflow-json/review/brief/analysis, writer-summary, compendium-json, compendium-agent, reader-extract.

## Workflow freeze

**Client-assembled** today (`workflowGenerationLaunchConfig` → POST start-*).  
PR4: `workflowGenerationLaunchConfig(projectSnapshot)` materializes project layers; every start-* passes project; new project = empty layers OK.

## PR plan (serial)

| PR | Focus |
|----|--------|
| 1 | Compiler + migration + dual-write; **parity mode** (no inject change) |
| 2 | taskKind + AITaskRunner + **scoped** mode; **system** isolation |
| 3 | Project field + UX + workshop contract |
| 4 | Client freeze + envelope policy + priority constant |
| 5 | Presets, docs polish, canary |

## Non-goals

No RAG; not a jailbreak product; no silent jailbreak keyword drop; historical runs rehydrate with intentional scoped tightening.
