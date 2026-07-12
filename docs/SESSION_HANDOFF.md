# DraftHarbor 会话交接

最后更新：2026-07-12。此文件是 DraftHarbor 后续会话的权威起点；以当前仓库与本文件为准，不使用旧 Writingway fork 的历史交接状态。

## 当前发布状态

- 工作区：`D:\soft\DraftHarbor`
- 分支：`main`
- 最新提交：`41f5f91 Release DraftHarbor 1.1.0`
- GitHub：`https://github.com/liumoumou0101/DraftHarbor`
- 最新正式版：`v1.1.0`，已上传安装版、便携版和 blockmap。
- 本地工作区在发布完成时干净，并与 `origin/main` 同步。

## 本轮已完成

- 架构：后台路由/服务、桌面 Shell、HTML 片段与 CSS 层均已拆分；ASAR 已启用。
- 功能：场景/章节摘要、正文选区提取资料卡、资料卡字段级 AI 重写、创作抽卡、项目级与全局避免写法库。
- 数据：资料卡支持 `sourceReferences`，避免写法规则支持项目与全局保存。
- 进度记录：`docs/FEATURE_TODO.md` 是功能任务的唯一状态表，F-01 至 F-05 均已完成。

## 关键边界

- `desktop/local-server.js` 只作组合入口；产品 API 路由在 `desktop/controllers/`。
- 桌面界面由 `desktop/fragments/`、`src/desktop/shell/`、`src/styles/desktop/` 组成；不要恢复单体 HTML/Shell/CSS。
- AI 改写、抽取和抽卡必须先预览、后确认写入。
- 项目级避免写法规则随项目快照保存；全局规则在桌面设置中保存。

## 发布前验证基线

```powershell
npm test
npm run backup-test
npm run writer-audit
npm run writer-layout-audit
npm run writer-realistic-visual-audit
npm run dist
npm run packaged-smoke
git diff --check
```

## 建议下一步

1. 对 1.1.0 做真实用户项目与真实 Provider 的手动验收。
2. 再恢复新的产品功能计划前，先在 `FEATURE_TODO.md` 新增任务、依赖和验收标准。
3. 发布新版本时递增版本号、重新构建安装包/便携版，并创建 GitHub Release。

