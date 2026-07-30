# DraftHarbor 会话交接

最后更新：2026-07-30。此文件是 DraftHarbor 后续会话的入口；功能状态以当前仓库、`docs/FEATURE_TODO.md`、对应设计/验收文档与本文件共同为准。

## 2026-07-30：本会话完成内容（F-09.6H 质量锁）与下一入口

### 结论

**F-09.6H 已实现并通过真实 DeepSeek 验收（24/24）。** 不要从「质量锁未做」或「工作流几乎不可用」重开。下一主线切片建议为 **F-09.6I**（批次与读者章节解耦、统一字数口径；长度仍是软目标）。

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

### 产品决策（仍有效）

- 目标字数 = **软目标**；禁止为精确字数截断/机械重写。  
- 质量指标默认可见软锁；用户明确锁定、事实/排除硬锁、系统门禁才可阻断。  
- 计划结果兑现用语义 + 结构化状态，禁止字面 `direction_missing` 硬误报。  

### 下一会话建议

1. `git status` / 拉取 `main`；阅读本节 + `FEATURE_TODO` F-09.6H（已完成）与 **F-09.6I**。  
2. 可选人工复查：打开 `f096h-quality-locks-real-20260730`，点「当前运行 · 创作锁」与审查升硬/豁免。  
3. 新开发优先 **F-09.6I**（自然章节装配、统一字数口径）；勿再默认启动 F-11。  
4. 后续债：技术说明腔**场景级** `inherit|avoid|allow`；更长真实 A/B；F-09.6J usage/上下文预算。  
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

- F-09.6I—K：章节装配与字数口径、上下文预算、分级复测发布门（**下一优先 I**）。
- F-07：资料库管家辅助联动。F-07.1 已完成；F-07.2/F-07.3 需等待真实使用反馈，不要自动启动。
- F-10：阅读体验改造。F-10.1—F-10.4D 已完成并通过最终发布验收；不要自动扩张到排除项。
- F-11：证据化文风工程。已决定推迟到下一个大版本，只保留为长期研究提案；未来需在独立实验分支先重构统一提示词指令/冲突解析，当前主线不得自动启动。
- 当前优先级：F-09.6I 开发或作者人工测试已完成能力；继续使用已有 Prompt/避免写法控制风格。
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

1. 阅读本文件顶部「本会话完成内容」与 `docs/FEATURE_TODO.md`（尤其 F-09.6H 完成态与 F-09.6I）。
2. 运行 `git status --short`；如有本地修改，先确认归属，不得重置用户改动。
3. 若动质量锁：先读 `docs/F096H_QUALITY_LOCKS_DESIGN.md`，复用 `workflow-lock-service` / `workflow-quality-metrics` / `workflow-locks.js`，勿另起门禁体系。
4. 新功能开始、暂停、完成或取消时同步更新 `docs/FEATURE_TODO.md` 与本文件。
5. 涉及持久化格式时先写 schema、迁移和兼容测试；涉及正式写入时先写备份、版本和幂等测试。
6. 质量锁真实验收可复跑：`node tests/workflow-quality-locks-real-provider-acceptance.js`（需本机已保存 DeepSeek 配置）。

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
