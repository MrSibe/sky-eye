# 技术决策记录

## TD-001：科学计算留在 Rust Core

React/WebView 只负责显示、交互和任务状态。FITS、标定、源检测、WCS、测光、运动检测和报告数据校验全部位于与 Tauri 解耦的 Rust 模块中。

## TD-002：FITS 使用 CFITSIO，避免手写大面积 FFI

首选 `fitsio` 高层封装，并启用源码/CMake 构建能力。若 Windows MSVC 门禁失败，则使用 `fitsio-sys` 的生成绑定和固定版本 CFITSIO，不自行维护函数声明。纯 Rust FITS 库只用于兼容性对照。

## TD-003：SEP 是 Data Reduction 和测光底座

SEP 负责背景、噪声、检测、deblend、质心、形状、Kron radius 和孔径测光。项目建立安全包装层，所有 `unsafe`、C 内存生命周期和 SEP flag 翻译集中管理。

采用前必须满足：

- Windows MSVC、macOS ARM64、Linux x64 均可构建。
- 与官方 Python SEP 使用同一输入时结果可重复。
- 打包前完成 LGPL 分发义务审查。

## TD-004：Data Reduction 以 near solve 为主

主路径使用 FITS/配置提供的大致中心、像素尺度和旋转提示，查询 Gaia DR3 后进行图案匹配和 TAN/CD 拟合。盲解不是默认路径；tetra3 和外部 Astrometry.net 只负责缺少 hint 或 near solve 失败时的回退。

实现顺序固定为：按像素比例计算 Gaia footprint → 归算级源筛选 → Gaia 多星等层级截断 → 一级扩展 Delaunay → 三角形不变量空间的对称匹配 → 全场一对一验证 → 稳健 TAN/CD。Delaunay 主路径同时搜索两种镜像和完整旋转，带尺度先验的星对 Hough 保留为辅助候选。不得仅凭一个三角形或四边形接受解；任何 seed 都必须通过额外参考星的统计验证。

参考星选择采用 Astrometrica 风格的双端窗口：G 星等小于亮端阈值的目录星视为可能饱和，G 星等大于暗端阈值的目录星视为可能未检出。该窗口必须同时作用于自动匹配、人工 Gaia 叠加和人工 seed 精化，避免界面重合数与 Rust 实际拟合使用不同样本。图像源还需依据 Header 饱和值或局部平顶形态排除饱和目标；自动失败时逐档增加参与匹配的亮星数量，而不是降低最终验证门限。

自动 near solve 失败时提供 Manual Reference Star Match：用户平移、旋转、缩放及镜像 Gaia 圆圈叠加层，或指定至少三组图像星/星表星配对。人工结果仅提供初始变换，最终仍须执行自动关联、异常剔除、TAN/CD 拟合以及匹配数和 RMS 门禁。

## TD-005：MVP WCS 限制为 TAN/CD，后续添加 SIP

MVP 不强制分发 WCSLIB。ERFA 提供切平面和天文坐标基础运算，`nalgebra` 负责最小二乘/SVD；实现通过 Astropy/WCSLIB golden data 验证。大视场畸变在参考星数量充分时才启用 SIP。

## TD-006：VizieR 与星表分工

- Gaia DR3：天体测量、proper motion、WCS 精化。
- ATLAS REFCAT2：`g/r/i/z` 测光零点和颜色项。
- VizieR TAP：使用 ADQL cone search 和 JSON 响应；保留 VOTable 作为需要标准互操作时的备选格式。
- `cdshealpix`：缓存覆盖和离线分块索引。
- SQLite：查询来源、时间、参数、结果和数据指纹。

## TD-007：统一时间模型

FITS 时间文本由 `time` 解析，ERFA 负责 UTC/TAI/TT、两段式 Julian Date、历元和空间运动。业务层统一使用 `AstroTime`，不得混用 Unix 时间、单个 `f64` JD 和未标注时标的字符串。

## TD-008：高吞吐显示不使用 JSON 像素数组

元数据使用普通 Tauri command。像素、缩略图和长任务进度使用 Raw Payload/Channel；大图通过受限 custom protocol 或 tile 读取。前端只持有 opaque frame ID，不向 protocol 传任意文件路径。

## TD-009：可复现与来源追踪

每个 WCS、测量和报告记录必须保存：输入帧、算法参数、参考星表、查询/缓存版本、剔除记录、RMS、观测时间解释和软件版本。失败结果不得伪装成有效 WCS。
