# F-10 Reader 最终发布验收

- 日期：2026-07-16
- 版本：DraftHarbor 1.2.0
- 环境：Windows 11，AMD Ryzen 5 7535H，15.2 GiB RAM，Node v24.11.1，Electron 42.4.1，win32-x64
- 结论：F-10.1—F-10.4D 全部退出条件通过，F-10 可以关闭

## 四来源 × 三目标矩阵

`npm run reader-release-acceptance` 使用隔离临时书库创建真实项目投影、TXT、Markdown 和粘贴文档，再分别形成写作、资料库和工作流 Envelope。12 个组合全部完成预览、未确认拒绝、确认应用、重复应用幂等和 consumed 生命周期验证。

| 来源 | 写作 | 资料库 | 工作流 |
| --- | --- | --- | --- |
| 项目场景 | 通过 | 通过 | 通过（`writer-source@1`） |
| TXT | 通过 | 通过 | 通过（`reader-source@1`） |
| Markdown | 通过 | 通过 | 通过（`reader-source@1`） |
| 粘贴文本 | 通过 | 通过 | 通过（`reader-source@1`） |

同一测试额外创建 120 个 Envelope，重复物化其中 60 个；列表数量、生命周期和轻量摘要边界均正确，耗时 2,167.32 ms。共扫描临时书库 459 个文件，没有发现注入的 API Key 哨兵或导入源绝对路径。项目写入和资料库写入合计创建 8 个写前备份。

## 百万字符性能

确定性夹具包含 1,000,311 个 UTF-16 字符、100 章和 1,000 个正文块。预热 1 次后测量 5 次。

| 操作 | 中位数 | p95 | p95 预算 | 结果 |
| --- | ---: | ---: | ---: | --- |
| 解析并形成预览 | 28.39 ms | 33.22 ms | 8,000 ms | 通过 |
| 原子确认入库 | 403.61 ms | 435.04 ms | 7,000 ms | 通过 |
| 百万字符快照写入 | 152.99 ms | 173.16 ms | 7,000 ms | 通过 |
| 百万字符快照重读 | 65.05 ms | 74.35 ms | 1,200 ms | 通过 |
| 单章按需读取 | 1.21 ms | 1.32 ms | 1,200 ms | 通过 |
| 完整字面搜索 | 1.88 ms | 2.12 ms | 1,500 ms | 通过 |
| 完整临时分页 | 0.70 ms | 1.20 ms | 1,500 ms | 通过 |

分页产生 2,518 个临时页面定义；观测堆增长峰值 69.27 MiB，低于 300 MiB 上限。

## 视觉、恢复与安全

- 1280×800 的 100%/125%/150%/200% 等效视口及 1366×768、1920×1080 均无溢出、抽屉越界或不可达控件。
- 深色双页、纸张单页、护眼流式和窄屏自动布局无页面裁切，正文对比度 11.81—13.90，且没有远程资源请求。
- Reader Store、协议、迁移、路径遍历拒绝、摘要不含正文、原子写入、版本冲突、备份恢复、目标独立生命周期和幂等账本均通过自动化回归。
- 真实 DeepSeek 资料库闭环已在 F-10.4B 完成 9 个分块请求、8 张候选和备份恢复；三轮估算费用 `$0.012105`，详见 `F104B_READER_COMPENDIUM_REAL_PROVIDER_ACCEPTANCE_2026-07-16.md`。

## 完整回归与发布产物

通过命令：

- `npm run reader-release-acceptance`
- `npm run reader-performance-acceptance`
- `npm run reader-layout-audit`
- `npm run reader-realistic-visual-audit`
- `npm run reader-storage-test`
- `npm run reader-protocol-test`
- `npm run reader-shell-test`
- `npm test`
- `npm run backup-test`
- `npm run workflow-release-acceptance`
- `npm run dist`
- `npm run packaged-smoke`
- `npm run installed-smoke`

NSIS 安装包经过实际静默安装到隔离临时目录、启动、项目创建/保存/重开、备份创建和卸载；unpacked 产物也通过同一应用冒烟。

| 产物 | SHA-256 |
| --- | --- |
| `DraftHarbor-Setup-1.2.0.exe` | `480AC0BEE12EDB08CFFB862FEFDACE17F49454FDFDBA74D1940215CCFE9B8306` |
| `DraftHarbor-1.2.0.exe` | `0E2F9401C7FF59A9D2FAB574F93143EF4393A2CA41C5C862C68C84352C595B1A` |

## 范围确认

首版没有引入 EPUB/DOCX/PDF/OCR 解析、字体文件管理、Reader 内 AI 工作台、curl 翻页或实时同步。AI 仍由资料库或工作流目标模块拥有；Reader 只负责确定来源和创建可验证快照。
