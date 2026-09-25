# ctxpack

> **Portable context for coding agents.**

## 1. 项目定位

`ctxpack` 是一个面向 Coding Agent 的 **上下文打包、交接与恢复工具**。

它解决的不是“如何让 Agent 更聪明”，而是一个更基础的问题：

> 一个 Agent 已经理解了项目、做了一半工作、踩过一些坑之后，如何把这些有效状态低成本地交给另一个 Agent 或下一次 Session？

典型场景：

```text
Devin 执行长任务
    ↓
任务做到 60%
    ↓
ctxpack capture
    ↓
ChatGPT / Codex Review
    ↓
ctxpack handoff --to pi
    ↓
Pi 基于已有状态继续执行
```

核心目标是让：

```text
Agent A → Agent B
Session 1 → Session 2
Computer A → Computer B
```

不再意味着：

```text
重新读仓库
重新理解目标
重新猜设计决策
重新踩已经踩过的坑
```

---

# 2. 第一性原则

ctxpack **不是 Memory 系统**。

ctxpack **不是 Prompt Manager**。

ctxpack **不是 Agent Framework**。

ctxpack 本质上只完成三个动作：

```text
Capture
   ↓
Normalize
   ↓
Handoff
```

即：

### Capture

从当前工作区提取：

- 当前目标
- 已完成工作
- 当前任务
- 关键文件
- Git 变化
- 已验证结论
- 已失败方案
- 重要设计决策
- 当前 Blocker
- 下一步动作

### Normalize

形成稳定、机器可读的数据结构。

### Handoff

根据不同 Agent 的输入习惯生成合适的上下文。

---

# 3. 核心用户

第一阶段只服务：

### Coding Agent 用户

包括但不限于：

- Codex
- Pi
- Claude Code
- Devin
- Cursor Agent
- OpenCode
- 其他 CLI Coding Agent

目标用户特征：

```text
同时使用多个 Agent
+
任务持续时间较长
+
经常切 Session
+
经常需要 Review / Handoff
```

---

# 4. MVP 非目标

V0.x 明确不做：

- 云端同步
- 用户账号
- Web UI
- 多人协作
- Vector DB
- RAG
- 长期个人 Memory
- MCP Registry
- Agent 调度
- 自动修改代码
- Agent Runtime
- Workflow Engine
- IDE Plugin
- SaaS

原则：

> ctxpack 只负责状态交接，不负责执行任务。

---

# 5. 核心 CLI

V0.1 只提供：

```bash
ctxpack init

ctxpack capture

ctxpack status

ctxpack handoff

ctxpack handoff --to codex

ctxpack handoff --to pi

ctxpack handoff --to claude
```

之后增加：

```bash
ctxpack diff

ctxpack validate

ctxpack compact

ctxpack export
```

---

# 6. 工作目录

初始化之后：

```text
.ctxpack/
├── manifest.json
├── state.json
├── project.md
├── decisions.md
├── failures.md
├── commands.md
├── artifacts.json
└── snapshots/
```

其中：

## manifest.json

描述 ctxpack 本身。

```json
{
  "version": "0.1",
  "project": "relay",
  "createdAt": "...",
  "updatedAt": "...",
  "schemaVersion": 1
}
```

---

## state.json

这是整个项目最核心的数据。

```json
{
  "goal": "Implement durable resume",
  "status": "in_progress",
  "completed": [],
  "currentTasks": [],
  "blockers": [],
  "nextActions": [],
  "relevantFiles": [],
  "verification": [],
  "git": {}
}
```

---

# 7. 核心领域模型

不要把模型设计复杂。

V0.1：

```typescript
interface ContextPack {
  meta: PackMeta
  goal: Goal
  progress: Progress
  decisions: Decision[]
  failures: Failure[]
  files: RelevantFile[]
  verification: Verification[]
  git: GitState
  nextActions: Action[]
}
```

## Goal

```typescript
interface Goal {
  summary: string
  acceptanceCriteria?: string[]
}
```

## Progress

```typescript
interface Progress {
  status:
    | "not_started"
    | "in_progress"
    | "blocked"
    | "completed"

  completed: string[]
  currentTasks: string[]
  blockers: string[]
}
```

## Decision

```typescript
interface Decision {
  id: string
  summary: string
  reason?: string
  timestamp: string
}
```

## Failure

这是非常重要的模型。

```typescript
interface Failure {
  approach: string
  result: string
  reason?: string
}
```

目的：

> 防止下一个 Agent 重复走已经证明失败的路线。

---

# 8. Context Capture

第一阶段不要追求“自动理解整个项目”。

Capture 数据来源只允许：

```text
Git
Filesystem
显式配置
已有 ctxpack 状态
Agent/用户提供的摘要
```

### Git 数据

读取：

```text
git status
git diff
git diff --staged
git log
current branch
HEAD
```

但默认不直接把完整 diff 塞进上下文。

只保留：

```text
changed files
diff stats
selected diff
```

---

# 9. Handoff 输出

默认：

```bash
ctxpack handoff
```

输出：

```markdown
# Current Goal

Implement durable resume.

# Current State

Status: IN_PROGRESS

Completed:
- SQLite RunStore
- Checkpoint API

Current task:
- Restore execution after process crash

# Important Decisions

- SQLite first
- No Temporal
- Append-only event log

# Known Failed Approaches

- Re-running every effect after resume
  Reason: duplicates external side effects

# Current Blockers

- Side effects do not yet have idempotency keys

# Next Actions

1. Add effect ID
2. Persist effect completion
3. Add crash recovery test

# Relevant Files

- src/runtime/run.ts
- src/runtime/effect.ts
- src/store/sqlite.ts

# Verification

- unit tests: PASS
- crash recovery: FAIL

# Git State

Branch: feat/resume
Changed files: 6
```

---

# 10. Adapter 架构

不要在 Core 里面写 Agent-specific 逻辑。

```text
                  ┌──────────┐
                  │ ctxpack  │
                  │   Core   │
                  └────┬─────┘
                       │
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
     Codex           Pi           Claude
    Adapter        Adapter         Adapter
```

统一接口：

```typescript
interface HandoffAdapter {
  name: string

  render(pack: ContextPack): Promise<string>
}
```

V0.1 支持：

```text
generic
codex
pi
claude
```

Agent Adapter 第一阶段只负责：

> 格式差异。

不要对各家 Agent 做复杂 Prompt Engineering。

---

# 11. Compact 机制

ctxpack 最大风险之一：

> 自己最终变成新的 Context Bloat。

因此必须从第一版建立 token discipline。

所有信息分三级：

```text
Critical
Relevant
Archive
```

默认 handoff：

```text
Critical
+
Relevant 摘要
```

Archive 默认不发送。

预算：

```text
默认 handoff：
<= 4,000 tokens

Compact：
<= 2,000 tokens

Full：
用户主动指定
```

后续支持：

```bash
ctxpack handoff --budget 3000
```

---

# 12. 技术栈

## Runtime

```text
TypeScript
Node.js 22+
```

原因：

- Coding Agent 生态兼容性好
- CLI 开发简单
- npm 安装方便
- 跨 Windows / Linux / macOS
- 后续 Pi 集成成本低

---

## Package Manager

```text
pnpm
```

---

## CLI

推荐：

```text
Commander.js
```

不要引入重量 CLI Framework。

---

## Schema

```text
Zod
```

负责：

- manifest 校验
- state 校验
- schema migration

---

## Storage

V0.1：

```text
JSON
Markdown
Git
```

暂时不要 SQLite。

ctxpack 的核心优势之一应该是：

```text
git clone
↓
.ctxpack/
↓
直接恢复上下文
```

---

## Testing

```text
Vitest
```

---

## Build

```text
tsup
```

---

# 13. Repo 结构

```text
ctxpack/
├── src/
│   ├── cli/
│   ├── core/
│   ├── capture/
│   ├── adapters/
│   │   ├── generic.ts
│   │   ├── codex.ts
│   │   ├── pi.ts
│   │   └── claude.ts
│   ├── git/
│   ├── schema/
│   └── storage/
│
├── tests/
│
├── examples/
│
├── docs/
│
├── package.json
├── README.md
└── PROJECT.md
```

---

# 14. 迭代计划

## M0 — Skeleton

目标：

> 一个可以正常安装和调用的 CLI。

完成：

```text
pnpm workspace
TypeScript
CLI
Vitest
CI
lint
build
```

验收：

```bash
ctxpack --help
```

正常工作。

---

# M1 — Context Pack Core

实现：

```text
ContextPack schema
manifest
state
storage
init
status
```

命令：

```bash
ctxpack init

ctxpack status
```

验收：

初始化普通 Git 仓库后生成合法：

```text
.ctxpack/
```

---

# M2 — Git Capture

实现：

```text
branch
HEAD
git status
changed files
diff stat
recent commits
```

命令：

```bash
ctxpack capture
```

验收：

修改项目文件后运行：

```bash
ctxpack capture
```

能够正确识别工作区状态。

---

# M3 — Handoff MVP

实现：

```text
generic markdown renderer
goal
progress
decisions
failures
blockers
next actions
git state
relevant files
```

命令：

```bash
ctxpack handoff
```

验收：

一个新的 Agent 只阅读输出的 handoff 文档，即可回答：

```text
项目现在在做什么？
做到哪里？
当前问题是什么？
下一步是什么？
哪些路线已经失败？
```

---

# M4 — Agent Adapters

增加：

```text
Codex
Pi
Claude Code
```

命令：

```bash
ctxpack handoff --to codex

ctxpack handoff --to pi

ctxpack handoff --to claude
```

验收：

同一个 ContextPack 可以输出不同格式，但：

> 信息语义必须一致。

---

# M5 — Token Discipline

实现：

```text
critical
relevant
archive

token budget
compact
```

命令：

```bash
ctxpack handoff --compact

ctxpack handoff --budget 3000
```

验收：

大型项目 handoff 默认不能随着仓库规模无限膨胀。

---

# M6 — Real-world Dogfood

直接用 ctxpack 开发 Relay。

流程：

```text
Devin
↓
ctxpack
↓
ChatGPT Review
↓
Pi
↓
ctxpack
↓
Codex
```

测试三个指标：

### 1. Resume Accuracy

新的 Agent 是否理解：

```text
Goal
State
Blocker
Next Action
```

### 2. Duplicate Work Rate

是否重复：

```text
读文件
调查
尝试失败方案
```

### 3. Context Cost

相比从零理解仓库：

```text
token
time
tool calls
```

是否明显下降。

---

# 15. V0.1 发布标准

必须达到：

```text
ctxpack init
ctxpack capture
ctxpack status
ctxpack handoff
ctxpack handoff --to codex
ctxpack handoff --to pi
```

并通过一个真实 Demo：

```text
Agent A
完成项目 50%
↓
ctxpack capture
↓
Agent B
只获取 ctxpack handoff
↓
继续完成任务
```

Agent B 不应需要：

> 从头扫描整个代码库才能知道发生了什么。

---

# 16. 成功指标

V0.1 不看 Star。

看：

```text
Handoff context < 4K tokens

新 Agent 首次有效行动时间
降低 ≥ 50%

重复调查 Tool Calls
降低 ≥ 30%

关键设计决策遗漏
接近 0

已失败方案重复尝试率
接近 0
```

---

# 17. 项目护栏

每个 PR 都必须回答：

> 这个功能是在帮助 Agent 更好地“交接已有状态”，还是在偷偷把 ctxpack 做成 Agent Framework？

如果属于后者：

**不做。**

ctxpack 的核心价值只有一句：

> **Don't make the next agent start from zero.**
