# 写作书桌能力保留与入口迁移

日期：2026-10-22。原生写作基线：`0120d9087fb046bba95486989e9f7c5ecbeac65f`。实施依据：[`2026-10-22-writer-literary-desk.md`](../superpowers/plans/2026-10-22-writer-literary-desk.md)。完整运行结果见 [正式集成与交付](2026-10-22-writer-desk-integration.md)。

本次保留原生项目 → 章节 → 场景、原有标识符、textarea、数据 API、保存与生成保护。变化的是布局和入口。低频能力可以折叠，但不能删除、变成演示按钮，或只能通过开发者工具访问。复用已绑定的原节点，避免复制出第二个正文或第二套状态。

## 证据口径

- **基线确认**：从上述提交的 `desktop/fragments/writer.html` 与原生处理器读到的能力；不表示新版运行通过。
- **迁移约定**：由书桌实现负责人与本表共同约定的新入口；在最终代码检查前不记为已实现。
- **静态保留**：HTML 中原控制标识、面板与选项仍存在；不能证明可见、可聚焦、处理器可用或 API 成功。
- **自动行为验证**：使用真实处理器及隔离的 DOM/存储/API 边界运行测试。仍不能代替布局、输入法与实际导出验收。
- **界面验收**：在临时项目/配置中从实际入口完成操作，并记录截图或结果。未执行的检查明确保留为待验收。

最终实现静态审查已核对原始 174 个交互控制标识、8 个助手面板、12 个改写预设，并检查书桌与修订范围模块。静态合同及修订范围单元测试通过；发现的两项遗漏场景及修复状态记录于文末。没有将「存在于源码」标记为「功能通过」。

## 新导航合同

| 用户入口 | 原生目标与约束 |
| --- | --- |
| 顶部「写作」 | 已实现 `data-native-desk-mode="write"` → `selectMode('write')` → 原 `gen-task=continue` 按钮的 click 处理器；实际 `generate` 面板迁入 `data-native-desk-dock`。 |
| 顶部「构思」 | 已实现 `data-native-desk-mode="conceive"` → 同一 `generate` 面板 → 原 `gen-task=beat` 按钮的 click 处理器；没有另造模型接口。 |
| 顶部「修订」 | 已实现 `data-native-desk-mode="revise"` → 实际 `rewrite` 面板；保留润色和大段重生成两条操作链。 |
| 右侧「当前场景」概览 | 已实现 `data-native-desk-open-tool="metadata/context/characters"` → `openTool`；资料卡通过真实 ID 调用 `openCompendiumPeek`。概览之外保留完整原生面板。 |
| 右侧工具选择 | 已实现 `data-native-desk-tool` 的 `characters/context/metadata/structure/search/history` 六个选项 → `openTool`；中央 composer 不随右侧工具关闭。|
| 设置/更多工具 | 原 `data-native-open-writer-settings`、`data-native-more-tools` 与既有事件绑定保留。新增 `data-native-desk-appearance-toggle` 打开字号/字体/夜间/减少动效模态；行高/宽度/段距/目标仍从原排版设置进入。 |
| 「经典布局」 | 已实现 `data-native-desk-layout` → `applyLayout`，使用原位置注释标记还原真实面板和折叠控件；恢复旧助手分组/面板与位置切换。偏好使用独立 `draftharbor:writerDesk:v1`，未增加作品 schema。 |

中央生成/改写区保留实际输入、参数与执行按钮。生成所用参考与建议可折叠；改写预设可折叠；折叠标题应说明内容且支持键盘。生成结果、保留/重试/撤回、停止、推理详情、保存冲突提示和阅读来源提示必须放在可见祖先内，不能因切换工具而失去入口。

## 能力清单与迁移位置

下列标识省略 `data-native-` 前缀，其他前缀会完整写出。所有行具有基线源码证据；新入口按上述真实控制器路径静态核对，具体功能运行验证记录见文末。

| 能力 | 原有控制/处理器证据 | 新入口与必须保留的行为 |
| --- | --- | --- |
| 项目打开、新建、书库返回 | `new-project`、`show-bookshelf`；`writer-bindings.js` | 左侧作品标题区。现有书库打开路径及项目切换保护保持原样；不得压平章节/场景或生成新 ID 来模拟目录。 |
| 章节与场景创建、定位、展开 | `add-chapter`、`add-scene`、`scene-list`；`addNativeChapter`、`addNativeScene`、`renderNativeEditor` | 左侧章节目录；保留活动章节/场景、展开状态、拖动重排。 |
| 重命名、删除、重排 | `outline-action=rename/delete/move-up/move-down`；结构面板的 `rename-*`、`delete-*`、`move-scene-up/down`；`writer-chrome.js` | 左侧右键菜单和右侧「结构与导出」。章节、场景均可上下移动；原删除确认与边界禁用保持。场景标题双击/键盘编辑仍可用。 |
| 正文与统计 | 唯一 `scene-editor`；`updateNativeStats`；`scene-title` | 中央正文。保持字数、目标字数、未保存/已保存状态及原 textarea 选择/输入事件。 |
| 保存、自动保存、冲突与恢复 | `save-scene`、`copy-unsaved-draft`、`reload-saved-draft`；`saveNativeScene`、`ensureNativeProjectSaved` | 中央顶部保存及原恢复提示条。Ctrl/Cmd+S、保存修订号、失败时保留草稿、复制草稿、备份并重载、切换保护、关闭保护均保留。 |
| 续写与按拍创作 | `gen-task=continue/beat`、`beat-input`、`generate`；`startNativeGeneration` | 「写作」/「构思」中央 composer；原三条建议、`length-hint` 三档、提示词预览、取消仍可用；草稿方向不因切页丢失。 |
| 生成场景摘要 | `gen-task=summary`、`generate-scene-summary`；`generateNativeSummary` | 中央原任务选择和右侧场景信息。生成摘要不伪装成正文续写，完成后仍可检查/保存。 |
| 插入位置 | `generation-insert-mode=append/cursor/replace`；`writer-generation-position.js` | 写作设置。保持追加、光标插入、替换选区的真实捕获位置及场景保护。 |
| 选区改写 | `rewrite-task=polish/expand/shorten/style`、`rewrite-preset`、`rewrite-instruction`、`preview-rewrite`、`start-rewrite`；`startNativeRewrite` | 「修订」中央 composer；右键「润色选区」也进入此处，显示原文、真实范围与要求。 |
| 全部改写预设与保存的提示词 | `rewrite-preset` 的 12 个选项、`rewrite-saved-prompt`；`renderRewritePresetOptions` | 修订中的可展开设置。保留润色、压缩、铺开、少说多看、对白口吻、角色声音、加压、加快、接上文、凝练、校对、自定义。不能仅剩顶部四个快捷任务。 |
| 大段重生成与上下文预算 | `rewrite-regenerate`、`regenerate-instruction`、`regenerate-use-context`、`regenerate-context-chars`、`regenerate-selection`；`startNativeRegenerateSelection` | 修订下的独立「重生成选区」；保留独立要求、是否附上下文、每侧 0–20000 字预算。普通改写保留 `rewrite-context-chars` 每侧 0–8000 字预算，二者不可合并。 |
| 候选、推理与错误恢复 | `accept-generation`、`retry-generation`、`discard-generation`、`stop-generation`、`cancel-generation`、`reasoning-toggle/copy/latest`；`writer-generation-view.js` | 中央生成结果区保持可见；保留实时状态、查看/复制思考、回到最新、停止、保留、重试、撤回以及错误和中断反馈；操作不可覆盖正文或被 composer 遮住。 |
| 提示词模板管理 | `prompt-template`、`manage-prompts`、`data-prompt-manager-*`；`writer-prompts.js` | 写作设置 → 提示词管理。保留正文/改写/摘要等原分类、系统内容、正文内容、新建、保存、删除、选用和预览。 |
| 用户全局与项目指令 | `manage-global-prompt`、`global-prompt-*`、`project-directive-*`；`writer-global-prompt.js` | 设置 → 指令栈。两层开关、内容、提交/取消、项目切换检查与保存失败保护保留；原有适用任务范围不因迁移扩大。 |
| 避免写法 | `style-guard` 三个原入口；`src/desktop/shell/style-guard.js` | composer 的规则状态及更多工具。保留全局/项目规则、计数、作用范围及持久化；不能只留静态计数。 |
| 配置组、模型与思考 | `profile-select`、`model-select`、`custom-model`、`thinking-toggle`；`writer-prompts.js`/`writer-bindings.js` | composer 模型按钮 → 写作设置；保留继承配置/模型、手填模型、受模型能力约束的思考开关，所有思考开关同步。 |
| 采样与输出上限 | `temperature`、`max-tokens`、`provider-defaults` | 写作设置。保留服务商默认值模式与参数说明，不由新布局写入虚构默认。 |
| 精确资料引用与标签 | `context-compendium`、`context-compendium-tags`；动态 `nativeCompendiumReference`、`nativeCompendiumPeek`；`setNativeCompendiumReference` | 右侧「参考资料」。选中的是具体资料 ID，保留资料标签、手动引用、常驻/提及自动注入与来源说明；不能用摘要卡替换原引用选择。 |
| 章节/场景引用 | `context-chapters`、`context-scenes`、`context-summary`；`renderNativeContext` | 右侧「参考资料」。逐章节、逐场景保留「不引用/摘要/全文」；切换工具后选中值和项目范围不丢失。 |
| 人物卡与资料速览 | `new-character`、`open-compendium`、动态 `nativeCharacterPeek`；`renderNativeCharacters`/`openCompendiumPeek` | 右侧「人物」，概览可跳转。保留新人物、资料库跳转、点卡速览与准确 ID；速览的引用切换仍影响真实写作上下文。 |
| 场景信息与摘要 | `scene-summary/tags/pov/tense`、`summary-template`、`generate-scene-summary`、`generate-chapter-summary` | 右侧「场景信息」。保留手写摘要、两种摘要生成、摘要模板、标签、视角、时态和「摘要待更新」提示。 |
| 摘要查看、编辑与资料联动 | `summary-dialog-content/save/copy/edit/close`；`writer-overlays.js` | 场景右键查看摘要/摘要生成结果 → 原摘要对话框；保留保存、复制、前往编辑、链接摘要资料卡及异步保存期间防关闭。 |
| 全文搜索与替换 | `search`、`search-prev/next`、`replace`、`replace-current/all`；`replaceNativeText` | 右侧「查找替换」。保留章节/场景/正文搜索、匹配计数、上下一个、当前与全部替换及摘要失效标记；生成锁定期间不能破坏正文。 |
| 调用历史复用 | `generation-history`、`history-toolbar`；动态 `history-filter/reuse/copy/retry/insert/delete` | 右侧「调用历史」。保留任务/时间/字数/场景信息、当前场景过滤、加载更早记录、历史提示词展开与复制、复用提示/结果/思考、复制结果、重试、插入当前场景、删除记录。历史内容不是固定示例。 |
| 五种导出 | `export-md/txt/html/epub/package`、`export-include-scene-titles`；`writer-export.js` | 右侧「结构与导出」。Markdown、TXT、HTML、EPUB、项目包全部保留；保持「包含场景标题」开关、保存屏障和项目切换保护。 |
| 阅读器来源快照 | `data-reader-source-return/dismiss/use`、`data-reader-writer-*`；`reader-writer-transfer.js` | 顶部原来源条 → 原快照接入对话框。保留定位、追加、覆盖、新场景、新项目、范围选择、目标/冲突预览、刷新、确认及来源返回。 |
| 送往讨论与提取资料 | `context-action=send-to-workshop/extract-compendium`、`send-to-workshop`、`save-to-compendium` | 正文选区右键菜单与原有按条件出现的工具入口；保留准确选区快照、目标、应用/保存流程。默认隐藏的旧工具按钮不应误报为已移除。 |
| 排版、朗读与特殊符号 | `format-manuscript`、`read-aloud/stop-reading`、`toggle-specials`、`special-char=*`；`writer-format.js` | 更多工具及原正文右键入口。保留全文/选区格式化、安全替换、朗读停止、十个符号插入和原输入位置。 |
| 字体、字号与阅读宽度 | `toggle-typography`、`editor-font-size/line-height/text-width/paragraph-spacing/font-family/word-goal` | 更多工具 → 排版设置；默认正文 24px，同时保留系统/衬线/微软雅黑、可调行高/宽度/段距/目标字数与既有偏好。 |
| 侧栏、专注与快捷键 | `toggle-outline`、`toggle-assistant`、`assistant-placement`、两个 `resize-*`；`writer-sidebar-resize.js` | 目录/参考栏显隐、可恢复的专注模式；经典布局保留助手侧边/底部位置和尺寸。保留 Ctrl/Cmd+S、Ctrl/Cmd+Shift+N、Alt+上下、菜单方向键/Esc/Shift+F10 的原作用范围。 |

## 自动验证覆盖与边界

`node tests/writer-capability-preservation.js` 使用固定基线清单检查 174 个交互标识（含有值的任务/菜单动作及阅读交接），确保原多入口数量不减少、8 个面板唯一、12 个预设存在，以及正文/主要状态字段不被复制。它不读取当前 HEAD 来重新定义基线，因此删除能力不能通过更新 HEAD 自动绕过检查。

此静态检查不检查 CSS 可见性、所有祖先的 `hidden` 状态、焦点、实际回调或网络结果。动态生成的资料/人物/历史项也不在 HTML 数量检查内；这些通过原功能测试与以下实际验收覆盖。不要以这个测试通过来代替路由或运行验收。

现有相关测试组（列出覆盖用途，不等于此次已运行）：

| 命令/文件 | 覆盖用途 |
| --- | --- |
| `npm run writer-reasoning-test` | 插入位置、推理状态、重试、选区与生成保护。 |
| `npm run writer-save-test` | 保存状态、保存后导出、项目切换、上下文、提示词加载、真实事件处理器、避免写法。 |
| `node tests/reader-writer-transfer-ui.js` / `reader-writer-transfer-service.js` | 阅读快照接入界面与服务边界。 |
| `node tests/compendium-peek.js` | 资料/人物速览与引用联动。 |
| `node tests/writer-desk.js` | 隔离临时项目的 Playwright 测试：写作/构思/修订与六个工具面板、节点身份、经典还原、偏好和选择状态；本审查未启动该浏览器测试。 |
| `node tests/writer-revision-range.js` | 使用真实修订/生成处理器和隔离 VM 的快照、候选目标、过期选区、镜像生命周期、输入法与接受/撤回检查；不请求模型。 |

## 实际验收清单

使用隔离配置和临时作品：两章、每章两场景、同名不同 ID 的两张人物/资料卡、有/无摘要场景、至少一条生成历史。模拟模型响应即可检查路由与安全性；不需要为布局验收调用付费模型。

1. **导航与状态**：三种顶部模式和全部右侧选项逐一进入；输入方向/改写要求、选择真实选区后切换，再返回确认输入、光标及状态保留。书桌/经典反复切换不增添第二个正文，不丢事件处理器。
2. **目录与项目**：创建/重命名/重排/删除临时章与场景；测试左右边界、右键、键盘菜单、拖动和跨章定位。草稿未保存或生成中切项目仍走原保护。
3. **正文保存**：输入中文和组合输入，保存、重开确认；注入保存失败/冲突后复制草稿、备份并重载，验证任何布局都能看到恢复入口。
4. **创作**：续写/按拍/摘要、三档篇幅、三个插入位置、取消、推理展开/复制/回到最新、保留/重试/撤回全部可操作，状态切换后仍显示实际目标。
5. **修订**：遍历 12 预设及已保存提示词，使用独立大段重生成要求；分别调整两种上下文预算及关闭上下文。检查高亮/原文与实际捕获范围一致；改正文、换场景、失败、重试、撤回后不会接受过期范围。
6. **设置**：在两类 composer 打开同一设置，验证模型/配置继承、手填、思考、温度/上限/服务商默认；管理正文/改写/摘要模板和全局/项目指令。样式规则修改后计数与真实提示词一致。
7. **参考与人物**：同名不同 ID 卡只选中目标卡；手动引用/标签/常驻/提及、章节与场景的摘要/全文模式切换后预览正确；打开速览并切引用；新建人物可返回写作。
8. **摘要/信息**：手改摘要/标签/视角/时态后保存；生成场景及章节摘要，保存/复制/前往编辑；正文变化显示待更新，不把陈旧摘要当新结果。
9. **查找/历史**：搜索跨章节文本、前后定位、当前/全部替换及生成锁定；历史过滤、复用、复制、重试、插入、删除及提示词展开分别检查。
10. **导出/跨模块**：五种格式分别导出并检查最新内容与顺序、场景标题开关；阅读快照各处理方式与确认预览；选区送讨论/提资料后校对来源范围和目标。
11. **工具与偏好**：排版全文和选区、十个符号、朗读/停止、字体/24px 默认及用户字号、行高/宽度/段距、目标、目录/参考栏显隐、专注退出、经典助手位置/尺寸。重开保留偏好。
12. **布局与可访问性**：1280×720 与 2560×1440、24px 与最大字号、长正文/长候选/长历史。Tab 可达折叠内容，模态关闭回到触发点，菜单 Esc/方向键正确；执行/保留/撤回不被容器裁剪，撤回操作满足至少 44px 的已批准目标；夜间与减少动效不损害可读性。

## 本次证据记录

| 项目 | 状态 | 证据/限制 |
| --- | --- | --- |
| 基线能力盘点 | 完成 | 读取原生 HTML 与 `writer-core/bindings/chrome/prompts/generation/generation-view/overlays/global-prompt/export/format` 等处理器；未读取与本迁移无关的 R18 资料。 |
| 新入口实现 | 已静态核对 | `writer-desk.js`、原生 HTML、bootstrap 与修订模块实际代码；三种顶部模式、右侧六个工具面板和经典还原路径已在上表列出。未以此宣称界面可见性通过。 |
| 静态合同 | 最终审查阶段通过 | 再次运行 `node tests/writer-capability-preservation.js`：174 个标识、8 面板、12 预设与唯一状态字段通过。 |
| 合同测试自身检查 | 通过 | 独立内存变体确认删除 EPUB 入口、复制正文、删除预设、删除历史面板都会触发失败；没有修改生产 HTML。新增测试通过 ESLint。 |
| 修订范围单元测试 | 修复后重跑通过 | `node tests/writer-revision-range.js`：快照、候选目标、过期保护、镜像生命周期及新增的「空失败后乙段改选丙段」回归通过；新范围对应 mark/excerpt/下一请求、失败历史保留均有断言。无 API 请求。 |
| 保存及跨模块保护 | 静态核对及全量回归通过 | 书桌没有替换原 `saveNativeScene`、导出屏障、读取器接入/确认、选区接受保护及回调；真实正文和已绑定节点仍在同一 writer 根节点下。完整 `npm test` 退出码 0。 |
| 概览后原生摘要编辑路由 | 修复后无浏览器复核通过 | 在内存执行真实控制器 `metadata → overview → 原生 metadata 路由`，现得到 `deskTool=metadata, metadataHidden=false, overviewHidden=true`。对应真实界面回归已加入 `tests/writer-desk.js`，运行结果由集成验收汇总。 |
| 最终静态审查 | 范围内无剩余阻塞 | 检查真实节点迁移/还原、原生路由、保存处理器与选区生命周期；两项发现已修复并复核。CSS 不在此次审查范围内；完整界面/打包验收仍需独立记录。 |
| 浏览器/打包验收 | 集成阶段完成 | 隔离浏览器、回环 SSE 生成链路、真实打包 EXE 验收通过；详见独立的正式集成报告，不把静态盘点本身当成运行证据。 |

### 静态审查发现及修复

1. **摘要「前往编辑」被概览状态吞掉（已修复）**：原实现先选择场景信息，再选择概览后保留 `assistantPanel='metadata'` 和 `lastPanel`，导致原摘要对话框再设置相同的 `metadata` 时仍显示概览。定位：`writer-desk.js:173` 的 `openTool`，调用源 `writer-overlays.js:267`。修复将概览时的原生 panel 对齐到当前 composer，使后续原生编辑路由能被观察到。无浏览器真实控制器序列由 `metadataHidden=true` 变为 `false`；界面回归同时检查摘要输入获得焦点。
2. **空结果失败后新选区与反馈不一致（已修复）**：原实现乙段生成空结果失败后直接选丙段，下一请求已用丙段，高亮却因旧 `selectionTarget` 保持乙段。定位：`writer-revision-range.js:187` 的 `onSelection`。修复在无正文结果/活动请求/待接收正文且新选区确实不同的分支，使用原撤回路径释放空失败目标，再捕获新范围；历史保留，有正文结果和流式生成的保护不变。新增 VM 回归确认 mark、excerpt 与下一请求一致，审查者重跑通过。
