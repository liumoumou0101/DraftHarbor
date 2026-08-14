# OpenCode Zen Provider 与动态模型目录设计

状态：规划完成，未开始实施  
日期：2026-08-14  
主待办：F-13

## 1. 决策摘要

稿湾新增一等 Provider `opencode-zen`。用户只需保存一次 Zen API Key，应用负责 Endpoint、协议和模型目录，不要求用户为同一个 Zen 连接反复填写完整 URL。

第一阶段只开放已经由稿湾适配和验收的 OpenAI Chat Completions 模型；Responses、Anthropic Messages 和 Google 原生模型可以出现在目录中，但在对应适配器完成前标记为“尚未兼容”，不能制造“可以选择但调用必然失败”的假象。

模型目录支持后台定期更新和手动“更新模型列表”。目录更新只改变可选项与状态，绝不自动更换默认模型、项目当前模型或历史工作流快照。

## 2. 当前证据与约束

- OpenCode Zen 是多协议网关，不是单一 OpenAI-compatible Endpoint。官方当前分别使用：
  - Chat Completions：`/chat/completions`
  - OpenAI Responses：`/responses`
  - Anthropic Messages：`/messages`
  - Google 原生：`/models/{model}`
- Zen 的 `GET https://opencode.ai/zen/v1/models` 当前只返回模型 ID、创建时间和所有者，不返回价格、免费状态、隐私等级或所需协议。
- 2026-08-14 实测 Zen 的 Chat Completions Endpoint 对带 Authorization 的跨域预检返回 HTTP 404，且没有 CORS 响应头。
- 稿湾当前写作区、Workshop 和大部分工作流在 Electron 渲染层直接请求 Provider，因此不能依赖 Zen 修复 CORS；云端生成必须迁移到 Electron 后台。
- 稿湾已有 Provider 配置组、写作区模型覆盖、工作流专用配置和冻结快照；这些能力可以复用，但当前模型目录和思考能力按 Provider/模型硬编码，不能直接表达 Zen 的异构协议。

官方资料：

- [OpenCode Zen 模型、Endpoint、价格与隐私](https://opencode.ai/docs/zen)
- [OpenCode Zen 在线模型目录](https://opencode.ai/zen/v1/models)

## 3. 产品目标

1. 设置页可直接选择“OpenCode Zen”，自动填入只读基础地址 `https://opencode.ai/zen/v1`。
2. 一组 Zen Key 可以服务默认写作、Writer 临时切换、Workflow 专用配置和资料库管家；各模块仍可选择不同默认模型。
3. 支持在线刷新模型目录，并清楚区分免费、付费、未知价格、已适配、待适配、已下线。
4. 免费模型变化后无需重新安装应用即可更新列表。
5. API Key 只在 Electron 后台读取和使用，不返回渲染层，不进入项目、Prompt、任务历史或日志。
6. 任何远端目录变化都不能静默改变用户正在使用的模型。

## 4. 非目标

- 第一阶段不承诺一次支持 Zen 全部模型协议。
- 不抓取或解析 OpenCode 网页作为运行时关键依赖。
- 不根据“模型名看起来便宜”自动路由或替用户消费额度。
- 不自动回退到另一个付费模型。
- 不把估算价格宣传为账单精确值。

## 5. Provider 配置模型

### 5.1 连接与模型分离

现有配置组同时保存 Provider、Endpoint、Key 和默认模型。Zen 接入后保留兼容字段，但逻辑上拆成：

```text
ProviderConnection
  id
  provider = opencode-zen
  baseUrl = https://opencode.ai/zen/v1
  credentialRef
  defaultModelId
  catalogPolicy = remote-with-cache

ModelCapability
  id
  transport
  endpointTemplate
  thinking
  samplingParameters
  availability
  pricingClass
  privacyClass
  compatibility
```

用户界面仍可称为“模型配置”，不要求用户理解这两个内部对象。

### 5.2 Endpoint 解析

Endpoint 由后台根据模型能力生成，普通用户不编辑：

| Transport | Endpoint | 第一阶段 |
| --- | --- | --- |
| `chat-completions` | `/chat/completions` | 支持 |
| `responses` | `/responses` | 后续 |
| `anthropic-messages` | `/messages` | 后续 |
| `google-generative` | `/models/{model}:streamGenerateContent` 等原生动作 | 后续 |

高级设置可以覆盖 `baseUrl`，但不能从在线目录下发任意 Endpoint，避免远端数据把密钥导向其他域名。

## 6. 项目与模型切换兼容性

稿湾现有“配置组 + 模型覆盖”思路可以继续使用，但要从静态 Provider 模型数组升级为能力驱动目录。

- Writer：可以在同一 Zen 连接下切换所有“已适配且当前可用”的模型。
- Workflow：启动前选择模型；运行开始后继续冻结连接 ID、模型 ID、Transport 和非敏感参数。目录更新不修改旧运行。
- 资料库管家：可以复用同一 Zen 连接，但保留独立默认模型，避免跟随正文写作模型变化。
- 项目只保存连接引用和模型 ID，不保存 API Key、在线价格或整个远端目录。
- 已选模型从在线列表消失时，保留其 ID并标记“当前不可用”；要求用户明确选择替代模型，不能静默切换。
- 新发现但未知协议或未验收的模型显示在“待适配”分组，默认禁用。

因此，项目本身确实可以继续切换各种模型，但“能出现在目录里”不等于“协议已经兼容”。选择资格必须由 `availability && compatibility` 共同决定。

## 7. 动态模型目录

### 7.1 三层来源

模型目录由三层合并：

1. **内置兜底目录**：随安装包发布，保证离线可配置已知模型。
2. **Zen 在线可用目录**：后台请求 `/models`，确认模型当前是否存在。
3. **稿湾兼容性清单**：可独立于安装包更新的只读 JSON，记录协议、免费状态、隐私提示和稿湾适配状态。

在线 `/models` 只作为“存在性”证据，不能单独推断免费或兼容。

### 7.2 免费模型识别

不能只按 `-free` 后缀判断，因为存在 `big-pickle` 之类没有后缀的免费模型，也不能保证带 `-free` 的 ID 永久免费。

建议维护：

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-08-14T00:00:00Z",
  "source": "https://opencode.ai/docs/zen",
  "models": {
    "deepseek-v4-flash-free": {
      "pricingClass": "free",
      "transport": "chat-completions",
      "privacyClass": "may-train",
      "compatibility": "supported"
    }
  }
}
```

该清单只允许描述已知 Zen 模型，不能携带 API Key、任意请求头、脚本或非 Zen 域名。远端清单校验失败时继续使用上次成功缓存和安装包兜底。

### 7.3 更新策略

- 应用启动后若缓存超过 24 小时，在后台非阻塞刷新一次。
- 打开模型设置时显示“上次更新”；超过 24 小时提示可刷新。
- 提供“更新模型列表”按钮，立即从后台刷新并展示新增、下线和状态变化数量。
- 网络失败不清空已有目录；显示缓存时间和失败原因。
- 目录保存到应用数据目录，不写入项目。
- 更新成功后只刷新下拉选项，不修改当前选择。
- 对免费状态从 `free` 变成 `paid/unknown` 的模型给出醒目提示；下次调用前再次确认，但不删除历史记录。

### 7.4 清单维护方式

首选在 DraftHarbor GitHub 仓库发布版本化 Provider Catalog JSON，并通过定时任务对照 Zen `/models` 与官方文档生成候选变更；协议/免费/隐私变化经规则校验后发布。应用不直接解析网页。

如果暂时不建设自动发布任务，第一版仍可做到：在线更新模型存在性，免费元数据使用内置清单；新增未知模型进入“待确认”而不是被错误标成免费。

## 8. 设置与选择界面

### 8.1 OpenCode Zen 预设

选择 Provider 后显示：

- Provider：OpenCode Zen
- Base URL：`https://opencode.ai/zen/v1`，默认只读
- API Key
- 默认模型
- “测试连接并获取模型”
- “更新模型列表”
- 上次更新时间与目录来源

### 8.2 模型分组

模型选择器按以下顺序分组：

1. 已收藏/最近使用
2. 免费且已兼容
3. 低成本且已兼容
4. 其他已兼容
5. 待适配或状态未知（禁用）
6. 已下线（仅在当前配置或历史记录引用时显示）

每个选项可显示：`免费`、`可能用于改进模型`、`付费`、`协议待适配`、`已下线` 等徽标。免费模型首次用于项目正文前需要一次隐私确认，并允许用户隐藏所有可能收集内容的模型。

## 9. 后台生成桥接

这是 Zen 预设上线的前置条件，不属于可选增强。

- 渲染层提交任务、连接引用、模型 ID 和生成参数到本地应用 API。
- Electron 后台读取密钥、解析 Transport、调用 Zen，并把统一事件流转发给界面。
- 统一事件：`reasoning`、`content`、`usage`、`finish`、`error`。
- 取消操作从界面传到后台 `AbortController`。
- 后台维护现有首包/空闲超时语义。
- 错误映射至少区分：认证失败、余额不足、频率限制、免费额度用尽、模型不可用、协议未适配、空响应和流中断。

不得通过关闭 Electron `webSecurity` 规避 CORS。

## 10. 分阶段实施

### F-13.1 后台安全生成桥接

- 将现有云端生成请求从渲染层移到后台。
- 保持 Writer、Workshop、Workflow 和资料库管家的统一流式事件。
- API Key 不再进入渲染层运行时配置。

### F-13.2 Zen 预设与 Chat Completions

- 新增 `opencode-zen` Provider。
- 支持 Zen Chat Completions 模型。
- 首批建议验收：DeepSeek V4 Flash/Pro、MiniMax M3、GLM 5.2、Kimi K2.6，以及当时至少两个免费模型。
- DeepSeek 思考能力按模型声明处理，不再依赖 Provider 名称。

### F-13.3 动态目录与免费模型更新

- `/models` 在线刷新、24 小时缓存、手动更新按钮。
- 版本化兼容性清单、免费/隐私徽标、新增/下线差异。
- 当前选择稳定与模型下线提示。

### F-13.4 其他协议

- 依次实现 Responses、Anthropic Messages、Google 原生适配器。
- 每个适配器单独通过流式、取消、usage、reasoning、工具无关纯文本和结构化 JSON 验收后才开放相应模型。

## 11. 验收标准

- 无密钥时能刷新公共模型 ID，但不能发起生成。
- 有效 Zen Key 可从设置页完成真实最小连接测试。
- Writer、Workshop、Workflow、资料库管家都通过后台请求，不受 Zen CORS 影响。
- 同一连接下切换两个 Chat Completions 模型无需重复输入 Key。
- 自动刷新和手动刷新均不会改变当前模型。
- 新增模型、模型消失、免费变付费、未知协议、缓存损坏和离线启动都有自动化覆盖。
- 免费模型首次发送正文前显示数据使用风险；用户拒绝后不发送。
- API Key 不出现在公共设置、渲染层、项目文件、工作流快照、错误详情和测试产物。
- 真实 Provider 验收记录耗时、输入/输出 usage、finish reason、空响应、取消和错误分类；不把本地估算冒充账单。
- 安装版与便携版均通过真实连接和流式生成冒烟。

## 12. 补充：OpenCode Go 月卡通道（2026-08-14）

同日真实连通表明：用户购买的 Go 订阅走 `https://opencode.ai/zen/go/v1`，不是 Zen 按量的 `/zen/v1`。稿湾新增一等 Provider `opencode-go`：

- 默认 Base URL：`https://opencode.ai/zen/go/v1`
- Chat Completions：`/chat/completions`
- Host 仍固定 `opencode.ai`，密钥边界与后台桥接与 Zen 相同
- 第一阶段同样只开放 Chat Completions；Responses 模型在 Go 目录里标为待适配
- 控制台「套餐用完走余额」是上游账户选项；稿湾不自动把失败请求改打 Zen 按量地址

## 13. 推荐默认值

- 默认模型：不随目录自动变化；由用户首次配置时明确选择。
- 目录自动更新：开启，24 小时一次，仅后台拉取元数据。
- 免费模型：显示但不自动选择。
- 可能用于训练/改进的模型：默认显示风险徽标，允许整体隐藏。
- 未适配模型：可见但禁用，避免用户误以为 Zen 模型缺失。

