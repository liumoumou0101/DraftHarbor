# F-09.6H 质量锁真实 Provider 验收（20260730）

> 会话交接入口：`docs/SESSION_HANDOFF.md` 顶部「本会话完成内容（F-09.6H）」  
> 设计与锁分配：`docs/F096H_QUALITY_LOCKS_DESIGN.md`  
> 进度勾选：`docs/FEATURE_TODO.md` §F-09.6H  

## 结论

使用已保存的 DeepSeek 配置完成连通 canary、真实短正文生成、审查与运行中调锁验收。  
**通过 24/24** 项。

- 项目：`F-09.6H 质量锁真实验收`（`f096h-quality-locks-real-20260730`）
- 从零 Run：`f096h-locks-creation-20260730`
- 续写 Run：`f096h-locks-continuation-20260730`
- 指标：`.ai_state\f096h-quality-locks-real-20260730.json`
- 真实正文字符：1852
- 对话比例（确定性）：30.0%
- API Key：**未写入本文件**

## 验收清单

| ID | 项目 | 结果 | 说明 |
|---|---|---|---|
| A1 | 读取已保存 DeepSeek 配置 | ✅ | workflowProfile=1784884056516; model=deepseek-v4-pro |
| A2 | DeepSeek Pro 流式 canary | ✅ | chars=15; 1011ms |
| A3 | DeepSeek Flash 流式 canary | ✅ | 863ms |
| B1 | 真实短正文生成 | ✅ | chars=1852; 44086ms |
| B2 | 确定性指标可计算对话比例 | ✅ | dialogue=30.0% |
| B3 | 真实正文未命中过程标签硬门禁 | ✅ | leaks=0 |
| B4 | 技术说明腔 soft 可检出 | ✅ |  |
| B5 | 技术说明腔 hard 可阻断 | ✅ |  |
| C1 | 从零创作持久化 writing-instructions | ✅ | revision=instructions-r-be2eb643-d67c-4862-a118-5a7483e0d2cc |
| C2 | qualityTargets 默认对话软指标开启 | ✅ |  |
| C3 | 排除锁默认可 soft（非全部 hard） | ✅ |  |
| C4 | 准备审查 Prompt 成功 | ✅ | 复用已有审查产物 |
| C5 | 真实语义审查有输出 | ✅ | 复用已有审查产物 |
| C6 | 审查产物含 metrics | ✅ | findings=5; parse=reuse-existing |
| C7 | 技术腔 finding 出现（soft） | ✅ | soft |
| C8 | 无 direction_missing 硬误报 | ✅ | direction_literal_absent/soft |
| D1 | 审查页升硬后 qualityTargets.technicalRegisterLocked | ✅ | {"locked":true,"mode":"avoid"} |
| D2 | 升硬后 finding 为 hard 或门禁阻断 | ✅ | gate=blocked; blocking=1; finding=hard |
| D3 | 豁免后可不阻断（若仅剩 soft 技术腔） | ✅ | gate=passed |
| D4 | 可批量改写 constraints + qualityTargets | ✅ | constraints=3 |
| E1 | 续写启动持久化 writing-instructions | ✅ | continuation-writing-instructions |
| E2 | 续写 settings.constraints 可读 | ✅ | count=1 |
| F1 | 排除 soft 命中不阻断 | ✅ |  |
| F2 | 排除 hard 命中阻断 | ✅ |  |

## 人工可复查

1. 打开项目 `f096h-quality-locks-real-20260730` → 工作流 → 选中 `f096h-locks-creation-20260730`。
2. 看「当前运行 · 创作锁」是否回显约束与质量目标。
3. 打开审查产物：应有质量指标、技术腔 finding（若仍保留）。
4. 对 finding 点升硬/豁免，确认按钮可用且门禁变化。
5. 续写 run 应有 writing-instructions 产物。

## 调用摘要（无密钥）

- canary-pro: deepseek-v4-pro, 1011ms, out=15, think=0, usage=29
- canary-flash: deepseek-v4-flash, 863ms, out=14, think=0, usage=27
- short-prose: deepseek-v4-pro, 44086ms, out=1852, think=510, usage=1599
