# 稿湾 DraftHarbor 1.2.0

`v1.2.0` 是稿湾第一阶段功能开发完成后的首个功能完整版本。项目、写作、资料库、Provider、备份恢复、半自动小说工作流和沉浸阅读器已经形成完整桌面闭环。此版本之后，当前主线将优先进行作者人工测试、缺陷修复、默认值调整和交互打磨。

## 主要更新

### 半自动小说工作流

- 支持续写现有作品、从零创作和大段重写三条正式流程。
- 支持来源快照、方向选择、细纲确认、分场生成、失败恢复、替代版本、差异比较和人工审查。
- 新增步骤视图与工作流画布；两种视图读取同一版本化运行定义。
- 正文、策划产物和资料建议均先预览，明确确认后才写回，并保留备份、来源链和幂等账本。
- 真实 DeepSeek 长篇闭环、百万字符项目、500 事件和安装版均已通过验收。

### 沉浸阅读器

- 支持项目正文、TXT、Markdown 和粘贴文本的本地书库阅读。
- 支持流式、单页、双页和自动布局，以及深色、纸张和护眼主题。
- 支持章节目录、搜索、书签、可拖动进度、稳定阅读位置和键鼠操作。
- 支持从选区、场景、章节、多章或全文创建不可变 Reader 快照。
- Reader 来源可安全转交写作区、资料库和工作流；目标模块负责预览、确认、备份、写入和恢复。

### 写作、资料库与 Provider

- 扩展正文续写、选区重写、重生成、Prompt 模板、上下文选择和避免写法。
- 资料库支持结构化人物字段、抽卡、字段重写、正文/Reader 提取、逐卡审核和来源证据。
- Provider 流支持 DeepSeek Thinking 与正文分离、活动续期超时、首响应/空响应/限流诊断和 usage 记录。
- AI Task 与 Workflow 历史保留模型、任务、来源和费用信息，但不保存 API Key。

### 存储、安全与恢复

- Reader Document、Transfer Envelope 和 Workflow v2 Artifact 使用版本化、摘要校验和原子写入。
- 项目写入、资料库批量保存和工作流回流均具备确认、版本冲突、写前备份和幂等保护。
- 路径遍历、正文摘要泄漏、API Key 隔离、旧格式迁移和备份恢复已进入自动化测试。

## 验收摘要

- 完整自动化：`npm test`、Reader 全套、备份、Workflow 发布验收通过。
- Reader 四来源 × 三目标共 12 条闭环通过，另完成 120 Envelope 压力测试。
- 百万字符 Reader 快照写入 p95 173.16 ms、重读 p95 74.35 ms。
- 多视口与四种真实阅读布局无裁切、横向溢出或远程资源请求。
- NSIS 安装版和 Portable 版均完成构建；unpacked 与实际安装/启动/持久化/备份/卸载冒烟通过。

详细证据见：

- `docs/F09_FINAL_ACCEPTANCE_2026-07-15.md`
- `docs/F10_FINAL_ACCEPTANCE_2026-07-16.md`
- `docs/REAL_PROVIDER_ACCEPTANCE_2026-07-15.md`
- `docs/F104B_READER_COMPENDIUM_REAL_PROVIDER_ACCEPTANCE_2026-07-16.md`

## 下载说明

- `DraftHarbor-Setup-1.2.0.exe`：Windows 安装版。
- `DraftHarbor-1.2.0.exe`：免安装便携版。
- `DraftHarbor-Setup-1.2.0.exe.blockmap` 与 `latest.yml`：自动更新元数据。

## SHA-256

| 文件 | SHA-256 |
| --- | --- |
| `DraftHarbor-Setup-1.2.0.exe` | `480AC0BEE12EDB08CFFB862FEFDACE17F49454FDFDBA74D1940215CCFE9B8306` |
| `DraftHarbor-1.2.0.exe` | `0E2F9401C7FF59A9D2FAB574F93143EF4393A2CA41C5C862C68C84352C595B1A` |
| `DraftHarbor-Setup-1.2.0.exe.blockmap` | `884CC2394EF75F1B2FF11CC41D85291FE7A8CA8CA5CCFCA328C4D8A54642F740` |
| `latest.yml` | `D4B61985E3F345D8D3D6385F9167EF5C92A998C2D4C204DE2996E8DF36E6F59A` |

升级前建议保留重要项目备份。现有项目和旧版导入格式继续兼容；首次打开重要项目后，建议检查章节、场景、资料卡和最近备份是否正常。
