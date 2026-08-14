# Grok 4.6 实施报告：OpenCode Zen Provider

状态：F-13.1—F-13.3 瘦身版已落地，并补 OpenCode Go 月卡通道  
日期：2026-08-14  
执行模型：Grok 4.6  
未提交、未推送、未包含安装包或密钥

## 1. 实现摘要

稿湾现在有两个 OpenCode 一等 Provider：

- `opencode-zen`：按量，`https://opencode.ai/zen/v1`
- `opencode-go`：月卡，`https://opencode.ai/zen/go/v1`

云端生成统一走 Electron 后台流式桥，API Key 不再返回渲染层。第一阶段只开放 Chat Completions；Responses / Anthropic Messages / Google 原生显示为待适配且不可调用。

模型目录由安装包内置清单与对应通道的 `GET /models` 缓存合并。免费/隐私状态来自内置版本化清单，不靠 `-free` 后缀猜测。目录刷新不改当前模型。

相对 Codex 任务书的裁剪：未建设远端 GitHub 兼容性清单发布管道；未做收藏/最近使用分组商店；未执行 `npm run pack` / `packaged-smoke`。真实 Key 已用于 Go 连通和部分模型对照，不是 Mock。

## 2. 架构与关键决策

- 渲染层云端路径改为 `DraftHarborDesktopGeneration.streamGeneration` → `POST /api/generation/stream`。
- 后台用磁盘上的设置和 Key 重新解析连接；忽略渲染层提交的 `apiKey` 和任意 Zen Endpoint。
- OpenCode Host 固定 `opencode.ai`。Zen 按量 Chat Endpoint 为 `https://opencode.ai/zen/v1/chat/completions`；Go 月卡为 `https://opencode.ai/zen/go/v1/chat/completions`。后台按 Provider ID 强制拼官方地址，不信任渲染层 Endpoint。
- 同一把 Key 可以登录 Zen 与 Go，但订阅不会自动改通道。控制台「套餐用完走余额」由用户在 OpenCode 账户里开关，稿湾不自动回退。
- 本地模型仍走原来的渲染层 `ProviderStream`。
- Playwright UI 测试若设置了 `window.__draftHarborGenerationStub`，客户端仍走该 stub，但会把 `apiKey` 抹掉，避免测试依赖密钥回传到页面。
- 思考能力按模型记录判断，不再用 `provider === 'deepseek'`。Zen 上的 DeepSeek V4 Pro/Flash 会发送 `thinking` 并分离 `reasoning_content`。
- 协议层 mock 响应支持 `write()` 流式 SSE，Electron `draftharbor://` 与 HTTP 测试服务器都能增量转发。
- 免费/可能采集模型首次发送前需确认；拒绝不发送。用户可隐藏此类模型。

## 3. 修改文件列表

新增：

- `desktop/services/generation-bridge-service.js`
- `desktop/services/model-catalog-service.js`
- `src/core/generation/desktop-generation-client.js`
- `tests/generation-bridge.js`
- `tests/model-catalog-service.js`
- `tests/opencode-zen-real-provider-acceptance.js`（需显式环境变量 Key，未并入 `npm test`）
- `docs/GROK46_OPENCODE_ZEN_IMPLEMENTATION_REPORT.md`

已删除（会自动读项目数据目录 Key 打真实上游）：`tests/opencode-zen-live-retest.js`、`tests/opencode-zen-endpoint-probe.js`、`tests/opencode-go-live-retest.js`、`tests/opencode-go-fiction-compare.js`

主要修改：

- `src/core/settings/model-catalog.js`、`settings-schema.js`
- `src/core/generation/provider-stream.js`
- `desktop/controllers/generation-controller.js`、`settings-controller.js`
- `desktop/services/settings-service.js`
- `desktop/protocol/http-test-adapter.js`、`protocol-router.js`
- `desktop/fragments/settings.html`、`src/desktop/shell/settings.js`
- Writer / Workshop / Workflow 生成入口改为后台客户端
- `tests/settings-service.js`、`tests/provider-stream.js`、`tests/writer-button-audit.js`
- `package.json`、`.eslintrc.js`、`docs/FEATURE_TODO.md`、`docs/OPENCODE_ZEN_PROVIDER_DESIGN.md`

## 4. 支持的模型与协议

### 4.1 OpenCode Zen（按量）

Transport：`chat-completions`（`POST /zen/v1/chat/completions`）

内置已兼容（可调用，具体是否在线以 `/models` 缓存为准）：

| 模型 ID | 思考 | 价格类 | 隐私 |
| --- | --- | --- | --- |
| deepseek-v4-pro | 是 | paid | standard |
| deepseek-v4-flash | 是 | paid | standard |
| minimax-m3 | 否 | paid | standard |
| minimax-m2.7 | 否 | paid | standard |
| glm-5.2 | 否 | paid | standard |
| glm-5.1 | 否 | paid | standard |
| kimi-k3 | 否 | paid | standard |
| kimi-k2.7-code | 否 | paid | standard |
| kimi-k2.6 | 否 | paid | standard |
| big-pickle | 否 | free | may-train |
| deepseek-v4-flash-free | 是 | free | may-train |
| mimo-v2.5-free | 否 | free | may-train |

未知在线 ID 进入「待确认」，默认禁用，不会标成免费。

### 4.2 OpenCode Go（月卡）

Transport：`chat-completions`（`POST /zen/go/v1/chat/completions`）

内置已兼容：

| 模型 ID | 思考 | 说明 |
| --- | --- | --- |
| glm-5.2 | 否 | 真实验收：连接与正文流可用 |
| glm-5.3 | 否 | Chat Completions |
| glm-5.1 | 否 | Chat Completions |
| kimi-k2.6 | 否 | 真实验收：最小生成 `ZEN_OK` 通过 |
| kimi-k3 | 否 | 内置有记录；一次实打返回 HTTP 400，ID 待核对 |
| kimi-k2.7-code | 否 | 偏代码，不作为写作默认 |
| deepseek-v4-flash / pro | 是 | Go 上可能需在控制台开启中国区托管 |

GPT / Grok 等 Responses 模型在 Go 目录中可见但禁用。

## 5. 未支持的模型与原因

| 类型 | 状态 | 原因 |
| --- | --- | --- |
| GPT / Grok / Muse 等 `/responses` | 可见，禁用 | 第一阶段未做 Responses 适配器 |
| Claude / Qwen 等 `/messages` | 可见，禁用 | 第一阶段未做 Anthropic Messages |
| Gemini 等 Google 原生 | 可见，禁用 | 第一阶段未做 Google 原生 |
| F-13.4 其余协议 | 未开始 | 需单独验收后再开放 |

## 5.1 Codex 审查后的安全修复（同日）

Codex 复现了密钥串用和错误回传后，已做这些修复：

1. **不再信任客户端 `snapshot.provider/endpoint/mode/organization`。** 磁盘 Key 只跟磁盘上的 Provider 走。客户端把 `snapshot.provider` 改成 `opencode-zen` 不能把 DeepSeek Key 带到 Zen。
2. **401/403/429 不再回传上游原文。** `publicProviderError` 分类前后都脱敏；含 `API key …` 的消息不会回到渲染层。
3. **模型目录 Provider 白名单。** 只允许 `opencode-zen` / `opencode-go`；`../../outside` 会被拒绝。
4. **OpenCode 未知模型后台拒绝。** `entry === null` 或 `isModelSelectable` 为假时不能打上游。待适配只是界面禁用不够，后台也拦。
5. **24 小时过期后，设置加载会非阻塞调用刷新接口**，并在成功后更新界面目录。
6. **Workflow 冻结改走 `projectId` + `runId`。** 启动时后台按磁盘 Profile 盖戳 `provider/mode`，丢掉客户端 Endpoint；生成时只认这份磁盘快照。Profile 被删或 Provider 被改成另一家，后台拒绝发送，不会把当前 Key 带到冻结的另一家接口。通用生成包装器不再自动读取当前选中的 Workflow；只有 Workflow 调用点显式传入 `projectId/runId`。请求带了 `runId` 但磁盘上没有对应冻结策略时直接失败。
7. **删除会自动读取项目数据目录 Key 并发起真实请求的一次性脚本。** 环境变量版 `tests/opencode-zen-real-provider-acceptance.js` 保留。
8. **空白 Key 不再跟着 Provider/Endpoint 搬家。** 只有 Provider 与规范化 Endpoint 都没变，或 Zen↔Go 同属 `opencode.ai` 时才保留已存 Key。其它变化会清掉旧 Key，避免 DeepSeek Key 被发到任意自定义地址。

## 6. 密钥边界证明

- `GET/POST /api/settings` 的 `runtimeProvider` / `runtimeProviderProfiles` 只保留 `hasApiKey`，`apiKey` 为空。
- `tests/settings-service.js` 断言响应 JSON 不含测试密钥 `ds-secret-1`。
- `tests/generation-bridge.js` 向后台提交伪造 Key 和恶意 Zen Endpoint；实际上游配置仍使用磁盘 Key 与官方 `opencode.ai` Endpoint；SSE 事件不含密钥。
- `publicProviderError` 会丢掉疑似密钥、Authorization 和 HTML。
- Writer 按钮审计改为断言渲染层配置没有 API Key。
- 项目、Workflow 快照本来就不存 Key；本次未改变写入规则。

## 7. 自动目录和免费模型更新说明

- 内置清单记录协议、免费、隐私、思考和适配状态。
- `big-pickle` 没有 `-free` 后缀，仍标为 free + may-train。
- 缓存文件：`{dataRoot}/cache/opencode-zen-models.json` 与 `opencode-go-models.json`，TTL 24 小时，原子写入。
- `GET /api/settings` 若目录过期会在后台非阻塞刷新；设置页加载后也会再打一次刷新接口。手动按钮仍可强制刷新。失败保留上次缓存和内置清单。
- 并发刷新互斥。
- 刷新只改可选项和状态徽标，不改当前模型字段。
- 未实现远端 GitHub 兼容性清单或网页解析。

## 8. 执行过的全部命令及真实结果

| 命令 | 结果 |
| --- | --- |
| `node tests/provider-stream.js` | 通过，含 Zen 思考流 |
| `node tests/settings-service.js` | 通过 |
| `node tests/model-catalog-service.js` | 通过 |
| `node tests/generation-bridge.js` | 通过 |
| `node tests/writer-button-audit.js` | 通过 |
| `node tests/workflow-guided-ui.js` | 通过 |
| `node tests/workflow-creation-guided-ui.js` | 通过 |
| `node tests/workflow-rewrite-guided-ui.js` | 通过 |
| `npm run core-test` | 通过 |
| `npm run desktop-mainline-test` | 通过（中间一次 `desktop-reader-epub` 文件名断言超时，重跑通过，属既有偶发） |
| `npm run lint` | 通过，`--max-warnings 0` |
| `git diff --check` | 通过（仅有 Git LF/CRLF 提示，无空白错误） |
| `npm test` | 通过（lint + smoke + unit + desktop-mainline） |
| `node tests/opencode-zen-live-retest.js` | Zen `/v1`：免费模型 429；Flash/GLM 被判 401（实为余额不足） |
| `node tests/opencode-zen-endpoint-probe.js` | 对照通道：`/zen/v1` Flash=`CreditsError`；`/zen/go/v1` GLM 5.2 与 Kimi K2.6 为 HTTP 200 |
| `node tests/opencode-go-live-retest.js` | Go 预设连接测试 HTTP 200；Kimi K2.6 流式完整；GLM 5.2 流式一次因输出额度截断无正文 |
| `node tests/opencode-go-fiction-compare.js` | 见第 9 节。未并入 `npm test` |
| `npm run pack` | 未执行 |
| `npm run packaged-smoke` | 未执行 |

## 9. 真实 Provider 验收结果

用户之后在稿湾保存了 OpenCode 档案并完成 Go 订阅，授权用该档案做连通测试。报告不记录 Key、完整正文或账户余额。

### 9.1 通道对照

| 通道 | 模型 | HTTP / 类型 | 含义 |
| --- | --- | --- | --- |
| Zen `/zen/v1` | big-pickle | 429 `FreeUsageLimitError` | Key 有效，免费额度限流 |
| Zen `/zen/v1` | deepseek-v4-flash | 401 `CreditsError` Insufficient balance | Zen 按量余额不足。早期被误判成认证失败，已改为余额文案 |
| Go `/zen/go/v1` | glm-5.2 | 200 | 月卡可用 |
| Go `/zen/go/v1` | kimi-k2.6 | 200 | 月卡可用，最小生成完整 |
| Go `/zen/go/v1` | deepseek-v4-flash | 403 `RegionError` | 中国区托管需在 OpenCode 控制台单独开启 |

结论：Go 订阅已生效，必须打 `/zen/go/v1`。稿湾因此新增 `opencode-go`。

### 9.2 连接测试修正

- 默认 AI 连接仍是 DeepSeek 时，底部「测试连接」测的是 DeepSeek，不是 `opencode` 档案。
- 档案未选模型时，旧逻辑会发送 `model-check`。现改为 Zen 用 `big-pickle`、Go 用 `glm-5.2`。
- 失败时展示上游安全错误原文和 HTTP 状态。
- `CreditsError` / Insufficient balance 不再显示成「请检查 API Key」。

### 9.3 Writer 空白项目输入 ZEN_OK 被拒

写作页「生成」会拼完整续写模板，并带上已启用的用户全局指令。`ZEN_OK` 被当成 BEAT。Go 上的 GLM/Kimi 把「无审查」全局指令读成越狱后拒绝。思考气泡有高度裁切。这是提示词与模型策略问题，不是通道没通。

### 9.4 Go 写作对照（初测，之后再测）

无越狱词。普通续写 + 直接成年亲密描写。不保存全文。指标见 `.ai_state/opencode-go-fiction-compare-20260814.json`。

GLM 5.2、MiniMax M3、MiMo V2.5 两道题都写了。DeepSeek V4 Flash / GLM 5.3 在思考占满额度时无正文。Kimi K2.6 两次只出思考。Kimi K3 返回 HTTP 400。更完整的写作质量对照按用户要求留到之后。

## 10. 已知风险和剩余工作

- 未做 `pack` / 安装版冒烟；发布前仍需跑。
- 已有 Zen 档案不会自动改成 Go。用户需在模型配置里把 Provider 改成 OpenCode Go，Key 留空保存。
- 稿湾不实现「Go 用尽自动改打 Zen 余额」。那是 OpenCode 控制台选项。
- MiniMax 会把 `<think>` 写进 content；需要单独清洗，否则写作区会看到思考原文。
- Kimi / GLM 在思考开启或输出额度偏低时，可能只出 reasoning、正文为空。
- DeepSeek 在 Go 上可能有地区托管开关。
- 内置模型 ID 可能与上游不完全一致（如 kimi-k3 实打 400）。
- 远端版本化兼容清单和 GitHub Action 仍未做。
- F-13.4 其他协议未开始。
- Playwright 测试仍可通过渲染层 stub 绕过后台桥；产品路径（无 stub）走后台。
- 更完整的多模型写作质量对照未完成，用户要求之后再测。

## 11. `git status --short` 与 `git diff --stat` 摘要

开始前（属于用户、未覆盖）：

```text
 M FEATURE_TODO.md
?? GROK46_OPENCODE_ZEN_IMPLEMENTATION_TASK.md
?? OPENCODE_ZEN_PROVIDER_DESIGN.md
?? OPTIONAL_IMPROVEMENTS.md
```

完成后工作区另有本次实现改动。已跟踪文件约 `26 files changed, 997 insertions(+), 142 deletions(-)`。

新增未跟踪实现文件：

- `desktop/services/generation-bridge-service.js`
- `desktop/services/model-catalog-service.js`
- `src/core/generation/desktop-generation-client.js`
- `tests/generation-bridge.js`
- `tests/model-catalog-service.js`
- `tests/opencode-zen-real-provider-acceptance.js`
- `docs/GROK46_OPENCODE_ZEN_IMPLEMENTATION_REPORT.md`

用户原有未跟踪文档仍在，未删除。后续又增加 `opencode-go` 预设及相关设置/目录改动，未单独再跑 `git diff --stat`。

## 失败、跳过和未执行

- 失败：无（`npm test` 退出码 0）。
- 偶发后重跑通过：`tests/desktop-reader-epub.js` 一次文件名断言超时，随后通过。
- 跳过 / 未执行：
  - 任务书里 Writer / Workflow / 资料库管家各一次完整产品闭环（仅做了后台桥与部分模型手测）
  - 更完整的多模型写作质量对照
  - `npm run pack`
  - `npm run packaged-smoke`
  - F-13.4 其他协议
  - 远端兼容性清单发布管道
