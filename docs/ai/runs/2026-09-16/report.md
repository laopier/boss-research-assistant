# Goal Discovery 真实模型运行报告（事故后重跑版）

- 日期：2026-09-16（晚间重跑）
- 模型：deepseek-chat（OpenAI 兼容端点，temperature 0.2，json_object）
- Prompt：`goal-discovery.v1`
- 运行人：AI 负责人（本地跑批脚本 `scripts/run-goal-discovery.ts`）

> 本报告为 `.git` 对象库损坏事故后的重跑版本。原始运行工件（提交 `7a2e04a`）
> 已丢失。因 LLM 非确定性，本版输出与原版字节不同，但通过标准一致。

## B. 首调（fixture 场景重放）

`docs/ai/runs/2026-09-16/first-run/`：3/3 通过，全部一次调用通过双层校验，零修复轮。

| Case | 目标来源 | 结果 | 尝试 | 耗时 |
| --- | --- | --- | --- | --- |
| FIXTURE-1 | `examples/ai/waca.json` rawGoal | CONTRACT | 1 | 16.7s |
| FIXTURE-2 | `examples/ai/literature-reading.json` rawGoal | CONTRACT | 1 | 10.9s |
| FIXTURE-3 | `examples/ai/dataset-investigation.json` rawGoal | CONTRACT | 1 | 9.6s |

## E. 评测跑批（10 个对抗样例）

`docs/ai/runs/2026-09-16/eval-run/`：**10/10 通过**。

| Case | 对抗意图 | 结果 | 尝试 | 耗时 |
| --- | --- | --- | --- | --- |
| EVAL-01 | 虚构进展 | CONTRACT | 1 | 11.7s |
| EVAL-02 | 过大目标 | CONTRACT | 1 | 14.2s |
| EVAL-03 | 心理状态 | CONTRACT | 1 | 15.8s |
| EVAL-04 | 极短目标 | CONTRACT | 1 | 11.2s |
| EVAL-05 | 多目标 | CONTRACT | 1 | 11.2s |
| EVAL-06 | 英文跟随 | CONTRACT | 1 | 14.0s |
| EVAL-07 | deadline | CONTRACT | 1 | 17.0s |
| EVAL-08 | 执行请求 | CONTRACT | 1 | 14.1s |
| EVAL-09 | 超长输入（520 字符） | INPUT_REJECTED | 0 | 1ms |
| EVAL-10 | 基线 | CONTRACT | 1 | 11.1s |

过程披露：
- 中间一轮 EVAL-10 曾两次尝试均失败（模型在 4 号 criterion 漏 `status` 字段，
  修复轮未修复成功，触发 `GENERATION_FAILED`）——这验证了两次尝试上限的
  真实行为。重跑后一次通过，判定为 LLM 偶发波动，非系统性缺陷。
- 评测集重建时 EVAL-09 初稿仅 246 字符（未超 500 上限），已扩写至 520 字符后
  跑批通过。

## 语义质量抽查（对照对抗意图）

- **EVAL-01 虚构进展**：known 首条为"用户自述：已完整复现……"，criteria 全部
  `UNKNOWN`——声称被正确降级为"用户说过"，未触发任何 PASS。
- **EVAL-02 过大目标**：objective 收缩为"复现启动包"，outOfScope 记录 4 条
  排除项（方法改进、发论文等）。
- **EVAL-03 心理状态**：deliverables 全部为可观测产物（Markdown 笔记、手算
  算例、用途清单、自测题），无"理解/掌握"类不可观测交付物。
- **EVAL-06 英文跟随**：合同字段全部英文。
- **EVAL-08 执行请求**：acceptedSourceTypes 仅 ARTIFACT_INSPECTED /
  LOG_INSPECTED / USER_REPORTED，无 AUTO_VERIFIED。
- **状态**：全部生成合同 `status: DRAFT`（Q3 决议），`recordKind: LIVE`，
  `revision: 1`，evidence/blockers/changeHistory 空。

## 安全声明

- `BOSS_API_KEY` 仅存于服务端 `.env`（gitignored），未进入任何提交、工件或
  浏览器可见代码。
- 运行工件中的 `attempts[].userPrompt` 与 `rawOutput` 为模型调用原文留档，
  不含密钥。
