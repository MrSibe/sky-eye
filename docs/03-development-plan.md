# 开发方案

## 1. 开发环境

### 1.1 前置依赖

| 工具      | 版本           | 用途           |
| --------- | -------------- | -------------- |
| Rust      | stable (≥1.75) | 后端编译       |
| Node.js   | ≥20 LTS        | 前端构建       |
| pnpm      | ≥9             | 包管理（推荐） |
| Tauri CLI | v2             | Tauri 构建     |

### 1.2 安装指引

```bash
# Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Node.js (推荐使用 fnm 或 nvm)
# 从 https://nodejs.org 安装 LTS 版本

# pnpm
npm install -g pnpm

# Tauri CLI
cargo install tauri-cli --version "^2"
```

### 1.3 项目初始化

```bash
cd D:\MyWork\sky-eye
pnpm create tauri-app sky-eye --template react-ts
cd sky-eye
pnpm install

# 添加后端依赖
cd src-tauri
cargo add celestial-images ndarray imageproc tokio reqwest serde serde_json toml
cargo add tetra3 --git https://github.com/esa/tetra3
cd ..
```

## 2. 开发原则

### 2.1 架构原则

- **模块独立：** 每个 Rust 模块有清晰入/出接口，可独立测试
- **前端无逻辑：** React 组件只做渲染和交互，所有计算在 Rust 后端
- **渐进增强：** 先用简单实现跑通主流程，再逐模块完善
- **最小依赖：** 不轻易引入新 crate，优先用 std / ndarray 解决

### 2.2 命名规范

- Rust: `snake_case` 函数和变量，`PascalCase` 类型和 trait
- TypeScript: `camelCase` 变量/函数，`PascalCase` 组件/类型
- 文件: `snake_case.rs`，`PascalCase.tsx`

### 2.3 错误处理

- Rust 端：所有命令返回 `Result<T, String>`，统一错误类型
- 前端：Tauri invoke 错误统一捕获和显示

## 3. 核心算法说明

### 3.1 星点检测（Source Detection）

参考 SEP/SExtractor 算法的简化实现：

1. **背景估计：** 将图像分网格（32×32），每个网格内计算中位数 → 双线性插值得到全图背景
2. **背景减除：** 原始像素 - 背景
3. **噪声估计：** 计算背景 RMS（Sigma Clipping）
4. **阈值分割：** 像素 > 背景 + n×RMS（通常 n=3~5）
5. **连通域标记：** 合并相邻像素
6. **质心计算：** 对每个连通域计算加权质心 Cₓ = Σ(I·x)/ΣI
7. **基本参数：** FWHM、峰值、流量、椭圆率

### 3.2 Plate Solving（tetra3）

1. **准备：** 将星点坐标 + 图像宽高 + 焦距/像素大小作为 hint 传入
2. **盲解：** tetra3 在索引库中搜索匹配的星模式
3. **精化：** SVD 求解姿态 → 验证 → WCS 生成
4. **追踪模式：** 后续帧使用前一帧的解算结果加速

### 3.3 直方图拉伸

| 模式   | 公式                                | 适用场景          |
| ------ | ----------------------------------- | ----------------- |
| Linear | `v = (x - min) / (max - min)`       | 通用              |
| Log    | `v = log(1 + x) / log(1 + max)`     | 暗弱天体          |
| ASINH  | `v = asinh(x / f) / asinh(max / f)` | 同时显示亮/暗细节 |

### 3.4 孔径测光

1. 在天体质心处定义圆形孔径（默认半径 = 2×FWHM）
2. 孔径内像素求和 → 总流量
3. 环形天光背景（内径 3×FWHM，外径 5×FWHM）
4. 净流量 = 总流量 - 背景×像素数
5. 星等 = -2.5 × log₁₀(净流量/t_exp) + 零点星等

## 4. 测试策略

| 层级          | 工具                | 覆盖                                           |
| ------------- | ------------------- | ---------------------------------------------- |
| Rust 单元测试 | `cargo test`        | 每个算法模块（stretch、detection、photometry） |
| Rust 集成测试 | `cargo test --test` | FITS 读写 + plate solving pipeline             |
| 前端组件测试  | Vitest              | React 组件渲染、用户交互                       |
| E2E 测试      | Playwright          | 完整操作流程                                   |

## 5. 数据管理

### 5.1 配置文件 (`~/.sky-eye/config.toml`)

```toml
[telescope]
focal_length = 2000    # mm
aperture = 200         # mm

[camera]
pixel_size_x = 4.63    # μm
pixel_size_y = 4.63    # μm
width = 2048
height = 2048

[catalog]
index_path = "~/.sky-eye/indices/"
max_magnitude = 16.0

[observer]
name = "Observer Name"
code = "XXX"
institution = ""

[display]
stretch_mode = "asinh"
stretch_factor = 2.0
```

### 5.2 索引文件

下载路径：用户指定的目录（默认 `~/.sky-eye/indices/`）

tetra3 GAIA DR3 索引文件：

- 按 HEALPix 层级分发
- 通常需要下载 2~4 个层级的索引（覆盖率取决于视场大小）
- 首次运行时引导下载，支持断点续传

### 5.3 缓存

- 在线星表查询结果缓存 7 天（避免重复请求）
- 解算结果缓存（同一帧避免重复解算）
