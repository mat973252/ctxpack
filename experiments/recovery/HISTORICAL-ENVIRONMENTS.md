# 历史任务执行环境检查

2026-10-03，Docker Desktop Linux/amd64。四个新增任务均已在独立新容器中复现冻结基线的指定失败，源码和只读依赖前后未变，清理已确认。它们是**已知基线的环境检查**，不是接收模型修复、三组交接对照或通用恶意代码隔离证明。任务1原有编码冒烟仍单列。

| 任务 | 完整基线文件数 | 实际目标测试 | 构建输出 |
| --- | --- | --- | --- |
| ctx-fences | 52 | 四个围栏断言全部按预期失败，无跳过／未处理错误 | 无源码树新增文件 |
| lens-wal | 110 | WAL快照1失败，其他13通过，无跳过／未处理错误 | 无源码树新增文件 |
| relay-clock | 178 | 两个时钟断言按预期失败，零取消／跳过／todo | 291个文件，仅在各包dist内 |
| permit-proxy | 224 | 四项中1断言失败、1注册错误、2通过，无跳过 | 129个文件，仅在模块target内 |

记录的所有基线文件SHA256、镜像ID、权限、依赖摘要、实际版本和结构化结果见 [冻结清单](historical-environments-2026-10-03.json)。源码清单完整；依赖记录遍历全部文件和symlink的摘要及数量，不声称审计过每个第三方依赖。

## 构建与复现

在组织者机器安装Node、Git、tar、Docker后运行；解析Java的JUnit报告还需要主机Python3。基线仓库必须包含冻结历史。以下生成器不启动模型，也不运行Docker：

```text
node experiments/recovery/prepare-historical-image.mjs --id ctx-fences --repository <ctxpack-repository>
```

可选id为 `ctx-fences`、`lens-wal`、`relay-clock`、`permit-proxy`，repository分别指向对应原仓。生成器新建原始材料，再以 `core.autocrlf=false` 导出单提交基线到独立构建上下文，保证POSIX Wrapper为LF。控制端manifest位于context之外，参考信息不得进入模型材料。

使用输出的context和manifest；Node镜像的PNPM_VERSION为ctxpack/AgentLens `10.17.1`、Relay `10.33.0`，Java构建省略该参数：

```text
docker build --file <context>/Containerfile --build-arg PNPM_VERSION=10.17.1 --tag <local-tag> <context>
docker image inspect <local-tag> --format "{{.Id}}"
node experiments/recovery/probe-historical-environment.mjs --material <manifest> --image sha256:<exact-id>
```

准备阶段可从公开registry下载依赖。运行探针时无网络、无主机目录／Docker socket／凭据挂载，不能让正式模型调用安装命令。新建workspace和依赖named volume，UID1000、只读rootfs、cap-drop ALL、no-new-privileges、2CPU/1GiB/128进程；`/tmp`为有界noexec/nosuid tmpfs。实际写入根目录和每个依赖入口均返回EROFS，外部连接返回ENETUNREACH，进程capabilities为零。

Node固定基础镜像实测22.23.3；与上一轮Windows24.19.0校准分开记录。Relay除根node_modules外，七个包的node_modules（含.bin）分别只读挂载，保留相对symlink位置；源码扫描只跳过这些精确依赖目录。ctxpack/AgentLens仅开放两个私有Vite临时缓存。Relay的tsbuildinfo在各包dist内，不写包根；生成路径只作分类，并不证明其语义正确。

Java固定基础镜像实测Java21.0.9/Maven3.9.11。Wrapper的分发目录指向镜像内同版本Maven，实际通过Wrapper运行；依赖在新镜像中用空settings下载，没有复制用户.m2或凭据。预热 `clean verify` 时仅排除已知红的代理测试类以准备其余依赖，这不算验收。最终镜像重新复制干净基线，不带预热生成的target或测试结果；运行时Maven分发和仓库均位于只读rootfs。实际离线clean/test执行了冻结代理四例。

镜像digest固定基础内容，最终image ID绑定本次构建；apt和传递依赖准备步骤不承诺未来按字节重现同一镜像。主机路径、完整原始stdout/XML保存在工作台本地证据目录，不直接公开。

## 失败与判定修正

- 首轮Java镜像只预热verify，离线clean/test缺maven-clean-plugin3.2.0，未执行目标测试，因此明确失败；改为clean verify后独立新容器通过。`/tmp`的noexec使Jansi原生库加载有警告，Maven回退后仍运行；未为消除警告放开执行权限。
- 独立审查指出Vitest仅按数量和泛化错误文本匹配会误通过。三个反例先失败：换成同消息的其他用例、把其余通过项改成skip、summary伪称通过而断言pending。现在核对完整失败名称、通过数、全部断言状态和零pending/todo；四项规则检查通过，实际Node探针使用新规则重新运行通过。
- Java重建命令首次相对Containerfile路径错误，构建未开始；改为明确绝对文件路径。旧失败日志保留。
- 故意改错Relay基线README哈希，探针在测试前拒绝，包含七个包级依赖卷在内的资源仍全部清理。原单任务默认配置另在旧镜像核对52文件并成功清理；没有再次调用编码模型。

独立只读审查只覆盖指定脚本与Dockerfile，不冒充Docker实测。最终四个探针的源码／规则哈希由主线程重新比对，实验标签查询无残留容器或volume；镜像保留供后续使用。

## 新宿主与下一门槛

客户端0.160.0的合成读取探针重新通过：实际gpt-6.1-sol/medium，完整MCP清单禁用，无其他工具事件，材料外读取被拒绝且隐藏标记未出现。临时线程archive仍失败，但宿主已实际退出，cleanup=true。这个有界读取检查不能外推为新编码工具的权限验收。

本轮没有在新四镜像执行参考补丁后的完整检查，也没有模型编码调用。下一步为五题接入限定修改和测试入口，在执行每版候选前亲读并审核副作用，完成后封闭工具并在新容器独立复验；再冻结三组交接输入、相同预算及重复次数。工作区可写不代表可以改测试或依赖；当前权限检查不能替代候选源码审查。
