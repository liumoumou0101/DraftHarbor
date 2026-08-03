---
title: Directive Stack Design Summary
status: Draft
revision: 4-codex
date: 2026-08-03
full_design: docs/DIRECTIVE_STACK_DESIGN.md
---

# Design Summary：指令栈 rev 4（Codex 修订版）

> 本版本由 Codex 在 Grok rev 3 基础上修订。完整修订理由、冲突处理和交接要求见 [`DIRECTIVE_STACK_DESIGN.md`](./DIRECTIVE_STACK_DESIGN.md) 的“Codex 修订说明（rev 4）”。当 rev 4 与后文保留的 rev 3 内容冲突时，以 rev 4 为准。

**实现状态（Codex，2026-08-03）：** rev 4 V1 已在当前工作树实现并通过完整 `npm test` 与 Writer audit。已落地 compiler、legacy/dual-write、canonical task transport、单通道 workflow envelope、版本化 freeze、旧 Run legacy、项目指令 UI、Workshop 会话指令和最终请求隔离测试。Packs、tail/sandwich、自动截断和高级 scope UI 按本修订版明确延后。

## 保留的 Grok 核心判断

当前 `settings.globalPrompt` 会无差别进入带消息的生成请求，工作流还会把同一正文放进 user JSON `globalContext.globalPrompt`。因此正文指令会污染 JSON、分析、资料库 Agent 和 Reader；同时缺少任务身份、项目作用域、迁移策略和可见性。

保留以下方向：

- 显式 `taskKind`，不能靠模糊的 `domain:action` 猜测多义任务。
- `streamGeneration` 是 system 指令唯一注入者。
- Builder 自有的模板/stage system 不进入栈。
- 新工作流在启动时冻结指令来源。
- 旧 `globalPrompt` 无损迁移，旧 UI partial patch 不丢数据。
- 最终 Provider 请求必须有“命中一次 / 完全隔离”的集成测试。

## Codex 修正的关键决策

1. **真正单通道。** 指令正文只进入 system；workflow user JSON 不再复制 applied layers、digest 正文或 legacy `globalPrompt`。Envelope 只保留 `taskKind`、版本、层 ID/hash 等审计元数据。`writingInstructions` 仍可作为业务输入存在。

2. **移除跨请求 applied 标记。** 不写 `prompt.meta.instructionStackApplied`。每次 `streamGeneration` 都从原始消息编译一次；重试同一 Prompt 仍注入一次，避免 rev 3 伪代码的“第一次有、重试丢失”问题。

3. **原子切换 scoped。** `taskKind`、system compile、workflow envelope 清理、freeze 和测试必须在同一 feature gate 后完成；在全部完成前保持 `parity`。不发布“system 已隔离但 user JSON 仍污染”的中间默认态。

4. **旧 Run 保持旧语义。** 旧快照只有 `snapshot.globalPrompt` 时使用 `legacy-unscoped`；不默认重新解释为 creative scopes。新 Run 写入 `directivePolicyVersion: 1` 并使用 scoped。可复现性优先于静默清洁历史运行。

5. **服务层负责冻结。** 首选由服务层根据持久化 settings/project 生成规范化 snapshot；若现阶段仍由客户端启动，则只传规范化 `project.directiveStack`，服务端校验并最终定稿，禁止要求每个入口传完整 project。

6. **V1 收缩。** 首版只实现 `app_defaults`、`user_global`、`project`、`run_session`。`profile_pack`、任意 `placement`、sandwich/tail pin、自动预算截断和复杂 `contract` 延后。

7. **不静默截断规则。** V1 保存/预览时提示长度；发送前只做总上限拒绝或显式警告，不把否定句、约束或 JSON 截成半句。后续若做预算，必须按完整段落/token 边界处理。

8. **默认契约保持中性。** 默认 app contract 只包含语言跟随、连续性、禁止创作过程 meta、服从当前输出格式。成人题材能力不进入默认文本；只有项目或本次任务明确要求时才进入 project/session 层。

9. **Canonical task identity。** 调用点最终必须提供一个规范化 `taskKind`。`target.type`、旧 `meta.task` 和 workflow node 映射仅用于迁移适配，不能长期成为多套并行真相。开发/测试环境缺失 taskKind 应报错；生产回退 `unknown` 并隔离用户创作层。

10. **不重复泛化模板。** `app_defaults` 与 `task_policy` 必须短小；若 Builder 已定义 JSON/no-Markdown 等要求，不再追加同义 system 段。防止用更多通用提示修复“提示稀释”。

## V1 数据与作用域

```js
directiveStack: {
  schemaVersion: 1,
  mode: 'parity' | 'scoped',
  userGlobal: {
    enabled: true,
    content: '',
    scopes: ['writer-prose', 'writer-rewrite', 'workshop-chat',
      'workflow-draft', 'workflow-rewrite', 'workflow-repair']
  }
}
```

项目仅保存同形的 `layers`；Workshop/单次 override 作为 `run_session`。首版不保存 packs、placement、自由 priority 或 tail pin。

## 修订后的交付顺序

| 阶段 | 内容 | 默认行为 |
|---|---|---|
| A | 纯编译器、legacy migration、dual-write、最终请求测试骨架 | `parity` |
| B | 所有调用点规范化 `taskKind`；AITaskRunner 转发 task identity | `parity` |
| C | workflow 新快照、旧快照 legacy 语义、移除 user JSON 指令正文 | `parity` |
| D | system scoped compile + C 的 envelope/freeze 一起原子启用 | `scoped` |
| E | UI、项目指令、Workshop session override | `scoped` |
| Later | packs、预设、token/段落预算、经 canary 验证的 anti-dilution | 可选 |

## 必测验收

- 创作任务：目标用户/项目指令在最终 Provider messages 中恰好出现一次。
- JSON、Agent、Reader：用户创作指令在整个最终请求中出现零次，包括 user JSON。
- 同一个 Prompt 对象连续调用两次：两次各出现一次。
- 缺少 taskKind：测试/开发失败；生产 `unknown` fail-closed。
- 旧 Run：升级前后保持 legacy 注入语义；新 Run 使用版本化 scoped snapshot。
- partial `{ globalPrompt }` 更新 `userGlobal` 的 enabled/content，保留 scopes。
- partial `directiveStack` 不丢其他层和设置。

## 给 Grok 的交接留言

Grok：rev 3 的代码审计、taskKind 冲突识别、dual-write 风险和 stream 单一所有者原则都保留。Codex 已按 rev 4 实现 V1；接手时请先审查当前 diff 和 `tests/instruction-stack.js`，不要退回 rev 3 的 `instructionStackApplied` 伪代码，也不要在 user JSON 中重复指令正文。旧 Run 必须继续保持 legacy 语义；成人题材相关内容只作为显式 project/session 指令处理，不放入 app default。后续重点是做真实 Provider canary 和 UX 打磨，不要在缺少质量证据时恢复 packs、tail sandwich 或静默截断。
