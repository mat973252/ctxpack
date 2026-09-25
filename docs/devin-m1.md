# ctxpack M1 — Context Pack Core

前提：以经过独立验收的 M0 为基线。只实现 M1，不做 Git capture、handoff、adapter 或 token compact。

目标：提供 `ctxpack init` 与 `ctxpack status`。`init` 在当前普通 Git 仓库创建 `PROJECT.md` 规定的 `.ctxpack/` 初始结构：`manifest.json`、`state.json`、`project.md`、`decisions.md`、`failures.md`、`commands.md`、`artifacts.json` 和 `snapshots/`。manifest 记录版本、项目、创建与更新时间、schemaVersion；state 包含 goal、status、completed、currentTasks、blockers、nextActions、relevantFiles、verification、git。使用 Zod 定义并校验稳定 schema 和最小 ContextPack 类型。已有合法状态不得被第二次 init 覆盖。

`status` 从现有状态读取并输出目标、进度和障碍；它不能改变任何文件。缺失或损坏状态应给出明确诊断和非零退出码。CLI、存储与 schema 只保留当前阶段所需结构，跨平台路径行为需兼容 Windows、Linux、macOS。Apache-2.0 license 保持一致。

验收：全新安装后的 lint/test/build 通过；在临时 Git 仓库运行 `ctxpack init`，逐一解析并校验生成内容；修改状态后重复 init 验证无覆盖；`ctxpack status` 显示有效内容且前后工作树哈希不变；无状态与无效 JSON 场景能失败且说明原因。提供实际命令、测试结果、源码包 SHA-256 与可取得的交付物。

停止点：M1 完成后等待独立验收；不进入 M2，不创建额外服务、不推送或发布。若已授权的项目远端可用，按交付约定提交到阶段分支并提供确切提交；否则用可核验文件包交付。控制本阶段计算消耗在 8 ACU 内，接近上限时报告并停止。
