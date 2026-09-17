# Web：完成 Goal to Contract 页面链路

**负责人：Web 工程负责人**

## 目标

交付可本地启动的目标输入页面，通过模拟 API 展示 Boss Contract、验收标准和 Evidence Map 占位区。

## 文件边界

- `src/app/**`
- 不修改 `src/lib/contracts.ts` 的字段语义

## 工作项

- 完成目标输入、长度限制、加载态和错误态。
- 调用 `POST /api/contracts/generate`。
- 展示 Contract 元信息、Acceptance Criteria 和 Evidence Map。
- 确认桌面与移动窄屏均可使用。

## 验收

- `pnpm lint` 与 `pnpm build` 通过。
- 输入非空目标后能看到带“模拟数据”标记的 Contract。
- 空目标不能提交，接口错误能显示给用户。

## 建议分支

`web/goal-contract-slice`
