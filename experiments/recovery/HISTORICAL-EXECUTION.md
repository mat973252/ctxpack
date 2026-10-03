# 五题受限编码入口

2026-10-03，执行协议5。复用已冻结的五个历史任务、镜像和受限宿主；新增可选 `--condition manual|native|ctxpack`。单次条件冒烟仍标记 `formalSample=false`，重复采样方案尚未冻结，不能把普通编码或机制探针计入正式对照。旧协议2/3/4结果及哈希原样保留。协议5补入准备回合仅回复READY的强校验，以及所有回合生命周期/通知顺序的最终复查；同回合结束后迟到item和重复开始/结束通知也不能通过。

协议3首次native编码曾请求前一个机制探针的随机文件名，被白名单拒绝并判失败。排查确认agentmemory的`empty-host`项目注入上下文含该标记；禁用MCP并不禁用会话启动注入。协议4仅在实验子进程关闭原生记忆使用/生成、agentmemory插件及注入，使用已安装插件支持的SDK子进程隔离开关，并从实际`config/read`核对关闭状态；不修改全局配置或删除已有记忆。MCP清单根据相同子进程配置重新枚举后严格核对。历史普通编码的测试通过仍是真实工程结果，但未核验额外记忆注入，不能当作纯交接输入下的隔离样本；正式比较仍为0。

三组输入准备已抽取为 `handoff-inputs.mjs`：同一份冻结事实生成手写结构笔记、native准备文本与真实本地CLI的Codex handoff；共同恢复提示只包含修改范围、预算、验收要求与文件索引，不重新注入历史事实。这里的manual是维护者固定模板，不是独立人类受试者撰写。五题真实渲染检查保留全部事实、输入和CLI哈希，并核对pack未被修改。临时pack在任何Git仓库外，避免读取原仓材料。

普通编码入口默认复用manual文本。指定条件后，输入渲染、宿主初始化、native准备回合和压缩共用120秒准备截止；容器材料准备在此前单列。native在同一线程发送事实，只答READY，然后请求 `thread/compact/start` 并等待同线程 `contextCompaction` 完成事件。manual/ctxpack各用新线程，直接在恢复提示中附对应输入。准备期不能调用工具；事件到达时绑定阶段/epoch，出队时再次核对线程/回合与开放状态，旧回合完成通知不能关闭新回合。开始响应前到达的请求等待当前回合绑定，不借用旧回合身份。

恢复阶段另有480秒共同截止。压缩RPC本身不提供操作ID，入口要求本次请求后唯一的新回合、同一item的started/completed配对及该回合completed状态；旧回合或其他item均不通过，不能只凭同线程出现压缩完成通知。最终实际退出并排空流后核验所有阶段，包含关闭期间的违例；native机制探针只使用随机合成材料，不执行候选代码，不证明任务收益。可运行 `node experiments/recovery/run-native-probe.mjs --codex <已验证CLI>` 验证当前宿主真实准备/压缩/恢复及工具限制。输入准备证据自身仍为 `nativeCompacted=false`，只有观察到实际压缩完成后该次运行才写true。

## 材料与工具

`historical-case.mjs`从既有清单加载准确image ID、完整文件哈希及已验证的依赖挂载。参与模型只见任务事实和材料路径，不见原仓、历史/参考提交、控制端记录或参考代码。每次使用新workspace和依赖volume，断网、非root、只读依赖/根文件系统；必要缓存继续使用受限tmpfs。Relay测试命令显式添加其CI要求的容器内Pi CLI路径；不使用本机Pi登录或凭据。

三个动态工具：清单内`read_file`、`apply_edit`、固定`run_tests`（regression/check）。每个样本24读、4改、4测、480秒共同截止；被拒绝请求也计数并记违例。所有修改重新从冻结原文生成完整候选，不累计上次补丁。必须先读目标源码及回归测试。每条测试命令启动前再次核验材料和截止时间，避免审批等待掩盖源码变化；这仍不能保证任意恶意代码执行期间没有竞态，源码审阅不可省略。Relay的Pi会话使用容器`HOME=/tmp`，不开放原用户目录。

| 任务 | apply_edit字段与范围 |
| --- | --- |
| markdown-text / ctx-fences / relay-clock | `body`：分别为stripTemplate、parseList、until的内部正文，不含外层花括号；最多8000字符。控制器插入前后换行，签名及其他字节冻结 |
| lens-wal | `body`：getRun内部原始文本，包含必要换行/缩进；`helpers`：紧接方法后新增的最多4个必要private实例方法，包含前置换行/缩进。各字段最多16000字符；不能遮蔽已有成员、插入字段/装饰器/构造器/静态成员或改签名 |
| permit-proxy | `fromAnnotated`、`create`：两方法内部正文，各最多16000字符；`imports`：最多4个新增普通导入的完整限定名，不支持static/通配符。原导入、签名、其余成员全部冻结 |

TypeScript使用编译器AST重新解析候选，核对真实函数/类成员边界。Java控制端需要JDK21：可信`JavaEditScope.java`通过内存源文件仅调用`JavacTask.parse()`与SourcePositions，不调用analyze/generate/call、不运行候选类或注解处理。Java Unicode escape序列在本协议中拒绝，避免词法前转换与原文范围混淆。解析器不能替代代码执行前审阅。

## 审阅与复验

模型每版候选执行前，控制器输出`pending-review.json`和`pending-candidate.txt`。主指导亲读完整候选与修改范围，只检查副作用/协议边界，不提供修复算法提示。认可后在模型不可见的控制目录写入`review-<sha256>.approved`，内容必须是同一候选SHA。等待时间单列，仍计入共同截止；没有审阅文件不运行该候选测试。

模型完成后封闭工具入口、等待队列并关闭宿主，再冻结候选。`verify-historical-candidate.mjs`用全新容器重放同一编辑，要求审核SHA一致，运行完整检查和结构化报告。逐个核对原文件哈希、准确生成目录、完整测试数、通过/失败/跳过状态和指定回归文件/类的准确用例身份。Relay的两个时钟用例仍是测试维护，不是产品恢复能力。Java full verify使用空settings、独立只读公开依赖缓存和offline Wrapper；不安装到本机公共消费者缓存。

宿主关闭须确认实际退出和stdio关闭，排空最后工具队列，再检查完整工具事件与其他RPC记录；关闭期间到达的违规不能漏过验收。只有实际成功且清理完成才输出`verified_pending_source_review`，最后仍须主代理亲读最终差异。此结果不代表任意恶意代码安全、外部采用或交接收益。容器权限不能替代源码审阅，函数范围正确也不保证方法内部无副作用。

```text
node experiments/recovery/run-real-smoke.mjs --id permit-proxy --codex <已验证的桌面CLI>
node experiments/recovery/run-real-smoke.mjs --id ctx-fences --condition native --codex <已验证的桌面CLI>
node experiments/recovery/verify-historical-candidate.mjs --id permit-proxy --edit <控制端编辑JSON> --approved-sha256 <已亲读候选SHA>
node --test experiments/recovery/historical-edits.check.mjs experiments/recovery/historical-case.check.mjs experiments/recovery/smoke-body.check.mjs
node --test experiments/recovery/host-phases.check.mjs experiments/recovery/handoff-inputs.check.mjs experiments/recovery/access-policy.check.mjs
```

控制端还需Python解析Surefire XML。正式运行前先完成五题参考重放校准，保留失败、环境修复和每版执行器哈希。参考重放是维护者已知答案的校准，不是模型成绩；已有协议1冒烟数据不得覆盖或改称协议2结果。
