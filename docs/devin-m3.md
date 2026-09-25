# ctxpack M3 — 通用 Handoff MVP

前提：以已验收的 M2 为基线。只实现通用 Markdown handoff 与 `ctxpack handoff`，不做 Codex、Pi、Claude 专用适配，不做 compact、预算、LLM、云端同步或 Agent 会话读取。

`ctxpack handoff` 读取既有 `.ctxpack/` 状态和 Markdown 文件，向标准输出生成一份可直接交给新 Coding Agent 的自包含交接文档。至少覆盖项目名称、当前目标、进度（已完成与正在进行）、重要决策、已失败方案及原因、当前障碍、下一步动作、相关文件、验证结果与 M2 Git 状态。`decisions.md`、`failures.md` 可采用最小的明确格式；若现有文件是普通 Markdown，也应保留其中有价值的原文，不因未采用新格式而丢失。空字段用简洁、明确的占位说明，避免把未知说成已完成。输出须确定性稳定，可在无 Git 变化时重复生成相同内容。

默认只读：命令不得修改 `.ctxpack/` 或工作区；无须自动运行 `capture`，应标明所展示 Git 数据来自上次采集。若未初始化、JSON 损坏或 schema 非法，返回明确诊断和非零退出。可以增加纯渲染函数和针对它的测试，但保持 M1/M2 数据兼容，避免扩大领域模型。保留 Apache-2.0 与 Node 22+/pnpm/TypeScript 工具链。

验收：全新安装后 lint/test/build；在临时 Git 仓库中 `init`、编辑 state/decisions/failures、`capture`、`handoff`，核对输出覆盖五个交接问题：现在做什么、做到哪里、当前问题、下一步、哪些路线已失败及原因；验证 JSON/Markdown、manifest、工作区在 handoff 前后字节不变；连续两次输出一致；缺失/损坏状态给出非零与明确错误。提供一个带真实内容的示例 handoff，并说明如何复现。不要将示例内容作为固定实现。

交付：从最新 `main` 建立独立分支 `devin/m3-generic-handoff`，提交并推送到已授权的项目远端；不要改 `main`、不开 PR。M3 完成后停止，等待 Codex 独立验收，不进入 M4。计算消耗限制 8 ACU，接近上限时停止并报告。
