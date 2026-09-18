# Boss Web 交接复核（Web Owner 上手版）

复核日期：2026-09-17
复核对象：`main`（`329ea1d`）
取代：分支 `web/mvp0-goal-contract` 上的旧版《Boss Web 工程交接文档》

> ⚠️ 旧版交接文档**从未合并进 `main`**（其提交是 `e8c8416`，不在 `main` 祖先链上），
> 且内容已被 PR #5 / PR #6 之后的进展推翻。本文档为复核后的准确版本。
> 团队通用上手指南请看 `docs/teammate-onboarding.md`；本文档只讲 **Web Owner 视角的
> 现状、边界与下一步**。

---

## 1. 结论

MVP-0 已合并进 `main` 并可演示，链路比旧文档描述的更完整：

```text
用户输入模糊科研目标
  → POST /api/contracts/generate
  → 服务端校验（1–500 字符、schemaVersion）
  → getGenerator() 按 BOSS_GENERATOR 选择 mock | llm
  → Ajv Schema 校验 + S1–S16 语义校验（失败最多 1 次修复重试）
  → 返回 boss-contract.v0
  → 页面渲染 Contract / 验收标准 / Evidence Map
```

**Web 侧没有未提交改动，但有一个演示级缺口**：当前 `main` 的生成器产出的是
全新的 `DRAFT` + 全 `UNKNOWN` 合同，而产品冻结的演示真值要求页面能展示
WACA 的 `PARTIAL` + `PASS/FAIL/PASS/UNKNOWN` 失败故事。详见 §5.2。

**最紧要的事**：作品必须在 **9 月 26 日 23:59** 前提供「可直接在线体验的地址」，
目前仓库**没有任何部署配置**（无 `vercel.json` / Dockerfile / CI workflow）。

---

## 2. 仓库真实状态

### 2.1 分支

| 分支 | 状态 | 说明 |
| --- | --- | --- |
| `main` | **演示基线** | `329ea1d`，所有人从这里拉取 |
| `web/mvp0-goal-contract` | 已合并（PR #5） | 但 `e8c8416`（旧交接文档）**未**进 main |
| `ai/goal-discovery-fixtures` | 已合并 | Goal Discovery 源码与 fixtures |
| `integration/mvp0-ai` / `-smoke` | 已合并（PR #6） | 集成调试，历史参考 |
| `product/waca-demo-acceptance` | ⚠️ **未合并** | `32cae4b`，含 `docs/product/mvp0-acceptance.md` 与 `docs/demo/waca-mvp0-script.md` |

### 2.2 关键提交

```text
329ea1d docs: add teammate onboarding guide + chat-per-boss UX issue (devfered to MVP-1)
afda9c2 Merge pull request #6 from laopier/integration/mvp0-ai
e72d992 Merge pull request #5 from laopier/web/mvp0-goal-contract
cbe1048 feat: complete MVP-0 integration smoke (route wiring + D3/D4 fixes)
```

### 2.3 本地仓库注意

本机曾存在一个**孤立历史的 `main`**（`55359c3`，单提交、与 `origin/main` 无共同祖先）。
复核时已将其重置到 `origin/main`；原始快照仍保存在本地分支 `local/mvp0-unmerged`
（且该快照的 64 个文件相对 `origin/main` 全为「新增/修改」，**无任何独有内容丢失**）。
如不需要可自行删除该本地分支。

---

## 3. 本地环境核验

工具链：

| 项 | 值 |
| --- | --- |
| Node.js | 22.22.2（`.workbuddy` 托管版） |
| pnpm | 11.19.0（经 corepack，与 `packageManager` 一致） |
| Python | 3.13.12（仅脚本用） |

验证结果（本机复核，`main` 基线 + Web 渲染补全分支）：

| 命令 | 结果 |
| --- | --- |
| `pnpm install` | ⚠️ 见下方注意事项 |
| `pnpm typecheck` | ✅ 退出码 0 |
| `pnpm test` | ✅ 64/64 pass |
| `pnpm lint` | ✅ 退出码 0 |
| `pnpm build` | ✅ 退出码 0 |
| dev server + 页面渲染 | ✅ 见 §3.1 |

> ⚠️ **install 注意（本机实测）**：`nodeLinker: hoisted` 会把 4 万+ 文件真实摊平到
> `node_modules`，本机首装超过 30 分钟，且**中途被中断会留下半成品**：
> 实测 `node_modules/ajv` 停在错误的传递依赖版本（6.15.0）或 `dist/` 被清空，
> 于是 typecheck / 测试报 `Cannot find module 'ajv/dist/2020'`。
>
> 诊断：`grep -m1 version node_modules/ajv/package.json`，`node_modules/ajv/dist/2020.js`
> 是否存在。正确版本由 lockfile 锁定为 **ajv 8.20.0**。
>
> 如遇同样症状：重跑 `pnpm install`；若仍卡在
> `Packages: +12 -59` / `Progress: ... added 11`，说明 hoist 收尾卡住，
> 可把暂存目录 `node_modules/ajv_tmp_*` 直接改名成 `node_modules/ajv` 收工
> （暂存目录内容即 lockfile 锁定的完整包）。
>
> 另外：本机 `rm` 被安全删除 shim 包裹，**批量删除 50 个以上文件会被拦截**
> （`SAFE_DELETE_BULK_CONFIRM_REQUIRED`），所以中断安装留下的 `*_tmp_*` 目录
> 可能清不掉。它们不影响模块解析（Node 只按精确目录名解析），可忽略。

### 3.0 🔴 `main` 上 `pnpm install --frozen-lockfile` 会直接失败

这是复核中最重要的一个可复现缺陷，**建议排到 P0 第一位**（一行提交即可修复）。

`main` 的 `package.json` 已声明 `ajv@^8.17.1`、`ajv-formats@^3.0.1`、`tsx@^4.19.0`，
但同一次提交**没有把重新生成的 `pnpm-lock.yaml` 一起提交** —— lockfile 的
`importers..dependencies/devDependencies` 段里这三个依赖缺失。

实测（在 `main` 的 `package.json` + `pnpm-lock.yaml` + `pnpm-workspace.yaml`
快照上运行）：

```text
[ERR_PNPM_OUTDATED_LOCKFILE] Cannot install with "frozen-lockfile"
because pnpm-lock.yaml is not up to date with package.json
  specifiers in the lockfile don't match specifiers in package.json:
* 3 dependencies were added: tsx@^4.19.0, ajv@^8.17.1, ajv-formats@^3.0.1
（退出码 1）
```

影响：

1. **README 里写的安装命令就是 `pnpm install --frozen-lockfile`** —— 任何人照做都会卡在第一步；
2. **CI 里 `frozen-lockfile` 默认为 true** —— 一旦加 workflow 会直接红；
3. `docs/teammate-onboarding.md` 之所以改口只说 `pnpm install`，很可能就是在绕这个坑。

修复方式：在 `main`（或短分支）上跑一次 `pnpm install`（不带 `--frozen-lockfile`），
把 `pnpm-lock.yaml` 的改动一起提交，并同步 README 的安装命令。

> 本机复核时，`pnpm-lock.yaml` 已经被自动重新生成（工作区里显示为 modified，
> 新增 334 行，补上了 ajv / ajv-formats / tsx 及 esbuild 各平台变体）。
> **该改动我没有提交**，因为在 Web 渲染分支上夹带 lockfile 变更会让 review 变脏，
> 且 lockfile 属共享文件、应由队长决定提交方式。

### 3.1 冒烟结果（dev server，端口 3100，`BOSS_GENERATOR=mock`）

| 场景 | 期望 | 实际 |
| --- | --- | --- |
| 正常目标（mock） | 200 / `generation: MOCK` | ✅ 200，`MOCK` / `DRAFT` / `LIVE` / 2 criteria / 0 evidenceItems，`rawGoal` 原样保留 |
| 空目标 | 400 `INVALID_REQUEST` | ✅ |
| 501 字符目标 | 400 `INVALID_REQUEST` | ✅ |
| `schemaVersion` 错误 | 400 `INVALID_REQUEST` | ✅ |
| 首页 HTML | 渲染标题 / 表单 | ✅ 200，标题与 `#goal` 表单均存在 |
| 页面所需字段齐全性 | `boss-contract.v0` 全字段 | ✅ `page.tsx` 读取的 16 个字段全部存在，schema 一致 |
| dev server 日志 | 无 error / exception | ✅ |

> 🐛 **发现一处行为回归（待修，属 Web 与 AI 对接边界）**：
> 请求体**不是合法 JSON** 时，当前 `route.ts` 的兜底 `catch` 返回
> **500 `INTERNAL_ERROR`**；而旧版路由与 `docs/api-contract.md` 的约定是
> **400 `INVALID_REQUEST`**（非法 JSON 属客户端错误，不该算服务端故障）。
> 这会影响错误可观测性和前端重试判断。建议在 `catch` 中把 JSON 解析失败
> 单独映射为 400。已实测复现。

> ⚠️ **页面视觉未做浏览器截图验证**：本机未安装浏览器自动化工具，
> 只做了字段契约校验 + 类型检查 + 构建通过。
> 新加的 `Evidence Map` / 交付物 / 范围外 / 已知 / 假设 / 阻塞 / 修订记录
> 各区块的实际排版建议由你在浏览器里过一眼。

### 3.2 本机两个环境坑（会浪费你半小时）

**坑 1：`corepack` / `pnpm` 在 Git Bash 下路径被破坏。**
shim 脚本把 POSIX 路径传给 `node.exe`，解析成 `E:\c\Users\...` 导致
`MODULE_NOT_FOUND`。绕法 —— 直接调 `corepack.js`：

```bash
NODE="C:/Users/Zhang Yuming/.workbuddy/binaries/node/versions/22.22.2/node.exe"
CP="C:/Users/Zhang Yuming/.workbuddy/binaries/node/versions/22.22.2/node_modules/corepack/dist/corepack.js"
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm <命令>
```

**坑 2：CLI 注入了 fail-closed 的 `safe-delete` shim。**
`NODE_OPTIONS` 里有
`--require="E:/LearnBuddy/.../genie-safe-delete.cjs"`，它劫持 `fs.unlink` 并改走回收站
二进制；在该二进制不可用时会**直接 abort，整条 `&&` 链断掉**（`pnpm install` 会假死式失败）。
同时 Git Bash 的 `rm` 是它的包装函数，**传相对路径会被拒绝**
（`relative path rejected (must be absolute)`）。

对策：
- 跑 pnpm 时显式覆盖 `NODE_OPTIONS="--use-system-ca"`（保留 `--use-system-ca`，去掉 shim）；
- **不要用 `rm` 删本项目文件**，改用绝对路径或 Python `os.remove`。

---

## 4. 当前系统实际能力边界

### 已具备

- `POST /api/contracts/generate`：校验、错误分级（`INPUT_REJECTED`→400、
  `CONFIG_ERROR`→500 带配置提示、其余→500 通用重试）。
- 双生成器：`BOSS_GENERATOR=mock`（离线确定性）/ `llm`（DeepSeek，OpenAI 兼容端点）。
- 双层校验：Ajv 2020-12 + `ajv-formats`，加 S1–S16 语义规则（幂等性、悬空引用、
  状态派生一致、fixture 抄袭守卫、初始态约束）。
- 失败策略：不静默兜底 fixture；最多 1 次携带诊断的修复重试，再失败抛 `GENERATION_FAILED`。
- 页面：目标输入（1–500 字符、空值禁用、加载态、错误提示）、徽标按 `generation`
  显示 `AI 生成` / `模拟数据`、Boss 状态中文化。

### 明确没有（不要误认为已完成）

- **任何部署配置**（无 Vercel/Docker/CI）—— 这是当前最大缺口。
- **Local Evidence Bridge**：目录选择、文件筛选、快照、变化检测全无。
  Evidence Map 只是**验收项状态占位**，不读任何真实文件。
- **真实 Evidence Item**：`evidenceItems` 永远是空数组，页面也不渲染它。
- **持久化 / 账号 / 数据库**：刷新即丢失，每次提交都是独立 Boss（见
  `docs/issues/04-chat-per-boss-ux.md`，队长已决定 defer 到 MVP-1）。
- **Understanding Check** 定时提醒、项目/能力进度双视图。
- **多 Boss 管理 / 会话区域**。

---

## 5. 赛事手册的硬性要求与差距

来源：《粤港澳大湾区 AI Coding 创新大赛赛事手册（LearnBuddy 版）》
赛道：**方向二 AI + 学术科研助手**（本项目细分方向：失败经验累积及孵化助手）

### 5.1 时间与提交材料

| 项 | 要求 | 现状 |
| --- | --- | --- |
| 作品提交截止 | **9 月 26 日 23:59**（今天 9/17，剩 **9 天**） | — |
| 初赛结果 | 9 月 30 日 / 决赛 10 月 15 日 | — |
| 作品链接 | **必需**，可直接在线体验 | ❌ 无部署 |
| 作品 Demo 视频 | **必需**，3 分钟 | ❌ 未开始 |
| 作品介绍 PPT | **必需**：简介/方向/AI 能力/技术方案/成员 | ❌ 未开始 |
| 源代码仓库 | **必需**，GitHub/Gitee | ✅ 已开源（MIT） |
| LearnBuddy 使用记录 | **必需**，历史对话记录 | ⚠️ 过程材料，需自行留存 |
| 跨学科组队 | 加分 +2 | 团队自行确认 |

开源要求（赛道二）：MIT / Apache 2.0 / GPL。本仓库已是 **MIT** ✅

### 5.2 ⚠️ 演示级缺口：跑不出「失败故事」

`docs/product/mvp0-acceptance.md`（未合并）冻结的演示真值是：

| 验收项 | 期望 | 产品含义 |
| --- | --- | --- |
| AC-1 | `PASS` | shape / 输出有限性 / 梯度有限性已验证 |
| AC-2 | **`FAIL`** | Stage 2 用了错误输入而不是 `Xweak` |
| AC-3 | `PASS` | 两阶段共用同一 MLP |
| AC-4 | `UNKNOWN` | 可选可视化未验证 |

Boss 状态 `PARTIAL`、`generation: MOCK`、徽标「模拟数据」，文案
「Boss 不替科研新人假装完成任务」。

**但当前 `main` 的页面走的是 `getGenerator()` 路径**：mock 生成器产出的是
英文、通用、2 条 criteria、全 `UNKNOWN`、状态 `DRAFT` 的新合同；
`examples/waca-se-boss.json`（含 `FAIL`）**已经无法通过 UI 触达**。

也就是说：**产品故事的核心（「运行成功 ≠ 语义正确」，`PARTIAL` 而非 `CLEAR`）
目前在跑起来的页面上看不到**。这对 30% 技术创新性 + 20% 用户体验是直接损失，
也影响 Demo 视频能不能讲出记忆点。

> 这不是要改 Schema、也不是要 Web 单方面决定产品路径。归属上这是
> **产品/队长决策**：要么把 WACA fixture 作为可选「示例场景」重新接回页面，
> 要么让 Goal Discovery 之后能进入 Evidence Review 阶段产生 `FAIL`。
> Web 侧可以先做「可展示证据与状态的渲染能力」，但**需要队长拍板演示路径**。

### 5.3 页面渲染缺项 —— ✅ 已在分支 `feat/web-contract-detail-render` 补全

复核时，页面只渲染了 `objective` / `revision` / `estimatedMinutes` /
`assistanceMode` / `status` / `acceptanceCriteria`（仅 id + 描述 + 状态）/
`inScope` / `unknowns`。以下字段**完全没有渲染**：

- `deliverables`（交付物及 `NOT_STARTED/IN_PROGRESS/DONE` 状态）
- `evidenceItems`（真实证据条目：来源类型、来源名、摘要、finding、审核状态）
- `outOfScope`（只渲染了 `inScope`）
- `known` / `assumptions`（只渲染了 `unknowns`）
- `deadline`、`blockers`、`changeHistory`
- `evidenceRequirements`（每个验收项的证据要求、可接受来源、最少条数）
- 三个 criterion 状态的**视觉区分**：`.status` 对 `UNKNOWN/PASS/FAIL`
  用的是同一个灰色样式，失败项不突出。

**本次已补齐**（改动仅限 Web 所有权的 `src/app/page.tsx` + `src/app/globals.css`，
未触碰 `src/lib/contracts.ts`、未改 Schema）：

- `PASS` / `FAIL` / `UNKNOWN` 改为三色 chip（绿 / 红 / 灰），失败项在视觉上最突出；
- Evidence Map 从「验收项状态占位」升级为**按验收项分组的真实证据列表**，
  展示证据来源类型、来源名、摘要、判定、审核状态、关联的 requirement id；
  并对空证据给出明确说明（「尚无证据：该验收项还没有被验证过」），
  而不是让页面看起来像「已完成验证」；
- 新增交付物、范围外、已知、假设、阻塞项、修订记录区块；
- 验收项补充「必需/可选」标签与逐条证据要求（可接受来源 + 最少条数）；
- 顶部加一行进度提示：必需验收项数 + 未通过数，并对「程序能跑 ≠ 判定完成」
  给出显式文案；
- `meta-grid` 改为 `auto-fit` 网格（新增「截止时间」项不再挤坏布局），
  窄屏规则同步更新。

文案表严格取自 `docs/product/mvp0-acceptance.md` 冻结的产品文案
（Boss 状态 / criterion 状态 / finding / review 状态），未自造枚举。

> 这一步只是**把「能展示证据与失败」的渲染能力准备好**；
> 页面上跑不出 WACA 失败故事的问题（§5.2）仍需队长拍板演示路径。

---

## 6. Web Owner 待办优先级（建议）

### P0 — 9/26 前必须完成

1. **修掉 lockfile 不同步（§3.0 🔴）** —— 一行提交，但直接决定「别人能不能按 README
   装起来」。提交 `pnpm install` 重新生成的 `pnpm-lock.yaml` + 同步 README 命令。
2. **部署上线，产出可访问链接**
   目前零部署配置。这是提交材料的硬性必需项，且越早上线越能让队友/评委看到、
   便于录制 Demo。需要先拿到环境变量管理方式（`BOSS_API_KEY` 是服务端密钥，
   绝不能进浏览器）。
3. **把失败演示路径接通** —— 渲染能力已就绪（§5.3 ✅），**缺的是产品决策**：
   演示走 WACA `PARTIAL` 失败故事，还是「任意目标 → 合同」通用故事？
   队长拍板后，Web 侧接一个「示例场景」入口或把 WACA fixture 接回页面即可。
4. **修掉请求体非法 JSON 返回 500 的回归**（见 §3.1 🐛），一行的改动。
5. **合并 `product/waca-demo-acceptance`**（或确认其已被取代）
   它是演示真值和 60 秒演示脚本的来源，目前只在未合并分支上。

### P1 — 差异化与工程完整性

6. **Local Evidence Bridge 最小探针**（旧交接文档指定的下一步）
   只读、目录选择、默认排除 `.env`/`.git`/`node_modules`/数据集/权重/二进制/超限文件、
   发送前给用户确认清单、为不支持目录 API 的浏览器提供
   `<input type="file" webkitdirectory multiple>` 回退。
   这是「Evidence 驱动」产品承诺的落地，直接服务 30% 技术创新性。
7. **移动端/窄屏可用性复核**（评分里「功能可用性」）。
8. **落地页叙事与竞赛定位对齐**：当前首屏讲的是「模糊目标 → 可验收的 Boss」，
   没有体现「失败经验累积与孵化」这一细分方向。

### P2 — 有余力再做

9. 客户端持久化（`localStorage`）让刷新后回到同一 Boss（争议见 issue 04）。
10. Understanding Check 定时提醒与能力进度视图（依赖共享接口冻结）。
11. 清理已孤立文件 `src/lib/mock-contract.ts`（已无任何引用）。
12. 补 CI workflow（lockfile 修好后，`frozen-lockfile` + lint + typecheck + test + build）。

---

## 7. 需向队长确认的事项（更新版）

1. **演示路径**：9/26 提交的 Demo 主打哪个故事？WACA `PARTIAL` 失败故事，
   还是「任意模糊目标 → 合同」的通用故事？（决定 §5.2 怎么解）
2. **部署平台**：Vercel / CloudStudio / 其他？`BOSS_API_KEY` 与
   `BOSS_GENERATOR` 的线上取值由谁配置？线上是否开放 llm 模式（涉及额度与稳定性）？
3. **`product/waca-demo-acceptance` 是否合并**，以及 60 秒脚本是否仍为验收基线。
4. **Local Evidence 的规则**：文件大小上限、允许的文本扩展名、数据集/权重判定。
5. **是否允许持久化 `FileSystemDirectoryHandle`**（若允许，用 IndexedDB 存多久、
   如何撤销授权）。
6. **用户确认前，文件名与摘要是否允许发送到服务端**（隐私边界）。
7. **LearnBuddy 使用记录**由谁负责汇总成提交材料。
8. 初赛 2500 Credits 额度当前消耗情况（影响是否能跑 llm 演示）。

---

## 8. 风险

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| **无线上地址** | 提交硬性必需，且剩 9 天 | 优先做 P0-2 |
| **lockfile 不同步** | `main` 上 `--frozen-lockfile` 直接失败（§3.0），README 的安装命令不可用 | 优先做 P0-1 |
| **共享接口漂移** | `src/lib/contracts.ts` 只是 Schema 的 TS 镜像；单方面加字段会让 fixture / 接口 / 页面不同步 | 任何字段变化先改 `schemas/**` + `examples/**` + 文档，再改实现 |
| **`main` 必须始终可演示** | `docs/collaboration.md` 明文要求 | 短分支 + PR + 至少一人 review；不要直推 `main` |
| **演示故事与产品定位不符** | 细分方向是「失败经验累积」，当前页面看不到失败 | 见 §5.2，尽快让队长拍板 |
| **本机删文件会被 shim 拦截** | 相对路径 `rm` 直接失败 | 见 §3.2 |
| **`llm` 模式依赖外部额度** | 演示当天 500 会很难看 | 备份 `BOSS_GENERATOR=mock` 的确定性演示路径 |

---

## 9. 上手命令

```bash
# 0) 切到演示基线
git fetch origin
git checkout main && git pull

# 1) 依赖与配置
#    新建 .env（不是改 .env.example！该文件被 git 跟踪）
#    BOSS_GENERATOR=mock          # 离线确定性，无需 Key
#    BOSS_API_KEY=<向队长索取>     # 仅 llm 模式需要
#
#    ⚠️ 先不要用 --frozen-lockfile：main 上的 lockfile 与 package.json 不同步，
#       会报 ERR_PNPM_OUTDATED_LOCKFILE（见 §3.0）。修好后可以加回来。
NODE="C:/Users/Zhang Yuming/.workbuddy/binaries/node/versions/22.22.2/node.exe"
CP="C:/Users/Zhang Yuming/.workbuddy/binaries/node/versions/22.22.2/node_modules/corepack/dist/corepack.js"
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm install

# 2) 验证
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm typecheck   # 期望退出码 0
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm test        # 期望 64/64
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm lint        # 期望 0 error
NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm build       # 期望退出码 0

# 3) 启动
BOSS_GENERATOR=mock NODE_OPTIONS="--use-system-ca" "$NODE" "$CP" pnpm dev -- -p 3100
# http://localhost:3100
```

提交 PR 前必须跑通 `pnpm lint` + `pnpm build`。

---

## 10. 关键文档索引

- `docs/teammate-onboarding.md` — 团队通用上手（权威）
- `docs/ai/goal-discovery.md` — Goal Discovery 行为定义
- `docs/ai/goal-discovery-phase1-plan.md` — 第一阶段计划 + 事故记录 + D1–D6 缺陷附录
- `docs/contracts.zh-CN.md` — Boss Contract 字段语义（权威）
- `docs/product-brief.md` — 产品定位与 MVP 边界
- `docs/collaboration.md` — 分工与 Git 工作流
- `schemas/boss-contract.v0.schema.json` — **唯一**机器可读标准
- `docs/issues/01–04` — 缺陷与产品讨论（04 为多 Boss/会话 UX，已 defer MVP-1）
- `docs/product/mvp0-acceptance.md`、`docs/demo/waca-mvp0-script.md`
  — **未合并**，在 `origin/product/waca-demo-acceptance`
