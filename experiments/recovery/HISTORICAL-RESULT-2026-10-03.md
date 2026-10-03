# 固定历史恢复任务对照：完整批次结果（2026-10-03）

执行源码基线：`752f68c11299be7af34b913d8151fc85f2e4ff98`。协议见[固定采样协议](SAMPLING-PROTOCOL.md)，结构化观测见[结果 JSON](HISTORICAL-RESULT-2026-10-03.json)。本文件记录已完成的历史编码批次，与本目录更早的合成只读实验、pilot分开计数。

原始模型/命令输出、候选全文和逐槽审阅记录保存在维护者本地控制目录，尚未作为公开证据包提供；本报告与JSON可用于复算所列统计，不能单独替代原始验收证据。没有独立人类参与者。

状态：**45槽均已取得终态；结论限制仍适用。**

冻结计划 SHA256：`3945cdb73da31df26bf060bd0bbeb2cad80697a47a367b7cf44a5febe021d043`。

本报告由逐槽原始证据和主指导审阅记录生成；重新运行会先核验计划、归档源码、材料、模型、隔离、清理和通过样本的测试报告。

## 结论边界

- 这是5个固定历史任务、3种交接条件、每组3次的观察；不是独立用户采用或普遍工程效率测试。
- 共享阶段说明存在歧义：准备阶段要求READY，恢复阶段要求修复。native经历真实准备/压缩，其他条件直接恢复。阶段误解是可能解释，尚未证明。
- protocolEligible仅表示记录符合核验条件，不能证明阶段提示公平。所有失败保留，不重跑，不据此归因交接格式优劣。
- 首次读取是恢复提示后成功读完指定文件的时间，不代表理解正确。null不填0；中位数标明观测数n及缺失数。
- 恢复耗时含人工审核等待，失败的短耗时不代表任务完成更快；准备、审核等待分别展示。独立复验耗时不包含在恢复耗时内。
- 重复读取可能是合理复核；候选测试失败可能是有效反馈；宿主violations按原数组条数统计，不等同于恶意意图或某类违规归因。不同任务不合并成一个效率排名。

## 45槽状态

| 状态 | 数量 |
| --- | ---: |
| accepted | 37 |
| failed | 8 |

## 每任务与条件的分母

| 任务 | 条件 | 计划 | 已尝试 | 终态 | protocolEligible | 通过 | 失败 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| markdown-text | manual | 3 | 3 | 3 | 3 | 3 | 0 |
| markdown-text | native | 3 | 3 | 3 | 3 | 3 | 0 |
| markdown-text | ctxpack | 3 | 3 | 3 | 3 | 2 | 1 |
| ctx-fences | manual | 3 | 3 | 3 | 3 | 3 | 0 |
| ctx-fences | native | 3 | 3 | 3 | 3 | 3 | 0 |
| ctx-fences | ctxpack | 3 | 3 | 3 | 3 | 2 | 1 |
| lens-wal | manual | 3 | 3 | 3 | 3 | 3 | 0 |
| lens-wal | native | 3 | 3 | 3 | 3 | 3 | 0 |
| lens-wal | ctxpack | 3 | 3 | 3 | 3 | 1 | 2 |
| relay-clock | manual | 3 | 3 | 3 | 3 | 3 | 0 |
| relay-clock | native | 3 | 3 | 3 | 3 | 3 | 0 |
| relay-clock | ctxpack | 3 | 3 | 3 | 3 | 1 | 2 |
| permit-proxy | manual | 3 | 3 | 3 | 3 | 3 | 0 |
| permit-proxy | native | 3 | 3 | 3 | 3 | 3 | 0 |
| permit-proxy | ctxpack | 3 | 3 | 3 | 3 | 1 | 2 |

## 时间中位数（秒）

| 任务 | 条件 | 首次读取 | 准备 | 恢复 | 审核等待 |
| --- | --- | --- | --- | --- | --- |
| markdown-text | manual | 10.275 (n=3, 缺=0) | 2.692 (n=3, 缺=0) | 93.001 (n=3, 缺=0) | 35.204 (n=3, 缺=0) |
| markdown-text | native | 4.305 (n=3, 缺=0) | 26.082 (n=3, 缺=0) | 85.853 (n=3, 缺=0) | 31.437 (n=3, 缺=0) |
| markdown-text | ctxpack | 9.949 (n=2, 缺=1) | 2.694 (n=3, 缺=0) | 79.554 (n=3, 缺=0) | 19.055 (n=3, 缺=0) |
| ctx-fences | manual | 10.790 (n=3, 缺=0) | 2.853 (n=3, 缺=0) | 79.042 (n=3, 缺=0) | 29.041 (n=3, 缺=0) |
| ctx-fences | native | 3.816 (n=3, 缺=0) | 21.961 (n=3, 缺=0) | 108.547 (n=3, 缺=0) | 54.701 (n=3, 缺=0) |
| ctx-fences | ctxpack | 9.668 (n=2, 缺=1) | 2.710 (n=3, 缺=0) | 85.835 (n=3, 缺=0) | 26.289 (n=3, 缺=0) |
| lens-wal | manual | 8.904 (n=3, 缺=0) | 2.718 (n=3, 缺=0) | 67.148 (n=3, 缺=0) | 13.936 (n=3, 缺=0) |
| lens-wal | native | 3.958 (n=3, 缺=0) | 21.714 (n=3, 缺=0) | 73.435 (n=3, 缺=0) | 30.523 (n=3, 缺=0) |
| lens-wal | ctxpack | 11.563 (n=1, 缺=2) | 2.799 (n=3, 缺=0) | 9.222 (n=3, 缺=0) | 0.000 (n=3, 缺=0) |
| relay-clock | manual | 10.110 (n=3, 缺=0) | 2.713 (n=3, 缺=0) | 240.193 (n=3, 缺=0) | 11.780 (n=3, 缺=0) |
| relay-clock | native | 4.731 (n=3, 缺=0) | 21.502 (n=3, 缺=0) | 236.259 (n=3, 缺=0) | 11.859 (n=3, 缺=0) |
| relay-clock | ctxpack | 8.901 (n=1, 缺=2) | 2.872 (n=3, 缺=0) | 8.758 (n=3, 缺=0) | 0.000 (n=3, 缺=0) |
| permit-proxy | manual | 8.993 (n=3, 缺=0) | 2.675 (n=3, 缺=0) | 72.969 (n=3, 缺=0) | 16.959 (n=3, 缺=0) |
| permit-proxy | native | 4.596 (n=3, 缺=0) | 23.969 (n=3, 缺=0) | 73.873 (n=3, 缺=0) | 21.413 (n=3, 缺=0) |
| permit-proxy | ctxpack | 9.148 (n=1, 缺=2) | 2.628 (n=3, 缺=0) | 9.472 (n=3, 缺=0) | 0.000 (n=3, 缺=0) |

## 调用与失败中位数（次）

| 任务 | 条件 | 工具调用 | 重复读取 | 测试非零退出 | 宿主violations条数 |
| --- | --- | --- | --- | --- | --- |
| markdown-text | manual | 10 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| markdown-text | native | 10 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| markdown-text | ctxpack | 10 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| ctx-fences | manual | 8 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| ctx-fences | native | 9 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| ctx-fences | ctxpack | 9 (n=3, 缺=0) | 0 (n=3, 缺=0) | 1 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| lens-wal | manual | 5 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| lens-wal | native | 5 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| lens-wal | ctxpack | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| relay-clock | manual | 4 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| relay-clock | native | 4 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| relay-clock | ctxpack | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| permit-proxy | manual | 7 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| permit-proxy | native | 7 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |
| permit-proxy | ctxpack | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) | 0 (n=3, 缺=0) |

## 全部槽位与证据

| 槽位 | 状态 | 首次读取秒 | 最终审阅/失败核对 |
| --- | --- | ---: | --- |
| 01-markdown-text-manual-r1 | accepted | 8.153 | 已核对，原始记录未公开 |
| 02-markdown-text-native-r1 | accepted | 4.743 | 已核对，原始记录未公开 |
| 03-markdown-text-ctxpack-r1 | failed | null | 已核对，原始记录未公开 |
| 04-ctx-fences-native-r1 | accepted | 3.816 | 已核对，原始记录未公开 |
| 05-ctx-fences-ctxpack-r1 | accepted | 9.935 | 已核对，原始记录未公开 |
| 06-ctx-fences-manual-r1 | accepted | 10.790 | 已核对，原始记录未公开 |
| 07-lens-wal-ctxpack-r1 | accepted | 11.563 | 已核对，原始记录未公开 |
| 08-lens-wal-manual-r1 | accepted | 6.686 | 已核对，原始记录未公开 |
| 09-lens-wal-native-r1 | accepted | 3.958 | 已核对，原始记录未公开 |
| 10-relay-clock-manual-r1 | accepted | 7.639 | 已核对，原始记录未公开 |
| 11-relay-clock-native-r1 | accepted | 4.082 | 已核对，原始记录未公开 |
| 12-relay-clock-ctxpack-r1 | failed | null | 已核对，原始记录未公开 |
| 13-permit-proxy-native-r1 | accepted | 5.108 | 已核对，原始记录未公开 |
| 14-permit-proxy-ctxpack-r1 | failed | null | 已核对，原始记录未公开 |
| 15-permit-proxy-manual-r1 | accepted | 11.096 | 已核对，原始记录未公开 |
| 16-markdown-text-native-r2 | accepted | 4.305 | 已核对，原始记录未公开 |
| 17-markdown-text-ctxpack-r2 | accepted | 9.274 | 已核对，原始记录未公开 |
| 18-markdown-text-manual-r2 | accepted | 10.276 | 已核对，原始记录未公开 |
| 19-ctx-fences-ctxpack-r2 | accepted | 9.401 | 已核对，原始记录未公开 |
| 20-ctx-fences-manual-r2 | accepted | 9.893 | 已核对，原始记录未公开 |
| 21-ctx-fences-native-r2 | accepted | 3.812 | 已核对，原始记录未公开 |
| 22-lens-wal-manual-r2 | accepted | 8.904 | 已核对，原始记录未公开 |
| 23-lens-wal-native-r2 | accepted | 3.776 | 已核对，原始记录未公开 |
| 24-lens-wal-ctxpack-r2 | failed | null | 已核对，原始记录未公开 |
| 25-relay-clock-native-r2 | accepted | 4.731 | 已核对，原始记录未公开 |
| 26-relay-clock-ctxpack-r2 | failed | null | 已核对，原始记录未公开 |
| 27-relay-clock-manual-r2 | accepted | 10.110 | 已核对，原始记录未公开 |
| 28-permit-proxy-ctxpack-r2 | failed | null | 已核对，原始记录未公开 |
| 29-permit-proxy-manual-r2 | accepted | 8.104 | 已核对，原始记录未公开 |
| 30-permit-proxy-native-r2 | accepted | 4.596 | 已核对，原始记录未公开 |
| 31-markdown-text-ctxpack-r3 | accepted | 10.624 | 已核对，原始记录未公开 |
| 32-markdown-text-manual-r3 | accepted | 10.275 | 已核对，原始记录未公开 |
| 33-markdown-text-native-r3 | accepted | 3.954 | 已核对，原始记录未公开 |
| 34-ctx-fences-manual-r3 | accepted | 11.528 | 已核对，原始记录未公开 |
| 35-ctx-fences-native-r3 | accepted | 4.258 | 已核对，原始记录未公开 |
| 36-ctx-fences-ctxpack-r3 | failed | null | 已核对，原始记录未公开 |
| 37-lens-wal-native-r3 | accepted | 5.872 | 已核对，原始记录未公开 |
| 38-lens-wal-ctxpack-r3 | failed | null | 已核对，原始记录未公开 |
| 39-lens-wal-manual-r3 | accepted | 9.069 | 已核对，原始记录未公开 |
| 40-relay-clock-ctxpack-r3 | accepted | 8.901 | 已核对，原始记录未公开 |
| 41-relay-clock-manual-r3 | accepted | 12.120 | 已核对，原始记录未公开 |
| 42-relay-clock-native-r3 | accepted | 6.549 | 已核对，原始记录未公开 |
| 43-permit-proxy-manual-r3 | accepted | 8.993 | 已核对，原始记录未公开 |
| 44-permit-proxy-native-r3 | accepted | 4.578 | 已核对，原始记录未公开 |
| 45-permit-proxy-ctxpack-r3 | accepted | 9.148 | 已核对，原始记录未公开 |

已终态槽中，编辑前测试调用：0次；其中非零退出：0次。0次调用表示未测，不能称基线通过。

维护者原始记录包含逐槽evidence.json、calls.json、归档源码及failure-review.json；本次没有公开这些文件，不把统计JSON冒充完整证据包。

阶段提示修改只能进入另行预注册的诊断，不能覆盖本批失败。独立开发者采用与重复使用仍须另取真实证据。

## 完整批次的观察与决定

| 条件 | 预登记尝试 | 通过 | 失败 |
| --- | ---: | ---: | ---: |
| manual | 15 | 15 | 0 |
| native | 15 | 15 | 0 |
| ctxpack | 15 | 7 | 8 |

这些数量是本批固定槽位的描述，不是独立总体成功率估计。失败原因不能仅按条件归因；共同阶段说明、历史压缩和模型行为的影响尚未分离。

本批未证明ctxpack稳定优于简单笔记，因此不据此扩第二宿主或云同步。后续阶段识别诊断必须另行预注册；不直接启动另一轮45次编码来寻找更好结果。

独立只读复核：45槽终态及失败记录、675份归档源码SHA、计划/输入hash和15组×8项统计均一致；42—45槽另核对原始测试报告。发现控制端主核验脚本未深入核对失败审阅记录后，已补齐并验证篡改槽号或模型记录会被拒绝，原始数据未改。旧槽全部测试报告与候选源码并未在这次独立复核中再次逐份重审。
