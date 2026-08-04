# Reader 2.0 专业小说阅读器开发计划

- 计划版本：0.1
- 日期：2026-08-04
- 状态：开发中；F-12.1—F-12.12 已落地，下一阶段进入后续格式扩展评估
- 功能编号：F-12
- 产品设计：[Reader 2.0 专业小说阅读器产品设计](READING_MODULE_2_0_DESIGN.md)
- 历史实现：[F-10 阅读体验改造开发计划](READING_MODULE_REDESIGN_DEVELOPMENT_PLAN.md)

## 1. 计划目的

本计划把 Reader 从“技术能力完整但产品体验不足”的 F-10 实现，升级为稿湾第三核心模块。开发目标不是重新实现已经通过验收的数据层，而是在保留 Reader Document、Locator、Store、分页和 Transfer 的前提下，建立完整的书库、专业阅读舞台、外观工作室、纸张/字体系统、批注和稳定跨模块转交。

计划中的“首期仅一种字体”只表示首个视觉实现减少变量，不表示把字体写死。字体目录、Provider、偏好字段、加载状态、缓存键和失败回退必须在 Reader 2.0 基础阶段完成；用户字体文件导入与管理作为后续明确工作包开启。

## 2. 当前基线

### 2.0 2026-08-04 首轮实现记录

- 浏览器文件导入统一走 Reader Store：字节预览、编码确认、书名/章节校正、取消和正式确认写入已接通。
- 导入确认后自动刷新书库并打开新文档，避免旧 `localStorage` 正文与正式书库双轨。
- 排版滑块增加实时数值；新增专注阅读切换、字体安装/识别说明入口。
- 项目投影桥接从 `reader.js` 拆为独立模块；新增 Reader 2.0 结构门禁，新增模块按 20 KiB 软预算检查。
- 书库摘要现在聚合 Reader 外部书籍与项目作品；项目作品通过只读投影路由打开，不把正文复制进 Reader Store。
- Preferences v2、内置阅读方案、字体目录/回退和批注/位置历史契约已建立并接入核心测试；旧偏好字段继续兼容。
- Preferences v2 已接入正式全局偏好存储和 legacy 迁移；状态栏、HUD、翻页输入、减少动态和稳定 `fontId` 均进入版本化模型。
- Theme V1 只接受受控颜色 token，并校验正文/纸张及控件对比度；内置方案不可被调用方覆盖，用户方案和用户主题使用稳定 ID。
- Font Provider 已提供 `list/get/probe/load/register/remove/resolve` 完整接口，正式阅读 CSS 字体栈通过 Provider 解析并暴露缺失/失败回退状态。
- F-12.5 已接通快捷外观条与六分区外观工作室；正文保持可见，修改先进入可撤销会话，支持全局/单书作用域、保存/删除用户方案和版本冲突保护。
- Theme V1 已扩展白纸、书籍纸、暖黄、护眼、墨灰和 OLED 六个内置主题；环境、正文、控件、纸张、晕影和阴影均通过 Reader token/状态属性控制。
- 纸张材质支持纯色、柔纸和细纹；细纹使用项目内原创 `assets/reader/paper-grain.svg` 并保留 CSS 降级，许可记录见 `docs/READER_ASSET_LICENSES.md`。
- 外观重排使用瞬时程序滚动并保留流式比例，避免平滑滚动动画覆盖进度末端的精确定位。
- 批注使用独立 Annotation Store，不修改项目正文或外部源文件；增删改、原子写入、并发冲突和最多 100 条位置历史均已接入 Reader API。
- 翻章现在立即持久化 Locator，章内滚动继续防抖写入；桌面验收覆盖刷新后恢复到上次章节。
- F-12.6 已接通中文分页边界、孤行/寡行控制、字重/书脊/字体目录版本缓存键，以及中英混排和 emoji 的 UTF-16 安全切分。
- 翻页输入已统一按钮、键盘、滚轮和触控滑动；设置面板、对话框、正文选区和可关闭的输入开关会抑制误翻，连续输入合并为单次页目标。
- `reader-transition.js` 已提供 fade/slide/cover/none 的统一 Adapter；减少动态效果会降级到无动画，curl 仍保持实验适配器和禁用状态。
- 底部状态栏已支持章节、页码、百分比、已读字符、预计时间、显示方式、字段选择和自动隐藏；状态栏状态属性与表单控件保持独立。
- F-12.6 桌面回归已覆盖方案切换、状态栏、动效、选区抑制、键盘/滚轮/触控翻页和关闭输入开关；视觉性能 p95 继续由 F-12.9 统一验收。
- 现有 Reader Document、State、Transfer、迁移与跨模块边界保持不变；F-12.9 发布门禁、F-12.10 用户字体管理、F-12.11 TTS/自动阅读和 F-12.12 EPUB 格式扩展已完成，下一阶段进入后续格式扩展评估。

### 2.1 可以直接保留

- `ReaderDocumentV2`、不可变 Revision、按章读取和项目派生投影。
- `ReaderLocatorV1`、Range、跨修订精确/近似/失败恢复。
- Reader Document Store、State Store 和 Transfer Store。
- 连续、单页、双页、自动布局的纯核心。
- 有界 DOM、内容权重进度、搜索、书签和状态串行合并。
- 选区快照、写作/资料库/工作流 Envelope 和目标端确认边界。
- 安全路径、原子写入、损坏恢复、百万字符和安装版验收基础。

### 2.2 必须优先修正

- 可见文件导入已改为字节预览与确认写入 Reader Store；旧 `importReaderFile` 不再由 UI 绑定。
- 导入后的正文、书库、书签和选区已统一进入 Reader Store 权威流。
- 进入 Reader 默认显示可管理书库；打开具体文档后进入阅读舞台。
- Reader HUD 已接管应用标题栏、全局导航、阅读顶栏、章节导航栏和底栏的专注/自动隐藏状态；F-12.6 已补齐状态栏字段选择与自动隐藏。
- 主题只覆盖正文区域，纸张与外层阅读环境割裂。
- 设置面板是单列参数清单，没有阅读方案、纸张材质、实时数值和快捷层。
- 当前字体仅是固定枚举，不能承载用户字体目录、加载状态或缺失回退。
- 视觉验收偏重对比度和无溢出，缺少与选定视觉目标的像素级/截图级比较。
- Reader 结构预算已经接近上限：`reader.css` 约 23.5 KiB、`reader-navigation.js` 约 22.5 KiB，而现有 Reader 专项硬门禁为单文件 24 KiB；本轮新增导入、项目投影和契约均保持独立文件，不继续堆入总控模块。

### 2.3 2026-08-04 F-12.4 实现记录

- 新增 `src/core/document/reader-hud.js`，冻结 `visible`、`idle`、`hidden`、`panel-open`、`selection-active` 五态及面板/选区/对话框自动隐藏规则。
- 新增 `src/desktop/shell/reader-hud.js`，统一处理输入唤醒、空闲计时、焦点移出隐藏控件、对话框/抽屉/选区协调和 `Esc` 优先级。
- 专注阅读切换会同步收起桌面左导航、应用标题栏和上下文条；退出 Reader 或退出专注模式时恢复原桌面壳层状态。
- Reader 设置抽屉、导入/字体/详情/转交对话框和文本选区会进入保护态，不会在自动隐藏计时中被错误遮蔽；隐藏 HUD 时焦点回到正文容器。
- `reader-hud.css` 独立于 Reader 基础样式加载，覆盖 HUD 过渡、全局 chrome 协调和减少动态路径；已有导入/转交样式继续保持独立。
- 核心、结构和桌面 Reader 回归新增 HUD 状态、专注收起/恢复、自动隐藏后鼠标恢复与离开 Reader 恢复壳层断言。

F-12.4 的边界是壳层和可见性状态机；完整快捷外观、可选状态栏字段、更多主题与纸张材质分别进入 F-12.5/F-12.6，不在本阶段把视觉参数重新写入 HUD 控制器。

## 3. 开发原则

1. 先消除双轨数据，再做视觉重构。
2. 每个阶段都保留可启动、可阅读、可恢复的主线。
3. 新 UI 不直接读写磁盘；通过 Reader Controller 和专用 Service。
4. Reader Document、Locator 和 Envelope 的权威边界不因视觉重构改变。
5. 影响分页的变更必须先捕获 Locator，重排后恢复。
6. 字体、主题和纸张资产只使用本地受控来源。
7. 正式 UI 开发前，先基于当前截图产出三个视觉方向并由用户选择一个。
8. 每个视觉阶段同时测试深色、纸张和最小桌面视口，不在最后集中补救。
9. 不把 Reader 新逻辑继续堆入 `reader.js` 或单个 `reader.css`。
10. 分期只决定开发顺序，不缩减 Reader 2.0 的最终产品边界。
11. 模块体积是前置架构约束：文件达到软预算 80% 时先拆职责，再增加功能；不能等触发发布硬门禁后再补拆分。

## 4. 总体里程碑

| 里程碑 | 覆盖阶段 | 结果 |
| --- | --- | --- |
| M0 设计冻结 | F-12.0 | 选定视觉方向、状态图和交互规范 |
| M1 数据主线统一 | F-12.1—F-12.2 | 新导入、项目入口、偏好和字体基础只有一套权威路径 |
| M2 合格阅读器 | F-12.3—F-12.6 | 书库、专注阅读、排版、纸张、分页和翻页可长期使用 |
| M3 完整阅读工具 | F-12.7 | 导航、书签、高亮、批注和位置历史完整 |
| M4 稿湾联动 | F-12.8 | 选择后安全转写作、资料库和工作流 |
| M5 发布 | F-12.9 | 性能、无障碍、视觉、迁移、安装和恢复验收 |
| M6 扩展包 | F-12.12 | EPUB 等后续能力 |

工作量使用相对点表示复杂度，不直接等于日历时间。基础版本 F-12.0—F-12.11 预估约 165–215 点，视觉资产质量、用户字体解析和仿真翻页可能单独增加工作量。

## 5. 依赖与关键路径

```text
F-12.0 视觉与交互冻结
  └─ F-12.1 导入/书库数据统一
      └─ F-12.2 偏好、主题、字体和批注契约
          ├─ F-12.3 书库与书籍详情
          └─ F-12.4 专注阅读壳
              └─ F-12.5 外观工作室
                  └─ F-12.6 分页、翻页与输入
                      └─ F-12.7 导航与批注
                          └─ F-12.8 稿湾转交
                              └─ F-12.9 发布验收
                                  └─ F-12.10 用户字体管理
                                      └─ F-12.11 TTS/自动阅读
```

F-12.3 和 F-12.4 在 F-12.2 契约冻结后可以并行；F-12.5 的视觉组件和 F-12.6 的纯核心测试可以部分并行。跨阶段不得提前把临时正文、字体路径或纸张资产写入错误 Store。

## 6. F-12.0 视觉方向、状态与验收基线

目标：在改生产代码之前，确定 Reader 2.0 的视觉目标和完整用户路径。

### F-12.0A 当前证据与状态图（3 点）

- 固化现有空状态、书库抽屉、深色阅读、纸张阅读、目录和设置截图。
- 绘制 `library → book-detail → reading → appearance/annotation/transfer` 状态图。
- 列出每个状态的进入、退出、焦点恢复、URL/会话状态和错误态。
- 明确全局导航、Reader HUD、底部状态和抽屉的显示规则。

### F-12.0B 三个视觉方向（5 点）

- 基于当前稿湾设计系统和审计截图，生成恰好三个视觉方向。
- 三个方向都必须覆盖书库首页、专注阅读、纸张双页和外观工作室，而不是只画一张首页。
- 使用相同 1280×720 视口、相同样本文本和相同功能状态比较。
- 用户选择一个方向后，冻结颜色、间距、字体样张、页面比例、HUD、阴影、书脊和面板结构。

### F-12.0C 视觉验收夹具（4 点）

- 建立真实中文长篇、长短章、对话、英文数字、emoji 和超长段落夹具。
- 为书库准备真实的项目、本地书籍、空书库、导入中和错误状态。
- 记录选定设计的基准截图和关键像素尺寸。
- 后续每个视觉阶段必须把实现截图和基准图一起比较。

### F-12.0D 模块地图与体积基线（4 点）

- 记录现有 Reader fragment、shell、core、service、controller 和 CSS 的行数、字节数及职责。
- 标出已达到 80% 软预算的文件；当前至少包括 `reader.css` 和 `reader-navigation.js`。
- 在 `tests/reader-2-structure.js` 中建立 Reader 2.0 专项白名单、职责和体积门禁。
- 先决定新模块归属和依赖方向，再创建文件；不得以 `reader-2.js`、`reader-manager.js` 或 `reader-all.css` 形成新的总控单体。

退出条件：

- 用户已选择视觉方向。
- 主要状态、导航和控件显示规则已冻结。
- 有可重复生成的基准截图，而不是只依赖口头描述。
- Reader 2.0 模块地图、软预算、硬门禁和拆分顺序已冻结。

## 7. F-12.1 Reader 主数据与导入统一

目标：彻底结束新版 Reader Store 与旧 localStorage 导入并存。

### F-12.1A 新版导入向导适配器（8 点）

- 新增桌面导入协调模块，调用现有 `file-preview/retry/correct/split/merge/confirm` API。
- 文件选择后进入预览，不直接调用 `importReaderFile`。
- 展示编码、替代字符数量、章节列表和样章。
- 支持标题修改、编码重试、拆章、并章、取消和确认。
- 确认后重新读取正式书库记录和 Reader State，再进入书籍详情或阅读。
- 导入失败保留草稿；重试不创建重复文档或 Revision。

### F-12.1B 项目作品书库投影（6 点）

- 新增 Reader 书库聚合服务，合并外部书籍摘要与项目只读入口。
- 项目条目使用 `project:<projectId>` 身份，不把正文写入 Reader Store。
- 返回标题、章节数、字数、最近修改、最近位置和来源类型。
- 项目删除、移动、重命名或修改后，书库摘要安全刷新。

### F-12.1C 兼容路径收口（5 点）

- `reader.js` 保留旧状态解析和迁移，不再绑定新文件导入主入口。
- 新 UI 不保存新正文到 `draftharbor:desktop:reader`。
- 检测旧外部正文时，只显示明确的“加入新版书库/放弃”迁移选择。
- 成功迁移、重开并校验后才清除旧键。
- 增加结构测试，禁止生产 Reader 文件控件再次调用旧导入。

### F-12.1D 协议与回归（4 点）

- 覆盖 TXT、Markdown、粘贴、重导入、编码失败和磁盘失败。
- 覆盖“导入后书库非空、书签可用、选区可用、重启可重开”。
- 列表和导入响应继续不含正文、绝对路径或密钥。
- 旧项目阅读和 F-10 迁移回归保持通过。

退出条件：

- 所有新导入只进入 Reader Store。
- 不再出现正文已打开但书库为空的状态。
- 旧 localStorage 只承担可验证迁移。

### 2.2 2026-08-04 F-12.3 实现记录

- 书库接口聚合项目作品、本地文本和粘贴文本，并为摘要附加章节、字数、版本、健康状态、最近阅读时间和估算进度；损坏摘要降级为可见错误状态，不把正文放进列表响应。
- 新增版本化 Library View Store：筛选、排序、网格/列表、收藏、移出书架和自定义书架均只保存稳定文档 ID 与视图状态。
- 书库 UI 增加继续阅读卡、来源筛选、标题/进度/最近阅读排序、搜索、收藏、书架选择和响应式卡片视图。
- 书籍详情对话框展示来源、格式、章节、字数、版本、阅读状态和目录预览；正文仍通过单章接口按需读取，详情响应不包含正文。
- 本地书籍支持从详情入口重新导入到同一文档的新版本；项目作品明确显示只读投影并保留 Writer 作为正文所有者。

## 8. F-12.2 新偏好、字体、主题与批注契约

目标：在 UI 开发前冻结可扩展数据模型，避免首期单字体再次写死架构。

### F-12.2A Reader Preferences v2（6 点）

- 新增版本化 `ReaderGlobalPreferencesV2` 和单书覆盖规范化函数。
- 字段覆盖布局、状态栏、HUD、排版、主题、字体、翻页输入和减少动态。
- 支持系统默认、阅读方案、单书覆盖和会话预览四层合并。
- v1 偏好自动迁移；未知 v2 字段安全保留或忽略。
- 偏好更新使用 optimistic concurrency 和原子写入。

### F-12.2B 阅读方案与主题契约（5 点）

- 定义 `ReaderAppearanceProfileV1` 与 `ReaderThemeV1`。
- 内置方案不可覆盖；用户方案使用稳定 ID、名称和版本。
- 主题区分环境、页面、文本、控件、材质和效果。
- 自定义颜色保存前验证格式和最低对比度；不保存任意 CSS。

### F-12.2C 字体目录基础（8 点）

- 定义 `ReaderFontCatalogEntryV1` 和 `ReaderFontReferenceV1`。
- 新增 Font Provider 接口：`list/get/probe/load/register/remove/resolve`。
- 首期只注册一个 `builtin:default` 条目也必须走 Provider。
- 偏好只存 `fontId`，布局缓存同时包含字体目录版本和实际解析结果。
- 缺失、加载失败、回退变化和重新可用状态都有纯函数与 Store 测试。
- Font Store 不接受调用方指定任意目标路径。

### F-12.2D 批注与位置历史契约（6 点）

- 定义 `ReaderAnnotationV1`、颜色/类型、Range、笔记和恢复精度。
- 定义有界 `ReaderPositionHistoryV1`。
- 批注与书签写入和位置写入共享安全的串行合并策略。
- 项目批注不修改项目正文；外部文档批注不修改源文件。

退出条件：

- 只有一种字体时，多字体架构仍能完整运行。
- v1 设置、书签和位置迁移后结果一致。
- 主题、方案、字体和批注 schema 均有拒绝非法输入测试。

## 9. F-12.3 阅读书库与书籍详情

目标：Reader 模块默认呈现正式书库，而不是空阅读舞台。

### F-12.3A 书库查询与视图状态（6 点）

- 聚合继续阅读、最近阅读、项目作品、本地书籍和自定义书架。
- 支持标题、来源、进度、最近时间和收藏排序。
- 书库视图状态只保存筛选、排序和显示模式，不保存正文。
- 500 本书摘要列表满足性能预算。

### F-12.3B 书库首页 UI（10 点）

- 实现继续阅读主卡、最近阅读、项目作品、本地书籍和导入入口。
- 实现封面、来源徽标、进度、收藏和更多菜单。
- 空状态只提供项目入口和导入，不出现阅读 HUD。
- 书库在 1280×720、1366×768 和 200% 缩放下可用。
- 使用正式图标库和真实本地封面/占位资产。

### F-12.3C 书籍详情（7 点）

- 展示标题、作者/来源、格式、字数、章节、版本和阅读状态。
- 提供开始/继续、目录预览、重新导入、收藏、移出书架和安全删除。
- 项目作品明确只读来源和最近修改。
- 删除前检查批注、书签和未归档 Transfer 引用。

退出条件：

- Reader 入口的第一屏是可管理、可继续阅读的书库。
- 项目与外部文档的来源清楚但体验统一。
- 空书库、500 本书、损坏摘要和缺失项目均有完整状态。

## 10. F-12.4 专注阅读壳

目标：把阅读从普通模块页面提升为专注场景。

### F-12.4A 阅读舞台结构（8 点）

- 拆分书库视图和阅读视图，不在一个 article 内同时维护空书库和正文。
- 合并顶部标题与章节导航，移除独立常驻章节栏。
- 底部只保留用户选择的状态字段和细进度。
- 分页布局显示左右热区；流式布局不显示无意义页边控件。

### F-12.4B 全局 chrome 协调（5 点）

- 进入阅读后按偏好收起全局左导航和应用标题栏。
- 边缘、鼠标移动、键盘和触控恢复控件。
- 全屏、窗口化和退出 Reader 后正确恢复应用壳。
- 对话框、设置、选择和屏幕阅读器模式不会错误自动隐藏。

### F-12.4C HUD 与焦点状态（6 点）

- 定义 visible、idle、hidden、panel-open、selection-active 状态。
- 用户输入、自动隐藏计时和焦点恢复可测试。
- `Esc` 行为按优先级关闭对话框、面板、选择，再切换 HUD。
- 控件隐藏不把焦点留在不可见节点。

### F-12.4D 样式拆分（4 点）

- 将现有 `reader.css` 拆为壳、书库、页面、外观、导航、批注和转交样式层。
- 保留明确 CSS cascade order，避免新单体样式文件。
- Reader 主题 token 与稿湾全局 token 分层，不污染其他模块。

退出条件：

- 720px 高度下不再有四层常驻 chrome。
- 正文舞台、控件显示和焦点状态在键鼠触控下等价。
- 离开 Reader 后应用导航状态完全恢复。

## 11. F-12.5 外观工作室、纸张与字体

目标：提供专业小说阅读器级的外观和排版体验。

### F-12.5A 快捷外观条（5 点）

- 主题预设、字号减/值/加、字体、布局和“更多设置”。
- 快捷操作可键盘访问，显示实际数值和重置。
- 修改先进入会话预览，可按全局/当前书/方案保存。

### F-12.5B 外观工作室（12 点）

- 实现方案、纸张、字体、排版、页面、翻页六个分区。
- 正文保持可见并实时比较，不用强遮罩完全压暗。
- 所有滑杆显示值、单位、默认点和重置。
- 支持撤销本次修改、恢复全局、保存新方案和删除用户方案。
- 全局/单书作用域使用清晰文案，不显示无解释的禁用控件。

### F-12.5C 完整主题与纸张资产（10 点）

- 实现白纸、书籍纸、暖黄、护眼、墨灰和 OLED 六个内置主题。
- 主题覆盖环境、页面、HUD、面板、焦点和选区。
- 引入经过许可的本地纸张纹理资产；记录来源与许可。
- 材质、阴影、书脊和晕影可关闭，并受高对比度/减少动态约束。
- 纹理损坏或加载慢时先显示基础色，不阻塞正文。

### F-12.5D 单字体首发与多字体演练（8 点）

- 生产 UI 首期只暴露一个稳定默认字体也可。
- 通过 Font Provider 读取并显示样张、可用状态和实际解析字体。
- 测试环境注册第二个本地测试字体，验证切换、加载、缓存失效和 Locator 恢复。
- 测试字体缺失、字体文件损坏、fallback 变化和重启恢复。
- 不允许 UI 或 CSS 依赖固定字体枚举。

退出条件：

- 用户可以配置完整排版并保存为全局、当前书或方案。
- 六个主题在整个 Reader 环境中一致。
- 一种生产字体并未阻塞多字体 Provider、测试和后续安装。

## 12. F-12.6 分页、翻页和阅读行为

目标：在现有纯核心基础上提升小说排版和翻页手感。

### F-12.6A 中文分页质量（8 点，已完成）

- 扩展分页测量输入，覆盖字重、缩进、书脊和实际字体目录版本。
- 处理长段、对话、标题、中英混排、破折号、省略号和 emoji。
- 添加基础孤行控制；无法满足时以无丢字和 Locator 正确为最高优先级。
- 单/双页在相同 Locator 上往返等价。

### F-12.6B 翻页输入协调（7 点，已完成）

- 统一按钮、热区、滚轮、键盘和触控手势。
- 文本选择、批注输入、设置面板和对话框打开时抑制误翻。
- 快速连续输入合并最终目标，权威位置只防抖写入一次。
- 用户可关闭点击热区或交换方向键行为。

### F-12.6C 动效适配器（6 点，已完成）

- 把 fade、slide、cover、none 放入统一 `transitionAdapter`。
- 动效不改变页定义、DOM 阅读顺序或 Locator。
- 减少动态强制降级，页面仍可键盘操作。
- curl 只建立实验适配器和性能门禁，不承诺首发开放。

### F-12.6D 状态栏与进度（5 点，已完成）

- 支持页码、章节、百分比、已读字符和预计时间字段。
- 用户可选择字段、顺序和自动隐藏。
- 进度滑杆仍按内容权重映射 Locator。
- 空书库、导入和设置状态不显示伪进度。

退出条件：

- 四种布局、所有输入和三种正式动效无丢字、重复和误翻。
- 字体、窗口和纸张设置改变后恢复同一 Locator。
- 视觉反馈 p95 满足预算，减少动态路径完整。

F-12.6 实现证据：`npm run reader-core-test`、`npm run reader-shell-test` 和针对性 ESLint 已通过；桌面回归覆盖 1280×820 阅读窗口、真实导入章节、单页分页、状态栏字段、cover Adapter、选区抑制、滚轮/触控滑动及输入开关。视觉反馈 p95 留在 F-12.9 的统一性能验收中，不在本阶段重复建立第二套基准。

## 13. F-12.7 导航、书签、高亮与批注

目标：完成专业阅读工具的日常标记与跳转能力。

### F-12.7A 导航中心（6 点）

- 目录、搜索、书签、批注和历史分区。
- 长目录支持筛选、当前章定位和折叠。
- 搜索继续逐章读取、可取消、最新请求获胜。
- 导航关闭后恢复阅读焦点。

### F-12.7B 书签升级（4 点）

- 增加颜色/分类、备注、创建时间和最近访问。
- 兼容现有书签并迁移。
- exact/approximate/unresolved 状态有明确文案和处理动作。

### F-12.7C 高亮与批注（10 点）

- DOM 选区映射为 Reader Range，支持流式、单页和双页。
- 高亮颜色同时提供下划线/边线等第二维度。
- 创建、修改、删除和跳转批注。
- 项目或外部 Revision 更新后重新解析范围。
- 批注写入失败不丢失当前选择和用户输入。

### F-12.7D 位置历史（4 点）

- 目录、搜索、书签、批注和跨模块返回前自动压入有界历史。
- 前进/后退不写入正文或永久页码。
- 跨书历史只在文档仍可读取时恢复。

退出条件：

- 用户可以完整搜索、标记、批注并返回原位置。
- 所有标记使用 Locator/Range，不修改正文。
- 更新 Revision 后恢复精度透明可见。

F-12.7 实现证据：新增 `reader-bookmarks.js` 与 `reader-annotation-ui.js`，导航中心接通目录/搜索/书签/批注/历史五类入口；书签扩展颜色、分类、备注和最近访问字段；选区可直接创建高亮、下划线或批注并在正文渲染 Range 标记；批注/书签跨 Revision 显示 exact/approximate/unresolved；位置历史通过 Reader API 原子写入并保持 100 条上限。`npm run reader-core-test`、`npm run reader-storage-test`、`npm run reader-protocol-test`、`npm run reader-shell-test`、`npm run smoke`、`npm run reader-release-acceptance` 和排除两个用户自有真实 Provider 夹具后的全仓 ESLint 已通过。

## 14. F-12.8 选择与稿湾转交

目标：在不干扰普通阅读的前提下，复用已验证的 Envelope 闭环。

### F-12.8A 选择模式（5 点）

- 普通阅读隐藏转交按钮。
- 文本选择、场景、章节、多章和全文进入同一选择模式。
- 第一层显示高亮、批注、书签和复制。
- “发送到稿湾”展开写作、资料库和工作流。

### F-12.8B 写作返回定位（5 点）

- 项目来源可“在写作中定位”到 exact/approximate 场景位置。
- 外部来源进入写前预览，不伪造项目定位。
- 返回 Reader 恢复原书、原 Revision 和 Locator。
- 目标并发变化继续由写作端预览和备份门禁处理。

### F-12.8C 工作流与资料库（5 点）

- 工作流继续使用 `writer-source@1` 或 `reader-source@1`。
- 资料库继续逐卡审核，Reader 不拥有 Provider。
- 目标只读取当前 Envelope，不枚举无关全文。
- fresh/stale/missing 和新 Revision 状态在选择确认中可见。

退出条件：

- 普通阅读没有跨模块噪声。
- 所有范围在三布局下生成等价 Envelope。
- 失败、重试、返回和目标应用不破坏阅读状态。

F-12.8 实现证据：选择工具栏已将高亮、批注、书签、复制作为第一层动作，将写作、资料库和工作流收纳在“发送到稿湾”入口；选择范围统一生成不可变 Transfer Envelope，三类目标分别支持预览/应用、fresh/stale/missing 与新 Revision 提示。项目稿源返回时会重新打开对应 `project:` Reader 投影并恢复源 Locator；普通文档、项目文档、流式/单页/双页布局、失败保留选择和跨模块返回均有桌面回归覆盖。`npm run reader-shell-test`、排除两个用户自有真实 Provider 夹具后的全仓 ESLint 和 `git diff --check` 已通过。

## 15. F-12.9 综合质量与发布

目标：把“合格阅读器”和“稿湾联动”一起变成发布门禁。

### F-12.9A 自动化矩阵（8 点）

- 来源：项目、TXT、Markdown、粘贴。
- 状态：空书库、首次导入、继续阅读、重导入、缺失来源、损坏恢复。
- 布局：流式、单页、双页、自动。
- 主题：六个内置主题。
- 字体：默认、测试字体、缺失和加载失败。
- 输入：键盘、鼠标、滚轮、触控、减少动态。
- 标记：书签、高亮、批注和位置历史。
- 转交：写作、资料库、工作流。

### F-12.9B 视觉 QA（8 点）

- 使用与 F-12.0 相同视口和内容，逐屏比较选定视觉目标。
- 检查书库、详情、阅读、设置、目录、批注、选择和错误状态。
- 修正边距、字号、字重、层级、圆角、阴影、纹理比例和控件密度。
- 不能用“无滚动条/无溢出”代替设计一致性。
- 截图和结论进入版本化验收报告。

### F-12.9C 无障碍与缩放（6 点）

- 100%、125%、150%、200% 等效缩放。
- 1280×720、1366×768、1920×1080。
- 键盘全路径、屏幕阅读器结构、高对比度和减少动态。
- 隐藏 HUD、抽屉、对话框和外观工作室焦点恢复。

### F-12.9D 性能、恢复与安装（8 点）

- 500 本书书库和百万字符长篇。
- 首屏、单章、重分页、字体首次加载、搜索和翻页反馈预算。
- 原子偏好、字体目录、主题方案、批注和状态恢复。
- Reader Store 损坏、字体缺失、纹理损坏和导入中断。
- `npm test`、Reader 全套、构建、unpacked、NSIS 和 Portable 冒烟。

退出条件：

- Reader 2.0 独立使用达到设计文档“合格阅读器”标准。
- 视觉实现通过选定目标对照。
- 所有迁移、安全、长篇、字体失败和跨模块闭环通过。

F-12.9 实现证据：新增 `tests/reader-accessibility-acceptance.js`，覆盖可见控件可访问名称、Reader 对话框/Tablist、抽屉 inert、Escape 关闭与焦点回收、减少动态效果，以及 100%/125%/150%/200% 四档缩放；新增 `reader-accessibility-acceptance` 和 `reader-quality-acceptance` npm 入口。`reader-quality-acceptance` 已通过 Reader Shell、百万字性能（1,000,311 UTF-16 字符，最新运行观察堆增长 81.69 MiB）、12/12 来源×目标矩阵、120 个压力 Envelope、布局审计和四场景视觉审计（对比度 11.81—13.90）。`npm run smoke`、`npm run unit`、`npm run desktop-mainline-test`、排除两个用户自有真实 Provider 夹具后的全仓 ESLint、`git diff --check`、`npm run pack`、`npm run packaged-smoke`、`npm run dist` 和 `npm run installed-smoke` 均已通过；安装冒烟验证了临时安装、启动、项目持久化、备份和卸载。

## 16. F-12.10 用户字体安装与管理

本阶段可以在 Reader 2.0 主版本之后开启，但基础接口必须已由 F-12.2/F-12.5 完成。

### F-12.10A Font Store（8 点）

- 读取和校验 TTF、OTF、WOFF2。
- 从字体元数据派生稳定 `fontId`、family、weight 和 style。
- 复制到应用管理目录，记录摘要、许可提示和目录版本。
- 拒绝超限、重复、非法、无法解析或路径穿越文件。
- 原子提交目录和 catalog。

### F-12.10B 字体管理 UI（6 点）

- 导入、预览、收藏、删除和缺失状态。
- 中文/英文/数字样张。
- 显示来源、字重和样式。
- 删除前显示受影响方案；删除后安全回退。

### F-12.10C 系统字体提供者（可选，5 点）

- Electron/本地服务安全枚举可用字体名称。
- 不向普通前端暴露字体绝对路径。
- 缓存探测结果并支持刷新。
- 系统字体变化后重新 probe 并受控重排。

退出条件：

- 用户安装字体不需要修改操作系统。
- 删除、缺失、重装和重启均保持方案与阅读位置可解释。

F-12.10 实现证据：新增 `desktop/storage/reader-font-store.js` 与 `/api/reader/fonts` 字体目录/文件接口，使用内容摘要生成稳定 `user:<sha256>` ID，限制 20 MiB、TTF/OTF/WOFF2 签名与匹配扩展名，并以原子 catalog 写入和 per-catalog 锁避免半提交；TTF/OTF 读取 `name` 与 `OS/2` 表识别 family、full name、weight、style，WOFF2 使用安全文件名回退。新增 `src/desktop/shell/reader-fonts.js`、字体安装/删除/预览 UI、缺失状态和安全回退；用户字体只保存在 `DraftHarbor Library/reader-fonts`，不修改系统字体、不上传网络、不把文件写入书库。`node tests/reader-font-store.js`、`npm run reader-core-test`、`npm run reader-storage-test`、`npm run reader-shell-test`、`npm run reader-accessibility-acceptance`、`npm run reader-quality-acceptance`、排除两个用户自有真实 Provider 夹具后的全仓 ESLint、`node tests/release-config.js` 和 `git diff --check` 均已通过。

## 17. F-12.11 TTS 与自动阅读

- 选择本地系统语音或未来可插拔语音 Provider。
- 朗读位置与 Reader Locator 双向同步。
- 速度、音量、声音、段落暂停和定时停止。
- 翻页、批注、窗口失焦和自动翻页冲突有统一状态机。
- 不把正文发送到远程语音服务，除非用户明确选择并确认。

本阶段不阻塞 Reader 2.0 主版本。

F-12.11 实现证据：新增 `src/core/document/reader-tts.js`，提供设置归一化、UTF-16/emoji 安全切分、段落队列、章节推进和状态转换；新增 `src/desktop/shell/reader-tts.js`，只调用浏览器本机 `speechSynthesis`，不上传正文或调用远程语音服务。Reader 已提供声音刷新、语速、音量、段落停顿、自动进章、定时停止、暂停/继续/停止和朗读状态提示；每个朗读片段用 Reader Locator 同步正文和位置 Store，打开面板、选择文本、翻页、导航、窗口失焦时按统一冲突规则暂停或停止。`node tests/reader-tts.js`、`npm run reader-core-test`、`npm run reader-shell-test`、`npm run reader-accessibility-acceptance`、`npm run reader-quality-acceptance`、排除两个用户自有真实 Provider 夹具后的全仓 ESLint、`npm run unit`、`node tests/release-config.js` 和 `git diff --check` 均已通过；桌面测试使用本机语音模拟覆盖开始/暂停/继续/选择文本暂停/停止及设置持久化。

## 18. F-12.12 EPUB 与格式扩展

- 新格式通过 Import Adapter 生成 Reader Document，不绕过导入草稿。
- EPUB 章节、标题、段落、强调和安全本地图片映射为受控块。
- 禁止脚本、远程资源、任意 HTML 和不受控 CSS。
- 格式扩展不修改 Reader Locator、State、Annotation 或 Transfer 主契约。

本阶段不阻塞 Reader 2.0 主版本。

F-12.12 实现证据：新增 `src/core/document/reader-epub-adapter.js`，使用现有 `jszip` 读取受控 EPUB 容器，校验 `mimetype`、`META-INF/container.xml`、OPF manifest/spine 和内部资源路径；按 spine 顺序将 XHTML 的标题、段落、强调文本、代码和本地图片说明转换为 Reader 受控块。适配器拒绝路径穿越、压缩炸弹、过大条目、过深/过多 XML、符号链接、脚本、样式、任意 HTML 和远程资源；Reader 导入服务保留 EPUB 原始字节为 `.epub` 源副本，正式内容仍通过导入草稿、Reader Document/Revision 提交。新增 `tests/reader-epub-adapter.js`、`tests/reader-epub-import.js`，并更新桌面文件选择器、源副本清理和结构门禁；`npm run reader-core-test`、`npm run reader-storage-test`、`npm run reader-shell-test`、`npm run reader-quality-acceptance`、排除两个用户自有真实 Provider 夹具后的全仓 ESLint、`npm run unit`、`node tests/release-config.js` 与 `git diff --check` 通过。

## 19. 建议代码边界

### 19.1 纯核心

建议新增或拆分：

- `src/core/document/reader-preferences-schema.js`
- `src/core/document/reader-theme-schema.js`
- `src/core/document/reader-font-schema.js`
- `src/core/document/reader-annotation-schema.js`
- `src/core/document/reader-library-query.js`
- `src/core/document/reader-position-history.js`

继续复用：

- `reader-document-schema.js`
- `reader-locator.js`
- `reader-layout.js`
- `reader-navigation.js`
- `reader-selection.js`
- `reader-transfer-schema.js`

### 19.2 Store 与 Service

建议新增：

- `desktop/storage/reader-appearance-store.js`
- `desktop/storage/reader-font-store.js`
- `desktop/services/reader-library-query-service.js`
- `desktop/services/reader-font-service.js`
- `desktop/services/reader-theme-service.js`

现有 Reader Document/State/Transfer Store 继续保持唯一写入所有权。批注可先进入升级后的 Reader State；若规模或并发要求超过状态文件预算，再迁移到独立 Annotation Store。

### 19.3 桌面模块

建议新增或重组：

- `reader-library-home.js`
- `reader-book-detail.js`
- `reader-import-wizard.js`
- `reader-focus-shell.js`
- `reader-hud.js`
- `reader-appearance-studio.js`
- `reader-font-catalog.js`
- `reader-annotations.js`
- `reader-position-history.js`

`reader.js` 只保留明确的兼容适配职责，并最终缩减为迁移入口。

### 19.4 样式

建议拆分：

- `reader-shell.css`
- `reader-library.css`
- `reader-page.css`
- `reader-appearance.css`
- `reader-navigation.css`
- `reader-annotation.css`
- `reader-transfer.css`

`desktop.html` 继续只组合片段和模块，不把 Reader 重新写成单体页面。

### 19.5 模块体积与责任门禁

仓库已有发布硬门禁：

- `desktop/local-server.js` 不超过 800 行，只做组合。
- 任一 `src/desktop/shell/*.js` 不超过 1400 行。
- `desktop.html` 不超过 120 行。
- 任一 `src/styles/desktop/*.css` 不超过 2200 行。
- Reader 专项 shell 和样式文件不超过 24 KiB。

F-12 采用更严格的开发软预算：

| 类型 | 软目标 | 拆分触发点 | 现有硬门禁 |
| --- | --- | --- | --- |
| Reader shell/UI 模块 | ≤ 500 行且 < 20 KiB | 达到任一软目标的 80%，或出现第二个独立职责 | Reader 专项 < 24 KiB；全局 ≤ 1400 行 |
| Reader core/schema | ≤ 600 行且 < 24 KiB | schema、算法、迁移或序列化出现两个以上变化轴 | 新增 F-12 专项门禁 |
| Reader service/controller/store | ≤ 600 行且 < 24 KiB | 路由、业务编排、磁盘写入混入同一文件 | 新增 F-12 专项门禁 |
| Reader CSS 层 | < 20 KiB | 达到 16 KiB，或同时承担两个产品空间 | Reader 专项 < 24 KiB；全局 ≤ 2200 行 |
| Reader fragment | ≤ 400 行 | 书库、阅读、设置、批注或转交出现两个以上独立空间 | 新增 F-12 专项门禁 |

软预算不是鼓励把文件填满。一个文件即使只有 200 行，只要同时承担 Store、API、状态机和 DOM 渲染，也必须按职责拆分。

依赖方向固定为：

```text
core/schema
  ↑
store
  ↑
service
  ↑
controller/protocol
  ↑
desktop adapter/state
  ↑
view module
```

- 下层不得引用 DOM、桌面状态或视觉资源。
- Controller 不实现产品业务，只解析输入并调用 Service。
- Store 不处理 UI 兼容和跨模块跳转。
- Reader shell 模块不直接读写文件系统。
- 兼容迁移、正式主线和实验功能必须是三个独立模块。
- 每增加一个 F-12 工作包，都先在结构测试登记允许修改和新增的责任文件。

## 20. 测试与命令建议

新增脚本：

- `reader-2-core-test`：偏好、主题、字体、批注、历史和书库查询纯函数。
- `reader-2-storage-test`：方案、字体目录、批注、迁移和并发。
- `reader-2-shell-test`：书库、阅读、外观、HUD、导航和选择。
- `reader-2-structure`：模块职责、依赖方向、行数、字节数、fragment 和 CSS 分层。
- `reader-2-visual-audit`：选定视觉目标对照。
- `reader-2-font-acceptance`：默认、测试、缺失、损坏和回退字体。
- `reader-2-release-acceptance`：完整用户路径和四来源×三目标。

继续运行：

- `npm run reader-core-test`
- `npm run reader-storage-test`
- `npm run reader-shell-test`
- `npm run reader-performance-acceptance`
- `npm run reader-release-acceptance`
- `npm test`

旧 F-10 回归不能被新 Reader 2.0 测试替代。

## 21. 风险与控制

| 风险 | 影响 | 控制 |
| --- | --- | --- |
| 功能面过大 | 长期无法形成可用版本 | 以 M1–M5 逐阶段退出，但不改变最终范围 |
| 新 UI 继续走旧导入 | 书库与功能状态再次割裂 | F-12.1 作为所有 UI 工作的前置门禁 |
| 字体写死 | 未来安装字体必须重构 schema | F-12.2 首日完成 Font Provider 和稳定 fontId |
| 字体文件不安全或许可不清 | 崩溃、路径和分发风险 | 应用内 Store、格式/大小校验、许可元数据 |
| 字体变化导致位置漂移 | 用户找不到原位置 | Locator 捕获、实际字体缓存键和回退测试 |
| 纸张素材过重 | 首屏慢、显存高 | 本地压缩资源、延迟装饰、基础色先显示 |
| 自定义主题不可读 | 对比度或焦点失败 | 保存前校验、可访问安全模式、恢复默认 |
| 仿真翻页制造第二套正文 | 选择、无障碍和定位失真 | DOM/Locator 权威，动画仅为 Adapter |
| CSS 再次单体化 | 难以维护与回归 | 分层样式、release structure gate |
| 项目投影过期 | Reader 与写作内容不一致 | 打开/返回时刷新 Revision 和 freshness |
| 视觉验收过于技术化 | 功能通过但效果仍差 | 选定视觉目标、同视口截图比较和人工评审 |

## 22. 开发启动条件

正式改生产 UI 前必须满足：

- 两份 Reader 2.0 文档已由用户确认方向。
- 当前未提交的 Directive Stack 等改动已明确保存策略，避免跨功能混入。
- F-12.0 三个视觉方向已完成并选定一个。
- `release-config`、`reader-shell-structure` 和新增 `reader-2-structure` 门禁全绿。
- 当前 Reader 数据、Store、Locator、分页和 Transfer 回归全绿。
- 为 F-12 创建独立分支或明确提交边界。
- 视觉资产、字体夹具和纸张纹理有可追溯许可。

## 23. 首个开发批次建议

第一批只做 F-12.1 与 F-12.2，不开始大规模视觉重构：

1. 新导入向导接入 Reader Store。
2. 项目与外部书籍统一书库摘要。
3. 移除新文件进入 legacy localStorage 的路径。
4. 冻结 Preferences v2、Theme、Appearance Profile、Font Catalog 和 Annotation schema。
5. 首期注册一个默认字体，通过 Provider 解析。
6. 增加“导入后书库可见、书签/选区可用、重启可重开”的端到端门禁。

完成这一批后，Reader 才拥有唯一可靠的数据主线，后续书库、纸张和专注阅读 UI 不会建立在兼容状态上。

## 24. 交接说明

- F-10 是数据与安全基础的完成记录，不应被标记为失败或删除。
- F-12 是产品级 Reader 2.0，重点是独立书库、专业阅读体验和完整视觉质量。
- 不要直接扩写旧 `reader.js` 的文件导入和渲染逻辑。
- 不要先做纸张 CSS 再处理导入双轨；F-12.1 是绝对前置。
- 不要因为首期只显示一种字体而省略 Font Catalog/Provider。
- 不要在普通阅读态常驻写作、工作流或 AI 按钮。
- 不要把纹理、页面截图、Canvas 或动画状态当正文和 Locator 的权威来源。
- 每完成一个阶段，更新 `docs/FEATURE_TODO.md` 的 F-12 状态、测试命令、验收文件和下一步。
