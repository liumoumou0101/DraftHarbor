# 新旧启动入口与作品数据目录修复

日期：2026-10-22。排查基线：`b64253c`。

## 原因

原 `start.bat` 调用 `start-desktop-preview.cmd`，通过 `electron .` 启动。没有环境变量覆盖时，`desktop/main.js` 将源码根目录作为作品数据根。

上次更新的 `启动新版稿湾.cmd` 显式将作品数据根设置为 AppData，因此两种入口读取不同书库：

| 入口 | 作品书库 | 实际内容 |
| --- | --- | --- |
| 原预览入口 | `H:\soft\DraftHarbor\DraftHarbor Library\projects` | 14 个项目、110 个场景、421,488 个正文字符。 |
| 修复前新版入口 | `C:\Users\MSN\AppData\Roaming\draftharbor-desktop\DraftHarbor Library\projects` | 3 个项目、5 个场景，正文均为空。 |

现存正文文件仍在原位置；这是入口数据目录不一致。检查时没有运行中的稿湾进程；桌面及开始菜单范围内也未发现相关快捷方式，因此不能仅凭进程确认用户最近点击了哪个入口。

## 修复

- `启动新版稿湾.cmd` 继续启动 `release\writer-desk-20261022\win-unpacked\DraftHarbor.exe`。
- `DRAFTHARBOR_DATA_ROOT=%~dp0`：让新版沿用脚本所在项目根目录，与原预览入口一致。
- 单独设置 `DRAFTHARBOR_PROFILE_ROOT=%APPDATA%\draftharbor-desktop`，供 `--user-data-dir` 使用，保留原浏览器配置。
- 两套原书库均保留，没有复制覆盖、合并同名项目或改写正文。原项目 ID、设置和阅读器数据沿用原数据根。
- 恢复项目锁文件对应的开发依赖，确保原预览入口也仍具备启动依赖。

## 验证

使用原书库的隔离副本、临时浏览器配置和实际新版 EXE：

1. 书库 API 列出的 14 个项目 ID 与原书库完全一致。
2. 逐项目打开，110 个场景的正文与原 Markdown 文件逐字一致。
3. 从真实书库卡片打开有正文的旧项目，确认新版文学书桌中显示了原先保存的 30,599 字符场景。
4. 两套原项目目录共 1,264 个文件在测试前后哈希一致。
5. 检查启动脚本的作品根、配置根与程序路径，正式包仍使用原先验证通过的 EXE，无需重新打包。

验证脚本和结果：`H:\soft\DraftHarbor\.ai_state\entry-data-root-audit`。未携带真实模型配置到测试副本，未请求外部模型。

修复前启动脚本备份：`H:\soft\DraftHarbor\.ai_state\backups\entry-data-root-20261022-234321\launcher-before.cmd`。

日常使用项目根目录的 `启动新版稿湾.cmd` 即可。直接双击 `release` 内的 EXE 会使用应用默认数据根，不能据此判断原书库内容。
