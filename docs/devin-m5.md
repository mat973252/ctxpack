# ctxpack M5 — 分级与输出预算

前提：以已验收的 M4 为基线。只实现交接输出的信息分级、默认预算、`--compact` 与 `--budget <positive integer>`。不做 LLM 摘要、Agent 会话读取、云端同步、自动修改状态或 M6 的真实 Relay 试用。

按现有状态字段建立明确且可审计的 Critical、Relevant、Archive 分级。Critical 至少包括项目、目标、当前状态、当前任务、障碍、下一步、已失败方案及原因、失败的验证项；Relevant 包括重要决策及原因、已完成事项、相关文件与简明 Git 状态；Archive 可包含较长的自由备注、历史提交和详细文件列表。默认 handoff 的预算为 4,000 个估算 token；`--compact` 为 2,000；`--budget N` 使用 N。必须公开所用估算方法及其局限，不得把估算值说成某个模型的精确 token 数。优先保留 Critical，再保留 Relevant 摘要；Archive 默认不进入交接，除非预算容许且不会挤占更重要内容。若 Critical 本身超出用户指定预算，明确报错并提示增大预算，不要静默丢失 Critical。

四种已支持格式（generic、codex、pi、claude）都要应用相同的信息优先级和预算规则；格式可以不同，保留的事实应一致。小型状态在预算内时保持 M4 原有输出的关键语义。超预算时用确定性裁剪与明确的省略提示；不得截断为不可读的半句话、损坏 Markdown 或改变原始 `.ctxpack/`。无论选项组合如何，运行都只读且相同输入/参数产生相同输出。`--compact` 与 `--budget` 同时提供时明确优先级并在帮助与 README 中说明；非法、零、负数和非整数预算须非零退出。

验收：全新安装后 lint/test/build；在一个临时大型 Git 仓库生成含长决策、失败、文件列表和验证记录的 pack，对四种格式分别运行默认、compact 和 `--budget 3000`，按项目公开的估算方法核对输出不超过预算、Critical 完整、Relevant 有界、Archive 的省略行为与输出提示；重复运行字节一致，交接前后 `.ctxpack/` SHA-256 不变。另测极小预算时明确失败、不覆盖状态；小型状态保持关键事实；不合法参数有诊断。记录实际命令、样本、估算 token 数、远端 SHA 和已知限制。

交付：从最新 `main` 建立独立分支 `devin/m5-token-discipline`，提交并推送到已授权的项目远端；不要改 `main`、不开 PR。M5 完成后停止，等待 Codex 独立验收，不进入 M6。计算消耗限制 8 ACU，接近上限时停止并报告。
