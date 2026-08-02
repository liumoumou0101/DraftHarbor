# F-09.6J 上下文装配 真实 Provider 验收

日期：20260802
项目：`f096j-real-context-assembly-20260802`
Run：`f096j-context-creation-20260802`
目标正文统计：约 6000（下限 4500）
模型：deepseek-v4-pro
开始：2026-08-02T09:03:42.923Z
结束：2026-08-02T09:03:43.994Z

> 复验性质说明：本报告对应恢复已完成 Run 后的幂等复验；约 1.1 秒耗时和 `callCount=1` 主要是 canary 与已有产物/事件断言。首次全量 6K 生成已在此前完成，因此这里不应解读为当前代码在 1.1 秒内重新生成了全部正文。

## 检查清单

| ID | 项 | 结果 | 细节 |
|---|---|---|---|
| A1 | 读取已保存 DeepSeek 配置 | ✅ | profile=1784884056516; model=deepseek-v4-pro |
| A2 | DeepSeek 流式 canary | ✅ | chars=12 |
| B1 | 测试项目就绪（保留数据） | ✅ | f096j-real-context-assembly-20260802 |
| B2 | 创作 run 已创建/恢复 | ✅ | f096j-context-creation-20260802 |
| C1 | 已批准正文场次数 ≥ 2 | ✅ | scenes=3 |
| C2 | 正文统计达到下限 4500 | ✅ | bodyStats=9394; raw=11071 |
| D1 | 章节装配预览非空 | ✅ | chapters=2; scenes=3 |
| D2 | 章名不含「第 N 批」 | ✅ | 借名 / 债务浮现 |
| D3 | 装配模式 narrative 或 batch-compat | ✅ | narrative |
| E1 | 写作区已写入场景 | ✅ | transferred=3 |
| E2 | 项目章名不含「第 N 批」 | ✅ | 借名 / 债务浮现 |
| E3 | 书库正文统计与进度同口径可计算 | ✅ | libraryBody=9394; raw=11071 |
| J-events | 存在 prompt_context_assembled 事件 | ✅ | count=5; stages=plan,draft,review |
| J-samples | 装配采样或事件至少其一成立 | ✅ | samples=5; events=5 |

通过：14/14

## 指标摘要

```json
{
  "bodyStatsChars": 9394,
  "rawCharacters": 11071,
  "sceneCount": 3,
  "chapterTitles": [
    "借名",
    "债务浮现"
  ],
  "assemblyMode": "narrative",
  "contextAssemblySamples": [
    {
      "stage": "plan",
      "rawChars": 9377,
      "assembledChars": 6338,
      "compressionRatio": 0.6759091393835982,
      "trimCount": 6,
      "selectedCompendiumCount": 4,
      "styleExemplar": {
        "sourceSceneId": "",
        "chars": 0,
        "strategy": "none"
      },
      "source": "event"
    },
    {
      "stage": "draft",
      "rawChars": 14087,
      "assembledChars": 10304,
      "compressionRatio": 0.7314545325477391,
      "trimCount": 2,
      "selectedCompendiumCount": 2,
      "styleExemplar": {
        "sourceSceneId": "",
        "chars": 0,
        "strategy": "none"
      },
      "source": "event"
    },
    {
      "stage": "draft",
      "rawChars": 17964,
      "assembledChars": 11400,
      "compressionRatio": 0.6346025384101537,
      "trimCount": 3,
      "selectedCompendiumCount": 2,
      "styleExemplar": {
        "sourceSceneId": "",
        "chars": 0,
        "strategy": "none"
      },
      "source": "event"
    },
    {
      "stage": "draft",
      "rawChars": 20153,
      "assembledChars": 12515,
      "compressionRatio": 0.6209993549347491,
      "trimCount": 4,
      "selectedCompendiumCount": 4,
      "styleExemplar": {
        "sourceSceneId": "",
        "chars": 0,
        "strategy": "none"
      },
      "source": "event"
    },
    {
      "stage": "review",
      "rawChars": 43347,
      "assembledChars": 22957,
      "compressionRatio": 0.5296098922647473,
      "trimCount": 4,
      "selectedCompendiumCount": 8,
      "styleExemplar": {
        "sourceSceneId": "",
        "chars": 0,
        "strategy": "none"
      },
      "source": "event"
    }
  ],
  "assemblyEventCount": 5,
  "callCount": 1
}
```

## 保留现场

- 项目目录：仓库 data root 下 `f096j-real-context-assembly-20260802`（勿删）
- 指标：`.ai_state/f096j-real-context-assembly-20260802-metrics.json`
- 本报告：`docs/F096J_CONTEXT_ASSEMBLY_REAL_ACCEPTANCE_20260802.md`

## 复跑

```bash
node tests/workflow-f096j-context-assembly-real-provider-acceptance.js
```
