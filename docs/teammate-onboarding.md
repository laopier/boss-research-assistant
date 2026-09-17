# 队友上手指南（Boss 科研助手 MVP-0 演示）

> 本指南面向团队成员第一次拉取并运行 demo 验证。
> 目标：5–10 分钟把 Boss Contract 生成 demo 跑起来。

---

## 0. 前置依赖

- Node.js ≥ 22（推荐 22.22.2，已在 `package.json` 的 `packageManager` 锁定 pnpm 11.19.0）
- pnpm（推荐）或 npm
- 一个 DeepSeek API Key（向队长索取）。mock 模式不需要 Key

如未装 pnpm：
```bash
npm install -g pnpm@11.19.0
```

---

## 1. 拉取与切换

```bash
# 第一次
git clone https://github.com/laopier/boss-research-assistant.git
cd boss-research-assistant
git checkout main

# 已经克隆过
git fetch origin
git pull
```

> ⚠️ 切到 **`main`** 分支——演示已经合并到 main。不需要切其他分支。

---

## 2. 配置环境变量（关键）

**新建 `.env` 文件**（不是修改 `.env.example`！）。

```bash
# 在仓库根目录新建 .env（gitignored，安全）
cat > .env <<'EOF'
BOSS_GENERATOR=mock
# BOSS_API_KEY=<向队长索取>
# BOSS_API_BASE=https://api.deepseek.com
# BOSS_MODEL=deepseek-chat
EOF
```

两种模式可选：

| `BOSS_GENERATOR` | 行为 | 需要 Key？ |
| --- | --- | --- |
| `mock` | 离线 mock 生成器，确定性、无网络 | 否 |
| `llm` | 调真实 DeepSeek 模型，可能 5–10 秒 | 是 |

> 🚨 **绝对不要把 Key 填进 `.env.example`**——该文件是 git 跟踪的，填了等于泄露到 GitHub。
> 任何时候提到"新建 .env"，都指**新建** `.env` 文件本身。

---

## 3. 安装依赖

```bash
pnpm install
# 或：npm install
```

> 首次安装可能慢（47000+ 文件）。如果中途卡住，重试即可（pnpm 有重入保护）。

---

## 4. 启动

```bash
pnpm dev
# 默认 http://localhost:3000
# 想换端口：pnpm dev -- -p 3100
```

启动成功的标志（dev server 输出）：
```
✓ Ready in ~1s
- Local: http://localhost:3000
```

打开浏览器访问该地址。

---

## 5. 试用

页面有 1 个文本框（默认占位文本可改），输入 1–500 字符的科研目标，点 **生成 Boss Contract**。

期望看到：
- 右上角**蓝色"AI 生成"徽标**（llm 模式）或**黄色"模拟数据"徽标**（mock 模式）
- 标题 + objective（AI 模式会是中文）
- 验收标准（4–5 条）+ Evidence Map
- 范围边界（inScope / outOfScope）+ 当前未知（unknowns）
- Boss 状态：默认 **DRAFT（草稿）**——MVP-0 永远生成 DRAFT，不生成 ACTIVE

每次刷新页面会得到一份**独立的** Boss Contract。这是 MVP-0 的设计——见 `docs/issues/04-chat-per-boss-ux.md`，下个 milestone 才加会话区域。

---

## 6. 跑测试 / 类型检查

```bash
# 类型检查
pnpm typecheck

# 全量测试（应输出 64/64 pass）
pnpm test
# 或：pnpm test -- src/test/validation.test.ts   （单文件）
```

---

## 7. 常见问题

### 端口 3000 被占
```bash
pnpm dev -- -p 3100
# 同时修改 curl 测试的端口
```

### 启动后页面打不开，一直转圈
- 看 dev server 终端，是否有 EPERM / next-development.log 等错误
- 当前 dev server 跑的是 Turbopack，对文件系统速度敏感；如果你的 `.next` 缓存被别的进程锁了（少见），换一个 `distDir`：
  ```bash
  # 临时：在仓库根新建 next.config.mjs
  cat > next.config.mjs <<'EOF'
  /** @type {import('next').NextConfig} */
  const nextConfig = { distDir: ".next-dev" };
  export default nextConfig;
  EOF
  ```
- **不提交这个 next.config.mjs**（它属于临时本机配置）

### AI 模式 500 报错
- 检查 `.env` 里 `BOSS_API_KEY` 是否正确、有没有多余空格
- 用 curl 直接探：
  ```bash
  curl -X POST http://localhost:3000/api/contracts/generate \
    -H "Content-Type: application/json" \
    -d '{"schemaVersion":"boss-contract.v0","goal":"我想试试"}'
  ```
  - 返回 400 → 输入有误（空、过长、schemaVersion 不对）
  - 返回 500 + `CONFIG_ERROR` → Key 没读到
  - 返回 500 + 其他 → 看 dev server 终端完整堆栈

### Key 写错地方了 / 误填进了 `.env.example`
立刻：
1. 联系队长重置 Key
2. 把 `.env.example` 改回模板
3. 重新填入新 Key 到 `.env`

### git 操作报错 "could not read xxx"
理论上你的机器不该遇到（那是队长机器上某个后台进程问题）。如遇到：
```bash
git fetch origin '+refs/heads/*:refs/remotes/origin/*' --prune
# 仍然报错的，把 sha1 报给队长
```

---

## 8. 团队分支速查

| 分支 | 用途 | 你需要碰吗？ |
| --- | --- | --- |
| `main` | **演示基线，所有人从这里拉取** | ✅ 日常 |
| `ai/goal-discovery-fixtures` | AI 模块源码与 fixtures | 一般不碰，AI 负责人维护 |
| `web/mvp0-goal-contract` | Next.js 垂直切片（已被 main 吸收） | 已合并，仅参考 |
| `product/waca-demo-acceptance` | 验收规则、演示脚本 | 一般不碰 |
| `integration/mvp0-ai*` | 集成调试分支（已合并） | 仅历史参考 |

修改任何分支前，先看 `docs/collaboration.md`。

---

## 9. 关键文档索引

- `docs/architecture.md` — 系统整体架构
- `docs/api-contract.md` — HTTP API 定义
- `docs/contracts.zh-CN.md` — Boss Contract 字段语义（权威）
- `docs/ai/goal-discovery.md` — Goal Discovery 行为定义
- `docs/ai/goal-discovery-phase1-plan.md` — 第一阶段实施计划
- `docs/issues/` — 缺陷与产品讨论
- `docs/product-brief.md` — 产品定位
- `docs/collaboration.md` — 协作规范

---

## 10. 出问题找谁

- **Web / 部署 / 页面问题** → Web owner
- **Goal Discovery 行为 / API 校验 / Prompt** → AI owner
- **演示步骤 / 验收规则 / 中文文案** → Product owner
- **.git / 远端 / 跨成员协作** → 队长

提 issue 前请先看 `docs/issues/` 有没有类似条目。