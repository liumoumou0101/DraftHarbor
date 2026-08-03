---
title: 指令栈设计摘要
status: Draft rev 2
date: 2026-08-03
full_doc: docs/DIRECTIVE_STACK_DESIGN.md
---

# Design Summary: 指令栈（Directive Stack）— rev 2

**Design doc:** `C:\Users\10937\AppData\Local\Temp\grok-10937\grok-design-doc-aa14c2ef.md`  
**Review (addressed):** `C:\Users\10937\AppData\Local\Temp\grok-10937\grok-design-review-aa14c2ef.md`  
**Status:** Draft rev 2 · 2026-08-03  
**Product name:** 指令栈 / **Directive Stack**

## Problem

Flat `settings.globalPrompt` is prepended on every `streamGeneration` call **and** re-embedded in workflow user JSON `globalContext.globalPrompt`. No task scope, dual-channel pollution, weak workshop anti-dilution, no budget/preview, and partial settings saves break naive dual-write.

## Solution

Ordered **Directive Stack** (layers 1–6: app → user global → project → packs → task policy → session/run). **Templates stay builder-owned** (not compiled).  

**`streamGeneration` is the sole mutator** of messages for stack injection. Builders only set `taskKind` / `directiveContext`.  

Compile is filtered by `taskKind`; **system apply and `buildGlobalContextEnvelope` share the same scope rules**.

## Review-driven hard constraints (rev 2)

1. **taskKind transport:** resolution order `config` → `meta.taskKind` → aliases (`fiction-prose`→`writer-prose`) → workflow node map → default **`unknown` (fail-closed structured)**.  
2. **PR1 = parity only** (compiler + migration + dual-write merge). **PR2 = scope/isolation hard gate** (wire all call sites).  
3. **Envelope:** workflow-json/review must not put full user jailbreak in `globalContext.globalPrompt`.  
4. **Partial settings:** `globalPrompt`-only patch updates `userGlobal` content/enabled, **preserves scopes**; deep-merge in `updateSettings`.  
5. **Call-site matrix 1–18** including `compendium-json`, rewrite/summary, brief/analysis/repair.  
6. **Project freeze at run launch**; mid-run edits ignored; legacy rehydrate single layer.  
7. **PR order serial:** PR1 → PR2 → PR3 → PR4 → PR5 (no optimistic parallel).

## Default scopes (migrated user_global)

`writer-prose | writer-rewrite | workshop-chat | workflow-draft | workflow-rewrite | workflow-repair`  

**Not** default: workflow-json/review/brief/analysis, writer-summary, compendium-json, compendium-agent, reader-extract.

## PR plan (5, serial)

| PR | Focus |
|----|--------|
| 1 | Core stack + migration + dual-write merge; **behavior parity** |
| 2 | taskKind everywhere + scope enforce + isolation (agent/json/comp-json) |
| 3 | Project field + UX + workshop `directiveContract` |
| 4 | Launch freeze + envelope policy + `INSTRUCTION_PRIORITY_TEXT` |
| 5 | Presets, docs, canary |

## Non-goals

No RAG; not a jailbreak product; no silent jailbreak keyword drop (hard budgets only); don’t break historical freeze semantics beyond intentional scoped rehydrate tightening.
