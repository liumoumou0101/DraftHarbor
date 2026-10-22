# 独立体验包验证

时间：2026-10-22。源码仍沿用项目版本号 1.2.6；这是资料库改版预览，没有创建正式发行版或修改已安装程序。

## 产物

- 入口：`release/compendium-reading-room-20261022/Launch-Reading-Room.cmd`
- 程序：`release/compendium-reading-room-20261022/win-unpacked/DraftHarbor.exe`
- 使用说明：`release/compendium-reading-room-20261022/README-preview.md`
- 独立数据和浏览器配置：`release/compendium-reading-room-20261022/preview-data`

启动脚本使用现有 `DRAFTHARBOR_DATA_ROOT` 环境变量和 Electron 的 `--user-data-dir` 参数。没有复制作者的小说、模型设置或个人浏览器配置。示例《无渡》通过现有 `projectService.createProject` 创建，再经 `openProject` 重新打开核验：9 份资料、2 章、3 个有正文的场景。首次打开可从书库选择《无渡》进入资料库。

## 打包结果

使用本地 Electron 42.4.1 和 electron-builder 26.15.3，离线打包成功；未下载运行时，未安装、签名或发布。

```powershell
node node_modules/electron-builder/cli.js --dir --win --x64 --config.directories.output=release/compendium-reading-room-20261022 --config.electronDist=node_modules/electron/dist --config.npmRebuild=false --config.win.signAndEditExecutable=false --publish never
```

`signAndEditExecutable=false` 仅用于独立预览，跳过可执行文件资源编辑和签名；应用内图标仍由现有窗口配置设置。

ASAR 与当前工作目录逐文件 SHA-256 比对通过：`desktop.html` 和 `src`、`desktop`、`assets` 中全部 271 个文件完全一致。包含本次新增 workspace、insights、peek 和两份样式。详细结果在 `package-verification.json`。

- 新 ASAR：`0a60566a59c48e74376e51d747801961df9e27512ad532605a46969db245e076`
- 原 `release/win-unpacked/resources/app.asar` 未改变，SHA-256 仍为 `1c38110f446b93b8f8c17b0f94eae2af5cdfe6d4b8c8030779bcbf2822132586`。

## 实际运行验证的边界

尝试使用现有 `tests/packaged-smoke.js` 和独立临时数据／profile 运行新程序。Electron 在 Playwright 建立调试连接前退出，报告 `Process failed to launch!`，尚未到达任何应用断言。一次追加 `DEBUG=pw:browser` 的诊断仍在相同阶段失败，未提供应用 JavaScript 错误；进程清理工具另报告 Windows 用户名或密码错误。

因此已确认的是打包成功、完整源码一致、示例数据能由真实存储服务读回。**不能据此声称完整 Electron 启动和端到端冒烟通过。** 没有为绕过执行环境限制而修改应用权限、沙箱或启动参数，也没有继续尝试不同启动路径。正常运行体验需使用上述独立启动脚本。
