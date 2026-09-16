# Goal Discovery 第一阶段实施计划（事故后重建版）

> 本文档为 2026-09-16 本地 `.git` 对象库损坏事故后的重建版本，忠实反映当前
> 仓库状态与已决事项。原始版本（385 行）随 5 个未推送提交一并丢失。

## §1 概念定位（不变）

Goal Discovery 是把"模糊意图"转成"有边界的下一步目标"的适配器：

- 输入：`{ schemaVersion: "boss-contract.v0", goal: string }`（goal trim 后 1–500 字符）
- 输出：一个通过双层校验的 `boss-contract.v0` 合同（`recordKind: LIVE`、`status: DRAFT`）
- 不做：执行代码、读仓库、Evidence Review、Understanding Check、登录/数据库

## §2 数据边界（Q1–Q10 决议要点）

- 生成即 `DRAFT`，用户确认后才 `ACTIVE`（Q3，2026-09-16）。
- criterion 状态只有 `UNKNOWN`/`PASS`/`FAIL`；`DRAFT/ACTIVE/PARTIAL/CLEAR/BLOCKED`
  只属于整个 Boss（派生值）。
- 四类证据来源边界：粘贴的终端输出记为 `LOG_INSPECTED`，永不 `AUTO_VERIFIED`。
- 初始态：`evidenceItems`/`changeHistory`/`blockers` 为空、`revision=1`、
  deliverable 全 `NOT_STARTED`、criterion 全 `UNKNOWN`。
- 不静默兜底 fixture；生成失败抛 `GENERATION_FAILED`，不返回部分合同。

## §3 双层校验方案

- **Schema 层**：Ajv 2020-12 + `ajv-formats`（format 断言必须显式启用——曾据此
  发现 `literature-reading.json` 的 `deadline: "null"` 缺陷，D1 已修复并有回归锁）。
- **语义层 S1–S16**（重建版编号，语义与原版等价）：
  - REJECT：S1 ID 唯一性 / S2 required criterion 无 requirement / S3 空
    acceptedSourceTypes / S4 minimumCount<1 / S5 悬空引用 / S6 sourceType 不被接受 /
    S7 状态派生不一致（GENERAL phase）/ S8 fixture 抄袭 / S9 初始态字段 /
    S10 deliverable 非 NOT_STARTED / S11 criterion 非 UNKNOWN
  - WARN：S12 unknowns∩assumptions / S13 estimatedMinutes>480 / S14 非 LIVE /
    S15 非 DRAFT（Q3）/ S16 空 inScope
- Schema 与语义层故意冗余（防御纵深）；`validateContract` 按输入守卫 → Schema →
  语义顺序短路。

## §4 生成器结构

- `getGenerator(env)`：`BOSS_GENERATOR=mock|llm`；llm 需 `BOSS_API_KEY`，缺省端点
  DeepSeek。
- `LLMContractGenerator`：最多 2 次尝试（首次 + 携带诊断的修复），失败抛
  `GENERATION_FAILED`；S8 抄袭守卫由 `KNOWN_FIXTURE_SIGNATURES`（按 id 去重的
  3 条签名）驱动。
- `OpenAICompatibleTransport`：`response_format: json_object`、temperature 0.2、
  可注入 fetchImpl、60s 超时。
- prompt：`src/lib/goal-discovery/prompt.ts` 为唯一运行时来源，
  `scripts/gen-prompt-md.ts` 生成评审版 md，同步测试强制逐字一致。

## §5 执行进度

| 步骤 | 状态 |
| --- | --- |
| A 源码 + 测试 | ✅ 重建完成，64/64 全绿（原版 86 个，语义覆盖等价） |
| B 真实模型首调（3 fixture 场景） | ⬜ 待重跑（见 §6 事故） |
| E 评测跑批（10 对抗样例） | ⬜ 待重跑 |
| F 集成冒烟（merge + route 接线） | ⬜ 待重做 |
| G PR | ⬜ 待做 |

## §6 事故记录（2026-09-16 21:11）

本地 `.git` 的 refs 与对象文件被外部进程清空（原因未明，疑似杀毒/同步软件）。
5 个未推送提交（`64f48a4` → `7a2e04a`）对象丢失，其中包括全部源码、86 个测试、
runner 脚本、评测集与真实模型运行工件。恢复措施：远端对象重新 fetch、分支 refs
重建、源码凭会话记忆 + `D:\tmp\boss-val\validate.py` 原型重建、全部提交立即推送。
`.env`（API Key）与 `node_modules` 幸存。备份：`D:\Project\boss-git-recovery-backup-20260916`。

**重建版与原版的已知差异**：
- 测试 64 个（原 86），断言合并但 S1–S16 每条规则、传输层每条错误路径均有覆盖。
- S 编号与原版可能不同（重建版按本文件 §3 编号）。
- 运行工件（`docs/ai/runs/`）需重跑，输出将与原版字节不同（LLM 非确定性）。

## §7 缺陷附录（当前状态）

- ~~D1 `literature-reading.json` deadline="null"~~ 已在重建提交中修复。
- D3 `src/app/page.tsx` "模拟数据"徽标硬编码（Web 所有权，待 Web owner 处理）。
- D4 页面 Boss 状态显示原始枚举值，与 `mvp0-acceptance.md` 中文文案表不一致
  （Web 所有权）。
- ~~D6 缺 `.env.example`~~ 已补。

## §8 提交记录

- `174cbd3` feat: add Goal Discovery fixtures and validation rules（远端原有）
- `54b2476` feat: rebuild Goal Discovery source after local object-store loss
- 后续：runner + eval 重建提交、运行工件提交（见 git log）
