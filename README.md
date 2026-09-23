# Boss Research Assistant

[English](#english) | [中文](#中文)

Boss is an evidence-driven research training assistant for novice researchers.
It turns vague research intentions into bounded, verifiable tasks while keeping
project completion separate from genuine capability growth.

## English

### Why Boss

Research beginners often know what paper or direction they want to explore, but
cannot yet define the next executable goal, suitable acceptance criteria, or
the evidence needed to prove completion. AI can accelerate implementation, but
successful execution or a correct tensor shape does not necessarily mean that
the artifact is semantically correct or that the user understands it.

Boss addresses this gap by combining bounded task planning, evidence-aware
review, explicit AI-assistance records, and delayed understanding checks.

### Core Workflow

1. **Goal Discovery** turns a vague intention and supplied materials into one
   bounded objective.
2. **Boss Contract** records deliverables, acceptance criteria, scope guards,
   unknowns, assumptions, and an estimate.
3. **Evidence Map** links each criterion to evidence with explicit provenance.
4. **Assistance Mode** records the highest level of AI help used: `AI_OFF`,
   `COACH`, `COLLABORATE`, or `AGENT`.
5. **Criterion Review** distinguishes `UNKNOWN`, `PASS`, and `FAIL` instead of
   treating a successful run as sufficient proof.
6. **Understanding Check** revisits important capabilities after 24–72 hours,
   separately from project progress.

### Boss Contract v0

The first shared Web/AI interface is now frozen:

- [Machine-readable JSON Schema](schemas/boss-contract.v0.schema.json): the
  canonical field and enum definition used by both workstreams.
- [Fixed WACA-SE demo fixture](examples/waca-se-boss.json): integration data
  for rendering and AI-output comparison. It intentionally contains a failed
  Stage 2 semantic criterion and is marked `DEMO_FIXTURE`.
- [English contract rules](docs/contracts.md): human-readable status,
  provenance, scope, blocking, and revision semantics.
- [中文合同规则](docs/contracts.zh-CN.md): the complete Chinese explanation for
  team review and implementation.

Evidence sources are deliberately separated:

- `USER_REPORTED`: the user states a result.
- `ARTIFACT_INSPECTED`: the system reads source code or another artifact.
- `LOG_INSPECTED`: the system reads a supplied execution log.
- `AUTO_VERIFIED`: the platform performs isolated verification itself.

Boss-level status is separate from criterion status. A Boss becomes `CLEAR`
only when every required criterion passes; optional failures do not block it.
External dependencies may instead place the Boss in `BLOCKED` while affected
criteria remain `UNKNOWN`.

### Demonstration Scenario

A beginner asks to reproduce WACA without knowing where to start. Goal
Discovery narrows this into a WACA-SE implementation Boss. The submitted module
runs and preserves tensor shape, but incorrectly reuses Stage 1 information in
Stage 2. Boss maps inspected source and a semantic test to the relevant
criterion, marks it as failed, and offers Coach-level direction. Project
completion does not automatically imply that the related capability is owned;
a delayed transfer question evaluates that separately.

### MVP Scope

- Online Web demo and one active Boss workspace.
- Adaptive vague-goal intake and structured Boss Contract generation.
- Evidence Map with criterion-level status and provenance.
- Read-only Local Evidence Bridge with explicit user authorization and a
  folder-upload fallback.
- Assistance-mode selection and provenance recording.
- Persistent Understanding Check scheduling.
- Separate project-progress and capability-progress views.
- Fixed WACA-SE failure demonstration.

### Repository Structure

```text
boss-research-assistant/
├── schemas/                 # Machine-readable shared contracts
├── examples/                # Fixed integration and demonstration fixtures
├── docs/
│   ├── product-brief.md     # User problem, product promise, and MVP boundary
│   ├── contracts.md         # English Contract v0 semantics
│   ├── contracts.zh-CN.md   # 中文 Contract v0 规则
│   └── collaboration.md     # Ownership and Git workflow
├── README.md
└── LICENSE
```

### Team Collaboration

- **Team lead:** product decisions, shared contracts, integration acceptance,
  demonstration fixture, presentation, and final submission.
- **Web owner:** product interface, Local Evidence Bridge, persistence,
  compatibility fallback, and deployment.
- **AI workflow owner:** Goal Discovery, structured generation, evidence review,
  assistance policy, Understanding Check, and evaluation fixtures.

`main` must remain demonstrable. Feature work should use short branches and
pull requests, with at least one teammate reviewing each integration.

### Project Status

Completed foundations:

- Product brief and collaboration workflow.
- Boss Contract v0 JSON Schema and bilingual semantic documentation.
- Fixed WACA-SE `PARTIAL` demo fixture.

In progress:

- Web product shell and Local Evidence Bridge probe.
- AI Goal Discovery and evidence-review workflow.
- Runtime stack selection and end-to-end integration.

Planned next:

- Separate Understanding Check contract and persistence.
- End-to-end WACA-SE competition demo and evaluation cases.

Competition positioning:

- Track: AI + Academic Research Assistant.
- Focus: Failure Experience Accumulation and Incubation Assistant.
- Initial submission deadline: 2026-09-26 23:59 (Asia/Shanghai).

## 中文

### Boss 要解决什么问题

科研新手往往知道自己想阅读哪篇论文或进入哪个方向，却很难独立提出下一个可执行目标、
可验收标准以及证明任务完成所需的证据。AI 能加快实现，但“程序成功运行”或“张量
shape 正确”并不等于语义实现正确，更不等于用户真正掌握了相关能力。

Boss 通过有边界的任务规划、基于证据的验收、AI 协助程度记录和延迟理解检查，降低
科研新手开始和坚持一个研究任务的成本。

### 核心工作流

1. **目标发现（Goal Discovery）**：根据模糊意图和用户提供的材料，生成一个有边界的
   下一步目标。
2. **Boss Contract**：记录交付物、验收项、范围限制、未知信息、假设和预计耗时。
3. **Evidence Map**：把每个验收项映射到具有明确来源的证据。
4. **协助模式**：记录本任务使用过的最高 AI 协助等级：`AI_OFF`、`COACH`、
   `COLLABORATE` 或 `AGENT`。
5. **逐项验收**：区分 `UNKNOWN`、`PASS` 和 `FAIL`，不把“成功运行”直接等同于
   “任务正确”。
6. **Understanding Check**：在 24–72 小时后脱离即时记忆再次检查能力，并与项目进度
   分开记录。

### Boss Contract v0

Web 与 AI 工作流共同使用的第一版接口已经冻结：

- [机器可读 JSON Schema](schemas/boss-contract.v0.schema.json)：两条工作流共同遵守的
  字段与枚举标准。
- [固定 WACA-SE 演示案例](examples/waca-se-boss.json)：供页面渲染、前后端联调和
  AI 输出比对使用。它故意保留 Stage 2 语义错误，并标记为 `DEMO_FIXTURE`。
- [英文规则说明](docs/contracts.md)：解释状态、证据来源、范围、阻塞和修订规则。
- [中文规则说明](docs/contracts.zh-CN.md)：供团队评审和实现时使用的完整中文版。

Evidence 被分为四类：

- `USER_REPORTED`：用户陈述某个结果。
- `ARTIFACT_INSPECTED`：系统实际读取了代码或其他产物。
- `LOG_INSPECTED`：系统读取了用户提供的执行日志。
- `AUTO_VERIFIED`：平台亲自执行了隔离验证。

Boss 总状态与单个 criterion 状态相互独立。只有全部必需验收项通过，Boss 才能
`CLEAR`；可选项失败不会阻止通关。若缺少数据集或权限等外部依赖，Boss 可以进入
`BLOCKED`，受影响的 criterion 则保持 `UNKNOWN`。

### 固定演示场景

一名科研新手提出“我想复现 WACA，但不知道从哪里开始”。Goal Discovery 将它收缩为
一个 WACA-SE 实现 Boss。用户提交的模块能够运行且 shape 正确，但 Stage 2 错误复用
了 Stage 1 信息。Boss 将静态代码与语义测试映射到对应验收项，判定该项失败，并在
Coach 模式下指出正确方向。项目完成后，系统不会自动认定用户已经掌握能力，而是在
延迟的迁移问题中单独检查。

### MVP 范围

- 在线 Web Demo 和一个活动 Boss 工作区。
- 自适应模糊目标输入与结构化 Boss Contract 生成。
- 带验收项状态和证据来源的 Evidence Map。
- 经用户明确授权的只读 Local Evidence Bridge，并提供文件夹上传回退方案。
- AI 协助模式选择与来源记录。
- 可持久化的 Understanding Check 定时安排。
- 分离的项目进度和能力进度视图。
- 固定 WACA-SE 失败案例演示。

### 仓库结构

```text
boss-research-assistant/
├── schemas/                 # 机器可读的共享数据合同
├── examples/                # 固定联调与比赛演示数据
├── docs/
│   ├── product-brief.md     # 用户痛点、产品承诺和 MVP 边界
│   ├── contracts.md         # Contract v0 英文语义规则
│   ├── contracts.zh-CN.md   # Contract v0 中文语义规则
│   └── collaboration.md     # 团队分工与 Git 工作流
├── README.md
└── LICENSE
```

### 团队分工

- **队长**：产品决策、共享接口、集成验收、演示案例、答辩和最终提交。
- **Web 负责人**：产品界面、Local Evidence Bridge、状态持久化、兼容性回退和部署。
- **AI 工作流负责人**：Goal Discovery、结构化生成、证据审核、协助策略、
  Understanding Check 和评估案例。

`main` 分支必须始终保持可演示。功能开发使用短分支和 Pull Request，每次合并至少由
一名队友审核。

### 当前进度

已经完成：

- 产品说明和团队协作流程。
- Boss Contract v0 JSON Schema 与中英文语义文档。
- 固定 WACA-SE `PARTIAL` 演示案例。

正在推进：

- Web 产品骨架与 Local Evidence Bridge 技术探针。
- AI Goal Discovery 与 Evidence Review 工作流。
- Runtime 技术栈选择和端到端集成。

下一步计划：

- 独立的 Understanding Check 合同与持久化。
- WACA-SE 端到端比赛演示和评估用例。

参赛定位：

- 赛道：AI + 学术科研助手。
- 细分方向：失败经验积累与孵化助手。
- 初赛作品提交截止：2026-09-26 23:59（Asia/Shanghai）。

## License

MIT

## Web MVP-0 Local Run

The first runnable vertical slice is available on the `web/mvp0-goal-contract` branch. It sends a vague research goal to a mock Route Handler and renders the canonical WACA-SE Boss Contract.

Requirements:

- Node.js 20 or later
- pnpm 11

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Before opening a pull request, run:

```bash
pnpm lint
pnpm build
```

The machine-readable source of truth remains `schemas/boss-contract.v0.schema.json`; `src/lib/contracts.ts` mirrors it for Web type checking.

## Local artifact reader (privacy & scope)

The evidence form can read real files from a project you choose, instead of pasting text. It is deliberately narrow:

- **Permission**: you click "连接本地项目目录" and pick a folder in the browser's own picker (`showDirectoryPicker`, Chromium/Edge only). Nothing is read before that explicit choice; cancelling reads nothing.
- **Scope**: only small, plain-text files are offered — `.py .ts .tsx .js .jsx .json .md .txt .log`. Everything else is excluded and the UI says why.
- **Always excluded**: `.env` and other secret-looking names, `.git/`, `node_modules/`, virtual environments, build/cache directories, binaries, and files over 200 KB.
- **Privacy**: the flow is read-only and never writes to your project. Only the files you tick are read, their text goes straight to the review request, and raw content is never persisted — the page keeps only the verdict, rationale, source name and proof boundary.
- **Proof boundary**: files handed over this way are reviewed as `ARTIFACT_INSPECTED` (the reviewer saw the content). They are never `AUTO_VERIFIED` — the platform has not executed anything.
- **Revoke**: the browser can forget the folder permission at any time via the site settings (the padlock / permissions icon in the address bar). Refusing or revoking permission shows an explanatory message, never a crash.
