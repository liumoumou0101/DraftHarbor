# F-09.6H 设计方案：可检测的文风、对话与伏笔控制

**状态**：**已实现并通过真实 DeepSeek 验收**（2026-07-30，24/24）  
**依据**：`docs/SESSION_HANDOFF.md`、`docs/FEATURE_TODO.md` F-09.6H、`docs/F096E_REAL_STREAM_20K_ACCEPTANCE_2026-07-30.md`  
**验收**：`docs/F096H_QUALITY_LOCKS_REAL_ACCEPTANCE_20260730.md`  
**原则**：接入既有「锁 + 审查」体系；锁对用户可在流程中自由调节；从零/续写/重写共用

## 实现落地索引（2026-07-30）

| 区域 | 路径 |
|---|---|
| 指标纯核心 | `src/core/workflow/workflow-quality-metrics.js` |
| 运行中改锁 | `desktop/services/workflow-lock-service.js` |
| 审查合并 | `desktop/services/workflow-review-service.js` |
| API | `POST /api/workflows/v2/update-run-locks`（`workflow-controller.js`） |
| 前台锁板 | `src/desktop/shell/workflow-locks.js` + `desktop/fragments/workflow.html` |
| 审查 finding 动作 | `workflow-guided-presentation.js` / `workflow-artifact-interactions.js` |
| 单测 | `tests/workflow-quality-metrics.js`、`tests/workflow-lock-service.js` |
| 真实验收 | `tests/workflow-quality-locks-real-provider-acceptance.js` |

**未做（后续债）**：技术说明腔场景级 `technicalRegister: inherit|avoid|allow`；更长真实生成 A/B。

## 定稿决议（开发以本节为准）

1. **对话比例**：默认**关**；开启后仅 soft 可调区间；本切片无 hard。  
2. **技术说明腔**：默认 **soft + avoid**；可 off / soft / hard；场景级覆盖后续做。  
3. **排除锁**：默认 **soft**，用户用结构化控件升 hard。  
4. **方向锁**：默认 soft；禁止字面 `includes` 硬误报。  
5. **计划 mustInclude/outcome**：默认只展示兑现，不阻断；可 `planOutcomeLocked`。  
6. **字数**：永不 hard。  
7. **系统门禁 G**：过程标签等仍 hard，用户不可关。  
8. **流程中可调锁**，影响后续生成/审查；**重写与续写同样受锁影响**。  

## 前台与逻辑对齐（防割裂）

| 入口 | 数据源 | 写入 |
|---|---|---|
| 新建流程锁板 | `workflowState.lockDraft` | 启动时 `constraints` + `writingInstructions` |
| 当前运行锁板 | 同 draft，选中 run 时从 `settings.constraints` + 写作指令 artifact 回显 | `POST update-run-locks` |
| 审查 finding 按钮 | 同一 API `findingActions` | 回写约束/质量目标/审查，并 `forceHydrate` 锁板 |
| 从零 / 续写 / 重写 | 启动均持久化 `workflow-writing-instructions@1` | 审查均走 `reviewDraft` + qualityTargets |

割裂修复点（已做）：去掉「文本行 `| hard`」双轨；续写/重写不再丢质量目标；审查调锁后刷新锁面板。

---

## 1. 问题与目标

### 已验证的质量缺陷

| 来源 | 现象 | 当前系统缺口 |
|---|---|---|
| 20 万字基线 | 对话约 17.32%；技术说明腔；伏笔（幼狼爪痕）未闭合 | 指令只进 Prompt，无指标、无证据 |
| 流式 3.5 万字 | 对话 19.31%；第三场结果拖到第四场；「自动生成约束系统」；`direction_missing` 误报 | 确定性方向检查字面匹配；无计划结果兑现状态；无技术腔检测 |
| 产品决策 | 字数可超目标 | 不得因字数硬截断/阻断；偏差只作诊断 |

### 本切片要达成

1. **可见质量指标**：对话比例、技术说明腔、计划结果兑现、重复句式、伏笔状态 —— 展示目标 / 实际 / 证据 / 作用范围 / 严重度。  
2. **接入现有锁机制**：编译为 constraint / finding，复用 `qualityGate` 与「只修复此场景」。  
3. **默认软锁**：提示偏差但不机械阻断；仅用户明确锁定、已批准计划必达项、事实/排除硬锁可升为阻断。  
4. **计划结果兑现** 用结构化计划引用 + 语义证据，状态：`fulfilled | deferred | unfulfilled | exempt`，禁止重复字面 `direction_missing` 硬误报。  
5. **题材可配置**：黑童话「避免技术说明腔」是项目/指令样本，不写死为全题材通用限制。

### 明确不做（本切片）

- F-09.6I 章节装配 / 字数口径统一（字数软目标规则可先在审查侧只读展示计划 vs 实际字符，不改批次模型）  
- F-09.6J 上下文预算与 usage  
- F-11 证据化文风工程  
- 删除或润色两个真实基线项目  
- 后台无人确认循环、全局字符串删除改写正文  

---

## 2. 现有基建（复用，不重造）

| 模块 | 现状 | 本切片用法 |
|---|---|---|
| `src/core/workflow/workflow-constraint-schema.js` | kind=`direction\|exclusion\|fact`，enforcement=`soft\|hard`，category 含 `style`/`pacing` | 质量目标编译为 constraint；硬锁仍走 precedence / snapshot |
| `workflow-writing-instructions@1` | `text/styleAndDistance/dialogueRatio(string)/pacingPreference/mustAvoid/stages` | 扩展可选结构化质量目标；旧 Revision 兼容 |
| `desktop/services/workflow-review-service.js` | 过程标签/边界硬门禁；`direction_missing` 字面 includes；severity 归一 | 扩确定性指标；**修正** direction 检查；合并 quality findings |
| `workflow-creation-guided-service.js` `completeCreationNode` | 确定性 + AI 语义审查合并 → `qualityGate` | 注入指标摘要与计划兑现结果 |
| `rolling-state@1` | `unresolvedThreads: string[]` | 升级为带 `threadId` 的结构化线索（兼容旧字符串） |
| scene-plan 场景字段 | `goal/outcome/mustInclude/avoid/hook/...` | 计划结果兑现的权威来源 |
| 验收脚本 `objectiveQuality()` | 已实现引号对话占比与重复短语抽样 | 下沉为 core 纯函数，供审查与离线回归共用 |
| 项目 `styleGuardRules` + `avoidance-rules.js` | 避免写法注入 Prompt | 作为「禁止/慎用」词源之一参与检测 |
| UI `workflow-guided-presentation.js` | findings 列表 + qualityGate 禁用继续/回流 | 增加指标面板、软/硬徽章、豁免入口 |

---

## 3. 概念模型

### 3.1 质量锁（Quality Lock）不是新 Store

质量锁 = **用户/计划/系统编译出的约束 + 度量结果 + 审查 finding**。

```text
writing-instructions / styleGuard / 已批准 scene-plan
        │
        ▼
  compileQualityLocks()     ← 纯核心
        │
        ▼
  constraints[]  +  qualityTargets snapshot
        │
        ▼
  measureProseMetrics(text)  ← 纯核心，每场/整批
        │
        ▼
  evaluateQualityFindings(metrics, targets, plan, threads)
        │
        ▼
  draft-review@1 findings[]  +  metrics 面板数据
        │
        ▼
  qualityGate：仅 hard + error/critical 阻断（沿用 F-09.6G）
```

### 3.2 强制等级策略

| 来源 | 默认 enforcement | 可升 hard 的条件 | 默认 severity |
|---|---|---|---|
| 过程标签 / 边界重复（G 已有） | hard | 已是 hard | error |
| 排除锁 exclusion | hard | 已是 hard | error（命中禁写） |
| 事实锁 fact（author_locked 等） | hard | 既有规则 | error |
| 方向锁 direction | soft | 用户显式 hard | **不再**因字面未命中报 error；见 §5.3 |
| 对话比例目标 | soft | 用户在写作指令中勾选「锁定对话比例」 | warning / suggestion |
| 技术说明腔 / 禁用词 | soft | 用户锁定该规则或 exclusion 硬锁同文 | warning |
| 重复句式 | soft | 用户锁定 | suggestion / warning |
| 计划必达（`mustInclude` / 场景 `outcome`） | soft 展示 | **已批准计划默认对 outcome/mustInclude 可 hard**（用户可逐项豁免） | unfulfilled→error（若 hard），deferred→warning |
| 伏笔 must_recover | soft | 用户标记「终局必须闭合」或终局批次策略 | warning；用户要求闭合→error |
| 目标字数偏差 | 仅诊断 | **永不**因超字数阻断 | info |

### 3.3 Finding 统一形状（扩展字段，向后兼容）

现有 finding 保留 `type/severity/sceneId/revisionId/evidence/suggestion/...`，增加可选：

```js
{
  type: 'dialogue_ratio_below_target',
  severity: 'warning',
  source: 'deterministic-quality-metrics' | 'ai-semantic-review' | 'deterministic-quality-gate',
  enforcement: 'soft' | 'hard',          // 新增：软锁不进 blockingFindings
  metricId: 'dialogue_ratio',
  target: { min: 0.25, max: 0.35 },
  actual: 0.1931,
  scope: { batchId, sceneId, sceneTypeHint },
  planRef: { sceneId, field: 'outcome' }, // 计划兑现用
  fulfillment: 'unfulfilled',             // 仅 plan_outcome_*
  constraintId: '...',
  exemptable: true,
  evidence: '...',
  suggestion: '...'
}
```

**阻断规则变更（关键）**：

```js
// 现有
isBlockingFinding = severity in {error, critical}

// 本切片
isBlockingFinding = severity in {error, critical}
  && enforcement !== 'soft'
// 未带 enforcement 的旧 finding：保持现有 severity 语义（过程标签等仍阻断）
// 新软锁 finding：即便 severity=warning 也不阻断；硬锁 error 才阻断
```

说明：软锁可用 `warning` 展示，但 **绝不** 把「仅启发式文风」标成 `error` 却又标 soft 造成混乱。约定：

- soft → severity ∈ {info, suggestion, warning}  
- hard 违规 → severity ∈ {error, critical}  
- 例外：过程标签/边界已是 hard error，不变  

---

## 4. 数据契约扩展

### 4.1 `workflow-writing-instructions@1`（兼容扩展）

`normalizeWritingInstructions` 在现有字段上增加可选对象 `qualityTargets`（缺省 `{}`，旧数据不变）：

```js
{
  schemaVersion: 1,
  kind: 'workflow-writing-instructions',
  text, styleAndDistance, dialogueRatio, pacingPreference, mustAvoid, applicableStages,

  qualityTargets: {
    // 对话：优先解析结构化区间；dialogueRatio 自由文本仍保留展示/Prompt
    dialogueRatioMin: number | null,      // 0–1，如 0.25
    dialogueRatioMax: number | null,      // 0–1，如 0.35
    dialogueRatioLocked: boolean,         // 用户明确锁定 → hard

    // 词汇与语体
    bannedTerms: string[],                // 禁止（可编译为 exclusion soft/hard）
    cautionTerms: string[],               // 慎用，只告警
    technicalRegisterMode: 'off' | 'avoid' | 'allow',
    // avoid：启用可配置技术说明腔模式表（见 §5.2）；allow/off 不检
    technicalPatterns: string[],          // 可选自定义正则/短语（用户/项目样本）
    technicalRegisterLocked: boolean,

    // 重复句式
    repeatedPhraseMinLength: number,      // 默认 12–24 字窗口
    repeatedPhraseCountThreshold: number, // 默认 2
    formulaicPatterns: string[],          // 如「不是…是…」
    repetitionLocked: boolean,

    // 解释性旁白（轻量启发式上限，软）
    maxExpositorySentenceRatio: number | null,

    // 伏笔追踪清单（用户可编辑）
    foreshadowingThreads: [{
      threadId: string,
      label: string,
      mustClose: boolean,
      expectedRecoveryStage: string,      // 自由文本或阶段名
      notes: string
    }],

    // 计划兑现
    planOutcomeLocked: boolean            // true：已批准 mustInclude/outcome 未兑现可 hard
  }
}
```

**解析规则**：

- 若仅有 `dialogueRatio: '约 25%–35%'` 而无 min/max，启动时用轻量解析器提取区间；解析失败则只进 Prompt、不做数值门禁。  
- `mustAvoid` 与 `bannedTerms` 合并去重后参与检测；项目 `styleGuardRules` 在运行上下文可用时一并并入 `cautionTerms`（默认 caution，不自动 hard）。  
- 修改指令仍产生新 Revision；冻结逻辑不变（默认下一批生效）。

### 4.2 `rolling-state@1` 线索结构化

```js
{
  schemaVersion: 2,  // 读旧数据时 schemaVersion 缺省按 1 兼容
  completedSceneIds, summary, characterStates, knownFacts, lastEnding,

  unresolvedThreads: [
    // v2 对象；v1 字符串读入时规范化为：
    // { threadId: hash(label), label, status: 'open', firstSeenBatchId, lastAdvancedBatchId,
    //   expectedRecoveryStage: '', mustClose: false, evidence: '' }
  ],

  threadLedger: [  // 可选完整台账（含已回收），便于终局清单
    {
      threadId, label, status: 'open' | 'advanced' | 'must_recover' | 'allowed_open' | 'closed' | 'abandoned',
      firstSeen: { batchId, sceneId },
      lastAdvanced: { batchId, sceneId },
      expectedRecoveryStage, mustClose, abandonReason, evidence
    }
  ]
}
```

写入路径：`completeCreationNode` 合并 AI `continuityState` 时走 `normalizeThreadLedger()`，禁止静默丢弃旧 threadId。

### 4.3 审查产物扩展

`draft-review@1` content 增加：

```js
{
  // 现有
  findings, blockingFindingCount, qualityGate, summary,

  metrics: {
    batch: { dialogueRatio, totalCharacters, sceneCount, repeatedPhraseHits, technicalHits, ... },
    scenes: [{ sceneId, revisionId, dialogueRatio, ... }],
    planFulfillment: [{ sceneId, field, status, evidence, source }],
    threads: [{ threadId, label, status, mustClose }]
  },

  qualityTargetsSnapshot: { /* 本批使用的目标快照，无密钥 */ }
}
```

指标与快照 **不复制正文**；evidence 仅短摘录（沿用 `evidenceExcerpt`）。

### 4.4 草稿 Revision 元数据（可选、轻量）

每场保存后可在 revision `summary` 或 artifact 侧车字段写入一行指标摘要（字符数、对话比），便于 UI 不打开全文也能显示。  
**不**把全文 metrics 重复存多份；权威批次指标以 review 为准。

---

## 5. 度量与判定算法

### 5.1 新纯核心模块（建议路径）

`src/core/workflow/workflow-quality-metrics.js`（Node + 可选挂到 global，与其它 core 一致）

导出：

- `measureDialogueRatio(text)` — 复用验收脚本引号规则：`[“”「」『』]...`  
- `measureRepeatedPhrases(text, options)`  
- `measureFormulaicPatterns(text, patterns)`  
- `measureTermHits(text, terms)`  
- `measureTechnicalRegister(text, { mode, patterns })`  
- `parseDialogueRatioRange(freeText)`  
- `compileQualityConstraints(writingInstructions, styleGuardRules, context)`  
- `evaluatePlanFulfillment({ scenes, scenePlan, semanticFindings, exemptions })`  
- `normalizeThreadLedger(previous, semanticContinuity, writingInstructions)`  
- `buildQualityFindings({ metrics, targets, enforcementMap })`  
- `isBlockingFinding(finding)` — 统一 severity + enforcement  

单元测试：`tests/workflow-quality-metrics.js`  
离线金标：从基线项目只读抽取样本（不改项目），断言对话比约 17%–20% 量级、技术腔样本命中、过程标签仍由 G 门禁覆盖。

### 5.2 技术说明腔（可配置）

内置 **可选模式表** `avoid-modern-tech-expository@1`（仅当 `technicalRegisterMode === 'avoid'` 或用户提供 patterns 时启用），示例模式（黑童话样本，可关）：

- 系统/协议/自动生成/检测/约束引擎/参数校准  
- 赫兹、精确到小数的生理读数、神经解剖式解释  
- 「XX 模块/接口/回调」等元叙事  

科幻/医学题材：默认 `off` 或 `allow`，用户启用才检查。  
命中 → finding `technical_register_drift`，附 evidence 摘录；默认 soft warning。

### 5.3 修正 `direction_missing`（必做）

当前 `reviewDraft`：

```js
if (constraint.kind === 'direction' && enforcement === 'hard' && !text.includes(value))
  → direction_missing warning
```

问题：完整约束句几乎不可能逐字出现在正文（流式验收已误报）。

**新规则**：

1. **删除**「硬方向锁 + 正文 includes 全文」作为唯一判定。  
2. direction 字面检查最多作为 `info` 信号：`direction_literal_absent`，`enforcement: soft`，**永不单独阻断**。  
3. 真正的「方向/必达未兑现」走 **计划结果兑现**（§5.4）+ AI 语义审查 finding（`plan_outcome_unfulfilled` 等）。  
4. exclusion 硬锁仍可用 includes（禁写短语命中），合理保留。

### 5.4 计划结果兑现

对已批准 `scene-plan` 中每个场景：

| 检查项 | 来源字段 | 状态机 |
|---|---|---|
| 必含事件 | `mustInclude[]` | fulfilled / unfulfilled / exempt |
| 场景结果 | `outcome`（及可选 `goal`） | fulfilled / deferred / unfulfilled / exempt |
| 钩子 | `hook` | 仅 info：是否留下可承接钩子（不硬阻断） |

**判定分层**：

1. **确定性弱信号**（不单独 hard）：关键词/别名命中率，仅辅助。  
2. **AI 语义审查**（主路径）：Prompt 要求对每个 sceneId 返回  
   `{ sceneId, field, status, evidence, deferredToSceneId? }`  
3. **合并规则**：  
   - AI 报 fulfilled → fulfilled（即使字面无完整句）  
   - AI 报 deferred 且指出后场 sceneId → deferred（warning，软）  
   - AI 报 unfulfilled 且 `planOutcomeLocked` 或用户 hard → error 阻断  
   - 用户豁免 → exempt，记入 review / 事件  

场景职责漂移（第三场 outcome 拖到第四场）应标为：  
- 第三场：`plan_outcome_deferred` 或 `plan_outcome_unfulfilled`  
- 第四场：可选 `previous_scene_overreach` 语义类（G 已要求 AI 区分）

### 5.5 对话比例

- 每场 + 整批计算 `dialogueRatio`。  
- 与 `dialogueRatioMin/Max` 比较；无结构化区间则跳过数值 finding，仅把自由文本留给 AI。  
- **场景类型调节**（软）：若计划 `pace` 为动作向或 `participants` 单人，偏差降级为 suggestion，并在 UI 注明「独处/动作场景允许偏低」。启发式即可，不做复杂分类器。  
- 仅 `dialogueRatioLocked && 整批明显偏离` 才 hard error。

### 5.6 伏笔 / 线索

- 每批审查后更新 `threadLedger`。  
- 规划下一批时，`batchContext` 注入：`dueThreads`（到期未回收）、`mustCloseThreads`。  
- **终局批次**（用户点结束，或 cumulative 达目标且用户选择结束）：生成清单 finding  
  - `thread_must_recover` / `thread_allowed_open` / `thread_abandoned`  
  - 未处理 mustClose → 至少 warning；用户曾锁定闭合 → error  

---

## 6. 服务与 UI 接入点

### 6.1 后端流程

| 时机 | 动作 |
|---|---|
| Run 启动 / 指令更新 | `compileQualityConstraints` → 可写入 settings.constraints 增量或仅运行时合并（推荐 **运行时合并**，避免污染用户手写锁文本） |
| 每场 draft 保存后 | 可选：轻量 metrics 写入 summary |
| `prepareCreationStage('review')` | Prompt 增加 qualityTargetsSnapshot、scene plan 必达表、threadLedger；要求返回 planFulfillment + 结构化 threads |
| `completeCreationNode` | `Review.reviewDraft` 扩指标；合并 AI fulfillment；写 `metrics`；`blockingFindings` 用新 isBlocking |
| 下一批 plan Prompt | 注入 dueThreads、上批 metrics 偏差摘要（短） |
| 定向修复 | 已有「只修复此场景」带上 quality finding evidence |

运行时合并伪代码：

```js
const compiled = compileQualityConstraints(writingInstructions, styleGuardRules, { projectId, runId });
const effectiveConstraints = [...(run.settings.constraints || []), ...compiled.constraints];
// reviewDraft({ constraints: effectiveConstraints, qualityTargets, scenes, scenePlan, ... })
```

### 6.2 前端

1. **写作指令编辑**（workflow artifact 表单 / 引导启动区）  
   - 结构化：对话区间滑块或两输入、锁定勾选、技术语体 mode、禁止/慎用词、伏笔列表  
   - 自由文本区保留；结构化是编译结果，可编辑/关闭  

2. **审查可读视图**  
   - 顶部「质量指标」卡：对话 实际 vs 目标、技术腔命中数、计划兑现汇总、线索状态  
   - finding 行：软锁灰标 / 硬锁红标；按钮：豁免、只修复此场景、查看证据  

3. **末端决策**  
   - soft-only → 可继续下一批（可显示「存在 N 条质量提示」）  
   - hard 未处理 → 保持禁用（G 行为）  

4. **豁免 API**（小）  
   - `POST` 记录 exemption：`{ findingKey, reason, user }` → 写入 review 新 Revision 或 run 事件 + 覆盖该 finding 为 exempt  
   - 必须新 Revision，不改历史  

---

## 7. 实现切片（建议提交顺序）

| 子切片 | 内容 | 测试 | 预估 |
|---|---|---|---|
| **H1** | `workflow-quality-metrics` 纯函数 + 对话/重复/用词/技术腔 | `tests/workflow-quality-metrics.js`；金标摘录不碰基线项目 | P0 |
| **H2** | `normalizeWritingInstructions` 扩展；compile constraints；兼容旧数据 | creation-guided-service 单测 | P0 |
| **H3** | `reviewDraft` 接入 metrics；修正 direction_missing；isBlocking+enforcement；review.metrics | review-service + guided-service 门禁回归 | P0 |
| **H4** | 计划兑现：AI schema + 合并；场景职责/deferred | 服务测 fixture：字面无句但语义已兑现 → 不得 error | P0 |
| **H5** | threadLedger 规范化 + 下一批 plan 注入 + 终局清单 | 多批 rolling-state 兼容测 | P1 |
| **H6** | UI：指标卡、软硬标、豁免、指令结构化表单 | `workflow-creation-guided-ui.js` | P1 |
| **H7** | 离线分析 200k/stream 样本报告脚本（只读）；更新 FEATURE_TODO / 交接 | 文档 + 可选 `node tests/...` | P1 |

**建议首个可合并里程碑**：H1–H3（指标可见 + 不再误报 direction + 软硬不误阻断）。  
H4 紧随，直接对应「第三场拖第四场」与「主动交易已发生却误报」。

---

## 8. 验收标准（对齐 FEATURE_TODO）

1. 对保留正文的**离线分析**可稳定复现约 17%–20% 对话比例量级，并检出样本文中技术说明腔短语。  
2. 新生成批次若设置 25%–35% 对话：界面显示是否达标、哪些场景拉低比例，而非一句笼统评价。  
3. 文风/伏笔检查可关闭或调整；切到科幻样本且 mode=allow 时，不误用黑童话技术词表。  
4. 已语义兑现的计划项不得再报硬性 `direction_missing`。  
5. 软锁不阻止继续下一批；硬锁 error 仍阻止继续/完成/回流。  
6. 基线项目 `f096-real-200k-redhood-20260729` 与 `f096e-real-stream-20k-redhood-20260730` **只读**。  
7. `npm test`、相关 workflow 定向测、`git diff --check` 通过。  

---

## 9. 风险与对策

| 风险 | 对策 |
|---|---|
| 对话比例引号规则漏检无引号对白 | 文档标明算法边界；AI 语义审查作补充 suggestion |
| 技术词表误伤 | 默认 off；按 mode 启用；用户可改 patterns |
| 硬锁过多导致无法推进 | 默认 soft；planOutcomeLocked 默认 false 或仅 mustInclude hard（实现时取 **默认 false，批准计划后 UI 提示可一键锁定必达**） |
| 与 G 门禁双重计数 | process_label/boundary 仍只在 deterministic-gate；metrics 不重复报同类 |
| 扩大范围到 I/J | 本设计明确裁剪；字数只 info |
| AI fulfillment 不稳定 | 确定性弱信号 + 用户豁免 + 证据展示；不单靠字面 |

**产品默认建议（请你拍板）**：

- `planOutcomeLocked` 默认 **false**（展示兑现状态，不阻断）；用户可在审查页「锁定未兑现必达项」后升 hard。  
- 若你希望「已批准计划的 mustInclude 默认 hard」，可在确认设计时改为默认 true。

---

## 10. 关键文件清单（实现时）

**核心**  
- 新增 `src/core/workflow/workflow-quality-metrics.js`  
- 改 `desktop/services/workflow-review-service.js`  
- 改 `desktop/services/workflow-creation-guided-service.js`（normalize、complete review、batchContext）  
- 改 `desktop/services/workflow-creation-service.js`（plan Prompt 注入 threads/metrics 摘要，如需要）  

**UI**  
- `src/desktop/shell/workflow-guided-presentation.js`  
- `src/desktop/shell/workflow-artifact-interactions.js` / `workflow.js`（指令表单，视现有入口）  
- 可能 `src/styles/desktop/` 少量样式  

**测试**  
- `tests/workflow-quality-metrics.js`  
- 扩展 `tests/workflow-creation-guided-service.js`、`workflow-creation-guided-ui.js`  
- 可选只读 `tests/workflow-quality-baseline-offline.js`  

**文档**  
- `docs/FEATURE_TODO.md` F-09.6H 勾选  
- `docs/SESSION_HANDOFF.md` 进度段  

---

## 11. 确认后的执行顺序

1. 你确认本设计（尤其 §9 的 `planOutcomeLocked` 默认值）。  
2. 退出纯设计，按 H1→H3→H4… 实现。  
3. 每子切片可独立测试回退；不触碰真实基线项目正文。  

---

## 附录：与交接「下一会话入口」对照

| 交接要求 | 本方案对应 |
|---|---|
| 质量指标接入锁机制 | §3 编译链 + constraint/finding |
| 默认可见软锁 | §3.2 / isBlocking 含 enforcement |
| 计划结果结构化 + 语义证据 | §5.4 |
| 禁止 direction_missing 字面误报 | §5.3 |
| 长度软目标 | 仅 info，不进 hard |
| F-09.6H 下一切片 | 全文范围即 H |
| 保留两基线项目 | §8.6 |
