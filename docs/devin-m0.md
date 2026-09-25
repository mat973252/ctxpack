# ctxpack M0 — Devin Cloud 任务书

请只实现 ctxpack 的 M0 项目骨架。ctxpack 是本地优先的 Coding Agent 上下文打包与交接 CLI；后续功能是 capture、normalize、handoff，本阶段不实现这些功能。技术约束：Node.js 22+、TypeScript、pnpm、Commander.js、Vitest、tsup，轻量 lint 与 GitHub Actions CI。不要加入云服务、账号、数据库、Web UI 或 Agent runtime。

交付一个独立的 `ctxpack/` 源码目录，使全新 Linux 环境能够执行 `corepack pnpm install --frozen-lockfile`、lint、test、build，以及构建产物的 `ctxpack --help`。CLI 帮助要显示项目名和命令入口；尚未实现的后续命令不要伪装成可用。附带最小示例测试和明确的 Node/pnpm 版本说明。优先使用简单结构，不要提前搭建未来模块框架。

请将 `ctxpack/`（不含 `node_modules`、`.git`、密钥）打成 ZIP，给出可下载的会话附件或明确的下载方式、SHA-256、实际运行的命令与原始结果摘要。若平台无法交付文件，请明确说明，不能只给聊天中的完成声明。

停止点：完成 M0 后停下等待独立验收；不要开始 M1，不要创建 GitHub 仓库、推送、开 PR 或公开发布。若方案需要外部权限或超出本阶段范围，先说明阻塞。把本阶段计算消耗控制在 5 ACU 内；接近上限时停下报告当前成果。
