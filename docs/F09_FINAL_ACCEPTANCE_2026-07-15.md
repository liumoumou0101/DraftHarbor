# F-09 半自动小说工作流最终验收（2026-07-15）

## 结论

F-09 已达到“功能完成，可交由作者持续人工测试和打磨”的状态。续写、从零创作、大段重写、版本比较、写作区/资料库回流、流式 Provider、恢复机制和可视化画布均已形成完整闭环。第一版明确不包含自主 Agent、循环图、任意脚本节点、后台常驻生成和无人确认写回。

## 真实 Provider 证据

- 续写长篇验收：16,038 字符原文生成 11,879 字符续写并回流，成功调用费用 `$0.037547388`；详见 `REAL_PROVIDER_ACCEPTANCE_2026-07-15.md`。
- 从零创作与大段重写验收：14 次调用、约 5.8 分钟、费用 `$0.033394805`；生成 6,031 字符正文，重写为 4,047 字符并原位回流；详见 `F093_REAL_PROVIDER_ACCEPTANCE_2026-07-15.md`。
- 最终在线冒烟：DeepSeek V4 Flash 非思考流约 0.8 秒；DeepSeek V4 Pro 思考流约 1.8 秒，reasoning 与正文分离返回。无密钥指标位于 `.ai_state/workflow-provider-canary-20260715.json`。

## 发布级压力验收

`npm run workflow-release-acceptance` 使用隔离临时项目验证：

- 36 个场景，共 1,008,279 字符正文。
- 500 条不可变运行事件。
- 5 个产物家族、50 个不可变 Revision。
- 8 个可重新读取的模板历史版本。
- 本机关键读写合计约 2.7 秒；打开百万字符项目约 44 毫秒，读取 500 条事件约 52 毫秒。
- Run Index 保持元数据大小，没有复制项目正文或产物长文本。

性能数字只用于本机回归基线，不作为所有设备的硬性产品承诺；测试中的宽松上限用于发现数量级退化。

## 故障与恢复覆盖

- Provider 首包超时、流中断空闲超时和持续活动续期。
- Provider 空响应稳定返回 `provider_empty_response`。
- HTTP 429 稳定返回 `provider_http_429` 并保留 `Retry-After`。
- 长篇区块中途失败后从未完成区块继续，不重复生成已完成内容。
- 取消、上游 Revision 变更导致过期、目标版本冲突、重复应用幂等。
- 批量写回部分失败后的继续或备份恢复。
- 旧运行只读兼容、v2 独立存储、模板旧版本启动和中断原子写临时文件清理。

## 人工打磨入口

后续作者测试属于产品质量优化，不再阻塞 F-09 完成状态。建议重点记录：

- 不同题材下方向、细纲和审查 Prompt 的偏差。
- 单场目标长度、节奏与情绪参数的默认值是否自然。
- 重写时关键术语、人物动机和跨场衔接的遗漏。
- 超长实际作品中的画布信息密度和历史版本查找效率。

发现问题时优先调整 Prompt、默认值和交互；只有证据表明数据契约无法表达真实需求时才升级 schema。

## 发布回归

下列命令已在 2026-07-15 全部通过：

- `npm test`
- `npm run backup-test`
- `npm run workflow-release-acceptance`
- `npm run workflow-provider-canary`
- `npm run writer-audit`
- `npm run writer-layout-audit`
- `npm run writer-realistic-visual-audit`
- `npm run dist`
- `npm run packaged-smoke`
- `git diff --check`

安装版、便携版、Blockmap、`latest.yml` 和解包目录已重新生成到被 Git 忽略的 `release/` 目录；打包应用冒烟通过。
