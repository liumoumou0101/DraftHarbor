# 独立仓库迁移验收清单

## 来源与仓库

- [ ] 新仓库不是 GitHub Fork
- [ ] Git 历史只有 DraftHarbor 独立提交
- [ ] README、NOTICE 和第三方许可证完整
- [ ] 不存在原 Logo、favicon、旧网页运行时或 Python 服务
- [ ] 不跟踪 `node_modules`、`release`、日志、项目数据和 `.ai_state`
- [ ] 秘密扫描没有发现真实 API Key 或令牌

## 品牌

- [ ] 软件显示“稿湾 DraftHarbor”
- [ ] 包名为 `draftharbor-desktop`
- [ ] `appId` 为 `io.github.liumoumou0101.draftharbor`
- [ ] 自定义协议为 `draftharbor://app`
- [ ] 用户数据目录与旧 Writingway 应用分离
- [ ] 安装包和 Portable 使用新图标

## 核心功能

- [ ] Electron 启动和自定义协议
- [ ] 新建、打开、保存和重新读取项目
- [ ] 章节、场景、正文和资料库
- [ ] AI 生成、改写、取消和历史
- [ ] Provider 配置与 DeepSeek Thinking
- [ ] Prompt、Workshop 和 Workflow
- [ ] 本地备份、恢复副本、场景恢复和替换前保护
- [ ] Markdown、TXT、HTML、EPUB 和项目包导入导出
- [ ] Writingway 1 与旧 JSON 导入
- [ ] Installer、Portable 和 unpacked 启动

## 自动化

- [ ] `npm test`
- [ ] `npm run writer-audit`
- [ ] `npm run backup-test`
- [ ] `node tests/provider-stream.js`
- [ ] `npm run writer-layout-audit`
- [ ] `npm run writer-realistic-visual-audit`
- [ ] `npm run pack && npm run packaged-smoke`
- [ ] `npm run dist`
