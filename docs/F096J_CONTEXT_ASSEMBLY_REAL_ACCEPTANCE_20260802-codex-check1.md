# F-09.6J 上下文装配 真实 Provider 验收

日期：20260802-codex-check1
项目：`f096j-real-context-assembly-20260802-codex-check1`
Run：`f096j-codex-check-20260802`
目标正文统计：约 6000（下限 4500）
模型：deepseek-v4-pro
开始：2026-08-02T13:05:28.904Z
结束：2026-08-02T13:16:05.501Z

## 检查清单

| ID | 项 | 结果 | 细节 |
|---|---|---|---|
| A1 | 读取已保存 DeepSeek 配置 | ✅ | profile=codex-default-deepseek; model=deepseek-v4-pro |
| A2 | DeepSeek 流式 canary | ✅ | chars=12 |
| B1 | 测试项目就绪（保留数据） | ✅ | f096j-real-context-assembly-20260802-codex-check1 |
| B2 | 创作 run 已创建/恢复 | ✅ | f096j-codex-check-20260802 |
| J-plan-b1 | plan 阶段上下文装配 | ✅ | plan: raw=9865 assembled=6334 ratio=0.642 usage=约 3k 输入 tokens（估算） |
| J-draft-b1 | draft 阶段上下文装配 | ✅ | draft: raw=14230 assembled=9836 ratio=0.691 usage=约 5k 输入 tokens（估算） |
| J-review-b1 | review 阶段上下文装配 | ✅ | review: raw=44987 assembled=23740 ratio=0.528 usage=约 12k 输入 tokens（估算） |
| C1 | 已批准正文场次数 ≥ 2 | ✅ | scenes=3 |
| C2 | 正文统计达到下限 4500 | ✅ | bodyStats=10032; raw=11860 |
| D1 | 章节装配预览非空 | ✅ | chapters=2; scenes=3 |
| D2 | 章名不含「第 N 批」 | ✅ | 双重契约的订立 / 代价的显形 |
| D3 | 装配模式 narrative 或 batch-compat | ✅ | narrative |
| E1 | 写作区已写入场景 | ✅ | transferred=3 |
| E2 | 项目章名不含「第 N 批」 | ✅ | 双重契约的订立 / 代价的显形 |
| E3 | 书库正文统计与进度同口径可计算 | ✅ | libraryBody=10032; raw=11860 |
| J-events | 存在 prompt_context_assembled 事件 | ✅ | count=5; stages=plan,draft,review |
| J-samples | 装配采样或事件至少其一成立 | ✅ | samples=3; events=5 |

通过：17/17

## 指标摘要

```json
{
  "bodyStatsChars": 10032,
  "rawCharacters": 11860,
  "sceneCount": 3,
  "chapterTitles": [
    "双重契约的订立",
    "代价的显形"
  ],
  "assemblyMode": "narrative",
  "contextAssemblySamples": [
    {
      "stage": "plan",
      "rawChars": 9865,
      "assembledChars": 6334,
      "compressionRatio": 0.642067916877851,
      "trimCount": 8,
      "selectedCompendiumCount": 5,
      "usageHint": {
        "source": "estimate",
        "label": "约 3k 输入 tokens（估算）"
      }
    },
    {
      "stage": "draft",
      "rawChars": 14230,
      "assembledChars": 9836,
      "compressionRatio": 0.6912157413914266,
      "trimCount": 2,
      "selectedCompendiumCount": 2,
      "usageHint": {
        "source": "estimate",
        "label": "约 5k 输入 tokens（估算）"
      }
    },
    {
      "stage": "review",
      "rawChars": 44987,
      "assembledChars": 23740,
      "compressionRatio": 0.5277080045346434,
      "trimCount": 4,
      "selectedCompendiumCount": 11,
      "usageHint": {
        "source": "estimate",
        "label": "约 12k 输入 tokens（估算）"
      }
    }
  ],
  "assemblyEventCount": 5,
  "callCount": 11
}
```

## 保留现场

- 项目目录：仓库 data root 下 `f096j-real-context-assembly-20260802-codex-check1`（勿删）
- 指标：`.ai_state/f096j-real-context-assembly-20260802-codex-check1-metrics.json`
- 本报告：`docs/F096J_CONTEXT_ASSEMBLY_REAL_ACCEPTANCE_20260802-codex-check1.md`

## 复跑

```bash
node tests/workflow-f096j-context-assembly-real-provider-acceptance.js
```

