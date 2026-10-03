# ctxpack

面向 Coding Agent 的本地上下文打包与交接工具。目标是在切换 Agent、会话或电脑时，保留当前目标、进度、决策、失败经验和验证结果。

项目范围、CLI、技术栈与 M0–M6 里程碑见 [PROJECT.md](PROJECT.md)。M0–M7 的 CLI 与 TUI 已按里程碑交付并经维护者独立复核（见 [DELIVERY.md](DELIVERY.md)）。

## 安装

```bash
npm install -g @mat973252/ctxpack@0.1.0
ctxpack --version
```

需要 Node.js 22+。npm 包名带作者 scope；命令仍是 `ctxpack`。不带 scope 的同名 npm 包属于其他作者。

## 开发与验收

每次只执行一个里程碑。Devin 提供可取得的源码、测试命令与结果；维护者独立复核通过后，才进入下一阶段。进度记录见 [DELIVERY.md](DELIVERY.md)。

V0.1 的发布判定以 `PROJECT.md` 的命令和真实 Agent 交接 Demo 为准；文档中的目标指标在获得对照实验前只算目标，不算已达到的结果。

许可证：[Apache-2.0](LICENSE)。

## 本地开发

当前可靠性交接候选已在[草稿 PR #3](https://github.com/mat973252/ctxpack/pull/3)公开，尚未发布为新的 npm 包。从空目录取得候选源码（另需 Git）并构建：

```sh
git clone --branch mat/c1-handoff-reliability --single-branch https://github.com/mat973252/ctxpack.git ctxpack-candidate
cd ctxpack-candidate
git rev-parse HEAD
corepack pnpm install --frozen-lockfile
corepack pnpm build
node dist/cli.js --help
```

记录实际检出的完整提交；分支会随审阅更新。检查其他仓库时，在目标仓库内使用 `node "候选源码绝对路径/dist/cli.js"` 代替 `ctxpack`，避免误用旧版全局 CLI。

要求：Node.js >= 22，pnpm 由 Corepack 提供（`packageManager` 固定为 pnpm 10.17.1）。

```bash
corepack enable
corepack pnpm install --frozen-lockfile

pnpm lint                     # eslint + tsc --noEmit
pnpm test                     # vitest run
pnpm build                    # tsup -> dist/cli.js
node dist/cli.js --help       # CLI 冒烟
```

## 当前命令（M7）

```bash
ctxpack init [--project <name>]   # 在当前 Git 仓库创建 .ctxpack/，已有合法文件不会被覆盖
ctxpack status                    # 只读：输出目标、进度、障碍、下一步与已采集的 Git 状态
ctxpack capture                   # 读取 Git 工作区，写入 state.json 的 git 字段并更新 manifest.updatedAt
ctxpack validate                  # 只读：交接前预检，退出码 0/1（见下节）
ctxpack handoff [--to <target>] [--compact] [--budget <n>]   # 只读：向标准输出生成可交给下一个 Agent 的自包含 Markdown 交接文档
ctxpack ui [--to <target>] [--compact] [--budget <n>] [--color <mode>]   # 交互式终端界面（见下节）
```

### 推荐工作流：init → 编辑 → capture → validate → handoff

```bash
ctxpack init                      # 一次性：创建 .ctxpack/
$EDITOR .ctxpack/state.json       # 手工填写 goal、status、nextActions、blockers 等；decisions.md / failures.md 记录决策与失败
ctxpack capture                   # 记录当前分支、HEAD、改动文件与 diff stat
ctxpack validate && ctxpack handoff --to codex > HANDOFF.md   # 预检通过才生成交接文档
```

`validate` 是只读、确定性的交接预检，不改写任何文件（含 `.git/index`，Git 读取以 `GIT_OPTIONAL_LOCKS=0` 执行），不联网、不调用模型、不自动补字段、不自动重新 capture。检查两件事：

1. **必填字段**：`goal` 非空白；`status` 不是 `completed` 时 `nextActions` 至少有一条非空白条目。缺失时给出编辑 `state.json` 的具体建议。记录了 `blockers` 的 `blocked` 项目是合法的交接状态，不算失败。
2. **Git 快照**：用与 `capture` 相同的读取逻辑（同样排除 `.ctxpack/`）取当前元数据，与 `state.git` 逐字段比较 `branch`、`head`、`headState`、`clean`、`changedFiles`、`changes`、`stat`；不比较 `recentCommits`（作者/日期）。结果分五类：未采集、旧版不完整快照、元数据已变化（列出变化字段与新旧值）、干净且匹配、脏工作区但匹配。已知字段有变化时优先报“已变化”，再判定“不完整”。

| 退出码 | 含义 |
| --- | --- |
| `0` | 必填字段齐全，且快照完整、与当前工作区匹配、采集时工作区干净 |
| `1` | 需要处理：字段缺失、未采集、快照不完整、元数据已变化、脏快照需人工复核、pack 不在 Git 工作区内（报告走 stdout）；或 pack 缺失/损坏、git 不可用等读取错误（诊断走 stderr） |

**局限（必须如实理解）**：

- 脏工作区的快照只有文件名和 diff 行数，**无法证明未提交文件内容没有变化**，因此即使元数据完全一致也判定为需复核并退出 1。
- 干净且匹配只说明**元数据一致**，不证明语义上仍然新鲜、上下文完整或验证结论仍然成立；这些仍需下一个 Agent 自行判断。
- `manifest.updatedAt` 是 pack 更新时间，不是可信的采集时间；`validate` 不引入任何 TTL 或时间判断。
- 不计算文件指纹、不做 schema 迁移。

### 结构化预检（当前源码）

`ctxpack validate --json` 输出 `ctxpack.validate/1`，包含 `ok`、`diagnostics` 和 `git`；退出码仍为 0（通过）或 1（修复／复核）。脚本应读取 `code`，不要匹配提示文案。普通文本输出保持原有格式。

- 字段诊断：`goal_missing`、`next_actions_missing`。
- Git 诊断：`git_no_repository`、`git_not_captured`、`git_changed`、`git_incomplete`、`git_match_clean`、`git_match_dirty`；`git.headState` 区分 branch/unborn/detached，无法取得时为 null。changedFields/missingFields 给出具体元数据项。`git_match_clean` 是通过说明，不是错误。
- 读取诊断：`pack_missing`、`file_missing`、`file_unreadable`、`invalid_json`、`invalid_schema`、`git_read_failed`、`capture_incomplete`、`capture_changed`；其他存储／预检失败保留 `storage_error`／`validation_failed`。读取失败时 `git` 为 null。

JSON 错误保留文件定位，不回显非法 JSON 正文或底层异常原文。dirty 即使元数据匹配仍退出 1；结构化输出同样不执行修复，也不证明语义新鲜度。

### Codex 显式入口（当前源码）

包内 `skills/ctxpack-handoff` 是项目自带 skill。安装当前候选包后，可将该目录复制到目标仓库的 `.agents/skills/ctxpack-handoff`，在新的 Codex 会话显式输入 `$ctxpack-handoff`。不要覆盖已有同名 skill。CLI 需支持上述 `validate --json`；已发布的旧包不因此自动获得新能力。

使用上述公开源码时，可直接复制源码中的 `skills/ctxpack-handoff` 目录，并向 Codex 明确提供已构建的 `dist/cli.js` 绝对路径；无需安装旧版 npm 包。复制目标仍为目标仓库的 `.agents/skills/ctxpack-handoff`，已有同名目录时先检查。

例如本地 npm 依赖安装后，在目标仓库的 PowerShell 中执行一次：

```powershell
$destination = '.agents/skills/ctxpack-handoff'
if (Test-Path -LiteralPath $destination) { throw '同名 skill 已存在，请先检查' }
New-Item -ItemType Directory -Path '.agents/skills' -Force | Out-Null
Copy-Item -LiteralPath 'node_modules/@mat973252/ctxpack/skills/ctxpack-handoff' -Destination $destination -Recurse
```

显式调用只展示预检与已记录交接；即使包里写了“继续下一步”，也不会因此执行。默认不调用 capture/init、不覆盖 AGENTS.md、不后台同步。dirty 或必填字段缺失会连同交接展示为待复核；文件损坏或采集中断则报告错误并停止读取。后续执行须来自用户的单独请求。

`handoff` 汇总 `state.json`（目标、进度、障碍、下一步、相关文件、验证结果、上次采集的 Git 状态）与 `decisions.md`、`failures.md`、`project.md`。`decisions.md` 支持 `- [YYYY-MM-DD] <summary> — <reason>`，`failures.md` 支持 `- <approach>: <result> — <reason>`；不符合该格式的原文内容会原样保留在输出中。空字段以 `(not recorded)` 占位。命令只读，不改写任何文件；Git 数据来自最近一次 `capture`，不会自动重新采集。未初始化、JSON 损坏或 schema 非法时以非零退出并报出明确诊断。两次运行间 `.ctxpack/` 无变化时输出完全一致（确定性）。

仅省略文件开头完整且未修改的初始化模板；后来重复出现的模板文字、正文空行和行尾双空格均保留。围栏代码块中的列表作为原文保留，不解析成决策或失败条目。修改过的模板也保留，避免猜测哪些文字属于用户。

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

`init` 生成 `.ctxpack/{manifest.json,state.json,artifacts.json,project.md,decisions.md,failures.md,commands.md,snapshots/}`，JSON 文件由 `src/schema/` 中的 Zod schema 定义并在读取时校验；损坏文件会在补建前拒绝。需要创建或修复文件时，init 与 capture 共用下述写入标记和代号，避免与采集交错；文件完整的重复 init 保持只读。初始化中断也保留标记，但不会生成 capture 的两份原始 JSON 备份，应核对已创建文件或恢复可信备份。缺失的必要状态仍会使读取命令失败。

`capture` 只修改用户 JSON 中的 `state.git` 与 `manifest.updatedAt`，其余用户状态和文件不动；另维护 `.capture-revision` 写入代号和临时 `.capture-pending/` 事务目录。JSON schema 仍为 v1，原有手动编辑方式不变。`state.git` 字段（全部可选，M1 写出的 `git: {}` 仍可读取）：

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

采集先在 `.capture-pending/` 保存两份原始 JSON 和待写内容，再逐文件替换，最后发布新的 `.capture-revision` 并清理事务目录。`capture_incomplete` 表示采集正在进行或曾中断；status、handoff、validate、init、capture 和 TUI 均拒绝将该目录视为有效交接。`capture_changed` 表示读取跨过了一次已完成采集，或写入前状态被改动，重新读取后再决定是否重试。只读入口不执行修复。

中断恢复目前需要人工检查：先确保所有采集进程已退出，归档当前 `.ctxpack/`；若事务目录内两份 `*.before.json` 均完整合法，可将它们分别恢复为 state.json 与 manifest.json，更新 `.capture-revision` 为新的唯一值，再把事务目录移出 `.ctxpack/` 保存。备份不完整或中断后已有人工编辑时，不应盲目覆盖；逐项核对或从其他可信备份恢复。只有两份文件确认属于同一份状态后才移走标记，随后运行 `ctxpack validate`。本次强杀测试覆盖进程中断，不声称提供断电/介质损坏保证；也不保证旧版客户端或外部编辑器遵守此标记。

### 交互式界面 `ctxpack ui`（M7）

`ctxpack ui` 从真实安装的 Node 包启动（`bin` 指向 `dist/cli.js`，不依赖 tsx 或 devDependencies），在当前 Git 工作区读取 `.ctxpack/` 并显示可交互的状态视图：项目目标、进度、决策及原因、失败方案及原因、阻塞、下一步、相关文件、验证结果、上次采集的 Git 分支/HEAD/改动摘要。Handoff 区可预览 generic/codex/pi/claude 四种交接文本（含估算用量与省略提示），预览走与 `handoff` 完全相同的渲染路径，输出逐字节一致。

**键位**：`↑/k` `↓/j` 选区，`Tab`/`→`/`l`/`Enter` 进入内容区（之后 `↑↓/jk` 滚动、`PgUp/PgDn` 翻页），`Esc`/`←`/`h` 返回，`1`–`4` 切换 handoff 目标，`b` 在默认/compact 预算间切换，`p` 直达 Handoff，`r` 重新读取 `.ctxpack/`，`q`/`Esc`/`Ctrl+C` 退出。屏幕底部常驻键位提示。

**写操作边界**：界面导航与预览全部只读，绝不改写 `.ctxpack/`。仅有的两个写入口 `c`（`capture`）与 `i`（`init`）都会先弹出标有 `WRITE ACTION` 的确认框，列出将修改的文件，必须显式按 `y` 才执行；`n`/`Esc` 取消且不落盘。capture 修改 `state.git`、`manifest.updatedAt` 及上述事务元数据，确认框也明确提示中断备份。

**错误与边界**：非 Git 仓库、未初始化、JSON 损坏/schema 非法时显示可操作的错误屏（损坏状态可用 `r` 重试，未初始化可用 `i` 确认初始化），stdin/stdout 非 TTY 时以非零退出。终端小于 40×10 显示“too small”提示；≥100 列时左侧为导航栏，<100 列折叠为顶部区段条；窗口 resize 时实时重排。

**颜色与字符**：配色取 `--ink #142121`、`--paper #fbf9f8`、`--mint #83cebe`、`--muted #61706b`、辅色 `#4aab96`；`--color` 支持 `auto`（默认，探测 TERM/COLORTERM/WT_SESSION）、`always`（真彩色）、`256`、`16`、`never`。`NO_COLOR` 环境变量优先生效——即使显式给了 `--color` 也不输出颜色 SGR（选中态退化为反白）。无 UTF-8 locale 时边框与标记退化为 ASCII。标志用字符 `▐M▌●`（深底白 `M` + 薄荷色圆点；ASCII 模式为 ` M *`），不依赖图片协议。CJK/emoji 按宽字符计宽并正确截断。
