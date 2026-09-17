# Boss Web 工程交接文档

更新日期：2026-09-17  
交接范围：Web 工程、MVP-0 Goal-to-Contract 链路、后续 Local Evidence Bridge 入口

## 1. 当前结论

Web MVP-0 已完成并可本地运行。当前链路为：

```text
用户输入模糊科研目标
  → POST /api/contracts/generate
  → 服务端校验请求
  → 返回固定 WACA-SE Boss Contract
  → 页面展示 Contract、验收标准和 Evidence Map
```

当前仍使用模拟数据，没有接入真实大模型、Local Evidence、数据库或 Understanding Check。下一位 Web 负责人可以在现有请求边界上继续接入 AI 工作流，并从 Local Evidence Bridge 技术探针开始后续开发。

## 2. Git 与协作状态

| 项目 | 当前状态 |
| --- | --- |
| 仓库 | <https://github.com/laopier/boss-research-assistant> |
| 开发分支 | `web/mvp0-goal-contract` |
| 最新提交 | `ac781b4 fix: approve pnpm dependency build` |
| 功能提交 | `c4fcabe feat: add goal-to-contract web slice` |
| Pull Request | [#5](https://github.com/laopier/boss-research-assistant/pull/5) |
| Web Issue | [#2](https://github.com/laopier/boss-research-assistant/issues/2) |
| AI Issue | [#3](https://github.com/laopier/boss-research-assistant/issues/3) |
| 产品 Issue | [#4](https://github.com/laopier/boss-research-assistant/issues/4) |

截至 2026-09-17，本地分支与远端 `web/mvp0-goal-contract` 一致，工作区在生成本文档前没有未提交修改。PR 合并前不要直接向 `main` 推送，也不要强制推送现有分支。

## 3. 已完成工作

### 3.1 可运行 Web 页面

- 使用 Next.js 16.3.5、React 19.3.0、TypeScript 6.0.2。
- 首页支持输入 1～500 字符的模糊科研目标。
- 已实现提交加载态、空输入禁用、接口错误提示。
- 成功后展示 Boss 基本信息、验收标准、Evidence Map、范围边界和未知项。
- 页面明确标记当前结果为“模拟数据”。

### 3.2 前后端请求边界

- 接口：`POST /api/contracts/generate`
- 请求：

```json
{
  "schemaVersion": "boss-contract.v0",
  "goal": "我想复现 WACA 论文，但不知道从哪里开始"
}
```

- 成功响应：

```json
{
  "generation": "MOCK",
  "contract": {
    "schemaVersion": "boss-contract.v0",
    "recordKind": "DEMO_FIXTURE"
  }
}
```

`contract` 的完整字段必须符合 `schemas/boss-contract.v0.schema.json`。未来接入真实 AI 时，将 `generation` 改为 `AI`，不要修改 `contract` 外形。

### 3.3 固定演示数据

当前接口读取 `examples/waca-se-boss.json`，仅将用户输入写入 `rawGoal`。这保证 Web 与 AI 使用同一份 Boss Contract v0，而不是各自维护一套模拟结构。

### 3.4 pnpm 11 安装修复

`pnpm-workspace.yaml` 已显式批准 `unrs-resolver` 的构建脚本：

```yaml
nodeLinker: hoisted

allowBuilds:
  unrs-resolver: true
```

pnpm 11 已移除旧的 `onlyBuiltDependencies` 配置。如果依赖变化后出现 `ERR_PNPM_IGNORED_BUILDS`，应审核具体依赖，再把明确允许或拒绝的包写入 `allowBuilds`，不要全局开放所有构建脚本。

## 4. 关键文件与所有权

| 文件 | 作用 | 负责人/修改规则 |
| --- | --- | --- |
| `src/app/page.tsx` | 目标输入、请求状态和 Contract 展示 | Web 负责 |
| `src/app/globals.css` | 页面样式和响应式布局 | Web 负责 |
| `src/app/api/contracts/generate/route.ts` | 请求校验及模拟生成入口 | Web 与 AI 对接边界 |
| `src/lib/mock-contract.ts` | 读取固定 WACA 数据并替换 `rawGoal` | 接入 AI 后替换其调用路径 |
| `src/lib/contracts.ts` | Web 侧 TypeScript 类型镜像 | 必须跟随 Schema，不可独立演进 |
| `schemas/boss-contract.v0.schema.json` | Boss Contract 唯一机器可读标准 | 队长维护，变更需三方同步 |
| `examples/waca-se-boss.json` | 固定比赛演示数据 | 队长/产品语义负责 |
| `docs/api-contract.md` | Goal-to-Contract 接口说明 | Web 与 AI 共同遵守 |
| `docs/architecture.md` | MVP-0 架构和模块边界 | 架构变化时同步更新 |
| `pnpm-workspace.yaml` | pnpm 安装布局和构建许可 | 新依赖脚本需审核 |

仓库根目录的 `AGENTS.md` 提醒：本项目使用的 Next.js 版本可能包含与旧版本不同的 API 和约定。修改 Next.js 相关代码前，应先阅读本地 `node_modules/next/dist/docs/` 中对应文档。

## 5. 本地启动与验证

环境要求：

- Node.js 20 或更高版本
- pnpm 11.19.0

首次运行：

```bash
corepack enable
corepack prepare pnpm@11.19.0 --activate
pnpm install --frozen-lockfile
pnpm dev
```

浏览器打开 <http://localhost:3000>。

提交前必须运行：

```bash
pnpm lint
pnpm build
```

2026-09-17 的交接前验证结果：

| 命令 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile` | 已完成干净安装验证，退出码 0 |
| `pnpm lint` | 退出码 0 |
| `pnpm build` | 退出码 0 |

生产构建包含静态首页 `/` 和动态接口 `/api/contracts/generate`。

## 6. 当前明确未完成

- 真实大模型调用与 Goal Discovery 多轮追问。
- Local Evidence 目录选择、文件筛选、快照和变化检测。
- 不支持目录 API 时的文件/文件夹上传回退入口。
- Evidence Item 的真实读取、审核和状态更新。当前 Evidence Map 主要展示验收项状态。
- 浏览器持久化、Understanding Check 定时提醒和到期首页提示。
- 用户账号、数据库、任意仓库执行、GitHub/Gitee 通用连接。
- 线上部署和最终比赛演示环境。

这些内容没有隐藏实现，不要把当前模拟页面理解为已经完成 AI 或 Evidence 能力。

## 7. 建议的接手顺序

### 第一步：确认 MVP-0 已合并

1. 查看 PR #5 的审核和合并状态。
2. 若尚未合并，在 PR 分支完成队友要求的修订。
3. 合并后从最新 `main` 新建短分支，建议使用 `feat/local-evidence`。

### 第二步：完成 Local Evidence 最小技术探针

首个探针只验证浏览器能否安全读取用户主动选择的本地文本文件：

1. Chromium 中调用 File System Access API，让用户选择目录并只进行读取。
2. 扫描文件名、相对路径、大小和最后修改时间。
3. 默认排除 `.env`、`.git`、`node_modules`、`__pycache__`、数据集、模型权重、二进制文件和超限文件。
4. 页面先展示待发送文件清单与摘要，用户确认后才进入后续处理。
5. 为不支持目录 API 的浏览器提供 `<input type="file" webkitdirectory multiple>` 或普通多文件上传入口。

探针建议输出：

```ts
interface LocalFileCandidate {
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
  mediaType: string;
  decision: "INCLUDED" | "EXCLUDED" | "NEEDS_CONFIRMATION";
  reason?: string;
}
```

这只是 Web 内部候选文件结构，不应直接修改共享 `EvidenceItem`。文件确认并被系统实际读取后，才根据团队共享接口映射为 `ARTIFACT_INSPECTED` 或 `LOG_INSPECTED`。

### 第三步：再接持久化与 AI

- 与队长确认目录句柄、快照元数据和 Boss 状态分别存放在哪里。
- 与 AI 同学对齐真实生成接口的超时、失败、重试和 Schema 校验策略。
- 在共享接口冻结后再增加 Understanding Check 和 Capability Progress 页面。

## 8. 接手前必须向队长确认的事项

1. PR #5 是直接合并，还是需要先部署预览环境验收。
2. MVP 首选部署平台、环境变量管理方式和线上域名。
3. 文件大小上限、允许的文本扩展名、数据集和权重的判定规则。
4. 是否允许持久化 `FileSystemDirectoryHandle`；若允许，使用 IndexedDB 保存多久以及如何撤销授权。
5. 用户确认前，文件名和摘要是否允许发送到服务端。
6. Local Evidence 的快照字段和共享 `EvidenceItem` 是否需要新增版本。
7. 真实 AI 接口由同一 Next.js 应用托管，还是调用独立服务。

## 9. 主要风险

### 共享接口漂移

`src/lib/contracts.ts` 只是 Schema 的 TypeScript 镜像。如果 Web 或 AI 单独加字段，会导致演示数据、接口和页面不同步。任何字段变化应先更新共享 Schema、示例和文档，再更新实现。

### 浏览器兼容性和权限生命周期

File System Access API 主要面向 Chromium。目录句柄权限可能在刷新或重启后需要重新确认，因此必须保留上传回退方案，并把授权状态清楚展示给用户。

### 隐私和大文件

目录扫描容易意外包含密钥、数据集、模型权重和生成文件。筛选应发生在浏览器端，默认拒绝高风险或超限文件，发送前必须给用户最终确认列表。

## 10. 交接完成检查表

- [ ] 接手人能访问仓库、Issues 和 PR #5。
- [ ] 接手人能按 README 在新环境完成安装和启动。
- [ ] 输入科研目标后能看到 WACA-SE 模拟 Contract。
- [ ] 接手人理解 Schema 是唯一数据标准。
- [ ] 接手人知道当前没有真实 AI、Evidence 读取和持久化。
- [ ] 队长已经回答第 8 节中会阻塞 Evidence Bridge 的问题。
- [ ] 后续工作从短分支和独立 Issue 开始。

## 11. 一句话交接说明

当前 Web 已有一条可运行、可验证的 Goal-to-Contract 纵向链路；下一步请保持 Boss Contract v0 不漂移，先完成只读、可预览、用户确认后才发送的 Local Evidence Bridge 技术探针。
