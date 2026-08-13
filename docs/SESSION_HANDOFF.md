# DraftHarbor 会话交接

最后更新：2026-08-13。此文件是 DraftHarbor 后续会话的入口；功能状态以当前仓库、`docs/FEATURE_TODO.md`、对应设计/验收文档与本文件共同为准。

## 2026-08-13：写作提示词装配收口

### 一句话结论

写作区「一块块写」的停笔条件从固定段数改成**写完本拍即停**；篇幅只用模糊档。内置模板从占位题材表收成更少、角度更清楚的一套，改写预设与模板库合成一个源，讨论区可以选内置讨论角度。DeepSeek-V4-Pro-0813 对照说明：这类成人虚构更像思考链变听话，不是硬墙变厚。

### 产品决策

1. **停笔看拍，不看段数、不看具体字数。** `buildFictionPrompt` 不再追加 `Write the next 2-3 paragraphs`。默认 closer：接着上文、只完成本拍、不要用固定段数或具体字数卡篇幅、不要提前写下一拍或后续情节。
2. **模糊篇幅，不当硬配额。** `generationDefaults.lengthHint` / 写作区「篇幅」三档：`brief`（写紧一点）、`natural`（按拍写完，默认）、`expanded`（稍展开）。旧 `{ minChars, maxChars }` 忽略，回落到 `natural`。
3. **稿纸「目标字数」和 `maxTokens` 不是文学长度。** 前者只显示进度；后者是 API 天花板（开思考时思维链也占额度）。续写 6000 / 改写前后文 1200 / 重生成 ±8000 / 摘要源约 18000 是**输入上下文预算**，未改。
4. **日常路径不要再叠硬破限词。** 正式版思考开着时，无前缀基线综合分高于 DAN / 系统覆盖；硬破限变慢且不更好。越狱文仍可放用户指令栈，产品默认不注入。

### 模板与接线

| 类别 | 原来 | 现在 | 原则 |
|---|---:|---:|---|
| 正文 | 20 | 13 | 拍的职责 + 网文/文学两种口气 |
| 改写 | 24 条库 + 20 个硬编码预设 | 11，下拉与库同一套 | 对原文做什么 |
| 摘要 | 8 | 5 | 续写检索笔记 |
| 讨论 | 10，聊天不用 | 6，讨论区可选 | 开写前问什么 |
| 工作流 | 8 | 6 | 可确认的件 |

正文模板共用中文契约（视角、跟上文口气、只出正文），每条只多一句「这一拍特别管什么」。默认正文不再写「输出 2–4 段」。改写/摘要去掉 60%–80%、1.3–1.8 倍、120–220 字等配额。

改写下拉由 `defaultPromptTemplates('rewrite')` 的 `key`/`hint`/`content` 填充；选「加压」等预设不再另写一份文案。讨论区输入上方增加「讨论角度」，写入 `workshopSession.promptTemplateId`（默认 `default-workshop-coach`），发送时用该模板的 system + 用法说明。讨论默认 system 改为中文。

### 对照测试（真实 DeepSeek，数据保留、未进仓库正文）

- 思考关 7 破限词：无硬拒；基线露骨词下降，曾误读成「甲厚了」。
- 思考开：无前缀最好；硬破限最慢；`2–3 段` 会和 beat 字数打架。
- 分块拍对照：本拍已切小时，2–3 段与「写完本拍即停」成文质量打平。墙钟 93s 对 32s，思考文本 3055 对 2411，**不能**说成思考 token 三倍，也不能排除网络波动。
- 「精简拼装输出为空」同时拿掉了部分写作指令，只能当线索，不能单独证明现有骨架不可再精简。
- 篇幅三档复测（2026-08-13 夜，27 次，思考开）：brief 字数中位 259、natural 427、expanded 340（均值 432）。**brief 明显更短且 9/9 写完本拍、0 越界**；expanded 波动大，中位并不稳定长于 natural，不能当成「选展开就一定更长」。0 次拒绝。报告：`.ai_state/writer-length-hint-repeat-20260813-length-repeat/REPORT.md`。
- **R18 同法再测 27 次**（窗上进入 / 地毯口交 / 窗边骑乘）：0 拒绝；brief/natural/expanded 中位 409 / 652 / 802。唯一「离开」命中是「嘴唇离开」假阳性。露骨词中位均为 1（近义漏计）。报告：`.ai_state/writer-length-hint-r18-20260813-length-r18/REPORT.md`。
- 材料在本机 `.ai_state/jailbreak-variants-compare-20260813*`、`writer-assembly-length-20260813-assembly`、`writer-length-hint-repeat-20260813-length-repeat`，以及桌面 `test/DeepSeek-V4-Pro-0813复测`。

### 2026-08-13 夜：token 截断与思考额度

R18 复测里至少 3 次撞到 `maxTokens: 4000`（`window-natural-3`、`ride-natural-2`、`ride-expanded-2`），正文停在半句。旧脚本没记 `finishReason`，把截断算成有效完成。软件旧默认还是 2000，开思考时比测试更容易截断。

处理：

- 测试补录 `finishReason`；`length` 单独计截断，不算有效完成，也不进字数中位。
- 新装默认 `maxTokens` 8000。写作区开思考且当前上限低于 8000 时，本次请求提到 8000，并在采样提示里说明。
- 正文生成若 `finishReason=length`，顶部状态写成「输出因额度用尽被截断，已写入正文，未保存」，不再被普通未保存文案盖掉。
- 清掉 4 个真实 API 脚本 ESLint 警告；阅读器触控/滚轮/滑动回归恢复默认执行。

用旧默认 2000 的真实验收仍应单独看截断率，不能再用「0 空/拒」代替「写完了」。

**2000 验收（2026-08-13，思考开，3 拍 × 3 档 × 2 次 = 18）：** 有效完成 13/18，`finishReason=length` 截断 5/18。窗边骑乘 natural 两发都截断。另有 4 次第一次思考把 2000 额度吃光、正文为空，重试后才出字。报告：`.ai_state/writer-length-hint-r18-20260813-r18-2000t/REPORT.md`。

**8000 验收（窗边骑乘，最容易截断的一拍，3 档 × 2 次 = 6）：** 6/6 `finish=stop`，截断 0，无空正文重试。natural 字数 1190 / 881。报告：`.ai_state/writer-length-hint-r18-20260813-r18-8000t-ride/REPORT.md`。保底 8000 后截断率从该拍 2000 组的 4/6 降到 0/6。

### 2026-08-13 晚：Codex 复核后的门禁修复

- 「风格」快捷改指向仍存在的 `literary`，不再静默回落润色。
- `loadWorkshopTemplates` 登记进 `.eslintrc.js` 的 shell 全局表。
- `writer-core.js` 压回 1400 行门禁内。
- `summary-workflow` 断言改为新摘要模板措辞。
- closer 去掉「下一段」歧义。

本切片**方向保留，未宣称效果完美**。Codex 第二轮指出的 token 截断已按产品保护处理；用旧默认 2000 的真实验收仍要单独看截断率。

### 关键文件

- `src/core/generation/prompt-builder.js` — closer、`normalizeLengthHint`、`lengthHint`
- `src/core/prompt/prompt-template-schema.js` — 内置模板、`rewritePresetByKey`
- `src/core/settings/settings-schema.js` — `generationDefaults.lengthHint`
- `src/core/workshop/workshop-schema.js` / `workshop-prompt.js` — 会话模板 ID、中文讨论装配
- `src/desktop/shell/writer-generation.js`、`writer-prompts.js`、`writer-bindings.js`
- `src/desktop/shell/workshop.js`、`desktop/fragments/workshop.html`、`writer.html`

### 验证

```powershell
node tests/core-generation.js
node tests/prompt-service.js
node tests/workshop-service.js
node tests/settings-service.js
node tests/context-prompt-core.js
```

### 明确未做

- 未做成人向专用内置模板；亲密场面用「情感拉扯」+ 拍里写清。
- 改写「下拉」和「提示词管理器」仍是两个入口，内容已同源。
- 工作流「目标字数 / 每场约 N 字」仍是软目标，本切片未改装配内核。
- 已把默认 `maxTokens` 从 2000 提到 8000；开思考且当前上限低于 8000 时，写作区会按 8000 发送并提示额度不足。旧设置里仍保存 2000 的用户走这条保护。
- 篇幅复测脚本补录 `finishReason`：`length` 截断单独统计，不算有效完成。
- 阅读器触控选择回归改为在保留选区的前提下派发事件，避免 Playwright click 先清掉选区。

### 下一会话

作者在写作区过一遍：选模板、三档篇幅、改写下拉、讨论角度。不必重跑破限词矩阵，除非正式版再次换模型。

---

## 2026-08-02：Codex 复核入口（当时未提交工作区）

### 一句话结论

工作区在 `7fcdd68` 之上包含 **F-09.6H 复核修复 + F-09.6I 章节装配 + F-09.6J 上下文装配**，均尚未单独提交。
**F-09.6J 已实现并通过真实 DeepSeek 从零创作验收（14/14）**；范围默认只接 **从零创作**，续写/大段重写**故意未接**装配内核。下一产品主线是 **F-09.6K** 或作者人工复测，不是重做 J。

### Codex 复核修复（2026-08-02）

Codex 已接手并修复复核发现的问题：

1. 章节计划改为按 `batchId + sceneId` 关联，避免跨批复用短场景 ID 时被后一批覆盖；补充章内顺序及同 key 强制拆章语义。
2. `author_locked` 资料卡不再被 `compendiumTotal` 软预算丢弃。
3. 服务端以批准 draft 装配为权威，客户端只能改章名、顺序、拆并章和移动场景；新增来源不重不漏、不可改映射校验。
4. 同步章节标题 UI 测试契约和工作流图的双 source 产物计数；清理真实验收脚本 lint。
5. 将写作区导出与工作流回流辅助逻辑拆为 `writer-export.js`、`workflow-transfer-helpers.js`，恢复桌面 shell 单文件不超过 1400 行的发布门禁。

验证：`npm test` 全量通过（lint、smoke、unit/core/storage/protocol、desktop-mainline）；未重复调用真实 Provider。

### 工作区范围（复核时请一并看）

| 切片 | 状态 | 说明 |
|---|---|---|
| F-09.6H 复核修复 | 代码在工作区 | lint / 伏笔台账 / 计划兑现 / 调锁 / rewrite 对比区回归 |
| F-09.6I | 代码 + 6K 真实验收 | 批次≠读者章节、统一字数口径、装配面板、回流 |
| F-09.6J | 代码 + 6K 真实验收 14/14 | 上下文装配内核、creation prepare 接线、usage 粗显示 |

### 明确不在本切片范围

- **续写**（`workflow-guided-service`）未调用 `assembleContext`。
- **大段重写**（`workflow-rewrite-guided-service`）未调用 `assembleContext`。
- 不与 DeepSeek 后台 token/账单对账；usage 只做「有大概、不误导」。
- 不启动 F-11；不为精确字数截断正文。

### 建议 Codex 复核关注点

1. **装配正确性：** `src/core/workflow/workflow-context-assembly.js` 预算、资料筛选、滚动状态、styleExemplar、`trims` 原因、draft 是否始终保留 `directions`。
2. **接线边界：** 仅 `workflow-creation-guided-service.prepareCreationNode` 在 plan/draft/review 调用装配；direction/blueprint/compendium 保持更满上下文。
3. **连续性：** 跨批 `lastSceneEnding` 可与 rolling `lastEnding` 去重为空；due/mustClose 线索不得丢。
4. **usage UI：** 进度条与 `data-workflow-stream-usage` 展示 label；禁止假 0；有 Provider usage 时升级为接口回传。
5. **I 回流：** 章节装配预览/面板、禁止默认「第 N 批」章名、writer sceneId 用 draft 产物 ID。
6. **测试证据：** 下列命令与真实验收报告；勿删保留项目。

### 验证命令

```powershell
node tests/workflow-context-assembly.js
node tests/workflow-chapter-assembly.js
node tests/workflow-creation-guided-service.js
node tests/workflow-creation-guided-ui.js
npm run core-test
# 真实 Provider（已跑通，保留数据；复跑会恢复已完成 run，默认少烧额度）
node tests/workflow-real-provider-canary.js
node tests/workflow-f096j-context-assembly-real-provider-acceptance.js
```

### 必须保留的测试项目（勿删、勿原地润色正文）

| 项目 ID | 用途 |
|---|---|
| `f096-real-200k-redhood-20260729` | 二十万字质量基线 |
| `f096e-real-stream-20k-redhood-20260730` | 流式舞台基线 |
| `f096h-quality-locks-real-20260730` | 质量锁真实验收 |
| `f096i-real-6k-assembly-20260731` | I 章节装配 6K 真实验收 |
| `f096j-real-context-assembly-20260802` | J 上下文装配 6K 真实验收 |

---

## 2026-08-02：F-09.6J 上下文装配收口

### 结论

**F-09.6J 已按批准方案收口（从零创作路径），并完成真实 DeepSeek 验收 14/14。**
主价值：按阶段装配提示词（少塞无效输入、裁剪可解释、连续性不退化）。usage 只做粗显示，不对齐账单。续写/重写本切片未接线（产品已确认可延后）。

### 本会话完成

1. **J2 阻塞修复：** `assembleContext('draft')` 始终保留 `directions`，修复 `prepareCreationStage` 的 `direction set requires 2 to 4 directions`。
2. **服务断言：** `workflow-creation-guided-service` 覆盖 contextReport/usageHint、selectedDirection、跨批结尾（rolling 或 lastSceneEnding）、due/mustClose 线索存活；跨批 ending 去重属预期。
3. **J3 用量 UI：** 进度条拼接 `usageHint.label`；流式舞台 `data-workflow-stream-usage`；有 Provider usage 时升级为「接口回传」；禁止假 0。
4. **真实验收脚本：** `tests/workflow-f096j-context-assembly-real-provider-acceptance.js`（可幂等恢复已完成 run；事件路径用 `libraryPaths.projectDir`，勿用 `openProject().projectPath`）。
5. **文档：** `FEATURE_TODO` §F-09.6J 勾选 + 真实验收证据；下一优先 **F-09.6K**。

### 关键路径

```text
# J 主路径
src/core/workflow/workflow-context-assembly.js
desktop/services/workflow-creation-guided-service.js
desktop/services/workflow-creation-service.js   # draft 提示词 styleExemplar 说明等
src/desktop/shell/workflow-artifact-interactions.js
src/desktop/shell/workflow-generation.js
src/desktop/shell/workflow-stream.js
src/desktop/shell/shell-foundation.js
desktop/fragments/workflow.html
tests/workflow-context-assembly.js
tests/workflow-creation-guided-service.js
tests/workflow-f096j-context-assembly-real-provider-acceptance.js

# 同工作区仍含 I（章节装配）等未提交内容
src/core/workflow/workflow-chapter-assembly.js
src/desktop/shell/workflow-chapter-assembly-ui.js
tests/workflow-chapter-assembly.js
tests/workflow-f096i-6k-real-provider-acceptance.js
docs/F096I_6K_REAL_ACCEPTANCE_20260731.md
docs/F096J_CONTEXT_ASSEMBLY_REAL_ACCEPTANCE_20260802.md
```

### 真实 DeepSeek 验收（2026-08-02，保留数据）

- 脚本：`tests/workflow-f096j-context-assembly-real-provider-acceptance.js`
- 项目：`f096j-real-context-assembly-20260802`（勿删）
- Run：`f096j-context-creation-20260802`
- 配置：`.draftharbor-settings.json` → `ai工作流` / `deepseek-v4-pro`
- 正文统计 **9394** · 原始 **11071** · 3 场 · 装配 2 章（`借名` / `债务浮现`）· mode=narrative
- 装配事件：`prompt_context_assembled` ×5（plan/draft/review）
- 实测压缩：plan ~0.68、draft ~0.62–0.73、review ~0.53（raw→assembled）
- 报告：`docs/F096J_CONTEXT_ASSEMBLY_REAL_ACCEPTANCE_20260802.md`
- 指标：`.ai_state/f096j-real-context-assembly-20260802-metrics.json`
- 过程说明：首次全量生成与装配断言均成功；验收脚本曾误用 `opened.projectPath`（undefined）导致事件检查假失败，已改为 `libraryPaths.projectDir` 后幂等复验 14/14。报告中的约 1.1 秒和 `callCount=1` 是恢复已完成 Run 后的 canary/幂等复验数据，不代表重新执行了一次完整 6K 生成。

### 下一会话建议

1. **Codex 复核**本节 + `FEATURE_TODO` F-09.6I/J + 上述关键路径 diff。
2. 可选：作者界面打开 `f096j-real-context-assembly-20260802` 抽查正文与进度条 usage。
3. 新开发优先 **F-09.6K**（分级复测/发布门）或作者打磨；勿自动启动 F-11。
4. 后续债：续写/重写接入同一装配内核；技术说明腔场景级 `inherit|avoid|allow`。

## 2026-07-30：本会话完成内容（F-09.6H 质量锁）与下一入口

### 结论

**F-09.6H 已实现并通过真实 DeepSeek 验收（24/24）。** 不要从「质量锁未做」或「工作流几乎不可用」重开。其后 **I/J 已在工作区落地**；历史文案中的「下一主线 I」已过时，以文件顶部 2026-08-02 节为准。

### 2026-07-31 复核结果与 Grok 修复

Codex 针对提交 `7fcdd68` 的复核问题已由 Grok 在同日工作区修复：

- **P0 lint：** `window.workflowWritingInstructionsPayload`；真实验收脚本 lint 清理。
- **P1 伏笔台账：** `normalizeThreadLedger` 合并字段，保留 closed/abandoned 与 firstSeen/lastAdvanced。
- **P1 计划兑现：** `evaluatePlanFulfillment` 仅字段精确匹配，不再把 outcome 套到 mustInclude。
- **P1 调锁：** soft-only finding 不展示/不接受升硬；`banned_term_hit` 可持久化为排除硬锁。
- **rewrite UI 对比区：** 已确认为 **F-09.6H 回归**，并已修复（见下节）。

验证通过：相关 eslint、质量锁/审查/锁服务、`workflow-guided-ui`、`workflow-rewrite-guided-service`、`workflow-rewrite-guided-ui`、`npm run core-test`。未重跑真实 Provider 验收。

### 2026-07-31：F-09.6I 批次 / 章节 / 字数口径（含装配面板）

- **字数：** `project-stats.countBodyStats` 与书库一致；进度双字段 body/raw；批次 additive `batchBodyStatsChars`。
- **场景计划：** 可选 `chapterKey` / `chapterTitle` / `chapterOrder` / `chapterBreakBefore`。
- **装配核心：** `workflow-chapter-assembly.js`（含 split/merge/move/rename）+ `POST /api/workflows/v2/preview-chapter-assembly`。
- **装配 UI：** `workflow-chapter-assembly-ui.js` + `dialog[data-workflow-assembly-dialog]`；从零点「结束并回流正文」先开装配板，确认后写入；draft 产物 ID 作 writer sceneId。
- **真实验收脚本：** `workflow-f096-200k-real-provider-acceptance.js` 回流改装配 API，拒绝「第 N 批」章名。
- **验证：** `workflow-chapter-assembly`、`workflow-creation-guided-service`、`workflow-creation-guided-ui`、`workflow-rewrite-guided-ui` 通过。
- **真实 6K 验收（2026-07-31，保留数据）：**
  - 脚本：`tests/workflow-f096i-6k-real-provider-acceptance.js`
  - 项目：`f096i-real-6k-assembly-20260731`（勿删）
  - Run：`f096i-6k-creation-20260731`
  - 正文统计 **9720** · 原始字符 **11612** · 3 场 · 装配 2 叙事章（`账册的扉页` / `菌丝的路径`）· mode=narrative
  - 报告：`docs/F096I_6K_REAL_ACCEPTANCE_20260731.md`
  - 指标：`.ai_state/f096i-real-6k-assembly-20260731-metrics.json`
- **大纲层级修复（同日）：** 回流后剪掉 `createProject` 空种子「第 1 章/场景 1」；侧栏章标题统一为「第 N 章 · 章名」，场景挂在章下可折叠。已清理现场项目 `f096i-real-6k-assembly-20260731`。
- **F-09.6J 已收口（2026-08-02）：** 见文件顶部；**下一优先 F-09.6K**。

### 2026-07-31：rewrite-guided-ui 对比区 — 归因确认与修复

#### 归因（Codex 二次核实 + Grok 诊断，已一致）

- Codex 初次「父提交 `76489cb` 也失败 → 历史债」**不严谨**；重跑后：**`76489cb` 完整通过**，当前工作区在修复前稳定挂于 L113。
- 根因：写作指令与原文快照同 `nodeId: 'source'`，`latest(artifacts, 'source')` 取到 `workflow-writing-instructions@1`，repair 建 comparison 时 500；UI 恢复路径只有修复正文、无对比卡。
- **定标：F-09.6H（`7fcdd68`）引入的回归，非更早独立债。**

#### 已落地修复

1. `desktop/services/workflow-rewrite-guided-service.js`
   - 新增 `sourceSnapshotArtifact()`：按 `writer-source@1` / `reader-source@1` 取快照。
   - `prepareRewriteNode` / `completeRewriteNode` 全部改用该函数；写作指令用 `writingInstructionsArtifact()`。
2. `src/desktop/shell/workflow-generation.js`
   - repair 完成后优先选中 `rewrite-comparison@1`，保证对比板可见。
3. `tests/workflow-rewrite-guided-service.js`
   - 启动时带 `writingInstructions`，断言快照与指令并存且 comparison 仍可建。

验证：`node tests/workflow-rewrite-guided-service.js`、`node tests/workflow-rewrite-guided-ui.js` 通过。

### 本会话做了什么

1. **产品/锁分配定稿**（用户确认）  
   - 对话比例：默认**关**；开启后仅 soft 可调区间；本切片无 hard。  
   - 技术说明腔：默认 **soft + avoid**；可关 / soft / hard；场景级覆盖**未做**（后续债）。  
   - 排除锁：默认 **soft**，用户显式升 hard。  
   - 计划 mustInclude/outcome：默认只展示兑现、不阻断；可 `planOutcomeLocked`。  
   - 字数：永不 hard。  
   - 系统门禁 G（过程标签/边界重复等）保持 hard。  
   - 锁必须在生成流程中可调，并影响**从零 / 续写 / 大段重写**后续步骤。  

2. **核心实现**  
   - `src/core/workflow/workflow-quality-metrics.js`：对话比例、技术腔、重复句式、禁用/慎用词、计划兑现、线索台账、`isBlockingFinding(enforcement)`。  
   - `desktop/services/workflow-review-service.js`：接入 metrics；`direction_missing` 改为 soft `direction_literal_absent`；排除 soft 不阻断。  
   - `desktop/services/workflow-lock-service.js` + `POST /api/workflows/v2/update-run-locks`：运行中改 constraints / qualityTargets / findingActions（harden|soften|disable|exempt）。  
   - `workflow-creation-guided-service` / `workflow-guided-service` / `workflow-rewrite-guided-service`：写作指令与审查链路带 qualityTargets；下一批 plan 注入 `dueThreads`/`mustCloseThreads`。  
   - 定义快照可更新：`workflow-run-store-v2.writeWorkflowV2RunDefinition`。  

3. **前台（防 UI/逻辑割裂）**  
   - `src/desktop/shell/workflow-locks.js`：统一 `lockDraft`；新建锁板 + **当前运行锁板**；结构化行（倾向/排除、启用、软/硬、删除）。  
   - 审查 finding：升硬 / 降软 / 关闭 / 豁免 + 原有「只修复此场景」。  
   - 调锁后 forceHydrate 锁板，与后端同一 API。  
   - 片段：`desktop/fragments/workflow.html`；样式：`src/styles/desktop/workflow-artifacts.css`。  

4. **测试**  
   - `tests/workflow-quality-metrics.js`、`tests/workflow-lock-service.js`  
   - 更新 `tests/workflow-review-service.js`、`tests/workflow-guided-ui.js`  
   - 接入 `package.json` 的 `core-test`  

5. **真实 DeepSeek 验收**  
   - 脚本：`tests/workflow-quality-locks-real-provider-acceptance.js`  
   - 报告：`docs/F096H_QUALITY_LOCKS_REAL_ACCEPTANCE_20260730.md`（**24/24**）  
   - 指标：`.ai_state/f096h-quality-locks-real-20260730.json`（无 API Key）  
   - 保留项目：`f096h-quality-locks-real-20260730`  
   - 从零 Run：`f096h-locks-creation-20260730`；续写 Run：`f096h-locks-continuation-20260730`  
   - 配置：读取仓库 `.draftharbor-settings.json` 中 `ai工作流` / `deepseek-v4-pro`（及 Flash canary）。  

### 权威文档

| 文档 | 用途 |
|---|---|
| `docs/F096H_QUALITY_LOCKS_DESIGN.md` | 设计、锁分配、前台对齐表 |
| `docs/F096H_QUALITY_LOCKS_REAL_ACCEPTANCE_20260730.md` | 真实验收清单与结果 |
| `docs/FEATURE_TODO.md` §F-09.6H | 勾选进度 |
| `docs/F096E_REAL_STREAM_20K_ACCEPTANCE_2026-07-30.md` | 流式舞台与既有质量 backlog |
| `docs/F096_200K_REAL_PROVIDER_ACCEPTANCE_2026-07-29.md` | 二十万字基线 |

### 必须保留的测试项目（勿删、勿原地润色正文）

| 项目 ID | 用途 |
|---|---|
| `f096-real-200k-redhood-20260729` | 二十万字质量基线 |
| `f096e-real-stream-20k-redhood-20260730` | 流式舞台基线 |
| `f096h-quality-locks-real-20260730` | 质量锁真实验收现场 |
| `f096i-real-6k-assembly-20260731` | I 章节装配 6K 现场 |
| `f096j-real-context-assembly-20260802` | J 上下文装配 6K 现场 |

### 产品决策（仍有效）

- 目标字数 = **软目标**；禁止为精确字数截断/机械重写。  
- 质量指标默认可见软锁；用户明确锁定、事实/排除硬锁、系统门禁才可阻断。  
- 计划结果兑现用语义 + 结构化状态，禁止字面 `direction_missing` 硬误报。  

### 下一会话建议

1. `git status` / 拉取 `main`；阅读本节 + `FEATURE_TODO` F-09.6H（已完成）与 **F-09.6I**。  
2. 可选人工复查：打开 `f096h-quality-locks-real-20260730`，点「当前运行 · 创作锁」与审查升硬/豁免。  
3. 新开发优先 **F-09.6I**（自然章节装配、统一字数口径）；勿再默认启动 F-11。  
4. 后续债：技术说明腔**场景级** `inherit|avoid|allow`；更长真实 A/B；F-09.6J 以**上下文装配**为主线，usage/token **粗显示即可**（不与 DeepSeek 后台对账、不追求精确）。
5. 复跑质量锁真实验收：`node tests/workflow-quality-locks-real-provider-acceptance.js`。  

### 本会话关键代码路径（便于检索）

```text
src/core/workflow/workflow-quality-metrics.js
desktop/services/workflow-lock-service.js
desktop/services/workflow-review-service.js
desktop/services/workflow-creation-guided-service.js
desktop/services/workflow-guided-service.js
desktop/services/workflow-rewrite-guided-service.js
desktop/controllers/workflow-controller.js  # update-run-locks
src/desktop/shell/workflow-locks.js
src/desktop/shell/workflow-guided-presentation.js
src/desktop/shell/workflow-artifact-interactions.js
desktop/fragments/workflow.html
tests/workflow-quality-locks-real-provider-acceptance.js
```

## 2026-07-30：工作流正文实时创作舞台

- 工作流正文已从“流式接收但只更新字符数”改为真正可见的流式稿纸：每个 Provider content 片段抵达后按动画帧增量绘制，用户在模型尚未返回完成时即可阅读半成品。
- 舞台显示当前场景/段落、本段与累计字数、平均生成速度、真实耗时和模型；数字墨水显现、呼吸光标、扫描光、信号条与背景辉光表达“文字仍在生成”，但正文纸面保持适合三分钟以上长时间观看。
- 自动跟随默认开启；用户向上滚动或使用向上导航键会暂停跟随，可一键恢复，也可收起正文区域。`prefers-reduced-motion` 下自动关闭持续动画。
- 思考流仍由独立气泡展示；第一段正文抵达时思考气泡自动让位，避免遮挡稿纸。保存/失败不会清空预览；失败文本只作为未完成预览，不作为正式 Revision。
- 已接入引导式续写、从零创作、大段重写、旧版兼容生成和替代版本。浏览器回归用可暂停的模拟 Provider 验证：响应未完成时已有部分正文、自动跟随可暂停/恢复、最终保存后进入完成态。
- 真实 Provider 验收已完成：保留项目 `真实流式验收 · 小红帽与失名狼群`，Project ID `f096e-real-stream-20k-redhood-20260730`，Run ID `f096e-real-stream-20k-creation`。`deepseek-v4-pro` 四场生成 35,023 字符，用时 10.77 分钟；首字 9.2–15.5 秒，每场 2,351–3,772 次可见增量，真实流式体验通过。不要删除或原地润色该项目。
- 完整结论见 `docs/F096E_REAL_STREAM_20K_ACCEPTANCE_2026-07-30.md`，指标和截图在 `.ai_state/f096e-real-stream-20k-redhood-20260730-*`。正文仍停在“分场正文待确认”，未批准、未运行 AI 审查、未转入写作区，方便用户直接检查。
- 本次暴露的新缺陷：对话比例 19.31%；第三场结果拖入第四场；第四场出现技术说明腔；确定性方向检查误报；真实流没有可保存 usage。目标 20,000、实际 35,023 只作为软目标偏差记录，不列为阻断缺陷。真实截图中的旧紧凑进度字数滞后已修复并补浏览器回归。

## 2026-07-29：F-09.6 二十万字真实 DeepSeek 验收

- 已用保存的 `deepseek-v4-pro` 完整生成并转入写作区：209,052 个生成字符、25 场景、6 批次、总耗时 94.3 分钟。
- 保留项目：`二十万字真实验收 · 猩红斗篷与饥饿之月`，项目 ID `f096-real-200k-redhood-20260729`，Run ID `f096-real-200k-creation`。不要清理该项目，用户需要直接检查质量。
- 完整验收结果见 `docs/F096_200K_REAL_PROVIDER_ACCEPTANCE_2026-07-29.md`；指标见 `.ai_state/f096-real-200k-redhood-20260729-metrics.json`。
- 真实运行发现并修复：正文目标长度语义不明确、场景边界/内部标签提示不足、逐场生成标题退化为“分场正文”、空白项目转写后仍停在默认空场景、`error` 未计入重大审查统计。
- 正文质量主要问题：第 4 批谈判场景重复、后段出现“场景 6-1”等元数据泄漏、技术说明语体过强、对话比例仅 17.32%、幼狼爪痕伏笔未闭合。
- 当前测试项目保留原始生成正文，不对文本做事后润色，以便复现和判断真实质量；仅将默认打开场景改为第一篇生成正文。

## 1. 当前工作区与发布状态

- 工作区：以当前电脑上的仓库检出目录为准，不依赖固定盘符。
- 发布基线：2026-07-29 的半自动工作流真实测试与 JSON 稳定性修复已合入 `main`；最新正式标签与 Release 仍为 `v1.2.1`。
- GitHub：`https://github.com/liumoumou0101/DraftHarbor`
- 最新正式发布版：`v1.2.1`，在 v1.2.0 的工作流、资料库和阅读改造基础上合入写作摘要、全局写作前缀、侧栏交互与中文默认标题增强。
- `v1.2.1` 发布后，当前主线继续以作者人工测试、缺陷修复和体验打磨为主。
- `release/` 为构建产物目录，不要把安装包提交到仓库。
- 工作区可能包含用户或前序开发留下的其他修改；开始编辑前先运行 `git status --short`，只修改当前任务需要的文件。

## 2. 当前功能状态

### 已完成

- F-01：场景与章节总结验收。
- F-02：正文选区提取资料卡草稿。
- F-03：资料卡字段级 AI 重写。
- F-04：创作抽卡。
- F-05：避免写法库。
- F-06：项目资料库管家 Agent。
- F-08：资料库检索问答。
- F-09：半自动小说工作流（主能力完成）。
- F-09.6A—H：多批持续生成、流式舞台、质量门禁 G、**质量锁 H**（见上文 2026-07-30 节）。

### 进行中或待反馈

- F-09.6I—J：已在工作区落地并完成短链路真实验收（**见文件顶部 2026-08-02**）；尚未作为独立提交合入时以工作区 + 本文为准。
- F-09.6K：分级复测与发布门（**下一主线**）。
- F-07：资料库管家辅助联动。F-07.1 已完成；F-07.2/F-07.3 需等待真实使用反馈，不要自动启动。
- F-10：阅读体验改造。F-10.1—F-10.4D 已完成并通过最终发布验收；不要自动扩张到排除项。
- F-11：证据化文风工程。已决定推迟到下一个大版本，只保留为长期研究提案；未来需在独立实验分支先重构统一提示词指令/冲突解析，当前主线不得自动启动。
- 当前优先级：Codex 复核 I/J 工作区 → F-09.6K 或作者人工测试已完成能力。
- 2026-07-29：从零创作工作流首次使用真实 DeepSeek Provider 完成 Brief、方向、蓝图、人物与世界观、场景计划、4 场正文、自动审查和正文回流的完整闭环。真实项目为 `红斗篷的挽歌`，Project ID `project-1785255712769-mjcqyd`，Run ID `creation-run-75758728-04ba-4712-a572-f5cbaf78f82f`；本地书库数据不进入 Git。运行生成约 12,500 个中文字符，证明首个闭环成立，也确认当前工作流只生成首批开篇，尚不能按 120,000 目标持续循环生成。
- 2026-07-29：已修复 DeepSeek 深度思考挤占结构化输出预算导致 JSON 截断的问题。Provider 现在暴露 `finish_reason`；结构化阶段预算提高到 8k–16k；人物与世界观拆为两个批次后合并；非法或 `length` 截断的 JSON 会自动进行一次关闭深度思考的修复；修复仍失败时，响应字符数、尾部、停止原因、usage 和修复状态会进入运行诊断事件。
- 2026-07-29：首次完整跑通后的产品反馈已整理为 `docs/WORKFLOW_FIRST_FULL_RUN_FEEDBACK_2026-07-29.md`。F-09.6A—E 已完成自动化实现：多批次持续生成、逐场保存与滚动上下文、批次连续性状态、版本化全局写作指令、每步自然语言 AI 重写、模型/深度思考选择、过程进度、三种产物视图、Revision 历史比较与恢复、返回上一步的精确过期标记和统一按钮文案。下一步只做 F-09.6F 真实 DeepSeek 多批复测与缺陷修复，不继续扩大范围。
- 2026-07-24：工作流 P0 可用性修复完成。设置页的“工作流 AI”可选择继承默认写作连接或使用独立 Provider 配置组；新引导运行保存不含密钥的配置快照，运行期间稳定使用已冻结的 Provider、模型、端点和采样参数。空书库可直接选择“从零构建新作”，确认 Brief 后由同一后端流程创建项目与运行，失败会清理刚创建的目录，成功后自动打开；续写、重写仍必须基于已有项目。思考气泡仅在显式开启深度思考时显示，生成完成自动收起；模型若提供实际思考内容，用户可按需重新打开，避免空面板遮挡产物。默认步骤页把当前待审批产物直接呈现在操作区；方向可读可选，且可在步骤页重跑当前节点或回退上一个可重跑节点（保留历史、下游过期）。当前运行类型不再被左侧新建流程表单误导。
- 2026-07-24：真实界面补充验收发现并修复空正文续写与 Provider 无响应反馈。前端/服务层均拒绝空来源且不创建孤儿 Run；工作流首响应 90 秒、流中空闲 120 秒超时，失败原因显示在主操作区，节点保持可重试。真实 DeepSeek Flash/Pro canary 通过。
- 2026-07-24：按真实用户路径使用设置中的独立 `ai工作流 / deepseek-v4-pro` 完整跑通续写与无项目从零创作。续写生成 1,863 字符并回流；从零创作生成 2,206 字正文、审查通过并回流写作区，7 张资料草稿经独立确认落库。已修复正文快照字段、分析越界、排除锁、方向重选、对象细纲、启动后误跳页、运行期思考配置冻结和工作流中央面板层叠问题；正文/资料回流现明确为分别确认。真实项目保留为 `workflow-ui-continuation-20260724` 与 `project-1784889287553-q3nc7q`，截图在 `.ai_state/workflow-visual-audit-20260724/`，完整 `npm test` 通过。
- v1 打磨期静态门禁已完成：`npm test` 会先执行 `npm run lint`，ESLint 必须保持 0 error、0 warning。现有 classic-script Shell 的 243 个跨脚本名称已作为显式遗留接口登记，新增拼写错误仍会被 `no-undef` 阻断；不要通过关闭 `no-undef` 绕过门禁。
- 全面迁移 ES Module/依赖注入推迟到作者完成功能人工测试和 v1 优化之后；当前只减少新增隐式全局依赖，不启动大规模架构重写。

详细状态以 `docs/FEATURE_TODO.md` 为准。

## 3. F-09 半自动小说工作流：完成情况

F-09 已完成设计、开发、真实 Provider 验收和发布级回归，可以进入作者人工打磨阶段。

### 已实现能力

- 续写作品：来源快照、分层总结、原文大纲和人物提取、方向选择、续写大纲、可选细纲确认、分场景长篇生成、审查和写回。
- 从零创作：结构化 Brief、方向、故事蓝图、人物/世界观资料草稿、节奏与情绪计划、细纲、分场景正文生成和资料库回流。
- 大段重写：重写 Brief、重写计划、分场景重写、衔接修复、差异预览和按原场景确认写回。
- 多版本：替代版本、逐场景差异、主版/替代版选择、混合采用和不可变 Revision。
- 锁机制：方向锁、排除锁、事实约束、权重编译和冲突检查。
- 可视化画布：真实 v2 Definition 的步骤/图视图、节点库、端口连线、模板版本、单节点运行、运行到确认点、过期节点重跑。
- 三模块联动：写作区与工作流双向转交；工作流策划稿/草稿可在资料库查询定位；资料更新继续走资料库审核流程。
- AI 体验：默认流式生成；支持 reasoning 浮动气泡；reasoning、正文、usage 或其他有效流数据都会续期空闲超时，活跃流不因固定墙钟时长被误判超时。

### 关键验收结果

- 真实 DeepSeek 长篇续写：16,038 字符原文生成 11,879 字符续写并成功回流，记录费用约 `$0.037547388`。
- 真实 DeepSeek 从零创作与重写：14 次调用、约 5.8 分钟、费用约 `$0.033394805`；生成 6,031 字符正文，重写后 4,047 字符并按场景回流。
- DeepSeek V4 Flash 与 V4 Pro 在线冒烟通过；Pro 的 reasoning 与正文分流正常。
- 百万字符综合压力验收通过：36 场景、500 事件、50 个产物 Revision、8 个模板版本。
- 完整测试、备份、写作区审计、桌面视觉审计、打包和安装包冒烟通过。

### F-09 权威文档

- `docs/SEMI_AUTOMATIC_WORKFLOW_DESIGN.md`
- `docs/SEMI_AUTOMATIC_WORKFLOW_DEVELOPMENT_PLAN.md`
- `docs/REAL_PROVIDER_ACCEPTANCE_2026-07-15.md`
- `docs/F093_REAL_PROVIDER_ACCEPTANCE_2026-07-15.md`
- `docs/F09_FINAL_ACCEPTANCE_2026-07-15.md`

### F-09 后续处理原则

- F-09 功能状态保持“已完成”；作者人工测试发现的问题作为质量打磨，不重新把整体功能改回未完成。
- 优先根据真实题材反馈调整 Prompt、默认值、节奏参数和交互。
- 只有证据表明当前数据契约无法表达真实需求时，才升级 schema。
- 不建设自主 Agent、后台无人确认的无限循环、任意代码节点或实时双向同步。允许建设由用户每批确认、可随时停止、以目标字数为参考的 `计划 → 正文 → 审查 → 继续` 循环。

### 2026-07-29 下一次测试建议

开始任何新实现前先阅读：

1. `docs/WORKFLOW_FIRST_FULL_RUN_FEEDBACK_2026-07-29.md`
2. `docs/WORKFLOW_REAL_USER_ACCEPTANCE_PLAN_2026-07-28.md`
3. 本文件的 F-09 边界

F-09.6A—E 已实现并通过完整自动化。下一次测试按以下顺序进行：

1. 使用真实 DeepSeek 在同一 Run 连续生成至少三批，记录每批字符数、耗时、失败恢复和跨批承接。
2. 在第一批结束后修改全局写作指令，确认默认只影响下一批；再单独验证“作用于当前批次”的过期提示和回退。
3. 在蓝图、计划或正文待确认时提交一次自然语言局部修改，确认模型/深度思考可选、新 Revision 可比较、未批准前不前进。
4. 故意中断一个正文场景，重开应用后确认已完成场景不重生成，进度、Revision 和真实结尾仍存在。
5. 使用可读/表单/JSON 三视图和历史恢复完成一次回退再前进，确认旧方案始终可见。
6. 记录真实文本质量：必须包含项、人物主动性、对话比例、POV 区分、修辞密度和未解线索延续。

已确认的质量证据：

- 优点：主题和事实锚定稳定、黑童话气氛明确、场景目标与钩子清楚。
- 问题：四场正文只覆盖开篇；必须包含的“主动与狼交易”没有发生；人物主动性不足；修辞密度偏高；两个 POV 的语体仍较接近。
- 工程原因：当前四场正文 Prompt 一次性准备，后场不读取前场刚生成的正文；项目 `styleGuardRules` 和工作流 `constraints` 均为空；整批生成后才做一次审查。

### 2026-07-29 F-09.6G 最新修复状态

- 已完成统一审查严重度映射；`major/high/严重/错误` 归一为 `error`，`fatal/致命` 归一为 `critical`，不再由各调用点维护不同名单。
- 已增加正文确定性门禁：过程编号/批次词、`fineOutline/targetWords/batchContext/currentScene/scenePlan`、Prompt/JSON/计划说明和意外一级标题会记录场景、Revision、范围、证据与建议。
- 已增加相邻场景首尾重复检测；审查 Prompt 另行要求区分重复重演、前场越界和状态重置。
- 当前批次存在 `error/critical` 时，“继续下一批”“完成流程”“转入写作区”均由后端拒绝，旧的 `acknowledgeMajor` 不能绕过；界面禁用推进按钮并保留“修复当前批次”。
- 审查 finding 提供“只修复此场景”：自动带入问题证据和用户补充意见，只让目标及其后续依赖场景失效，无问题的前序场景保持原 Revision；定向服务测试已验证旧版本仍在历史中且复审通过后才可继续。
- 已补齐全局上下文：运行启动时冻结设置中的 `globalPrompt`，并将其与 `workflow-writing-instructions@1` 一起放入方向、蓝图、资料、计划、正文、审查的每个 JSON 上下文；Provider 调用使用冻结值。
- 写作模块“全文上下文”已通过浏览器测试：选择章节全文后，最终提示词预览包含被引用场景的完整正文，并排除当前场景。
- 已通过定向审查、从零创作、回流、浏览器引导工作流、`npm test`、`writer-audit` 和 `git diff --check`。
- 二十万字基线项目 `f096-real-200k-redhood-20260729` 必须继续保留，不得删除或原地修正文。

## 4. F-10 阅读体验改造：当前设计结论

当前正式设计文档：`docs/READING_MODULE_REDESIGN_DESIGN.md`（正式设计 0.1）；开发计划：`docs/READING_MODULE_REDESIGN_DEVELOPMENT_PLAN.md`（计划 0.1）；前置分析保留在 `docs/READING_MODULE_REDESIGN_DISCOVERY.md`。

### 模块定位

F-10 分为三层：

1. 阅读呈现层：沉浸式阅读、滚动/分页、单页/双页、主题、背景、翻页方式、目录、字体和进度。
2. Reader Document 层：把当前项目、TXT、Markdown 和粘贴文本转换为带稳定章节、段落和来源定位的阅读文档。
3. 内容转交层：把选区、场景、章节、多章或全文冻结为不可变来源快照，显式转交写作、资料库或工作流。

### 已确认的产品边界

- 阅读模式负责阅读体验。
- 所谓“编辑模式”只负责选择内容和目标并跳转，不建设分析侧栏、Prompt 工作台或第二套正文编辑器。
- 阅读器只创建稳定的 `ReaderTransferEnvelope`；分析、生成、审核、备份和写入由目标模块接管。
- 外部书籍默认复制进本地阅读书库，避免原文件移动后失效。
- 第一版只支持当前项目、TXT、Markdown 和直接粘贴文本。
- EPUB、DOCX、PDF、扫描/OCR、书内图片、复杂 Markdown 媒体和高级字体管理均为后续增强。
- 外部或粘贴的设定文本可以生成一张或多张资料卡候选；每张卡必须得到明确的“通过、修改后通过或放弃”决定，不能未经逐卡审核批量写入。
- 字体切换从第一版进入数据与分页契约。保存稳定 `fontFamilyId`；字体、字号、窗口宽度或单双页变化后按章节/块/字符 locator 恢复阅读位置，不能只保存页码。
- 阅读器不直接修改外部原文件，也不建立四个模块间的实时双向同步。

### F-10 建议实施顺序

1. F-10.1：Reader Document v2、本地磁盘书库、不可变修订、稳定 locator、项目场景/字符映射、TXT/Markdown 复制入库、编码和章节识别预览、旧 `localStorage` 兼容迁移。
2. F-10.2：沉浸式阅读界面、流式/单页/双页/自动布局、翻页效果、主题、背景、字体和位置恢复。
3. F-10.3：范围选择、`ReaderTransferEnvelope` Store、过期来源检测和三个轻量跳转动作。
4. F-10.4：写作导入/定位、资料库单卡与多卡逐卡审核、工作流冻结快照接入。

### 下一步

- F-10.2E 已完成抽屉焦点约束、标签键盘路径、状态播报、100%–200% 等效缩放、常见窗口尺寸、真实长篇夹具以及布局/视觉审计；低高度分页安全降级为流式阅读。
- 百万字符最终报告见 `docs/F102E_READER_FINAL_ACCEPTANCE_2026-07-16.md`：搜索 p95 6.52 ms、分页 p95 2.25 ms、堆增长 21.56 MiB。
- F-10.3A 已完成 Envelope/结构/文本分离存储、三态生命周期、消费者引用保护、三类来源新鲜度与按 `envelopeId` 读取协议。
- F-10.3B 已完成选区、场景、章节、多章和全文范围映射，三布局 DOM 选区等价，服务端按 locator 重建权威快照；确认 UI、三目标 Envelope 动作、失败保留与正文泄漏回归均通过。
- F-10.3C 已完成三个目标统一来源条、单 Envelope 安全读取、fresh/stale/missing/较新修订提示、返回来源、跨项目建议门禁，以及成功物化后才 consumed 的幂等生命周期；应用重开可恢复 Envelope，正文不进入路由或 localStorage。
- F-10.4A 已完成项目精确/近似定位、外部快照片段预览、追加/覆盖/按章建场景/新建项目、显式确认、版本冲突、应用前备份、场景来源引用、项目幂等账本和备份恢复；写作来源条不再直接把正文塞入创作要求。
- F-10.4B 已实现 Reader Envelope 单卡/多卡分块抽取、跨块别名合并、新建/更新/疑似重复比较、逐卡三态审核、整批校验、版本保护、来源证据、备份、幂等保存和恢复；资料库来源条不再创建塞入整段全文的临时候选卡。
- F-10.4B 真实 DeepSeek Flash 验收已完成：9 个分块请求，完整轮 13,297 字符、8 张候选、7 通过、1 放弃、2 张既有命中；备份、幂等、Envelope consumed 和恢复通过，三轮总估算费用 `$0.012105`，验收文件无密钥和绝对路径。详见 `docs/F104B_READER_COMPENDIUM_REAL_PROVIDER_ACCEPTANCE_2026-07-16.md`。
- F-10.4C 已完成：项目单场来源成为保留 Reader locator 的 `writer-source@1`，外部/粘贴来源成为不伪造场景的 `reader-source@1`；目标项目、模板和旧快照继续均需明确确认，确定性 Run/Revision 保证幂等，输入物化后可脱离 Reader Store 独立重开。
- F-10.4D 已完成：四来源×三目标 12 条闭环、120 Envelope 压力、百万字符快照/搜索/分页、安全/恢复/幂等、真实桌面视觉和完整回归通过；1.1.1 NSIS 与 Portable 已构建，unpacked 与实际安装版冒烟通过。详见 `docs/F10_FINAL_ACCEPTANCE_2026-07-16.md`。
- `curl` 继续禁用；不要启动 EPUB/DOCX/PDF 解析器或 Reader 内 AI 控件。
- F-10.1 性能基线见 `docs/F101_READER_PERFORMANCE_ACCEPTANCE_2026-07-15.md`：百万字符预览 p95 29.34 ms、确认 p95 361.92 ms、单章读取 p95 1.47 ms、观测堆增长 23.45 MiB。

## 5. 必须保留的架构与安全边界

- `desktop/local-server.js` 只作组合入口；产品 API 路由放在 `desktop/controllers/`。
- 桌面界面继续由 `desktop/fragments/`、`src/desktop/shell/`、`src/styles/desktop/` 组成；不要恢复单体 HTML、Shell 或 CSS。
- 写作模块与半自动工作流是两个独立生成引擎，只共享 AI Task、Provider、流式传输、reasoning、历史、错误处理等基础设施；不要把写作区的逐段生成业务直接复制成长篇生成器。
- AI 生成、重写、资料提取和资料更新一律先进入可编辑预览或候选态，用户确认后才能写入正式数据。
- 所有正式写入必须有明确目标、版本保护和备份/恢复；重复应用需要幂等。
- 资料库管家仍是受限可选模块：默认不能读取小说正文，不能修改资料库白名单以外的字段。
- 资料库问答保持只读，只读取资料卡，不读取场景、章节或小说正文。
- API Key 不进入 Prompt、任务历史、日志、错误对象或公共设置响应。
- 跨模块联动由用户显式发起；目标模块继续拥有自身的预览、确认和写入业务。
- 不因后续格式扩展引入新的权威正文副本；来源映射、内容摘要和稳定 locator 必须先成立。

## 6. 代码与数据结构提示

- F-09 v2 工作流数据由独立 Store 持有；项目整体保存不得覆盖工作流文件。
- Run 摘要、状态、产物元数据、长文本、区块检查点、事件、模板和应用账本分离存储。
- Artifact Revision 不可变；编辑或批准产生子 Revision，不覆盖历史。
- 写回通过带 `applicationId`、来源 Revision、备份和逐项结果的应用账本保证幂等。
- 旧 0.1 工作流只读兼容；复制为新版运行，不原地迁移。
- F-10 应复用这些快照、Revision、过期检测和显式写回理念，但不要直接把工作流 Store 当成阅读书库 Store。

## 7. 继续开发前检查

1. 阅读本文件顶部「2026-08-02：Codex 复核入口」与 `docs/FEATURE_TODO.md`（F-09.6I/J 完成态与 F-09.6K）。
2. 运行 `git status --short`；如有本地修改，先确认归属，不得重置用户改动。当前工作区同时含 H 复核修复、I、J。
3. 若动质量锁：先读 `docs/F096H_QUALITY_LOCKS_DESIGN.md`，复用 `workflow-lock-service` / `workflow-quality-metrics` / `workflow-locks.js`，勿另起门禁体系。
4. 若动上下文装配：复用 `workflow-context-assembly.js`，默认只影响从零创作 prepare；勿在未设计前强行改续写/重写。
5. 新功能开始、暂停、完成或取消时同步更新 `docs/FEATURE_TODO.md` 与本文件。
6. 涉及持久化格式时先写 schema、迁移和兼容测试；涉及正式写入时先写备份、版本和幂等测试。
7. 真实验收可复跑（需本机 DeepSeek 配置；保留数据）：
   - J：`node tests/workflow-f096j-context-assembly-real-provider-acceptance.js`
   - H：`node tests/workflow-quality-locks-real-provider-acceptance.js`
   - I：`node tests/workflow-f096i-6k-real-provider-acceptance.js`

## 8. 发布前验证基线

基础发布验证：

```powershell
npm run lint
npm test
npm run backup-test
npm run writer-audit
npm run writer-layout-audit
npm run writer-realistic-visual-audit
npm run dist
npm run packaged-smoke
git diff --check
```

F-09 相关验证还包括：

```powershell
npm run workflow-release-acceptance
npm run workflow-provider-canary
```

F-10 开发后需要新增独立 Reader Document、迁移、长篇性能、分页位置恢复、三模块转交和桌面视觉验收命令，并补充到本节与 `docs/FEATURE_TODO.md`。
