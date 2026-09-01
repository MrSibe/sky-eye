# 性能基准

## 已知天体传播（2026-09-01）

数据：本地 MPCORB 1,556,456 条记录，四个相邻观测时刻；Windows x64，debug profile。命令由 `src-tauri/examples/bench_known_objects.rs` 固化，可在相同数据上复跑。

| 场景                                           |      结果 |
| ---------------------------------------------- | --------: |
| 冷加载二进制 MPCORB 索引                       |  8,424 ms |
| 10,000 条 × 4 帧，旧版每轨道重复 ERFA state    | 13,193 ms |
| 10,000 条 × 4 帧，共享 `PropagationContext`    |    238 ms |
| 相对提速                                       |    55.28× |
| 1,556,456 条 × 4 帧，共享 `PropagationContext` | 42,575 ms |

prepared-state 已超过本切片约定的 5× 相对门槛，因此暂不启用可能产生漏检的空间预筛索引。完整 exhaustive 路径仍然偏慢；后续若继续优化，必须先用 MBA、快速 NEO、彗星替代数据、RA=0 和高纬视场证明 candidate set 完全一致。

这些数字是本机 debug 构建的工程比较，不是发布版本性能承诺。
