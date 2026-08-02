# F-09.6I 6K 真实 Provider 验收

日期：20260731
项目：`f096i-real-6k-assembly-20260731`
Run：`f096i-6k-creation-20260731`
目标正文统计：约 6000（下限 4500）
模型：deepseek-v4-pro
开始：2026-07-31T06:41:19.260Z
结束：2026-07-31T06:51:58.773Z

## 检查清单

| ID | 项 | 结果 | 细节 |
|---|---|---|---|
| A1 | 读取已保存 DeepSeek 配置 | ✅ | profile=1784884056516; model=deepseek-v4-pro |
| A2 | DeepSeek 流式 canary | ✅ | chars=11 |
| B1 | 测试项目就绪（保留数据） | ✅ | f096i-real-6k-assembly-20260731 |
| B2 | 创作 run 已创建/恢复 | ✅ | f096i-6k-creation-20260731 |
| C1 | 已批准正文场次数 ≥ 2 | ✅ | scenes=3 |
| C2 | 正文统计达到下限 4500 | ✅ | bodyStats=9720; raw=11612 |
| D1 | 章节装配预览非空 | ✅ | chapters=2; scenes=3 |
| D2 | 章名不含「第 N 批」 | ✅ | 账册的扉页 / 菌丝的路径 |
| D3 | 装配模式 narrative 或 batch-compat | ✅ | narrative |
| E1 | 写作区已写入场景 | ✅ | transferred=3 |
| E2 | 项目章名不含「第 N 批」 | ✅ | 第 1 章 / 账册的扉页 / 菌丝的路径 |
| E3 | 书库正文统计与进度同口径可计算 | ✅ | libraryBody=9720; raw=11612 |

通过：12/12

## 指标摘要

```json
{
  "bodyStatsChars": 9720,
  "rawCharacters": 11612,
  "sceneCount": 3,
  "chapterTitles": [
    "账册的扉页",
    "菌丝的路径"
  ],
  "assemblyMode": "narrative",
  "callCount": 12
}
```

## 保留现场

- 项目目录：仓库 data root 下 `f096i-real-6k-assembly-20260731`（勿删）
- 指标：`.ai_state/f096i-real-6k-assembly-20260731-metrics.json`
- 本报告：`docs/F096I_6K_REAL_ACCEPTANCE_20260731.md`

## 复跑

```bash
node tests/workflow-f096i-6k-real-provider-acceptance.js
```
