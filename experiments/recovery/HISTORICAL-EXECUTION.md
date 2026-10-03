# 五题受限编码入口

2026-10-03，执行协议2。复用已冻结的五个历史任务、镜像和受限宿主；此入口尚不提供人工/native/ctxpack三种交接条件，普通编码冒烟不计入正式对照。

三组输入准备已抽取为 `handoff-inputs.mjs`：同一份冻结事实生成手写结构笔记、native准备文本与真实本地CLI的Codex handoff；共同恢复提示只包含修改范围、预算、验收要求与文件索引，不重新注入历史事实。这里的manual是维护者固定模板，不是独立人类受试者撰写。五题真实渲染检查保留全部事实、输入和CLI哈希，并核对pack未被修改。临时pack在任何Git仓库外，避免读取原仓材料。

当前普通编码入口复用manual文本，但仍没有native阶段隔离和真实压缩完成门禁。`nativeCompacted=false`、正式样本仍为0；不能将输入准备检查计为模型交接结果。下一步须接入同线程准备/压缩/恢复，冻结120秒准备共同截止，工具只在恢复阶段开放，并在实际进程退出后检查迟到事件，再采样。

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
node experiments/recovery/verify-historical-candidate.mjs --id permit-proxy --edit <控制端编辑JSON> --approved-sha256 <已亲读候选SHA>
node --test experiments/recovery/historical-edits.check.mjs experiments/recovery/historical-case.check.mjs experiments/recovery/smoke-body.check.mjs
```

控制端还需Python解析Surefire XML。正式运行前先完成五题参考重放校准，保留失败、环境修复和每版执行器哈希。参考重放是维护者已知答案的校准，不是模型成绩；已有协议1冒烟数据不得覆盖或改称协议2结果。
