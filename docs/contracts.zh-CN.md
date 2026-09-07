# Boss Contract v0 中文规则说明

Boss Contract 是 Web 前端、AI 工作流和产品验收共同使用的数据合同。
机器可读的唯一标准是
[`schemas/boss-contract.v0.schema.json`](../schemas/boss-contract.v0.schema.json)，
本文件负责解释字段背后的产品语义和判定规则。

固定演示案例位于
[`examples/waca-se-boss.json`](../examples/waca-se-boss.json)。它的
`recordKind` 为 `DEMO_FIXTURE`，其中的证据和状态仅用于比赛演示及前后端联调，
不得冒充真实用户项目的验证结果。

## 1. 三份文件分别负责什么

- Schema 是接口标准：限制字段、数据类型和允许的枚举值。
- Example 是联调样例：Web 可以直接渲染，AI 可以对照输出格式。
- 本规则文档是语义说明：解决“字段虽然合法，但含义是否用对”的问题。

AI 工作流生成的合同必须通过 Schema；Web 不应自行猜测或创造字段；任何接口修改
都应由队长审核并通过 Issue 或 Pull Request 记录。

## 2. 谁负责提供和维护字段

- 用户提供：原始目标 `rawGoal`、截止时间 `deadline`、期望的 AI 协助模式
  `assistanceMode`。
- AI 提议：明确目标 `objective`、交付物、验收标准、范围边界、已知信息、未知信息、
  假设和预计耗时。
- 系统维护：ID、证据来源、证据审核结果、派生状态和修订记录。
- 用户在开始执行前确认合同。确认后，合同的范围和验收语义被冻结。

AI 不能把自己的推测写成用户事实，也不能因为想让任务通过而降低验收标准。

## 3. Criterion 状态和 Boss 状态必须分开

单个验收项 `criterion` 只有三种状态：

- `UNKNOWN`：尚无足够证据，不能判断是否满足。
- `PASS`：该项的所有证据要求均已满足。
- `FAIL`：已有被接受的证据表明该项不满足。

整个 Boss 使用另一组状态：

- `DRAFT`：合同仍在讨论，尚未接受。
- `ACTIVE`：已经开始执行，但还没有必需验收项通过。
- `PARTIAL`：至少一个必需验收项通过，但并非所有必需项都通过。
- `CLEAR`：所有 `required: true` 的验收项均为 `PASS`。
- `BLOCKED`：外部依赖导致任务目前无法继续或验证。

因此，单个 criterion 不能写成 `ACTIVE`、`PARTIAL` 或 `CLEAR`；这些词只描述整个
Boss。

## 4. Boss 状态的推导规则

在合同已经被接受的前提下，建议按以下优先级计算：

1. 存在有效且未解决的 blocker，Boss 为 `BLOCKED`。
2. 所有必需 criterion 都是 `PASS`，Boss 为 `CLEAR`。
3. 至少一个必需 criterion 是 `PASS`，但没有全部通过，Boss 为 `PARTIAL`。
4. 否则 Boss 为 `ACTIVE`。

`PARTIAL` 不是所有“尚未完成”情况的通用状态。例如，测试已执行但断言失败，相关
criterion 应为 `FAIL`；缺少数据集导致测试无法执行，相关 criterion 应保持
`UNKNOWN`，整个 Boss 可以进入 `BLOCKED`。

## 5. 必需项和可选项

每个 criterion 都必须显式声明：

```json
"required": true
```

- `required: true` 是 Boss 通关所必需的验收项。
- `required: false` 是可选或加分项，即使失败也不阻止 Boss `CLEAR`。

前端在展示 `CLEAR` 时，仍应分别报告必需项和可选项的完成情况，例如：

```text
Required criteria: 2/2 PASS
Optional criteria: 0/1 PASS
```

## 6. 四类证据及其证明边界

### `USER_REPORTED`

记录用户的陈述，例如“我已经运行测试并通过”。它是证据，但只证明用户做出了该
陈述，不能单独满足要求客观运行结果的 criterion。

### `ARTIFACT_INSPECTED`

系统实际读取了源代码、配置文件或其他产物。它能证明静态实现中写了什么，但不能
单独证明运行时行为正确。

### `LOG_INSPECTED`

系统读取了用户提供的执行日志。它能证明日志中报告了什么，但平台本身没有执行该
命令。

### `AUTO_VERIFIED`

平台亲自执行了隔离验证。只有平台真正运行测试时才能使用；读取用户粘贴的终端输出
必须记为 `LOG_INSPECTED`，不能升级为 `AUTO_VERIFIED`。

## 7. Evidence Requirement 如何工作

每个 criterion 拥有一个或多个 `evidenceRequirements`。每项要求必须声明：

- `id`：要求的唯一标识。
- `description`：需要证明的具体内容。
- `acceptedSourceTypes`：可以接受哪些证据来源。
- `minimumCount`：至少需要多少条有效证据。

例如，“Stage 2 实际接收 Xweak”可以同时要求：

1. `ARTIFACT_INSPECTED`：静态检查源代码中的 Stage 2 输入。
2. `LOG_INSPECTED` 或 `AUTO_VERIFIED`：通过 forward hook 和数值比较验证运行时输入。

这能防止把“代码看起来正确”误判为“运行行为已经验证”。一条证据必须映射到明确的
`criterionId` 和 `requirementId`，不能拿无关证据给其他验收项凑数。

## 8. Evidence Item 的两个结论

Evidence Item 同时包含：

- `finding`：证据内容支持 `PASS`、`FAIL`，还是无法得出结论
  `INCONCLUSIVE`。
- `reviewStatus`：证据是否被系统接受，即 `PENDING`、`ACCEPTED` 或
  `REJECTED`。

只有 `reviewStatus: ACCEPTED` 的证据可以参与 criterion 状态计算。被接受并不代表
一定通过：一条有效证据完全可能得到 `finding: FAIL`。

## 9. BLOCKED 和 blocker

当缺少数据集、访问权限、用户选择或其他外部依赖，并且当前无法继续有意义的工作时，
Boss 可以进入 `BLOCKED`。同时必须记录：

- 阻塞原因；
- 受影响的 criterion；
- 解除阻塞所需的动作。

阻塞不是失败。因为尚未完成验证，受影响 criterion 通常保持 `UNKNOWN`。

## 10. 合同冻结与修订

在 `DRAFT` 阶段，`required`、scope 和验收标准可以协商修改。用户接受合同后，
这些语义被冻结。

执行阶段确需修改时，系统必须：

1. 增加 `revision`；
2. 在 `changeHistory` 中记录修改时间和修改人；
3. 保存修改原因；
4. 保存字段的修改前后值。

工期压力可以作为协商背景，但不能成为静默降低失败验收项的充分理由。

## 11. Scope Guard 与新 Boss

`scopeGuard.inScope` 表示当前 Boss 明确负责的工作，`outOfScope` 表示不在当前
Boss 内完成的工作。

执行中出现超出范围的新需求时，应保留当前 Boss，并创建一个新 Boss，而不是不断
扩大原任务。例如，实现 WACA-SE 时提出“顺便实现完整 WACA-UNet 并训练 500
epochs”，应创建新的关联 Boss。

## 12. Understanding Check 的边界

Understanding Check 属于 MVP，但不嵌入 Boss Contract v0。它将使用通过 `bossId`
关联的独立合同，从而保持两条进度线分离：

- Project Progress：项目和交付物是否完成。
- Capability Progress：用户脱离 AI 后是否真正掌握并能够迁移。

Boss `CLEAR` 不能自动把某项能力升级为 `OWNED`。能力必须经过延迟的
Understanding Check 单独确认。
