# Boss Research Assistant

> 把模糊的科研目标变成一条可调整、可验收、可持续推进的路线，而不是只生成一份看起来完整的计划。

[在线体验](https://boss-research-assistant.vercel.app/) · [产品说明](docs/product-brief.md) · [中文合同规则](docs/contracts.zh-CN.md) · [协作规范](docs/collaboration.md)

Boss 是一个面向科研初学者的 AI 工作台。用户可以输入一个尚不清晰的科研目标，并选择本地资料作为上下文；系统会生成完整的项目路线图、当前阶段的具体 Boss Contract，以及与验收标准一一对应的证据要求。任务是否完成由证据推导，而不是由“程序能跑”或用户自行勾选决定。

当前仓库是一套可在线体验的比赛 MVP，默认支持 DeepSeek，也保留了无需 API Key 的离线 mock 模式。

## 当前已经能做什么

完整流程如下：

```text
模糊科研目标 + 可选本地文件
          ↓
AI 生成完整项目路线图 + 第一个详细 Boss Contract
          ↓
用户接受合同并提交一个或多个交付物/证据
          ↓
AI 按验收项审核证据，用户采纳结论
          ↓
验收状态、交付物状态和全局进度自动更新
          ↓
当前 Boss 通关后，按照路线图生成下一项详细 Boss
          ↓
新信息出现时，通过协商修改路线并保留修订记录
```

目前已实现：

- **Goal Discovery**：把模糊目标收敛为有范围边界的 Boss Contract。
- **全局路线图**：首次创建项目时生成 2–6 个里程碑和 4–12 个规划步骤；尚未展开的步骤也会计入总进度。
- **渐进式展开**：只为当前步骤生成详细合同，避免一次展示大量细节造成认知负担。
- **加权项目进度**：依据各步骤预计投入和必需验收项状态计算，不允许手动修改百分比。
- **Boss Negotiation**：用户可以自由描述调整意图，预览提案后再接受；支持移动、暂停、替换 Boss，以及新增或删除未来步骤。
- **Evidence Review**：证据先进入待审核状态，AI 给出 `PASS`、`FAIL` 或 `INCONCLUSIVE` 及其证明边界，用户采纳后才影响验收。
- **批量交付物提交**：一份文件可以同时支持多个验收项，不必把同一份报告拆成多次重复提交。
- **本地文件上下文**：经用户授权读取选中的小型文本文件，用于生成 Boss 或审核证据；原文不写入本地账本。
- **失败沉淀与孵化**：失败验收项可保留为失败资产，并进一步收敛成新的 Boss。
- **本地持久化**：项目、合同、证据结论和路线修订保存在当前浏览器的 `localStorage` 中。
- **验收报告导出**：Boss 完成后可导出结构化结果。

## 先试用线上版本

打开 [https://boss-research-assistant.vercel.app/](https://boss-research-assistant.vercel.app/)。

推荐测试路径：

1. 点击“重新开始”，避免旧版浏览器数据影响体验。
2. 输入一个包含多阶段工作的目标，例如“复现一篇论文并完成最小实验”。
3. 观察系统是否立即显示完整路线图，而不是只显示当前任务。
4. 进入当前 Boss，接受合同并提交一份交付物。
5. 采纳 AI 审核结论，观察验收项和全局进度变化。
6. 在“协商调整路线”中要求新增、删除或替换一个未来步骤。

首次创建项目会先生成当前 Boss，再生成全局路线图，因此真实 AI 模式下通常比后续操作慢。

## 本地启动

### 环境要求

- Node.js 22 或更高版本
- pnpm 11（仓库声明版本为 `11.19.0`）

### 安装

```bash
git clone https://github.com/laopier/boss-research-assistant.git
cd boss-research-assistant
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
```

### 配置

复制 `.env.example` 为 `.env.local`。不要把真实 Key 写入 `.env.example` 或提交到 Git。

离线 mock 模式：

```dotenv
BOSS_GENERATOR=mock
```

DeepSeek 模式：

```dotenv
BOSS_GENERATOR=llm
BOSS_API_KEY=your_deepseek_api_key
BOSS_API_BASE=https://api.deepseek.com
BOSS_MODEL=deepseek-chat
```

也可以使用 `DEEPSEEK_API_KEY` 代替 `BOSS_API_KEY`。Key 只在服务端读取，不会下发到浏览器。

公开演示站推荐保持 `BOSS_GENERATOR=mock`，不在 Vercel 中保存团队自己的 Key。访客可在页面顶部的
“AI 模式”中临时填写自己的 DeepSeek API Key：它只进入当前标签页的 `sessionStorage`，每次请求经
HTTPS 发送给本站服务端并转发至 DeepSeek，不写入项目账本、Cookie 或 Git；关闭标签页后自动清除。

### 运行与检查

```bash
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)。提交改动前运行：

```bash
pnpm test
pnpm lint
pnpm build
```

当前基线包含 404 项自动化测试。

## 系统结构

这是一个 Next.js 16 单体应用：页面与三个服务端 Route Handler 放在同一仓库，AI Key 始终留在服务端。

```text
Browser / React UI
  ├─ project & evidence ledger ── localStorage
  ├─ authorized folder picker ── selected text only
  ├─ POST /api/contracts/generate
  ├─ POST /api/evidence/review
  └─ POST /api/negotiation/chat
                         ↓
             mock adapter or DeepSeek
```

### 接手代码时建议按这个顺序阅读

| 文件 | 作用 |
| --- | --- |
| `src/app/page.tsx` | 页面总编排：创建项目、推进 Boss、提交证据、应用协商提案 |
| `src/lib/contracts.ts` | Boss Contract、项目路线图和 API 的 TypeScript 边界 |
| `src/lib/failure-ledger.ts` | 本地账本、路线图存储结构与不可变更新函数 |
| `src/lib/roadmap.ts` | 全局进度、里程碑状态和下一规划步骤的推导 |
| `src/lib/project-plan.ts` | 初始全局路线图的 mock/LLM 生成与严格校验 |
| `src/lib/goal-discovery/` | 从目标生成 Boss Contract 的 Prompt、生成器和校验 |
| `src/lib/evidence-review/` | 证据审核请求、模型 Prompt、响应校验和 mock reviewer |
| `src/lib/negotiation-chat.ts` | 自由协商对话协议与模型输出校验 |
| `src/lib/negotiation.ts` | 协商提案的预览、影响计算和原子应用 |
| `src/app/workbench.tsx` | 项目路线图与全局进度界面 |
| `src/app/artifact-panel.tsx` | 本地目录授权、筛选和文件选择界面 |
| `src/test/` | 生成、审核、路线、协商和组件回归测试 |

共享的机器可读合同位于：

- `schemas/boss-contract.v0.schema.json`
- `schemas/evidence-review.v0.schema.json`

## 状态模型中最重要的约束

- `USER_REPORTED` 只能证明用户做出了陈述，不能代替产物检查。
- `ARTIFACT_INSPECTED` 表示审核服务读取了内容，但没有执行代码。
- `LOG_INSPECTED` 表示读取了运行日志。
- `AUTO_VERIFIED` 才表示平台亲自完成了隔离验证。
- 证据“被接受”不等于验收“通过”；结论仍可能是 `FAIL` 或 `INCONCLUSIVE`。
- 只有全部必需 criterion 通过，Boss 才能进入 `CLEAR`。
- 项目进度由路线图、预计投入和验收状态推导，不能手动填写。
- 协商先生成可预览提案，用户确认后才修改计划；修订原因必须保留。

详细语义见 [docs/contracts.zh-CN.md](docs/contracts.zh-CN.md)。

## 本地文件与隐私边界

- 网页不能静默读取任意磁盘路径；必须由用户通过浏览器目录选择器授权。
- 只支持白名单中的小型文本文件，例如 `.py`、`.ts`、`.json`、`.md`、`.txt` 和 `.log`。
- `.env`、`.git/`、`node_modules/`、虚拟环境、缓存、二进制文件和过大文件会被排除。
- 选择的原始文件内容仅进入当次生成或审核请求，不保存在浏览器账本中。
- 当前平台不会在用户电脑上执行代码，因此本地文件证据最多属于 `ARTIFACT_INSPECTED`，不能标为 `AUTO_VERIFIED`。

## 当前限制

这是比赛 MVP，不要把以下能力当作已经完成：

- 没有账号系统、云数据库或多设备同步；清除浏览器数据会失去本地项目。
- 没有自动执行用户仓库代码的沙箱。
- 旧版本创建的项目不会自动补齐新的全局路线图；测试新功能请重新开始。
- 初始 Boss 与全局路线图目前是两次独立模型调用，仍可继续优化延迟和一致性。
- 协商仅能执行协议明确支持的安全变更，不能任意改写账本。
- 延迟 24–72 小时的 Understanding Check 仍属于后续工作。
- 尚缺完整的浏览器端 E2E 测试、账号级限流和生产监控。

## 部署

线上版本部署在 Vercel。其他平台必须支持 Node.js 服务端运行时，因为三个 `/api/*` 路由不能在纯静态托管中运行。

公开演示站建议配置：

```dotenv
BOSS_GENERATOR=mock
BOSS_API_BASE=https://api.deepseek.com
BOSS_MODEL=deepseek-chat
```

这样评委无需 Key 也能使用固定演示；如需检查真实 AI 路径，可在页面中临时填写其自己的 DeepSeek
Key。不要在公开项目中配置团队成员的长期 Key。服务端托管 Key 的方式仍受支持，但只适合有鉴权、
限流和预算控制的部署。

完整部署与安全说明见 [docs/deployment.zh-CN.md](docs/deployment.zh-CN.md)。

## 协作与交接

1. 从最新 `main` 创建短生命周期分支。
2. 一个分支只解决一个清晰问题，并补齐相应测试。
3. 提交前运行 `pnpm test && pnpm lint && pnpm build`。
4. 通过 Pull Request 合并，说明用户问题、实现边界、验证结果和仍未解决的风险。
5. `main` 必须始终保持可演示和可部署。

当前接手者建议优先确认：

1. 从新建目标到下一 Boss 的线上主链路是否稳定。
2. 全局路线图与协商后的进度分母是否符合产品预期。
3. 是否要把“两次 AI 调用”合并为一次结构化响应。
4. 下一阶段优先做账号/云端持久化，还是先补 E2E 与错误监控。

更多背景：

- [队友上手指南](docs/teammate-onboarding.md)
- [API 边界](docs/api-contract.md)
- [AI Goal Discovery](docs/ai/goal-discovery.md)
- [团队协作规范](docs/collaboration.md)

## English summary

Boss Research Assistant turns a vague research intention into an adaptive, evidence-driven project route for novice researchers. On first creation it generates a coarse global roadmap and one detailed Boss Contract. Future steps remain visible in the project denominator but are expanded just in time. Users can submit artifacts for AI review, adopt criterion-level findings, preserve failures, and negotiate roadmap changes before applying them.

The current MVP is a Next.js 16 application with three server-side endpoints for contract generation, evidence review, and roadmap negotiation. It supports an offline deterministic mock mode and a DeepSeek-backed live mode. Project state is currently stored in browser `localStorage`; there is no authentication, cloud database, local code execution, or cross-device synchronization yet.

Quick start:

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Before opening a pull request, run `pnpm test`, `pnpm lint`, and `pnpm build`.

## License

MIT
