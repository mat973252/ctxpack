# 里程碑交付记录

状态日期：2026-09-25。M0、M1、M2 已独立验收并集成到 `main`；M3 待 Devin 执行。

| 阶段 | 交付结果 | 独立验收 | 状态 |
| --- | --- | --- | --- |
| M0 | 可安装 CLI、构建、测试、lint、CI 配置 | 全新安装；CLI help/version；lint、测试与构建 | 已验收 |
| M1 | ContextPack schema、存储、`init`、`status` | 临时 Git 仓库初始化、状态结构、无覆盖、只读与错误路径 | 已验收 |
| M2 | Git 工作区采集 | 变更文件后验证 branch、HEAD、文件和 diff stat | 已验收 |
| M3 | 通用交接文档 | 新 Agent 仅凭 handoff 回答目标、进度、障碍、下一步与失败路线 | 未开始 |
| M4 | Codex、Pi、Claude 格式适配 | 相同状态在不同输出中的语义一致 | 未开始 |
| M5 | 分级与 token 预算 | 大仓库默认输出受预算限制且关键内容不丢失 | 未开始 |
| M6 | Relay 真实交接试用 | 记录对照实验与实际结论 | 未开始 |

每阶段验收记录须包含源码来源、版本或提交、运行环境、实际命令、结果、已知缺口及下一步决定。未验收成果不得标为完成；远端创建、推送和发布另行处理。

## M0 验收记录（2026-09-25）

- 源码：Devin Cloud 会话 `e57eed8ed3544d61badab3b06a8a9cea` 提交 `d1cb32315c88abfae0a275d4bf8527de59382ecf`，远端分支 `devin/m0-skeleton` 的 SHA 已核对；本地 `main` 快进到同一提交。
- 独立环境：Windows PowerShell，Node `v24.13.0`，Corepack pnpm `10.17.1`；从远端分支创建全新检出目录。
- 实际命令与结果：`corepack pnpm install --frozen-lockfile` 成功；`corepack pnpm lint` 成功；`corepack pnpm test` 为 1 文件、2 测试通过；`corepack pnpm build` 成功生成 `dist/cli.js`；`node dist/cli.js --help` 显示 `ctxpack` 和 M0 尚未实现打包命令；`node dist/cli.js --version` 输出 `0.0.1`。
- 范围与许可证：新增 CLI、测试、工具配置和 GitHub Actions CI；`PROJECT.md`、`docs/`、`LICENSE` 未修改，`package.json` 声明 Apache-2.0。未发现提前实现 M1 命令。
- 已知缺口：本机安装经历 npm 仓库下载超时和自动重试，最终在 5 分 11 秒完成。本机独立运行环境是 Windows；GitHub Actions 在 `main` 提交 `6121e3b` 上的 Ubuntu CI [运行 36091736673](https://github.com/mat973252/ctxpack/actions/runs/36091736673) 已通过安装、lint、测试、构建和 CLI 冒烟。
- 下一步：按 `docs/devin-m1.md` 将 M1 单独交给 Devin，完成后再独立验收。

## M1 验收记录（2026-09-25）

- 源码：Devin Cloud 会话 `fc0d0aa0e7bf48c28d52c4f1b2aaa707` 提交 `c8cbe3e3b95dc3ef8c4e264689aede81f6cb337c`；远端 `devin/m1-core` SHA 已核对，本地 `main` 快进到同一提交。交付物可从该 Git 提交取得。
- 独立环境：Windows PowerShell，Corepack pnpm `10.17.1`；以远端分支创建全新检出目录。测试使用本机 Node `v24.19.0`。
- 实际命令与结果：`corepack pnpm install --frozen-lockfile`、lint、build 均通过；Node `v24.19.0` 下测试为 2 文件、13 测试通过；构建产物帮助列出 `init`、`status`，未提前实现后续命令。
- CLI 端到端：临时 Git 仓库中 `init` 生成 3 个 JSON、4 个 Markdown 和 `snapshots/`，manifest、state、artifacts 的规定字段可解析；修改 state 与 decisions 后再次 `init`，文件哈希不变；`status` 展示目标和障碍且文件哈希不变；非法 JSON、schema 错误、缺失 state 和非 Git 目录都返回非零退出与明确诊断。
- 范围与许可证：仅修改 M1 所需 CLI、schema、存储、测试与 README；`PROJECT.md`、`docs/`、`LICENSE` 未改，`package.json` 仍为 Apache-2.0。
- 环境限制：本机另一套 Node `v24.13.0` 运行测试时有 3 个失败；已用独立最小复现确认其 `fs.rmSync` 执行后文件仍存在，而 `fs.unlinkSync` 能删除。相同检出在 Node `v24.19.0` 上 13 个测试全部通过。GitHub Actions 在 `main` 提交 `9e3ef99` 上的 Ubuntu CI [运行 36092496599](https://github.com/mat973252/ctxpack/actions/runs/36092496599) 已通过安装、lint、测试、构建和 CLI 冒烟。
- 下一步：按 M2 阶段任务书交给 Devin，完成后再独立验收。

## M2 验收记录（2026-09-25）

- 源码：Devin Cloud 会话 `78b9830aaad9412fac07aa5574110903` 提交 `e716dfad48ec4d4239c90bbb2c52552eef21bf48`；远端 `devin/m2-git-capture` SHA 已核对，本地 `main` 快进到同一提交。
- 独立环境：Windows PowerShell，Node `v24.19.0`、pnpm `10.17.1`；从远端分支创建全新检出目录。
- 实际命令与结果：`corepack pnpm install --frozen-lockfile`、`corepack pnpm check` 均通过；lint、3 个文件共 28 项测试、build 全部通过。`node dist/cli.js --help` 列出 `capture`，未提前实现 handoff。
- CLI 端到端：独立临时 Git 仓库中先提交基线，再制造 unstaged、含空格文件名的 staged 和中文文件名的 untracked 文件；`capture` 的 branch、HEAD、3 个 changedFiles、staged/unstaged 文件数与 Git 对照一致，最近提交 SHA 正确。重复 capture 的 `state.git` 不变；预填的 goal/blockers 保留。损坏 state 时命令非零退出且原始损坏文件字节不变。
- 范围与许可证：只修改 M2 所需 Git 采集、schema、CLI/status、测试和 README；`PROJECT.md`、`docs/`、`LICENSE`、依赖与 CI 未改，仍为 Apache-2.0。
- 已知缺口：`state.json` 与 `manifest.json` 依次直接写入，未实现跨文件原子提交；这不是 M2 已规定的验收项，但崩溃时可能出现一新一旧。Windows 测试使用 Node `v24.19.0`；本机 Node `v24.13.0` 的 `fs.rmSync` 异常仍适用。
- Ubuntu CI：`main` 提交 `1c8b3dd` 的 [运行 36093196440](https://github.com/mat973252/ctxpack/actions/runs/36093196440) 已通过安装、lint、测试、构建和 CLI 冒烟。
- 下一步：按 `docs/devin-m3.md` 单独派发 M3。
