# ctxpack M2 — Git Capture

前提：以已验收的 M1 为基线。只实现 M2 的 Git 工作区采集和 `ctxpack capture`；不生成 handoff、不读取 Agent 会话、不使用 LLM，也不实现 adapter 或 compact。

`capture` 从当前已初始化的普通 Git 仓库读取当前分支、HEAD、Git 状态、改动文件、staged 与 unstaged 的 diff stat，以及最近最多 5 条提交。对尚无提交的仓库、detached HEAD、文件名含空格和非 ASCII 字符给出稳定行为。`changedFiles` 包含 tracked 修改、staged 修改和 untracked 文件；diff stat 仅针对 Git 能统计的 tracked/staged 内容。默认不得把完整 diff 或文件正文写入 `.ctxpack/`。为避免自引用，采集结果不计入 `.ctxpack/` 自身的变更。

扩展 M1 的 `state.git` schema 以持久保存这些最小数据，已有 M1 合法状态仍能读取。`capture` 只更新 `state.git` 与 `manifest.updatedAt`，保持 goal、进度、决策、失败记录及其他现有文件内容不变；读 Git 或校验状态失败时返回明确诊断和非零退出，不覆盖已有合法状态。遵守 Apache-2.0 和既有 Node 22+/pnpm/TypeScript 工具链。

验收：全新安装后 lint/test/build；在临时 Git 仓库依次制造已提交基线、unstaged、staged、untracked 和含空格/非 ASCII 文件名，运行 `ctxpack capture` 后对照真实 Git 命令检查 branch、HEAD、文件集合、stat 和最近提交；重复 capture 在工作区未变时数据稳定；修改已有 goal/blockers 后 capture 保留它们；损坏 state、未初始化目录和非 Git 目录都失败且不覆盖内容。提供实际命令、测试结果、变更文件、远端提交 SHA 与已知缺口。

交付：从最新 `main` 建立独立分支 `devin/m2-git-capture`，提交并推送到已授权的项目远端；不要改 `main`、不开 PR。M2 完成后停止，等待 Codex 独立验收，不进入 M3。计算消耗限制 8 ACU，接近上限时停止并报告。
