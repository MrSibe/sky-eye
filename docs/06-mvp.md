# SkyEye MVP

## 目标

SkyEye MVP 复刻 Astrometrica 的核心人工测量闭环，而不是只做 FITS 查看器：

1. 打开一组 FITS 图像并读取可靠的观测时间、曝光和设备元数据。
2. 对图像执行 Dark/Flat 标定并以统一拉伸显示。
3. 检测星源、查询 VizieR Gaia DR3，并在给定中心和像素尺度提示下完成 near plate solving。
4. WCS/星点对齐后 Blink，多帧人工确认移动目标。
5. 点击目标，计算质心或二维高斯 PSF、RA/Dec、FWHM、SNR 和孔径测光。
6. 使用 ATLAS REFCAT2 做光度定标，生成并校验 ADES PSV 报告。

## MVP 范围

### 必须完成

- FITS 整数/浮点图像、BSCALE/BZERO、多 HDU 和常见压缩格式。
- FITS Header 查看；UTC 曝光开始、结束和中点语义明确。
- WebGL2 灰度显示、black/white point、gamma、ASINH/Log、反色、缩放和平移。
- 2–25 帧加载、统一拉伸、星点或 WCS 对齐 Blink。
- SEP 背景估计、源检测、去混叠、形状参数和孔径测光。
- VizieR Gaia DR3 cone search、proper motion 历元传播和本地缓存。
- 扩展 Delaunay/TAN-CD near solve、迭代匹配、sigma clipping、残差、人工参考星叠加校准和人工排除参考星。
- 质心与二维高斯两种测量方式。
- ATLAS REFCAT2 光度零点和可选颜色项。
- ADES PSV 预览、校验和导出。
- Windows、macOS、Linux 构建检查。

### MVP 后实现

- 自动 Moving Object Detection。
- Track & Stack 和 synthetic tracking。
- 离线 Gaia/REFCAT2 与 MPCORB 轨道传播。
- MPC Known Objects Overlay。
- Find_Orb、Astrometry.net 等可选 sidecar 集成。
- ADES XML 和旧 MPC 80-column 兼容导出。

## 非目标

- 不逐像素复制 Astrometrica 的旧界面。
- 不在 TypeScript 中实现科学计算。
- 不在缺失有效观测时间或可信 WCS 时生成可提交报告。
- 不允许自动候选未经人工复核直接进入报告。
- MVP 不引入 GPU synthetic tracking。

## 验收标准

- 同一帧 `pixel -> sky -> pixel` 往返误差小于 0.05 px。
- 真实样本的参考星拟合 RMS 目标小于 1 arcsec。
- 对齐 Blink 的静态恒星残差小于 1 px。
- 合成高斯星的流量误差小于 1%，质心误差小于 0.1 px。
- SEP 结果与官方 Python SEP golden data 在约定浮点容差内一致。
- ADES PSV 通过官方规则校验，并包含观测站、曝光中点、坐标、星等、滤镜和星表来源。
- 4K 多帧像素不通过 JSON 数组在 Rust 与 WebView 间反复复制。

## 交付顺序

1. 原生依赖三平台门禁：CFITSIO、SEP、ERFA。
2. 科学核心数据模型、FITS、时间和标定。
3. WebGL2 Viewer 与高吞吐像素通道。
4. 多帧星点配准与 Blink。
5. VizieR Gaia near Data Reduction。
6. 手工目标测量、ATLAS 测光和 ADES PSV。
