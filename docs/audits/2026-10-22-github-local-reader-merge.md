# GitHub 更新与本地阅读器合并验证

日期：2026-10-22。用户要求先备份，保留本地阅读器修改，合并远端功能，测试通过后打包并更新启动入口。没有推送、发布或修改 GitHub PR。

## 备份与合并

- 原本地版本：`77359e9661b87ac6c9741c0e43a5e09f7b2bedf6`。
- 远端功能版本：`bf6aa8c7a81cdd6ffdbad6bbc5a486520a250d6e`，包含写作保护与资料库阅读室。
- 合并提交：`cae470d72fb7bc9885a0a693aa56f10aff45e4e6`，两侧历史均保留。
- 备份：`.ai_state/backups/github-merge-20261022-210130/`。完整 Git bundle 已核验，另有原启动脚本和文件哈希清单。
- 备份文件：主目录 17 个未跟踪文件、旧工作树 26 个文件、用户 profile 232 个文件、仓库内项目及资料库 1,251 个文件。个人数据备份没有提交到 Git。
- 阅读器源文件、递归片段加载和阅读器测试入口保留。旧 reader-polish 工作树的功能已经被主线吸收，没有重复移植或覆盖。
- CSS 冲突保留本地工作流样式拆分，避免重复定义。桌面测试合并精确批量添加定位和导入完成等待。

## 测试与适配

- 最终完整 `npm test` 返回 0：lint、smoke、unit、desktop-mainline 全部通过。
- 远端入口原有 125 行超过既有 120 行限制；仅合并相邻标签排版，所有资源、属性和加载顺序保持不变，没有放宽测试限制。
- desktop-library 与 summary-workflow 的旧资料库操作已适配新版真实可见控件；保留保存、导入、改写、策略、筛选和滚动断言，没有 force、固定等待或超时放宽。
- 阅读器配图范围、真实 PNG、查看器、紧凑与连续布局、延迟上传隔离、翻页材质、过渡稳定性及位置恢复通过。
- 独立审查未发现阻塞的合并或测试适配问题。

## 新包

- 程序：`release/merged-20261022/win-unpacked/DraftHarbor.exe`。
- 版本仍为 1.2.6；Electron 42.4.1、electron-builder 26.15.3，使用本地 Electron ZIP 构建目录包，没有安装、签名或发布。
- `source-verification.json` 记录 276 个源码和资源文件 SHA-256，全部与构建源码一致；运行依赖 jszip 已包含。
- ASAR SHA-256：`a139ad0577121cbb45f1d9eb574d12f84283104ea4939242f1b6e386c4345da2`。
- `packaged-smoke` 通过：真实 Electron 协议入口、隔离 profile、创建项目、保存、重开和备份。
- 额外打包入口检查通过：新资料库、insights helper、阅读器入口和嵌套配图查看器，无页面异常。
- 启动脚本指向新目录，继续使用原 `%APPDATA%/draftharbor-desktop` 数据。验证过程均使用临时数据，没有打开或迁移真实作品。

## 回退

原程序 `release/preview-fit-20261007/win-unpacked/DraftHarbor.exe` 保留。将备份中的 `launcher-before.cmd` 复制回根目录作为 `启动新版稿湾.cmd` 即可恢复旧启动入口。代码回退点为 `codex/backup-before-github-merge-20261022-210130`；恢复个人数据前应先保存恢复时的最新资料。

验证日志保存在备份目录的 `verification/` 中。
