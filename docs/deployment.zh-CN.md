# 部署说明（平台中立版）

> 赛事硬性要求：**作品须部署至浏览器环境，提供可直接访问的在线链接**（赛事手册 §4.1，Q5 明确「是的，我们要求作品提供可在线体验的链接」）。
> 提交截止 **9 月 26 日 23:59**。

本方案刻意**不绑定厂商**：同一份构建产物既能部署到任意容器平台，也能直接跑在裸 Node 主机上，
Vercel 也能直接使用（它会忽略 `Dockerfile`）。

---

## 1. 先理解一个硬约束：这个应用不能纯静态托管

`next build` 的路由形态：

```text
Route (app)
┌ ○ /                            ← 静态预渲染
├ ○ /_not-found
└ ƒ /api/contracts/generate      ← 动态，需要 Node 服务端运行时
```

`ƒ` 代表「按需服务端渲染」。生成逻辑必须留在服务端，因为 `BOSS_API_KEY`
是**服务端密钥，绝不能进浏览器**。

**结论**：GitHub Pages、纯静态对象存储、仅支持静态的托管产品
（如 CloudStudio 静态部署、EdgeOne 纯静态模式）**都跑不了**——
页面能打开，但一点「生成 Boss Contract」就会 500。

必须选择**支持 Node 服务端运行时**的方案。

---

## 2. 环境变量

服务端读取以下变量（见 `src/lib/goal-discovery/factory.ts`）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `BOSS_GENERATOR` | 否 | `mock`（默认，离线确定性）或 `llm`（调真实模型）。**其它值会抛 `CONFIG_ERROR`，不会静默降级。** |
| `BOSS_API_KEY` | 仅 llm | 服务端密钥。**绝不提交、绝不下发浏览器** |
| `BOSS_API_BASE` | 否 | 默认 `https://api.deepseek.com` |
| `BOSS_MODEL` | 否 | 默认 `deepseek-chat` |
| `PORT` / `HOSTNAME` | 否 | 容器内由 `Dockerfile` 设为 `3000` / `0.0.0.0` |

**建议先按 `BOSS_GENERATOR=mock` 上线**：确定性强、零额度消耗、演示不会翻车。
需要时再通过环境变量切到 `llm`，无需改代码、无需重新构建。

> ⚠️ `.env.example` 是被 git 跟踪的模板，**不要把真实 Key 填进去**。
> 本地开发新建 `.env`（已在 `.gitignore` 中）。

---

## 3. 方案 A：Docker（推荐，通用性最好）

```bash
docker build -t boss-research-assistant .

docker run -d --name boss \
  -p 3000:3000 \
  -e BOSS_GENERATOR=mock \
  boss-research-assistant
```

要开真实模型就加上 `-e BOSS_GENERATOR=llm -e BOSS_API_KEY=<key>`。
**密钥通过运行时环境变量注入，不进镜像层。**

`Dockerfile` 是三阶段构建：

1. `deps` —— 只复制 `package.json` / `pnpm-lock.yaml` / `pnpm-workspace.yaml`，
   跑 `pnpm install --frozen-lockfile`（依赖层可缓存）。
2. `builder` —— 复制源码，跑 `pnpm build`。
3. `runner` —— 只带 `.next/standalone` + `.next/static`，以非 root 用户 `nextjs` 运行。

最终的 `runner` 阶段很小：不含包管理器、不含构建工具链、不含完整 `node_modules`。

---

## 4. 方案 B：不用 Docker，直接跑 standalone 产物

`next.config.mjs` 里开了 `output: "standalone"`，所以 `next build` 会额外产出
`.next/standalone`——一个自带所需 `node_modules` 子集的自包含服务端。

```bash
pnpm install --frozen-lockfile
pnpm build

# standalone 不包含 .next/static，必须手动补（这是 Next.js 的既定行为）
cp -r .next/static .next/standalone/.next/

cd .next/standalone
PORT=3000 HOSTNAME=0.0.0.0 BOSS_GENERATOR=mock node server.js
```

> 本仓库没有 `public/` 目录，所以无需拷贝它。若以后新增了 `public/`，
> 也要一并拷进 `.next/standalone/`。

---

## 5. 两个容易踩的坑（都已在本仓库处理）

### 5.1 standalone 不自动带 `.next/static`

`output.md` 明确写道：该最小服务器**默认不复制 `public` 和 `.next/static`**
（设计上假设由 CDN 处理），需要手动拷到 `standalone/` 下。
`Dockerfile` 已经处理了这一步；手动部署时要自己记得。

### 5.2 `examples/**/*.json` 必须显式纳入文件追踪（否则线上守卫静默失效）

`src/lib/goal-discovery/factory.ts` 的 `loadKnownFixtureSignatures()` 在**运行时**
用 `readFileSync` 读 demo fixtures，路径由 `resolve(__dirname, "../../..")` 或
`process.cwd()` **动态拼出**。

而 Next.js 的输出文件追踪（`@vercel/nft`）靠**静态分析**，跟不了这种动态路径。
更麻烦的是该函数**故意把「读不到」当成「跳过」**（`catch { return null }`），
所以一旦没打进产物，它不会报错，只会**静默地一条 fixture 都找不到**——
后果是 llm 模式下的**抄袭守卫（语义校验规则 S8）失效**，而日志里毫无痕迹。

因此 `next.config.mjs` 里显式声明：

```js
outputFileTracingIncludes: {
  "/api/contracts/generate": ["./examples/**/*.json"],
}
```

**验证方式**（本仓库已实测）：

```bash
pnpm build
ls -R .next/standalone/examples
# 应看到 5 个 json：waca-se-boss.json
#                  ai/waca.json
#                  ai/literature-reading.json
#                  ai/dataset-investigation.json
#                  ai/eval/cases.v1.json
```

这 4 个 fixture 去重后应得到 **3 条唯一签名**
（`examples/ai/waca.json` 与 `examples/waca-se-boss.json` 共用 id
`boss-waca-se-demo`）。

---

## 6. 上线后必须做的验收

| # | 检查项 | 期望 |
| --- | --- | --- |
| 1 | 打开首页 | 200，能看到标题与目标输入框 |
| 2 | 输入模糊目标并提交 | 200，渲染出 Boss Contract |
| 3 | 徽标 | `mock` 模式显示「模拟数据」；`llm` 模式显示「AI 生成」 |
| 4 | 空目标 / 501 字符 / 错误 `schemaVersion` | 400 `INVALID_REQUEST` |
| 5 | 页面在窄屏（手机）可读可操作 | 内容不溢出、按钮可点 |

非法 JSON、空请求体、错误 `schemaVersion` 与不合法目标现在均返回
**400 `INVALID_REQUEST`**，并已由 `src/test/route.test.ts` 覆盖。服务端配置或
生成器内部故障才返回 **500 `INTERNAL_ERROR`**。

---

## 7. 与提交材料的对应关系

- 部署产出的 URL 即赛事要求的**「作品链接」**（必需项）。
- 建议把线上地址写进 README，方便队友与评委直接访问。
- Demo 视频录制建议用 `BOSS_GENERATOR=llm` 展现真实模型效果；
  线上保持 `mock` 保证稳定。
