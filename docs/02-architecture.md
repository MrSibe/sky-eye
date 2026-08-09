# SkyEye 架构设计

## 1. 架构目标

SkyEye 是面向小行星、彗星测量的桌面科学软件。架构围绕一条可审计流水线设计：

`FITS → Dark/Flat → 源提取 → Gaia near solve → WCS → 测量/测光 → ADES`

科学结果必须携带输入、配置、星表版本、后端版本、残差和质量标志；未完成或未验证的算法不能返回伪造的成功结果。

## 2. 运行时分层

```text
React 19 + TypeScript + WebGL2/Canvas
  ├─ 工作区、Blink、覆盖层、残差和测量交互
  └─ Zustand：界面状态和任务状态
                  │ Tauri command / Channel / raw payload
Rust scientific core
  ├─ fits          FITS 与 Header
  ├─ core          Frame、AstroTime、Measurement
  ├─ reduction     SEP 背景、检测、孔径测光
  ├─ astrometry    TAN WCS、匹配、拟合、残差
  ├─ catalog       VizieR、Gaia、ATLAS REFCAT2、缓存
  ├─ registration  星表或相位相关配准
  ├─ motion        tracklet 与候选评分
  ├─ stacking      普通叠加与 Track & Stack
  ├─ ephemeris     MPC 轨道数据和已知天体覆盖
  ├─ ades          PSV/XML 生成和校验
  └─ project       SQLite、配置、provenance
                  │
可选原生/外部后端
  ├─ CFITSIO：完整 FITS 与压缩支持
  └─ Find_Orb/Astrometry.net sidecar：显式配置后使用
```

前端只负责显示和交互，不实现科学算法。亮度、gamma、log/asinh 和反色在 shader 中完成；不能在每次拖动黑白点时让 Rust 重新生成 PNG。

显示范围默认采用 IRAF/Astropy 风格 ZScale：二维均匀采样、排序秩上的稳健直线拟合和迭代异常值剔除。默认传递函数为 Linear，暗弱结构可切换真正的 Asinh。Blink 图像组共享参考帧的 `z1/z2` 和传递函数，切帧不自动重算，且所有显示变换都不修改科学像素。

## 3. 核心边界

### 3.1 数据模型

- `ImageFrame`：`Array2<f32>`、观测开始时刻、曝光、标定状态。
- `AstroTime`：split Julian Date 和显式时间尺度；目标位置使用曝光中点。
- `WCS`：MVP 使用 TAN + CD，后续加入 SIP 畸变。
- `Measurement`：像素、天空坐标、flux、SNR、FWHM、星等和不确定度。
- `Provenance`：文件摘要、软件/后端版本、参数、星表版本和处理时间。

这些类型不能依赖 Tauri，使相同算法能够被桌面端、CLI 和测试复用。

### 3.2 Reduction 后端

`ReductionBackend` 是 Rust 安全接口。当前 `SepReducer` 集中封装 `sep-sys` 的 `unsafe`、指针检查和 C 对象释放，提供：

- 网格背景与全局 RMS；
- 阈值检测、deblend、质心、形状、flux 与 SEP flags；
- 亚像素圆孔径积分；
- 天光环 sigma-clipped median、净流量、误差和 SNR。

后续二维椭圆高斯 PSF 通过单独的 `PsfBackend` 实现，不能把检测 flux 当作最终科学测光。

### 3.3 Astrometry

Data Reduction 主路径是 near solve：

1. 从 Header、设备配置或用户输入取得中心、比例和旋转先验。
2. SEP 提取图像源；结合 FITS `SATURATE/SATLEVEL/MAXADU/DATAMAX` 与局部平顶检测标记饱和源，再过滤饱和、截断、高椭率、卫星线以及同一恒星的重复检测。
3. VizieR cone search 获取 Gaia DR3，并将 proper motion 推算到观测历元。
4. Gaia 目录先应用可配置的亮端（排除图像饱和星）和暗端（排除无法可靠检出的星）G 星等区间；图像源与目录源各自按亮度排序。自动匹配按 50、90、120 颗图像源逐档扩大候选集，再分别构造一级扩展 Delaunay 三角网，在边长比不变量空间中保留互为最近邻的三角形，生成比例、旋转、平移和镜像初始假设；Delaunay 主路径不把可能过时的旋转/镜像元数据当作硬门禁，星对 Hough 只作为带尺度先验的辅助候选。
5. 允许 4–6 个一致匹配作为初始假设，对其进行全场一对一重关联，并用 `nalgebra` 最小二乘和残差裁剪迭代精化 TAN/CD；最终解仍必须满足至少 8 星和 RMS 门限。畸变明确时才启用 SIP。自动匹配失败时进入人工参考星叠加，人工变换只作为 seed，不能直接成为科学 WCS。
6. 迭代剔除残差异常星，输出匹配数、RMS、分位数和残差目录。

当前代码已实现上述 hinted near solve 主路径：从常见 FITS Header 或归算面板读取中心、比例、旋转、镜像和 Gaia 星等区间先验，按真实 footprint 查询 Gaia，进行分档扩大的 Delaunay 对称三角匹配、星对投票辅助候选、全场关联、仿射精化、残差裁剪和 TAN/CD 输出。自动失败后可进入 Gaia 人工叠加模式，通过拖动或像素级方向键调整平移，并微调比例、旋转、镜像和星等区间建立粗 WCS，再由 Rust 使用同一星等区间自动关联和精化。合成旋转/镜像星场、错误源、星等区间及人工 seed 偏移测试已通过；真实仪器数据仍需继续建立 golden data 和参数门禁。

多帧归算以“一次操作、逐帧独立结果”执行：首个成功帧完整求解，后续帧复用上一成功帧的中心、尺度、旋转和镜像作为 tracking hint，但每帧仍重新检测、关联 Gaia、拟合并验证自己的 WCS；失败帧不得继承前帧结果。

## 4. 依赖策略

| 能力            | 首选依赖                         | 当前状态                                                    |
| --------------- | -------------------------------- | ----------------------------------------------------------- |
| FITS            | `fitsio` + CFITSIO               | 可选 feature；本机需安装 CMake，默认暂用 `celestial-images` |
| 源提取/孔径测光 | `sep-sys`                        | 已接入并有合成星场测试；静态 LGPLv3 影响发布许可证          |
| 坐标/时间       | `erfars` + `time`                | 时间核心已建；ERFA 转换待接入                               |
| 数组/并行       | `ndarray` + `rayon`              | 已加入依赖                                                  |
| 三角网          | `delaunator`                     | 一级扩展 Delaunay 与对称三角不变量匹配已实现                |
| 拟合            | `nalgebra`                       | 仿射初配与迭代稳健 TAN/CD 已实现                            |
| 星表网络        | `reqwest` + VizieR TAP/ADQL/JSON | Gaia DR3 cone search 已接入；磁盘缓存待实现                 |
| 天区索引        | `cdshealpix`                     | 离线星表阶段接入                                            |
| 状态存储        | `rusqlite`                       | 工程持久化阶段接入                                          |

详细取舍和验收门禁见 [07-technical-decisions.md](07-technical-decisions.md)。

## 5. IPC 与并发

- 元数据和小型结果使用 JSON command。
- FITS 像素、tiles 和大型源目录使用 raw payload/Channel，不传 `number[]`。
- 每个长任务有任务 ID、进度、取消令牌和结构化错误。
- 同一 frame 的 background/source/WCS 结果按参数摘要缓存；切帧不能覆盖其他帧结果。
- 文件访问由 Tauri scope 限制，sidecar 路径和参数不得直接接受任意 shell 字符串。

## 6. 验证边界

- Rust 单元测试：时间、TAN WCS、背景、合成星检测、测光和拟合。
- Golden tests：与 Python SEP、Astropy/ERFA、Astrometrica 教程结果比较。
- 集成测试：真实 FITS → VizieR → WCS → 测量 → ADES。
- 三平台门禁：Windows MSVC、macOS、Linux 的原生依赖构建和许可证产物。
