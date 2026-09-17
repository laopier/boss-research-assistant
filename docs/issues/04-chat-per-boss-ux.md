# Issue 04 — UX: 每个对话 = 新 Boss，用户容易迷失

## 观察

集成冒烟实测时，队长在 Web 端连续尝试生成第二个 Boss，发现每次"新开对话"都会创建一份独立的 Boss Contract。
反馈原文：

> "现在有一个问题，我们每一次对话都是在新建一个 boss 吧🤔，因为我刚刚尝试提交任务但是他直接给我跳到了新的 boss。我现在想做这样的一个操作，我们每次开启新的 boss 就新开一个聊天区域，之后和 boss 的沟通都在那个聊天框内（类似于 learnbuddy 的新建任务与空间的概念），否则用户容易迷失。"

## 根因

当前 Web 端只实现 MVP-0 的 Goal-to-Contract vertical slice：
- 首页表单 → POST `/api/contracts/generate` → 渲染一份合同
- 没有 Boss 列表、没有持久化、没有会话标识

每次"刷新 / 重新打开" 都会得到一份全新合同，与上一次没有任何关联。

## MVP-0 范围约束

来自 `docs/collaboration.md` 与 `docs/ai/goal-discovery-phase1-plan.md`：
> 不在同一 Boss 内接入：登录/数据库、长期科研规划、**多 Boss 管理**、……

加"会话区域 + 列表"会同时跨过"多 Boss 管理""数据库""登录"三条红线，**不是 MVP-0 内的修复，是产品范围扩展**。

## 三个候选方案（已与队长讨论）

### 🅰 MVP-0 范围修补（半天工作量）

- 生成 Boss 后 URL 变成 `/boss/[id]`，刷新即恢复同 Boss（localStorage 持久化）
- 顶部一个 "+ 新建 Boss" 按钮 → 回首页表单
- 不引入后端、不动 schema

**取舍**：跨设备/清浏览器数据丢失。

### 🅱 MVP-1 真做（一周+）

- 服务端 SQLite/Postgres + Boss 列表 + 完整聊天历史
- 新建 `bosses` 表、改 `route.ts` 加 GET/PATCH、加登录态

**取舍**：直接跨过 MVP-0 三条红线；等于开新 milestone。

### 🅲 跳过 MVP-0（队长决策，2026-09-17）

- 当前 demo 把"每会话 = 一次 Goal Discovery 校验"作为特性
- 把"会话即 Boss / 多 Boss 管理"列入下一个产品 milestone 议题，开会拍板

## 决策

**队长选择 🅲**。原因（队长原话）："现在额度不多了，让队友去做变动。"

留给下一个 milestone 讨论。本次不实施。

## 移交清单

- Web owner：把"会话区域 + Boss 列表"列入 MVP-1 backlog
- Product owner：在下次 milestone 会议拍板"用户路径"（🅰 客户端 → 🅱 服务端的过渡节奏）
- AI owner：不需要改 Goal Discovery；MVP-1 实施时 `getGenerator().generate(goal)` 已经能直接复用，schema 也已经有 `id` 字段可作为会话标识

## 关联

- `docs/ai/goal-discovery-phase1-plan.md` §1（Goal Discovery 范围）
- `docs/collaboration.md` 范围与红线
- `docs/issues/01-web-vertical-slice.md`（Web 垂直切片已交付的 baseline）