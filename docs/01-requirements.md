# 需求文档

## 1. 项目概述

仿照 [Astrometrica](http://www.astrometrica.at) 开发一款跨平台天文图像处理软件，用于 CCD 图像的 **天体测量数据归算**（Astrometric Data Reduction），主要面向小行星/彗星的搜索、测量和报告。

- **框架：** Tauri v2（Rust 后端 + WebView 前端）
- **前端：** React + TypeScript + Vite
- **后端：** Rust
- **目标平台：** Windows / macOS / Linux

## 2. 核心功能

### 2.1 FITS 图像加载与显示

- 读取标准 FITS 格式图像（16-bit / 32-bit float，单通道灰度）
- 支持多张图像同时载入
- 直方图拉伸（Histogram Stretch）：Linear / Log / ASINH
- 缩放、平移、适合窗口
- 像素值读取（光标悬停显示 ADU 值）
- 反色显示

### 2.2 Data Reduction（底片解算 / Plate Solving）

- 自动星点检测（背景估计 → 阈值分割 → 质心计算）
- 参考星表匹配（VizieR Gaia DR3 + 扩展 Delaunay 三角不变量；可选 Astrometry.net 盲解回退）
- WCS（世界坐标系统）求解：RA/Dec 中心、像素尺度、旋转角
- 残差验证与可视化
- 手动解算模式（自动解算失败时叠加 Gaia 圆圈，人工调整平移、比例、旋转和镜像，随后自动精化 WCS）

### 2.3 Blink 比较

- 在 2~4 张图像间循环切换显示
- 可调闪烁速度
- 停止闪烁并定位目标
- 自动对齐（基于 WCS 将各帧对齐）

### 2.4 已知天体叠加

- 从在线星历服务（MPC / JPL Horizons）查询当前视场内的已知天体
- 在图像上标注已知小行星/彗星位置和名称
- 区分已知对象和候选新发现

### 2.5 天体测量（Astrometry）

- 在图像上标记目标，自动计算精确 RA/Dec 坐标
- 支持多个目标同时测量
- 显示 RMS 误差、信噪比（SNR）
- 跨帧追踪同一目标，验证匀速直线运动

### 2.6 测光（Photometry）

- 孔径测光（Aperture Photometry）
- 参考星相对测光
- 输出：星等（Magnitude）、流量（Flux）、SNR
- FWHM 计算（星像半高全宽）

### 2.7 MPC 报告生成

- 按 Minor Planet Center 标准格式生成观测报告
- 集成 MPC 报告头信息（观测者信息、望远镜配置）
- 同一图像集仅生成一份报告
- 报告预览与导出
- 无发现时生成空报告（"No moving objects detected"）

### 2.8 已知对象识别（Known Object Overlay）

- 测量后自动比对已知天体数据库
- dRA/dDec 接近 0 的为目标 → 标记为已知
- dRA/dDec 偏差大的为目标 → 标记为候选新发现

## 3. 配置管理

- 望远镜配置（焦距、口径）
- CCD 配置（像素大小、像素尺寸）
- 星表配置（索引文件路径、星等下限）
- 观测者信息（姓名、机构、MPC 编号）
- 配置文件可保存/载入（.cfg 格式）
- 支持多个配置文件切换

## 4. 非功能需求

- **性能：** FITS 加载和拉伸 < 1s（典型 4K×4K 图像）
- **跨平台：** Windows 10/11, macOS, Linux（x86_64）
- **离线可用：** plate solving 和图像处理无需网络；仅 MPC 查询和星表下载需联网
- **首次引导：** 首次运行时引导下载 tetra3 索引文件
