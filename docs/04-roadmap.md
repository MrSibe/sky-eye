# SkyEye 开发路线图

状态标记：`[x]` 已完成，`[~]` 已有基础实现但尚未达到科学验收，`[ ]` 未完成。

## M0：可信核心与工程基线

- [x] Tauri v2 + React 19 + TypeScript 项目可构建。
- [x] CFITSIO 多 HDU/压缩读取、Header 诊断、WebGL2 shader 显示，以及 Rust/CPU/GPU 独立按字节 LRU。
- [x] 建立 Git 基线与 MVP、架构、技术决策文档。
- [x] 建立 `AstroTime`、`ImageFrame`、`Measurement` 核心类型。
- [x] SEP Windows/MSVC 编译门禁。
- [x] SEP 背景、检测、deblend 参数、形状和 flags 安全封装。
- [x] SEP 亚像素孔径 + sigma-clipped 天光环测光接口。
- [x] TAN/CD 像素与天空坐标双向转换及往返测试。
- [x] 移除伪造成功的 Plate Solve 占位结果。
- [~] CFITSIO 已为唯一默认读取器并通过 Windows 源码构建；`.fits.fz` 与厂商 fixtures 仍需扩充。
- [x] 大像素数组已从 JSON IPC 改为 Tauri raw `ArrayBuffer`；流式 tiles 后续按需要实现。

## M1：Data Reduction MVP

- [~] VizieR TAP/ADQL/JSON Gaia 客户端、内存缓存和超时/取消已完成；磁盘缓存待实现。
- [x] Gaia DR3 cone search 与 proper motion 线性历元传播。
- [~] Header 中心、`CD/CDELT/PIXSCALE`、焦距/像元估计、归算参数面板和 Gaia 圆圈人工校准已接入；持久化设备配置待实现。
- [x] 图像源质量筛选和 Gaia 切平面投影。
- [x] 基于尺度先验的星对 Hough 投票、三角形回退、全场一致性评分和 TAN/CD 最小二乘拟合。
- [x] 迭代异常星剔除、RMS 和逐星残差目录。
- [x] 整组批量归算、逐帧独立 WCS、上一成功帧 tracking hint 和逐帧失败隔离。
- [~] 每帧已独立保存源目录、Gaia 星表和求解结果；完整 provenance 待实现。
- [ ] 残差覆盖层、参考星删除与重新拟合界面。

验收：真实测试图匹配数达到约定下限，RMS 目标 `< 1 arcsec`，WCS 往返 `< 0.05 px`，失败必须给出明确原因。

## M2：测量、测光与 Blink

- [x] Gaussian-window 迭代质心与 SEP 亚像素孔径测光。
- [ ] 二维椭圆高斯 PSF 拟合。
- [ ] 输出 centroid/PSF 不确定度、FWHM、长短轴、方向和 flags。
- [x] ATLAS REFCAT2 查询、颜色项和零点稳健拟合。
- [~] WCS 对齐 Blink 已在 GPU/Canvas 显示路径实现；真实四帧 corpus 的残差验收仍待完成。
- [x] Blink 播放、速度、帧导航、标准 ZScale、Linear/Asinh 和整组拉伸锁定。
- [ ] 测量表、质量控制、接受/拒绝和跨帧目标关联。

验收：合成 Gaussian flux 误差 `< 1%`；真实标准场给出零点残差和异常星；对齐后恒星残差 `< 1 px`。

## M3：报告与已知天体

- [x] MPCORB 下载、本地 `.gz` 导入、版本清单和本地缓存。
- [~] ERFA 本地二体传播、JPL second-pass 复核、5 秒超时/离线模式和会话缓存已完成；保守空间索引仍待真实 155 万条基准决定是否启用。
- [x] 已知天体覆盖和测量交叉匹配。
- [~] ADES 2022 PSV 数据模型和生成器已完成；固定 PSV 已接入固定版本官方 `iau-ades` PSV→XML/schema 门禁，更多提交规则 fixtures 待扩充。
- [ ] 观测站、设备、滤镜和星表配置。
- [ ] 工程 SQLite、恢复、审计记录和导出包。

验收：ADES 通过官方校验；报告中的时刻、坐标、星等、星表和站点可追溯到具体输入与处理参数。

## M4：自动发现与暗弱目标

- [ ] 多帧固定恒星过滤、匀速 tracklet 链接和候选评分。
- [ ] Blink 人工复核队列。
- [ ] Dark/Flat 标定和坏点/宇宙线处理。
- [ ] 普通配准叠加。
- [ ] 给定速度的 Track & Stack。
- [ ] 速度网格 synthetic tracking；CPU 基准不足时再评估 `wgpu`。

## 当前下一个切片

1. 扩充已提交的 Pan-STARRS XY54.p10 四帧裁剪 corpus，加入离线 Gaia/REFCAT2 对照目录和 WCS/测光 golden 值。
2. 在真实四帧 corpus 上验收 WCS Blink 恒星残差、20 帧内存边界和 155 万条 MPCORB 性能。
3. 实现残差覆盖层、参考星手工删除和重新拟合。
4. 增加 VizieR 磁盘缓存、设备配置持久化与完整归算 provenance。
