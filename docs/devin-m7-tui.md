# ctxpack M7 — 可打包的交互式 Node TUI

基线：已独立验收的 M5 与 M6 Relay 隔离交接试用。本阶段由 Devin 编写全部产品代码，只实现本地终端界面；不修改或推送 Relay，不宣称 Relay 安全审查 Step 6/7 通过。提交到 `devin/m7-tui` 后停在 M7，等待 Codex 独立验收。10 ACU 上限，接近上限时停止并报告。

## 用户明确的视觉方向（2026-09-25）

- 可通过 Node 包安装运行的**可视化终端界面**，布局与信息密度参考 Claude Code TUI；应是可交互的状态视图，不是加彩色的 `status` 文本。
- 标志参考 [用户 GitHub 头像](https://github.com/mat973252)：深色圆形、白色几何 `M`、薄荷色圆点。以终端字符简化呈现，不依赖图片协议。
- 配色参考 [个人网站](https://mat973252.github.io/) 当日公开样式：`--ink: #142121`、`--paper: #fbf9f8`、`--mint: #83cebe`、`--muted: #61706b`，辅色 `#4aab96`。深色终端需保证文本对比度；真彩色不可用时 ANSI 降级，`NO_COLOR` 生效。布局保持紧凑、清晰层级和细分隔线；不复制 Claude Code 品牌资产或代码。

## 范围

- 增加 `ctxpack ui`（或等价的单一明确入口），从实际 Node 包的 `bin` 启动，默认在当前 Git 工作区读取 `.ctxpack/` 状态。
- 展示项目目标、当前任务、进度、决策、失败及原因、阻塞、下一步、Git 分支/HEAD/改动摘要。可预览 generic/codex/pi/claude 四种交接文本，显示 compact/budget 估算与省略提示；已有 `handoff` 输出必须保持确定性。
- 对 `init`/`capture` 等写入操作使用清楚标注及明确键盘确认；导航/预览本身只读。无效状态、非 Git 仓库或未初始化时给出可操作错误，不覆盖已有文件。先保持最小的可用交互，不增加远端同步或自动模型调用。
- 键盘完整可用：上下/j/k、Enter、Tab 或明确切换键、Esc、q、Ctrl+C，屏幕内有键位提示。80×24 可读，120×30 分栏，resize 恢复布局；退出后终端状态恢复。
- 保留 `init`、`capture`、`status`、`handoff` 的现有 CLI 语义、只读保证及 token 估算说明。

## 安装与验收

- 从全新检出冻结安装、lint、测试、构建；`npm pack` 或等价方式生成真实 npm 包，在仓库外空目录安装 tarball，运行 `ctxpack ui --help` 并在实际 TTY 操作，不依赖源码、`tsx` 或 devDependencies。
- Windows Terminal 与 Ubuntu TTY 各跑一轮；核对 80×24、120×30、resize、中文/Unicode、NO_COLOR、ANSI 降级、Ctrl+C 终端恢复，提供界面截图或录屏，并逐项核对上述视觉令牌和信息层级。
- 在临时 Git 仓库初始化并填入含目标、决策、失败、障碍及中文路径的状态，交互预览四种格式并与原有 CLI 输出比较；预览前后 `.ctxpack/` 全文件 SHA-256 不变。经确认执行 capture 后仅允许既有契约范围的字段改变。非法预算、损坏状态及过小终端有明确反馈。
- README 说明安装、入口、键位、安全边界和终端兼容性。报告完整提交 SHA、测试与打包命令、截图路径、已知限制；只推送本里程碑分支，不直接修改 main。
