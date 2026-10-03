# 历史任务判定器校准

2026-10-03，Windows，本轮四份完整新基线由 `materialize-historical-case.mjs` 生成。主代理亲读历史源码和测试后，只在临时副本应用已知参考修复；**没有新的模型编码样本、交接对照或独立采用结果**。加上既有Markdown任务，五个历史编码任务均有判定器证据；任务1的模型冒烟仍单列。

| 任务 | 基线实际失败 | 最小参考修复后 |
| --- | --- | --- |
| ctx-fences | 新增4例全部在entries/notes断言失败，无模板／空白／尾空格输入 | 只替换 `parseList`；完整check退出0，156测试通过，lint/build通过 |
| lens-wal | 冻结增量文件14例中13通过、WAL快照1失败；具体为running元数据与run.completed事件不一致 | 仅 `getRun` 包装与私有读取方法，10行新增；lint、266测试、build通过 |
| relay-clock | 两项时钟回归均失败：前跳提前超时；精确截止断言0次与2次不符 | 只替换 `until`；完整check退出0，206通过、2个平台条件skip；这是测试辅助代码修复 |
| permit-proxy | 4例中2通过；类代理注册报无注解工具，代理final方法未拒绝 | 只改 `GuardedToolMethods.java`，6行新增／1行删除；完整verify通过，43份Surefire报告216例、零失败／错误／skip，代理4例通过 |

Node明确使用24.19.0，ctxpack/AgentLens的pnpm10.17.1、Relay10.33.0；Permit报告Java21.0.9，Wrapper Maven3.9.11。此轮没有Node22、Linux或真实外部provider新验收，也没有启动真实Redis集成suite的证据。

四份workspace都只有一个新建基线Git提交、没有remote。参考修复后Git只显示允许文件改变；ctxpack与Relay同时记录允许函数以外字节的SHA256一致，其余测试文件SHA256不变。Relay的源码和测试共用文件，所以整文件hash改变，不能谎称测试文件hash不变；被保护的是函数外字节，包括所有断言。

## 保留的失败

- Relay首次离线安装缺 `@types/node@24.13.6` tarball；按原锁文件联网补齐后安装成功，未改锁文件。
- Permit首次完整离线verify缺 `junit-platform-launcher:6.0.3`；使用既有候选专用缓存补齐后，在线verify和随后离线verify均通过。没有向公共0.5.0消费者缓存安装候选，缓存准备失败不算产品回归或模型失败。
- 控制端参考修复脚本首次Windows ESM绝对路径导入失败，源码尚未被修改；改为合法file URL后执行。它是本地校准脚本错误，不是四题中的缺陷。

材料归档、测试、起始源码和参考修复哈希见相邻 `historical-material-calibration-2026-10-03.json`。原始日志以 `material-{ctx-fences,lens-wal,relay-clock,permit-proxy}-*` 保存于协调工作台的本地证据目录，不直接公开包含主机路径的日志。

独立gpt-6.1-sol/medium只读审查未发现指定材料生成器、ctxpack回归和任务说明的具体问题；确认Relay overlay恢复旧helper、第二个ctxpack任务不依赖正文修复。该审查没有重跑测试或检查容器隔离。主线程测试与静态审查分别记账。

## 下一门槛

当前材料生成器不提供模型执行隔离。各题需要独立依赖环境、受限读取／修改／测试入口和最终新环境重放；Java及跨方法任务不能直接使用现有任务1函数体工具。客户端已升级为0.160.0，普通读取成功不能代替重新检查受限采样工具清单。三组交接输入、统一预算和重复采样尚未冻结，不能把本轮校准当作ctxpack收益。
