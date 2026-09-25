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

## 当前命令（M5）

```bash
ctxpack init [--project <name>]   # 在当前 Git 仓库创建 .ctxpack/，已有合法文件不会被覆盖
ctxpack status                    # 只读：输出目标、进度、障碍、下一步与已采集的 Git 状态
ctxpack capture                   # 读取 Git 工作区，写入 state.json 的 git 字段并更新 manifest.updatedAt
ctxpack handoff [--to <target>] [--compact] [--budget <n>]   # 只读：向标准输出生成可交给下一个 Agent 的自包含 Markdown 交接文档
```

`handoff` 汇总 `state.json`（目标、进度、障碍、下一步、相关文件、验证结果、上次采集的 Git 状态）与 `decisions.md`、`failures.md`、`project.md`。`decisions.md` 支持 `- [YYYY-MM-DD] <summary> — <reason>`，`failures.md` 支持 `- <approach>: <result> — <reason>`；不符合该格式的原文内容会原样保留在输出中。空字段以 `(not recorded)` 占位。命令只读，不改写任何文件；Git 数据来自最近一次 `capture`，不会自动重新采集。未初始化、JSON 损坏或 schema 非法时以非零退出并报出明确诊断。两次运行间 `.ctxpack/` 无变化时输出完全一致（确定性）。

`--to` 选择输出格式，可用目标：`generic`（默认，同 `ctxpack handoff`）、`codex`、`pi`、`claude`。三种特定格式复用同一份已校验的 ContextPack，只改变排版，保留全部关键语义（目标、进度、决策及原因、失败方案及原因、障碍、下一步、相关文件、验证结果、上次采集的 Git 状态），并明确声明这是交接状态而非已完成记录——这些格式是本项目自定义的约定，不是各产品官方规定的格式：

- `codex`：任务简报式布局——开头给出继续执行的指令清单，`## Do Not Retry` 单独列出已失败方案，其余事实收进 `## Reference` 参考区。
- `pi`：紧凑的 `KEY: value` 单栏字段加缩进列表，适合直接粘贴到小型终端 Agent 的提示词。
- `claude`：结构化交接文档——前置阅读说明、目标与进度、`- [ ]` 待办清单、`## Constraints & Pitfalls` 汇总失败方案与障碍。

未知 `--to` 值会列出全部可用目标并以非零退出。

### 输出预算与信息分级（M5）

`handoff` 的输出按估算 token 预算裁剪，避免大型仓库的交接无限膨胀：

- 默认预算：约 **4,000** 个估算 token。
- `--compact`：约 **2,000**。
- `--budget <n>`：使用 `n`。`--budget` 与 `--compact` 同时给出时 **`--budget` 生效**，并在 stderr 提示一条说明。
- 非法、零、负数或非整数的 `--budget` 以非零退出并报出诊断。

内容按三级优先级保留，四种 `--to` 格式应用完全相同的取舍：

| 级别 | 内容 | 裁剪行为 |
| --- | --- | --- |
| Critical | 项目、目标、当前状态、当前任务、障碍、下一步、已失败方案及原因、失败的验证项 | 从不裁剪；若仅此部分已超预算，命令非零退出并提示增大 `--budget`，不静默丢弃 |
| Relevant | 重要决策及原因、已完成事项、相关文件、简明 Git 状态（分支/HEAD/干净与否/diff stat）、通过的验证项 | 按确定性的阶梯逐步限量，列表尾部给出 `… N more … omitted` 标记 |
| Archive | 较长自由备注（project.md 备注、decisions/failures 中的非格式行）、最近提交、变更文件明细列表 | 最先整体省略，页脚注明省略内容；完整内容始终在 `.ctxpack/` 中 |

超预算时输出尾部带预算页脚，写明估算用量、预算和省略项；小型 pack 在预算内时输出除页脚外与此前版本一致。裁剪只按整项省略，不截断半句话，不改写任何 `.ctxpack/` 文件，相同输入与参数产生完全相同输出。

**估算方法与局限（必须如实理解）**：估算值 = `ceil(ASCII 字符数 / 4) + 非 ASCII 字符数`。这是一个确定性的字符启发式，**不是任何具体模型的精确 tokenizer**：对典型英文文本大致贴合“约 4 字符一个 token”的经验值；对中文等非 ASCII 文本按约 1 字符 1 token 计，仍属近似；emoji、稀有文字和长串符号可能低估或高估。请把它当作粗略上界使用，不要把输出里的 `~N` 当作某个模型的真实 token 数。

`init` 生成 `.ctxpack/{manifest.json,state.json,artifacts.json,project.md,decisions.md,failures.md,commands.md,snapshots/}`，JSON 文件由 `src/schema/` 中的 Zod schema 定义并在读取时校验；状态缺失或损坏时 `status`、`init`、`capture` 与 `handoff` 均以非零退出码报错并说明原因，且不改动已有文件。

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
