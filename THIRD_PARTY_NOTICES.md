# Third-party notices

稿湾使用以下直接依赖。每个组件仍适用自己的许可证；GPL-3.0-or-later 不会移除其版权声明或许可证条件。

| Component | Purpose | License |
|---|---|---|
| Electron | Desktop runtime | MIT |
| electron-builder | Packaging | MIT |
| Playwright | Automated tests | Apache-2.0 |
| ESLint | Development linting | MIT |
| JSZip | Project package and EPUB ZIP processing | MIT OR GPL-3.0-or-later; DraftHarbor uses it under MIT |

完整版本号由 `package-lock.json` 固定。安装依赖后，各依赖的许可证正文位于相应的 `node_modules/<package>/LICENSE*`、`NOTICE` 或 `ThirdPartyNotices.txt` 文件中。

发布安装包时需要保留 Electron/Chromium 随附的第三方许可文件，并将本项目的 `LICENSE`、`NOTICE` 和本文件一起打包。Apache-2.0 组件的 `NOTICE` 不能省略。

间接依赖主要使用 MIT、ISC、BSD-2-Clause、BSD-3-Clause、Apache-2.0、BlueOak-1.0.0、0BSD、Zlib、Python-2.0 或兼容的多许可证声明。正式发布前应从锁定依赖重新生成一次许可证清单。
