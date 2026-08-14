# Grok 4.6 实施任务书：OpenCode Zen Provider

状态：待执行  
日期：2026-08-14  
执行模型：Grok 4.6  
对应主待办：F-13.1—F-13.3  
设计依据：`docs/OPENCODE_ZEN_PROVIDER_DESIGN.md`

## 1. 任务目标

在稿湾中实现一个真正可用的 OpenCode Zen Provider，使用户只保存一次 Zen API Key，即可在 Writer、Workshop、Workflow 和资料库管家中选择稿湾已经兼容的 Zen 模型。

本任务同时实现：

1. 云端 Provider 请求迁移到 Electron 后台，解决 Zen CORS，并让 API Key 退出渲染层。
2. 一等 Provider 预设 `opencode-zen`。
3. Zen Chat Completions 模型接入与切换。
4. 在线模型目录、24 小时缓存和“更新模型列表”按钮。
5. 免费模型、隐私风险、兼容状态和下线状态的可靠展示。

完成后由 Codex 根据本文末尾的固定量表审查和打分。不要修改评分标准。

## 2. 开始前必须阅读

- `docs/OPENCODE_ZEN_PROVIDER_DESIGN.md`
- `docs/FEATURE_TODO.md` 中 F-13
- `src/core/generation/provider-stream.js`
- `src/core/settings/model-catalog.js`
- `src/core/settings/settings-schema.js`
- `desktop/services/settings-service.js`
- `desktop/controllers/generation-controller.js`
- `src/desktop/shell/settings.js`
- `src/desktop/shell/writer-generation.js`
- `src/desktop/shell/workflow-generation.js`
- `src/desktop/shell/workflow-provider-config.js`

开始前记录 `git status --short`。工作区已有修改属于用户，不得覆盖、重置或清理。

## 3. 已冻结的产品决策

以下决策不允许自行改变：

- Provider ID：`opencode-zen`。
- 默认 Base URL：`https://opencode.ai/zen/v1`。
- 不关闭 Electron `webSecurity`，不注入全局 CORS 绕过头。
- 云端请求由 Electron 后台发起；渲染层只提交任务和非敏感选择。
- 第一阶段只正式开放 Chat Completions 模型。
- Responses、Anthropic Messages、Google 原生模型可以显示为“待适配”，但不能伪装成可用。
- 自动更新目录不能自动改变默认模型、项目模型或历史 Workflow 快照。
- 免费模型不自动选为默认值。
- 免费/隐私状态不能只根据 `-free` 后缀猜测。
- 远端目录数据不能下发任意 Endpoint、请求头、脚本或非 Zen 域名。
- 不实现自动付费模型回退。

## 4. 当前 Zen 协议范围

### 4.1 本任务必须支持

OpenAI Chat Completions：

```text
POST https://opencode.ai/zen/v1/chat/completions
Authorization: Bearer <Zen API Key>
```

当前候选模型族：

- DeepSeek V4 Pro / Flash
- MiniMax M3 / M2.7
- GLM 5.2 / 5.1
- Kimi K3 / K2.7 Code / K2.6
- 当前在线的 Chat Completions 免费模型

至少为 DeepSeek V4 Pro、DeepSeek V4 Flash、MiniMax M3、GLM 5.2、Kimi K2.6 建立明确能力记录。其他在线 Chat Completions 模型可以进入目录，但未知能力必须使用安全默认值。

### 4.2 本任务不要求实现

- `/responses`：GPT、Grok、Muse
- `/messages`：Claude、Qwen
- Google 原生：Gemini

这些模型必须被正确标为 `unsupported-transport` 或同等状态，不能进入可调用选择。

## 5. 强制架构要求

### 5.1 后台生成桥接

为所有云端 Provider 建立后台流式请求入口，不能只为 Zen 写一条旁路。

要求：

- 后台读取真实设置和 API Key。
- 渲染层提交 Provider 配置组引用、模型覆盖、Prompt、生成参数和任务元数据。
- 后台重新解析并校验连接，不能信任渲染层提交的 API Key 或任意 Zen Endpoint。
- 统一向界面转发：`reasoning`、`content`、`usage`、`finish`、`error`。
- 保留首包超时、空闲超时、活跃流不限总墙钟时长的现有语义。
- 支持取消；客户端中止或断开后必须中止上游请求。
- Writer、Workshop、Workflow、资料库管家统一使用该路径。
- 现有 DeepSeek、OpenAI、OpenRouter、OpenAI-compatible/custom 行为不得回归。
- 本地模型可以继续使用既有本地路径。

### 5.2 密钥边界

- `publicSettings`、Provider 列表、运行时前端状态不包含真实 API Key。
- 删除或替代当前把 `runtimeProviderProfiles` 密钥返回渲染层的行为。
- 项目、Workflow 快照、任务历史、错误对象、日志和测试报告不得包含密钥。
- 后台错误响应不得包含上游响应头、完整响应体或可能含密钥的 URL 查询参数。

### 5.3 能力驱动模型目录

将“Provider 是否兼容”“模型是否在线”“模型协议是否已适配”“是否支持思考”分开表达。建议字段：

```text
id
provider
transport
availability
compatibility
thinkingSupported
thinkingControl
samplingPolicy
pricingClass
privacyClass
deprecated
```

不得继续用 `provider === deepseek` 作为唯一思考能力判断。Zen 中的 DeepSeek 模型也要正确支持思考开关和 `reasoning_content`。

## 6. 动态目录与免费模型

### 6.1 三层目录

合并以下来源：

1. 安装包内置兜底目录。
2. Zen `GET /models` 的在线存在性。
3. 版本化稿湾兼容性清单：协议、免费状态、隐私状态、适配状态。

Zen `/models` 当前只证明模型存在，不证明免费、协议或隐私状态。

### 6.2 缓存与刷新

- 模型缓存写入应用数据目录，不写入项目目录。
- 缓存 TTL：24 小时。
- 过期后后台非阻塞刷新。
- 设置页提供“更新模型列表”。
- 显示最后成功更新时间、来源和新增/下线/状态变化数量。
- 网络失败保留最后成功缓存和内置兜底，不能清空选择器。
- 并发刷新必须合并或互斥，不能重复写坏缓存。
- 缓存写入应使用现有原子写入模式。

### 6.3 免费与隐私元数据

- 免费模型必须来自版本化清单或明确的上游机器可读字段；不能只按名称猜测。
- 必须覆盖没有 `-free` 后缀的免费例外，例如当前的 `big-pickle`。
- 免费变为付费或未知时，保留模型选择但在下一次调用前提示确认。
- `may-train`、试用采集或类似隐私风险必须有可见徽标。
- 免费/可能采集内容的模型首次用于项目正文前必须确认；拒绝后不发送。
- 用户可以隐藏所有带内容采集风险的模型。

### 6.4 远端兼容性清单

至少提供：

- 严格 schema 校验。
- `schemaVersion`、`updatedAt`、来源 URL。
- 只允许 Zen 模型 ID 和枚举元数据。
- 禁止远端覆盖 Base URL、Endpoint、Authorization 或其他请求头。
- 校验失败回退到缓存/内置版本。

如果实现自动生成脚本或 GitHub Action，应把上游 `/models` 和 OpenCode 官方 Zen 文档作为候选数据来源；自动结果必须经过 schema 与差异门禁。应用运行时不能依赖解析网页才能正常启动。

## 7. 设置与模型选择体验

### 7.1 设置页

新增“OpenCode Zen”选项后：

- 自动显示固定 Base URL。
- 用户填写 API Key。
- “测试连接并获取模型”发送后台真实最小请求，不是仅检查字段存在。
- 可选择默认模型。
- 显示模型目录更新时间。
- 提供“更新模型列表”。
- 清楚显示认证失败、余额不足、频率限制、免费额度用尽、模型不可用和协议未适配。

### 7.2 Writer / Workflow / 资料库管家

- 同一 Zen 连接下可切换已兼容模型，不重复输入 Key。
- 模型选择器至少区分：免费已兼容、付费已兼容、待适配、已下线。
- Workflow 启动后继续冻结模型 ID、Transport、非敏感参数和目录版本；不冻结 API Key。
- 资料库管家可以复用 Zen 连接，但保留独立默认模型。
- 当前模型下线后不静默切换，显示可恢复的明确错误和重新选择入口。
- 未知/待适配模型可以展示，但默认禁用。

## 8. 数据迁移与兼容

- 现有设置文件无需用户手动迁移。
- 现有 Provider Profile ID 保持稳定。
- 旧 DeepSeek 配置继续工作。
- 历史 Workflow 快照继续可读。
- 老版本中不存在的目录缓存损坏或缺失时安全重建。
- 不因目录刷新修改项目文件的 `updatedAt`。

## 9. 错误与安全要求

- Zen Host 默认固定为 `opencode.ai`；仅高级自定义 Provider 沿用现有自定义 Endpoint 能力。
- URL 只允许 `https:`；开发测试如需本地 Stub，使用明确测试开关，不放宽生产规则。
- 对目录响应设置大小、模型数量、字符串长度和超时上限。
- 拒绝重复 ID、危险字段、错误 schema、非 JSON、重定向到非允许域名和超大响应。
- 429 保留可读重试提示；402 显示余额/额度问题；401/403 显示认证或权限问题。
- Provider 错误正文只提取受限、安全的消息，不原样回传整段 HTML。

## 10. 自动化测试

至少覆盖：

### 10.1 Provider 与流式桥接

- Chat Completions 正文流。
- DeepSeek reasoning 与正文分离。
- usage、finish reason、空响应。
- 首包超时、空闲超时、取消和客户端断开。
- 401、402、403、429、5xx。
- 上游 SSE 拆包、多个事件同包、坏事件后继续、`[DONE]`。
- 现有 DeepSeek/OpenAI/OpenRouter 回归。

### 10.2 设置和密钥

- Zen 默认 URL 和 Provider 元数据。
- 保存 Key 后公共设置只有 `hasApiKey`。
- 渲染层响应、项目、Workflow、错误与日志中搜索不到测试密钥。
- 普通配置测试必须真实请求后台 Stub，而不是字段检查。

### 10.3 模型目录

- 初次联网、24 小时内命中缓存、过期刷新、手动刷新。
- 离线使用缓存、缓存损坏、远端 schema 错误。
- 新模型、模型消失、免费转付费、协议改变、未知协议。
- `big-pickle` 这类无 `-free` 后缀免费模型。
- 刷新后当前模型保持不变。
- 下线模型的历史引用继续可读。

### 10.4 桌面流程

- 设置 Zen → 测试连接 → 选择模型。
- Writer 切换两个 Zen Chat Completions 模型。
- Workflow 冻结模型并生成。
- 资料库管家复用连接并使用独立模型。
- 待适配模型不可调用。
- 免费隐私确认拒绝后不发送。

## 11. 真实 Provider 验收

如果用户明确提供或授权使用 Zen Key，至少执行：

- DeepSeek V4 Flash：非思考正文流。
- DeepSeek V4 Pro 或 Flash：思考流，验证 reasoning/content 分离。
- 另一个付费 Chat Completions 模型：最小生成。
- 一个当前免费模型：仅发送无敏感测试文本。
- Writer、Workflow、资料库管家各一次最小闭环。

记录模型、Endpoint 类型、HTTP 结果、首包时间、总耗时、usage、finish reason 和结果是否完整。报告不得记录 Key、完整私人正文或账户余额。

没有用户授权或没有 Key 时，不得寻找、读取或导出本机密钥；将真实验收明确标为未执行，不能用 Mock 冒充。

## 12. 必须执行的质量门禁

根据实际改动选择并执行所有相关测试，最低要求：

```text
node tests/provider-stream.js
node tests/settings-service.js
node tests/writer-button-audit.js
node tests/workflow-guided-ui.js
node tests/workflow-creation-guided-ui.js
node tests/workflow-rewrite-guided-ui.js
npm run core-test
npm run desktop-mainline-test
npm run lint
git diff --check
```

新增功能必须有独立测试入口；不能只扩展一个过大的既有测试文件。完成定向测试后运行 `npm test`。若完整测试因明确的既有环境问题失败，必须给出可复现证据，不能写“应该通过”。

构建检查：

```text
npm run pack
npm run packaged-smoke
```

不提交生成安装包，不执行 Git commit/push，除非用户另行明确授权。

## 13. 代码与范围约束

- 优先复用现有 Settings、Provider Stream、AI Task、Workflow Snapshot 和原子存储。
- 新模块职责单一，避免继续扩大已接近体积门禁的界面脚本。
- 不引入大型 Agent 框架。
- 不建立数据库。
- 不改变正文、资料库和 Workflow 的确认写入规则。
- 不修改与 F-13 无关的 Reader、TTS、导入或项目存储功能。
- 不删除用户文件、测试项目、现有验收证据或未提交修改。

## 14. Grok 交付报告

完成后创建：

`docs/GROK46_OPENCODE_ZEN_IMPLEMENTATION_REPORT.md`

报告必须包含：

1. 实现摘要。
2. 架构与关键决策。
3. 修改文件列表。
4. 支持的模型与协议。
5. 未支持的模型与原因。
6. 密钥边界证明。
7. 自动目录和免费模型更新说明。
8. 执行过的全部命令及真实结果。
9. 真实 Provider 验收结果或未执行原因。
10. 已知风险和剩余工作。
11. `git status --short` 与 `git diff --stat` 摘要。

禁止把测试失败隐藏在大量日志里；失败、跳过和未执行必须单独列出。

## 15. Codex 固定评分量表（100 分）

### A. 后台生成桥接与兼容性：25 分

- 10：所有云端 Writer/Workshop/Workflow/资料库调用统一进入后台。
- 5：流式正文、reasoning、usage、finish、取消和超时正确。
- 5：现有 Provider 无回归。
- 5：错误分类与恢复体验完整。

### B. OpenCode Zen 预设：15 分

- 5：Provider、Base URL、真实连接测试正确。
- 5：同一 Key 可供多个模块和模型使用。
- 5：DeepSeek 思考及 Chat Completions 参数正确。

### C. 动态目录与免费模型：20 分

- 5：在线存在性、内置兜底、缓存三者正确合并。
- 5：24 小时自动刷新、手动刷新、离线回退正确。
- 5：免费/付费/隐私状态来源可靠，不靠后缀猜测。
- 5：新增、下线、状态变化不会静默切换模型。

### D. 模型切换与产品体验：15 分

- 5：Writer、Workflow、资料库管家模型选择正确。
- 5：已兼容、待适配、已下线状态清楚。
- 5：免费隐私确认、拒绝不发送、重新选择路径完整。

### E. 安全与迁移：10 分

- 5：API Key 不进入渲染层、项目、快照、日志和错误。
- 3：远端目录 schema、域名和大小边界可靠。
- 2：旧配置、Profile ID、历史 Workflow 和缓存迁移安全。

### F. 测试与证据：10 分

- 5：定向自动化覆盖关键正常/异常路径。
- 3：完整回归、Lint、diff check 结果可信。
- 2：构建/packaged smoke 与真实 Provider 证据完整，或诚实说明未执行原因。

### G. 代码与文档质量：5 分

- 3：模块边界清楚、无明显重复和超大脚本继续膨胀。
- 2：设计、主待办和实施报告同步准确。

### 评分等级

- 95—100：优秀，可直接进入最终真实验收。
- 85—94：良好，少量修正后可合并。
- 70—84：部分完成，存在重要缺口。
- 50—69：方案可见，但不足以安全发布。
- 0—49：核心方向错误或结果不可验证。

### 强制扣分与总分上限

- 关闭 `webSecurity` 或用全局 CORS 绕过：总分最高 40。
- API Key 仍返回渲染层或进入项目/日志：总分最高 40。
- 预设可见但 Writer/Workflow 仍因 CORS 无法生成：总分最高 50。
- 免费状态仅靠 `-free` 后缀判断：C 项最高 8 分。
- 把 Mock 写成真实 Provider 验收：总分最高 50。
- 声称执行测试但没有可核对证据：总分最高 50。
- `npm test` 存在由本次改动造成的失败：总分最高 70。
- 静默替用户切换模型或付费回退：总分最高 60。

## 16. 完成定义

只有同时满足以下条件，任务才可报告为“完成”：

- F-13.1—F-13.3 的强制范围全部实现。
- Zen Chat Completions 在 Writer、Workflow 和资料库管家均可用。
- 动态目录和免费模型更新不是静态演示。
- API Key 安全边界通过自动化搜索与审查。
- 所有相关测试结果真实记录。
- 实施报告完整。
- 未提交、未推送、未包含安装包或密钥。

