# Contributing to DraftHarbor

感谢你愿意帮助改进稿湾。

## 开始之前

- 新功能和较大改动请先创建 Issue 说明目标、用户流程和数据影响。
- 不要提交作品正文、API Key、Provider 配置、本机绝对路径、日志、安装包或测试生成数据。
- 不要从许可证不明确的项目复制代码、Prompt、图标、截图或文案。
- 引入第三方代码或资源时，请在 PR 中说明来源和许可证，并更新 `THIRD_PARTY_NOTICES.md`。

## 本地验证

```powershell
npm install
npm test
npm run writer-audit
npm run backup-test
```

涉及界面布局时还应运行：

```powershell
npm run writer-layout-audit
npm run writer-realistic-visual-audit
```

## 许可证

提交贡献即表示你有权提交这些内容，并同意该贡献以 GPL-3.0-or-later 用于稿湾。你仍保留自己贡献的版权。
