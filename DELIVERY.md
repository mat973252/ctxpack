# 里程碑交付记录

状态日期：2026-09-25。M0 已独立验收并集成到 `main`；M1 待 Devin 执行。

| 阶段 | 交付结果 | 独立验收 | 状态 |
| --- | --- | --- | --- |
| M0 | 可安装 CLI、构建、测试、lint、CI 配置 | 全新安装；CLI help/version；lint、测试与构建 | 已验收 |
| M1 | ContextPack schema、存储、`init`、`status` | 在临时 Git 仓库初始化并验证状态结构 | 未开始 |
| M2 | Git 工作区采集 | 变更文件后验证 branch、HEAD、文件和 diff stat | 未开始 |
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
- 已知缺口：本机安装经历 npm 仓库下载超时和自动重试，最终在 5 分 11 秒完成。GitHub Actions 的 Ubuntu CI 结果须在推送 `main` 后另行核对；本机独立运行环境是 Windows，Linux 成功结果来自 Devin 报告。
- 下一步：确认远端 `main` 和 CI 后，按 `docs/devin-m1.md` 将 M1 单独交给 Devin，完成后再独立验收。
