# ctxpack M4 — Agent 输出格式适配

前提：以已验收的 M3 为基线。只增加 Codex、Pi、Claude Code 三种 handoff 输出格式和 `ctxpack handoff --to codex|pi|claude`；默认 `ctxpack handoff` 继续输出 M3 通用格式。不要做 LLM、Agent 会话读取、自动写入各家配置、工具调用、compact 或 token 预算。

三个 adapter 应复用同一份已校验的 ContextPack 与现有 Markdown 内容，只负责格式差异。每一种格式都必须完整保留 M3 的关键语义：项目、目标、完成和当前任务、重要决策及原因、已失败方案及原因、障碍、下一步、相关文件、验证结果、上次采集的 Git 状态。采用简洁、可直接粘贴给目标 Agent 的 Markdown；以明确标题或说明让目标 Agent 知道这是交接状态，不要把未验证事项写成已完成。对三个目标的格式区别给出具体例子，但不要声称这是各产品官方规定格式。

输出必须只读、确定性稳定，不额外采集 Git；未知 `--to` 值给出可用目标列表和非零退出。保持 M1/M2/M3 数据兼容、Apache-2.0、Node 22+/pnpm/TypeScript 工具链。可以用小的 adapter 接口或共享视图减少重复，但不要引入只为未来扩展而设的框架。

验收：全新安装后 lint/test/build；同一个填有真实目标、决策、失败、障碍和 Git 状态的临时仓库中分别运行默认、`--to codex`、`--to pi`、`--to claude`，比较四份输出的关键语义与差异；三份特定格式在连续运行时字节一致，生成前后 `.ctxpack/` 和工作区文件字节不变；未知目标和损坏状态返回非零与明确诊断。提交一份可复现的简短示例与实际命令/结果。

交付：从最新 `main` 建立独立分支 `devin/m4-agent-adapters`，提交并推送到已授权的项目远端；不要改 `main`、不开 PR。M4 完成后停止，等待 Codex 独立验收，不进入 M5。计算消耗限制 8 ACU，接近上限时停止并报告。
