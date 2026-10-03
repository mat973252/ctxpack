# 五个真实历史编码任务

2026-10-03，任务材料版本1。本文、材料生成器和控制端manifest包含参考提交，**仅供组织者使用，不放入参与模型的可读材料**。完整编码冒烟与正式上下文恢复对照分别计数。

任务集含四个产品缺陷和一个测试辅助代码缺陷。Relay任务单独列为测试维护，不能合并宣传为五个产品恢复能力修复。两个ctxpack任务虽然来自同一个C1提交，但一个保护原文，一个隔离示例与事实；第二题不包含模板、空白行或行尾空格，不能靠第一题修复通过。

| ID | 历史基线 → 参考修复 | 参与者任务事实 | 允许修改范围 |
| --- | --- | --- | --- |
| markdown-text | ctxpack `6e0c895` → `7cdd523` | 初始模板后的用户正文、重复模板文本、内部空行和Markdown硬换行应保留 | `src/core/handoff.ts` 的 `stripTemplate` |
| ctx-fences | ctxpack `6e0c895` → `7cdd523` | 围栏内的决策／失败列表是示例，保留在notes；围栏外真实条目仍正常解析；短围栏和异类标记不能提前结束示例 | 同文件的 `parseList`，不修改 `stripTemplate` |
| lens-wal | AgentLens `784c511` → `5e5cf3d` | WAL写者在元数据与事件读取之间提交终态时，读取必须来自同一已提交快照；不能提交调用者外层事务，失败后仍可继续读取 | `src/storage/sqlite/store.ts` 的 `getRun` 与必要私有读取方法 |
| relay-clock | Relay `934d5db` → `e51d518` | 业务沙箱测试中的等待辅助函数不能因墙钟调整提前超时或延长五秒预算；恰好截止时拒绝 | `packages/mcp/test/business-sandbox.test.ts` 的 `until`；其他字节和测试断言冻结 |
| permit-proxy | AgentPermit4j `7b90a6e` → `c113515` | 真实CGLIB类代理应能注册原方法注解，执行仍经过原代理advice及审批／幂等流程；代理final工具方法明确拒绝，普通对象final方法仍支持 | `GuardedToolMethods.java` 的发现／创建逻辑及必要imports |

完整SHA由生成器固定；不得在参与者提示中给出参考SHA、补丁、参考输出或原仓可读路径。角色为主代理的组织者已知参考答案，其补丁只用于判定器校准。

## 材料生成

任务1仍使用 [原材料入口](REAL-TASK.md)，无需改写旧数据。其余任务从本地具有相应历史的仓库导出完整基线：

```text
node experiments/recovery/materialize-historical-case.mjs ctx-fences <ctxpack-repository>
node experiments/recovery/materialize-historical-case.mjs lens-wal <agentlens-repository>
node experiments/recovery/materialize-historical-case.mjs relay-clock <relay-repository>
node experiments/recovery/materialize-historical-case.mjs permit-proxy <agentpermit4j-repository>
```

每次新建临时workspace，仅包含基线归档和固定验收测试，创建单提交Git仓库且没有remote，不复制依赖或旧历史。参考源码没有写入参与者目录。AgentLens和Permit叠加参考提交的测试文件；Relay的实现与测试同文件，因此叠加两项时钟测试但用AST恢复原 `until` 声明。ctxpack第二题使用不涉及模板保留的四项固定测试。

manifest在workspace外，记录基线归档、测试和起始源码SHA256。它含控制端参考信息，不能向模型提供。生成器**不安装依赖、不启动模型、不证明访问隔离、不提供统一测试执行器**。本轮用于校准的workspace已含参考补丁，禁止拿它们采样；正式材料必须重新生成。

## 逐任务验收

依赖必须在采样前按各仓锁文件准备好；正式模型阶段不下载包。Node任务使用兼容Node22/24，Windows校准明确选择24.19.0；pnpm为ctxpack/AgentLens 10.17.1、Relay 10.33.0。Permit使用Java21和Maven Wrapper 3.9.11，插件和依赖缓存必须齐备；`-o`不能替代Wrapper分发缓存准备。公共0.5.0消费缓存与本地候选缓存分开，不能先安装候选再声称公共包通过。

| 任务 | 冻结缺陷回归 | 完整判定 |
| --- | --- | --- |
| markdown-text | `pnpm exec vitest run tests/recovery-case.test.ts`，8项 | `pnpm check` |
| ctx-fences | `pnpm exec vitest run tests/recovery-fences.test.ts`，4项 | `pnpm check` |
| lens-wal | `pnpm exec vitest run tests/incremental-recorder.test.ts`，14项，其中WAL快照为基线唯一失败 | `pnpm lint`、`pnpm test`、`pnpm build` |
| relay-clock | `pnpm exec tsc -b`，再 `node --test --test-name-pattern="business waits" packages/mcp/dist/test/business-sandbox.test.js`，2项 | `pnpm check`；Windows平台前提skip单列，不能称跨平台全通过 |
| permit-proxy | `mvnw -B -ntp -o -pl agent-permit-spring-ai -am -Dtest=GuardedToolMethodsAcceptanceTest -Dsurefire.failIfNoSpecifiedTests=false clean test`，4项 | `mvnw -B -ntp -o verify`；使用准备好的独立本地缓存和空settings |

成功必须同时满足：历史基线在指定缺陷处失败；候选完整检查通过；冻结测试、依赖和配置不变；修改不越界；主代理亲读最终差异。Relay文件除 `until` 以外的字节必须一致，不能允许参与者借“可改测试文件”删除断言。其他任务测试文件哈希保持不变。结构化报告与实际退出码核对，加载／依赖错误不算预期缺陷失败。

WAL现有测试是两条真实SQLite连接和确定性调度，不是sleep碰运气。Permit现有代理测试覆盖实际advice与业务次数、参数审批绑定、已消费审批和同键缓存；它没有单独证明代理跨tenant变更或事务回滚，不能由此扩大安全保证。Relay证明的是可构造的墙钟敏感性，不是历史偶发超时的已确认根因。

## 正式对照仍待接入

五项都属于真实历史缺陷，校准通过也不是接收agent成绩或ctxpack收益。下一步需将各任务接入受限执行环境，重新核验当前宿主工具清单与候选执行边界，再冻结三组交接输入、相同预算和重复次数。已有单函数冒烟工具只支持任务1，不能假定它已经支持Java、跨方法改动或测试辅助函数。

四个新增任务的实际基线失败、完整参考修复验收及保留的环境失败见[校准报告](HISTORICAL-CALIBRATION-2026-10-03.md)。已修复目录不是未来采样材料。

正式评分按任务、条件分别报告成功数／总样本、协议违例、超时、依赖／环境失败、重复读取与阶段耗时。维护者审核等待单列；失败留在分母。产品任务与测试维护任务分层，不用一个总均值掩盖不同类型。全部任务和条件冻结后才能采样，不能看到落后组再改题或放宽验收。
