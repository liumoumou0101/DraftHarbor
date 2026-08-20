# 稿湾 DraftHarbor 1.2.4

## 本次更新

- 启动时还原上次所在模块；写作、资料、讨论、工作流会打开最近一本，书库只钉顶不自动冲进稿纸。
- 新增 Anthropic Messages、Google Gemini 官方 OpenAI 兼容接口，以及可手填模型 ID 的自定义 Chat Completions 入口。
- OpenCode Go / Zen 可调用套餐内模型并允许手填 ID。
- 设置页 AI 配置收成配置组；写作默认、工作流、资料库管家仍各用各的连接。
- 写作高级选项改为单列表单，去掉嵌套模型手风琴。
- 资料库、讨论、恢复页 UI 收口；讨论转化需确认，空状态提供三个开头。
- 桌面主题扩为 6 套；书库最近一本钉顶；2K 稿纸与阅读翻页不再裁切。
- 阅读器正文模块不再受过紧的 24 KiB 字节门禁；仍保留 1400 行防堆回单文件。

## 验证

- `npm run lint`、`npm run smoke`、`npm run unit`。
- `node tests/desktop-library.js`、`node tests/workshop-ui.js`。
- 工作流 guided / creation / rewrite / graph UI。
- Windows NSIS 安装版与 Portable 便携版构建。
- Packaged Smoke。

## 下载与校验

| 文件 | SHA-256 |
| --- | --- |
| `DraftHarbor Setup 1.2.4.exe` | `8831E261CD065FFDB099D24055FFA6EDD04882E739B9E25E717F73ECEBA90784` |
| `DraftHarbor 1.2.4.exe` | `14C4A908E0407EF88F5ACC603FEA6D843A6893AEE047B97569E7AF19E23CFF48` |
| `DraftHarbor Setup 1.2.4.exe.blockmap` | `42DE25BBD98CB08B2395C7BA3D157D6FE13735035970F3AA196BC7504FCF455B` |
| `latest.yml` | `D05E61F15D1FC12146E4A6ED9502D3E503E99CED97B71344E2FB2CBCA1B49F5D` |

升级前建议备份重要项目。现有项目、Reader 书库和旧版导入格式继续兼容。
