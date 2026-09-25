# ctxpack

面向 Coding Agent 的本地上下文打包与交接工具。目标是在切换 Agent、会话或电脑时，保留当前目标、进度、决策、失败经验和验证结果。

项目范围、CLI、技术栈与 M0–M6 里程碑见 [PROJECT.md](PROJECT.md)。目前仅建立项目文档与本地 Git 基线，代码开发由 Devin Cloud 按里程碑交付。

## 开发与验收

每次只执行一个里程碑。Devin 提供可取得的源码、测试命令与结果；维护者独立复核通过后，才进入下一阶段。进度记录见 [DELIVERY.md](DELIVERY.md)。

V0.1 的发布判定以 `PROJECT.md` 的命令和真实 Agent 交接 Demo 为准；文档中的目标指标在获得对照实验前只算目标，不算已达到的结果。

许可证：[Apache-2.0](LICENSE)。

## 本地开发（M0）

要求：Node.js >= 22，pnpm 由 Corepack 提供（`packageManager` 固定为 pnpm 10.17.1）。

```bash
corepack enable
corepack pnpm install --frozen-lockfile

pnpm lint                     # eslint + tsc --noEmit
pnpm test                     # vitest run
pnpm build                    # tsup -> dist/cli.js
node dist/cli.js --help       # CLI 冒烟
```

当前为 M0 骨架：`ctxpack` 仅打印帮助与版本；`capture`、`normalize`、`handoff` 等命令尚未实现，不会在帮助中伪装为可用。
