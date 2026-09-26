# 社区调研与 `ctxpack validate` 的最小改动（2026-09-26）

## 来源（核对日期 2026-09-26）

| 来源 | 类型 | 观察 |
| --- | --- | --- |
| <https://v2ex.com/t/1220285>（2026-06） | 论坛讨论 | 用户在切换会话或工具后重新扫描代码库以重建上下文；提到用 Markdown 计划/记忆文件作为现有替代做法。 |
| <https://www.reddit.com/r/ClaudeAI/comments/1plgyff/> | 论坛讨论 | 用户在上下文压缩（compaction）后手工写会话摘要 / 交接说明。 |
| <https://github.com/openai/codex/issues/36642>（2026-08-03） | 单个用户 issue | 报告上下文被静默丢失。这是一条历史性的个案报告，不是总体失败率。 |

这些材料只支持“交接完整性值得检查”这一判断，**不构成对另一个记忆平台的已证实需求**，也不能用于宣称任何性能或采用率改善。本文不引用任何用户数量、采用数据或效果对比。

## 观察到的问题

- 交接的失效模式集中在两点：交接内容缺少目标 / 下一步（下一个 Agent 不知道该做什么），以及交接文本描述的仓库状态与实际工作区不一致（下一个 Agent 基于过时状态行动）。
- 目前 `ctxpack handoff` 只读渲染 `.ctxpack/`，不会告诉用户这两点是否成立；用户只能自己核对。

## 现有替代方案：Markdown 计划 / 记忆文件

手写 `PLAN.md`、`NOTES.md` 等文件是社区已经在用的做法，成本低、无依赖。它的缺点与 ctxpack 相同：文件与仓库状态可能脱节，且没有任何机器可检查的“可以交接”信号。ctxpack 不试图替代这种做法；`.ctxpack/*.md` 本身就是这类文件，`validate` 也不改写它们。

## 选择的最小改动

新增只读命令 `ctxpack validate`（实现见 `src/core/validate.ts`，测试见 `tests/validate.test.ts`）：

1. 用既有 storage 层加载并校验 pack；要求 `goal` 非空白，`status != completed` 时至少一条非空白 `nextActions`。缺失只给出编辑 `state.json` 的建议，不自动填充，不改写 Markdown。
2. 用既有 `captureGitState`（同样排除 `.ctxpack/`）读取当前 Git 元数据，与 `state.git` 比较 `branch`、`head`、`headState`、`clean`、`changedFiles`、`changes`、`stat`，不比较 `recentCommits` 的作者/日期。结果分为：未采集、旧版不完整快照、元数据已变化、干净且匹配、脏工作区但匹配；已知字段有变化时优先判定“已变化”。
3. 退出码：仅在字段齐全且快照完整、匹配、干净时返回 0；其余情形与读取错误返回 1，并打印原因与下一步。`blocked` 且记录了 `blockers` 的项目是合法交接状态，不算失败。
4. Git 读取以 `GIT_OPTIONAL_LOCKS=0` 执行，避免只读查询顺带刷新 `.git/index`。这一环境变量加在共用的 git runner 上，`capture` 同样受益，没有行为变化（capture 本来就只写 `.ctxpack/`）。
5. 不改动既有 `handoff` / `status` / TUI 输出，不改动存储 schema。

## 明确拒绝的扩展

- 文件内容指纹 / 哈希：可以证明内容不变，但意味着新的存储字段与 schema 迁移，超出本阶段范围。
- TTL / “快照多久算过期”：`manifest.updatedAt` 是 pack 更新时间而非可信采集时间，任何时间阈值都是编造的判据。
- 自动重新 capture、自动补全字段、自动重试：与“只读预检”矛盾，且会掩盖用户本应看到的差异。
- LLM 摘要、联网、读取 Agent 会话记录：属于 PROJECT.md 的非目标。
- `--json` 输出、`--strict` 等选项：没有当前用户需求证据，先不加。

## 验收与局限

已在本阶段执行（见 PR 描述中的命令与结果）：冻结安装、`pnpm lint`、`pnpm test`（含新增 17 个 `validate` 测试：空 pack、空白字段、`completed` 免 nextActions、干净匹配、HEAD / 分支 / 状态变化、同 diff 统计但内容变化的脏快照、旧版部分快照、非 Git 目录中的 pack、缺失 / 损坏 pack、`.ctxpack/` 字节与 mtime 及 `.git/index` 不变、三次运行输出逐字节一致、既有 handoff 输出不变）、`pnpm build`、`node dist/cli.js --help` 与安装包冒烟。

局限：

- 脏快照的元数据一致**不能证明**未提交文件内容未变，因此始终判为需复核（退出 1）。
- 干净且匹配只表示元数据一致，不表示语义新鲜、上下文完整或验证结论仍成立。
- 没有对真实用户做任何采用或效果测量；上述来源是动机而不是证据。
- 维护者独立验收已完成：Windows Node 24.13.0 冻结安装、lint、152 项测试、build、仓外安装包冒烟通过。复核发现并修复 unborn 缺 head / detached 缺 branch 被误判为旧版不完整快照的问题，补充对应回归。原交接输出与 Git index/pack 只读回归通过。
- 仓外安装包冒烟确认新仓库干净预检通过、工作区变化时退出 1。
