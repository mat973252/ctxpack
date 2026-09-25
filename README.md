# ctxpack

面向 Coding Agent 的本地上下文打包与交接工具。目标是在切换 Agent、会话或电脑时，保留当前目标、进度、决策、失败经验和验证结果。

项目范围、CLI、技术栈与 M0–M6 里程碑见 [PROJECT.md](PROJECT.md)。目前仅建立项目文档与本地 Git 基线，代码开发由 Devin Cloud 按里程碑交付。

## 开发与验收

每次只执行一个里程碑。Devin 提供可取得的源码、测试命令与结果；维护者独立复核通过后，才进入下一阶段。进度记录见 [DELIVERY.md](DELIVERY.md)。

V0.1 的发布判定以 `PROJECT.md` 的命令和真实 Agent 交接 Demo 为准；文档中的目标指标在获得对照实验前只算目标，不算已达到的结果。

许可证：[Apache-2.0](LICENSE)。

## 本地开发

要求：Node.js >= 22，pnpm 由 Corepack 提供（`packageManager` 固定为 pnpm 10.17.1）。

```bash
corepack enable
corepack pnpm install --frozen-lockfile

pnpm lint                     # eslint + tsc --noEmit
pnpm test                     # vitest run
pnpm build                    # tsup -> dist/cli.js
node dist/cli.js --help       # CLI 冒烟
```

## 当前命令（M2）

```bash
ctxpack init [--project <name>]   # 在当前 Git 仓库创建 .ctxpack/，已有合法文件不会被覆盖
ctxpack status                    # 只读：输出目标、进度、障碍、下一步与已采集的 Git 状态
ctxpack capture                   # 读取 Git 工作区，写入 state.json 的 git 字段并更新 manifest.updatedAt
```

`init` 生成 `.ctxpack/{manifest.json,state.json,artifacts.json,project.md,decisions.md,failures.md,commands.md,snapshots/}`，JSON 文件由 `src/schema/` 中的 Zod schema 定义并在读取时校验；状态缺失或损坏时 `status`、`init` 与 `capture` 均以非零退出码报错并说明原因，且不改动已有文件。`handoff` 等命令尚未实现。

`capture` 只写 `state.git` 与 `manifest.updatedAt`，其余用户状态和文件不动。`state.git` 字段（全部可选，M1 写出的 `git: {}` 仍可读取）：

| 字段 | 含义 |
| --- | --- |
| `headState` | `branch` / `detached` / `unborn`（尚无提交） |
| `branch` | 当前分支名；detached 时缺省 |
| `head` | HEAD 完整 SHA；unborn 时缺省 |
| `clean` | 排除 `.ctxpack/` 后工作区是否干净 |
| `changedFiles` | 排序去重后的相对路径，含 tracked 修改、staged、untracked |
| `changes` | `git status --porcelain` 每条记录：`path`、`index`/`worktree` 原始状态码（`?` 为 untracked）、重命名的 `from` |
| `stat.staged` / `stat.unstaged` | `files`、`insertions`、`deletions`、`binary`，来自 `git diff [--cached] --numstat` |
| `recentCommits` | 最近最多 5 条：`sha`、`shortSha`、`author`、`date`（ISO）、`subject` |

不写入完整 diff 或文件正文；`.ctxpack/` 自身的改动不计入任何字段。
