# 完整基线执行环境检查

2026-10-03，Windows Docker Desktop 4.92.0 / Linux Engine 29.8.0。结果为 `bounded_container_probe_passed`；[允许字段证据](container-probe-2026-10-03.json)记录镜像、脚本哈希、运行配置、版本和实际测试名称。它验证本次执行环境，不是模型恢复成绩或通用容器安全证明。

## 复现

在仓库根目录、Docker Linux 引擎已经可用时执行。首次构建需要下载基础镜像和依赖；模型/测试运行阶段断网。

```powershell
$material = node experiments/recovery/materialize-real-case.mjs | ConvertFrom-Json
$context = Split-Path $material.workspace -Parent
@('**','!workspace/','!workspace/**','workspace/.git','workspace/node_modules','workspace/dist','workspace/.ctxpack','workspace/experiments') |
  Set-Content -LiteralPath (Join-Path $context .dockerignore) -Encoding utf8
docker build --file experiments/recovery/Containerfile --tag ctxpack-recovery:baseline-6e0c895 $context
node --test experiments/recovery/container-report.check.mjs
node experiments/recovery/probe-container-isolation.mjs --image ctxpack-recovery:baseline-6e0c895
```

必须先确认每步退出成功。探针正常退出0，但内部八个历史回归测试应退出1，并且必须失败在指定的正文保留断言；这不表示产品测试全部通过。探针会保存原始命令日志到新临时目录，删除自己创建的容器和volume，保留镜像供后续使用；不运行全局prune。

本次冻结清单来自归档SHA256 `53c290013a3ff4e0dfeea4c7e7a4ac7f94ce5dc8eb48f06dd9b719546281fedf`，包含51个基线文件和1个冻结验收文件。Windows生成的归档正文含CRLF，因此完整清单按这份归档的实际字节校验；源文件另记录LF归一化哈希，与原Git blob一致。别的平台若生成不同字节的材料，应先核对换行和归档来源，不能删掉清单校验或覆盖旧证据让它通过。此构建流程还未跨主机验证。

## 观察值与检查范围

- 基础镜像按digest固定；本次成品镜像ID为 `sha256:8c3b08e1addc12193851b5cc89a56a91d892639dd9887e844595458e9bb7605e`。实际 Node22.23.3、pnpm10.17.1、Git2.39.5。系统包来自构建时仓库，镜像ID记录本次结果，不承诺未来逐字节重建。
- runtime为UID1000、network=none、只读rootfs、cap-drop=ALL、no-new-privileges、2 CPU、1GiB内存、128进程。只使用本次新建volume作为/workspace，以及受限/tmp tmpfs；没有主机目录或Docker socket挂载，不传入凭据环境变量。
- 实际根目录写入返回EROFS，workspace写入/删除成功，只有loopback接口，外部连接返回ENETUNREACH。配置和实际进程权限均检查，不仅保存启动参数。
- 运行前后完整52文件哈希一致；排除.git和node_modules，不排除其他源码或配置，也拒绝源码符号链接。Git重新初始化，仅有这份基线，不带主仓历史。依赖来自构建时锁文件安装，不链接主仓node_modules。
- Vitest JSON精确核对8个用例、失败状态及固定断言行34/54，拒绝18等数量、初始化/加载错误和错误断言位置。Vitest 3 JSON reporter不记录onFinished错误，另用固定reporter检查该错误数组为空。此检查不是仅匹配“8 failed”。
- 清理按预先生成的精确资源名及UUID标签核验归属，分别清理容器/volume，并查询确认不存在；创建命令没有成功返回也要查询。无法确认清理时总体结果不能是通过。

## 保留的失败和负向检查

首次镜像构建因/workspace归root而导致非root Git初始化失败，修正目录所有者后构建成功，没有改成root运行。首次探针把Git blob的LF字节哈希与CRLF材料直接比较而失败；复查原始归档证明只是换行差异，保留原始与归一化哈希，完整清单继续严格检查原始字节。

独立只读审查发现文本计数、只验证两文件、创建失败遗留资源以及清理失败仍标通过四项问题，修复后重测。第一次精确报告校验误写断言行36，实际冻结正文断言在34，修正后全部匹配；旧失败记录保留。

另做两次实际负向执行：hello-world镜像无法执行sleep，Docker已创建容器后返回错误；探针报告失败并查询/删除已创建资源。另一镜像只修改README并提交成干净Git状态，正文/验收文件不变，但完整清单在测试前拒绝。两次cleanupComplete=true，主线程额外查询实验标签没有残留容器或volume；负向镜像已删除。

## 下一步

模型可见的读取、函数修改和固定测试工具尚未接入此容器。下一阶段在同一受限宿主配置下提供这些工具，冻结工具/测试预算和评分，以新volume完成一次真实编码冒烟；主代理参考补丁不能进入接收者材料。只有完整任务执行闭环验证后，才扩展五任务与三组正式对照。此探针不升级旧45个合成样本的证据等级，也不是独立采用。
