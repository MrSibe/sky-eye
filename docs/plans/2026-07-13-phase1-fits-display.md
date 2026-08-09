# Phase 1: FITS 显示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 跑通 Tauri 项目，能在窗口中加载并显示 FITS 图像，支持直方图拉伸、缩放和平移。

**Architecture:** Tauri v2 + React + TypeScript + Vite 前端；Rust 后端负责 FITS 读取、像素处理和直方图拉伸。前后端通过 Tauri IPC invoke 通信。

**Tech Stack:** Tauri v2, React 18, TypeScript, Tailwind CSS, celestial-images (FITS I/O), ndarray (数组运算), shadcn/ui

---

## 文件结构

```
sky-eye/
├── src/                              # React 前端
│   ├── main.tsx                      # 入口
│   ├── App.tsx                       # 根组件
│   ├── App.css                       # 全局样式
│   ├── index.css                     # Tailwind 入口
│   ├── components/
│   │   ├── FITSViewer/
│   │   │   ├── FITSViewer.tsx        # Canvas 渲染
│   │   │   └── index.ts
│   │   ├── ImageToolbar.tsx          # 拉伸/缩放工具栏
│   │   ├── StatusBar.tsx             # 底部状态栏
│   │   └── FileOpenButton.tsx        # 打开文件按钮
│   ├── stores/
│   │   └── fitsStore.ts              # Zustand 状态
│   ├── types/
│   │   └── fits.ts                   # FITS 类型定义
│   └── lib/
│       └── tauri.ts                  # Tauri invoke 封装
├── src-tauri/
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs                   # Tauri 入口
│       ├── lib.rs                    # 库入口，模块声明
│       ├── commands.rs               # Tauri 命令注册
│       └── fits/
│           ├── mod.rs
│           ├── reader.rs             # FITS 文件读取
│           └── stretch.rs            # 直方图拉伸算法
├── package.json
├── tsconfig.json
├── vite.config.ts
├── tailwind.config.js
└── postcss.config.js
```

---

### Task 1: 初始化 Tauri v2 + React 项目

**操作：** 创建 Tauri v2 项目并安装所有依赖

- [ ] **Step 1: 创建 Tauri v2 项目**

运行以下命令，如果 `sky-eye` 目录已存在就先删除重建：

```bash
cd D:\MyWork
pnpm create tauri-app sky-eye --template react-ts
```

交互选择：

- Package manager: pnpm
- 等待脚手架完成后进入目录

- [ ] **Step 2: 安装前端依赖**

```bash
cd D:\MyWork\sky-eye
pnpm add zustand
pnpm add -D tailwindcss @tailwindcss/vite
```

- [ ] **Step 3: 配置 Tailwind CSS**

编辑 `src/index.css`：

```css
@import 'tailwindcss';
```

编辑 `vite.config.ts`：

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
})
```

- [ ] **Step 4: 添加 Rust 后端依赖**

```bash
cd D:\MyWork\sky-eye\src-tauri
cargo add celestial-images ndarray serde serde_json
cargo add --features tauri tauri
```

- [ ] **Step 5: 验证项目可启动**

```bash
cd D:\MyWork\sky-eye
pnpm tauri dev
```

预期：Tauri 窗口打开，显示 React 默认页面。

---

### Task 2: 实现 Rust FITS 读取模块（`fits::reader`）

**文件：**

- Create: `src-tauri/src/fits/mod.rs`
- Create: `src-tauri/src/fits/reader.rs`

- [ ] **Step 1: 创建模块声明**

`src-tauri/src/fits/mod.rs`：

```rust
pub mod reader;
pub mod stretch;
```

- [ ] **Step 2: 实现 FITS 读取**

`src-tauri/src/fits/reader.rs`：

```rust
use celestial_images::FitsFile;
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct FitsHeader {
    pub object: String,
    pub ra: f64,
    pub dec: f64,
    pub exposure: f64,
    pub filter: String,
    pub date_obs: String,
    pub naxis1: u32,
    pub naxis2: u32,
    pub bitpix: i32,
    pub focal_length: f64,
    pub pixel_size: f64,
}

#[derive(Debug, Serialize)]
pub struct FitsData {
    pub header: FitsHeader,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<f32>,
    pub min_val: f32,
    pub max_val: f32,
}

pub fn load_fits(path: &str) -> Result<FitsData, String> {
    let fits = FitsFile::open(path).map_err(|e| format!("无法打开 FITS: {}", e))?;

    let hdu = fits.primary_hdu().map_err(|e| format!("读取 HDU 失败: {}", e))?;
    let hdr = hdu.header();

    let header = FitsHeader {
        object: hdr.get_string("OBJECT").unwrap_or_default(),
        ra: hdr.get_f64("RA").or_else(|_| hdr.get_f64("OBJCTRA")).unwrap_or(0.0),
        dec: hdr.get_f64("DEC").or_else(|_| hdr.get_f64("OBJCTDEC")).unwrap_or(0.0),
        exposure: hdr.get_f64("EXPTIME").unwrap_or(0.0),
        filter: hdr.get_string("FILTER").unwrap_or_default(),
        date_obs: hdr.get_string("DATE-OBS").unwrap_or_default(),
        naxis1: hdr.get_i64("NAXIS1").unwrap_or(0) as u32,
        naxis2: hdr.get_i64("NAXIS2").unwrap_or(0) as u32,
        bitpix: hdr.get_i64("BITPIX").unwrap_or(0) as i32,
        focal_length: hdr.get_f64("FOCALLEN").unwrap_or(0.0),
        pixel_size: hdr.get_f64("PIXSIZE1").unwrap_or(0.0),
    };

    let (img_hdr, data) = fits.primary_hdu_with_data::<f32>()
        .map_err(|e| format!("读取像素数据失败: {}", e))?;

    let width = img_hdr.get_i64("NAXIS1").unwrap_or(0) as usize;
    let height = img_hdr.get_i64("NAXIS2").unwrap_or(0) as usize;

    if width == 0 || height == 0 {
        return Err("无效的图像尺寸".to_string());
    }

    let pixels = data.as_slice().to_vec();

    let mut min_val = f32::MAX;
    let mut max_val = f32::MIN;
    for &v in &pixels {
        if v.is_finite() {
            if v < min_val { min_val = v; }
            if v > max_val { max_val = v; }
        }
    }

    Ok(FitsData {
        header,
        width: width as u32,
        height: height as u32,
        pixels,
        min_val,
        max_val,
    })
}
```

---

### Task 3: 实现 Rust 直方图拉伸模块（`fits::stretch`）

**文件：**

- Create: `src-tauri/src/fits/stretch.rs`

- [ ] **Step 1: 实现三种拉伸算法**

`src-tauri/src/fits/stretch.rs`：

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub enum StretchMode {
    Linear,
    Log,
    Asinh,
}

#[derive(Debug, Serialize)]
pub struct StretchedImage {
    pub width: u32,
    pub height: u32,
    pub buffer: Vec<u8>,  // RGBA, 每个像素 4 bytes
}

pub fn apply_stretch(
    pixels: &[f32],
    width: u32,
    height: u32,
    mode: StretchMode,
    min_val: f32,
    max_val: f32,
    stretch_factor: f64,
) -> StretchedImage {
    let range = max_val - min_val;
    if range <= 0.0 || width == 0 || height == 0 {
        return StretchedImage {
            width,
            height,
            buffer: vec![0; (width * height * 4) as usize],
        };
    }

    let factor = stretch_factor.max(0.001);

    // 预计算查找表（16-bit 精度）
    let lut_size = 65536;
    let mut lut = Vec::with_capacity(lut_size);
    for i in 0..lut_size {
        let normalized = i as f64 / (lut_size - 1) as f64;
        let stretched = match mode {
            StretchMode::Linear => normalized,
            StretchMode::Log => (normalized * factor + 1.0).log10() / (factor + 1.0).log10(),
            StretchMode::Asinh => {
                let x = normalized * factor;
                x.asinh() / factor.asinh()
            }
        };
        let v = (stretched.clamp(0.0, 1.0) * 255.0) as u8;
        lut.push(v);
    }

    let total = (width * height) as usize;
    let mut buffer = Vec::with_capacity(total * 4);

    for &p in pixels {
        let normalized = if p.is_finite() {
            ((p - min_val) / range).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let idx = (normalized * (lut_size - 1) as f64) as usize;
        let v = lut[idx.min(lut_size - 1)];
        buffer.push(v); // R
        buffer.push(v); // G
        buffer.push(v); // B
        buffer.push(255); // A
    }

    StretchedImage { width, height, buffer }
}
```

---

### Task 4: 实现 Tauri 命令层

**文件：**

- Create: `src-tauri/src/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

- [ ] **Step 1: 实现 commands.rs**

`src-tauri/src/commands.rs`：

```rust
use crate::fits::{self, stretch};
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize)]
pub struct FitsMeta {
    pub path: String,
    pub header: fits::reader::FitsHeader,
    pub width: u32,
    pub height: u32,
    pub min_val: f32,
    pub max_val: f32,
}

#[derive(Debug, Serialize)]
pub struct StretchResult {
    pub width: u32,
    pub height: u32,
    pub buffer: Vec<u8>,
    pub min_val: f32,
    pub max_val: f32,
}

#[derive(Debug, Deserialize)]
pub struct StretchParams {
    pub mode: stretch::StretchMode,
    pub factor: f64,
}

/// 应用状态：保存当前加载的 FITS 数据
pub struct AppState {
    pub current_fits: std::sync::Mutex<Option<fits::reader::FitsData>>,
}

#[tauri::command]
pub fn load_fits(path: String) -> Result<FitsMeta, String> {
    let data = fits::reader::load_fits(&path)?;
    let meta = FitsMeta {
        path,
        header: data.header,
        width: data.width,
        height: data.height,
        min_val: data.min_val,
        max_val: data.max_val,
    };
    Ok(meta)
}

#[tauri::command]
pub fn apply_stretch(
    state: State<AppState>,
    params: StretchParams,
) -> Result<StretchResult, String> {
    let fits_data = state.current_fits.lock().map_err(|e| e.to_string())?;
    let data = fits_data.as_ref().ok_or("未加载 FITS 文件")?;

    let result = stretch::apply_stretch(
        &data.pixels,
        data.width,
        data.height,
        params.mode,
        data.min_val,
        data.max_val,
        params.factor,
    );

    Ok(StretchResult {
        width: result.width,
        height: result.height,
        buffer: result.buffer,
        min_val: data.min_val,
        max_val: data.max_val,
    })
}
```

- [ ] **Step 2: 更新 lib.rs 注册模块和状态**

`src-tauri/src/lib.rs`：

```rust
mod commands;
mod fits;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            current_fits: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_fits,
            commands::apply_stretch,
        ])
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}
```

- [ ] **Step 3: 更新 main.rs**

`src-tauri/src/main.rs`：

```rust
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    sky_eye_lib::run();
}
```

注意：需要将 `package.json` 中的 `"buildName"` 或二进制名与 lib crate 名对应。在 `Cargo.toml` 中确保 `[lib]` 的 `name` 为 `"sky_eye_lib"`。

编辑 `src-tauri/Cargo.toml`，在 `[lib]` 部分：

```toml
[lib]
name = "sky_eye_lib"
crate-type = ["lib", "cdylib", "staticlib"]
```

---

### Task 5: 实现前端类型定义和 Tauri 调用封装

**文件：**

- Create: `src/types/fits.ts`
- Create: `src/lib/tauri.ts`

- [ ] **Step 1: 类型定义**

`src/types/fits.ts`：

```ts
export interface FitsHeader {
  object: string
  ra: number
  dec: number
  exposure: number
  filter: string
  date_obs: string
  naxis1: number
  naxis2: number
  bitpix: number
  focal_length: number
  pixel_size: number
}

export interface FitsMeta {
  path: string
  header: FitsHeader
  width: number
  height: number
  min_val: number
  max_val: number
}

export interface StretchResult {
  width: number
  height: number
  buffer: number[]
  min_val: number
  max_val: number
}

export type StretchMode = 'Linear' | 'Log' | 'Asinh'

export interface StretchParams {
  mode: StretchMode
  factor: number
}
```

- [ ] **Step 2: Tauri 调用封装**

`src/lib/tauri.ts`：

```ts
import { invoke } from '@tauri-apps/api/core'
import type { FitsMeta, StretchResult, StretchParams } from '../types/fits'

export async function loadFits(path: string): Promise<FitsMeta> {
  return invoke('load_fits', { path })
}

export async function applyStretch(params: StretchParams): Promise<StretchResult> {
  return invoke('apply_stretch', { params })
}
```

---

### Task 6: 实现 Zustand Store

**文件：**

- Create: `src/stores/fitsStore.ts`

- [ ] **Step 1: 实现 Store**

`src/stores/fitsStore.ts`：

```ts
import { create } from 'zustand'
import type { FitsMeta, StretchMode } from '../types/fits'

interface FitsState {
  // 状态
  filePath: string | null
  meta: FitsMeta | null
  imageData: ImageData | null
  isLoading: boolean
  error: string | null

  // 显示参数
  stretchMode: StretchMode
  stretchFactor: number
  zoom: number
  panX: number
  panY: number
  invert: boolean
  fitToWindow: boolean

  // 动作
  setFilePath: (path: string | null) => void
  setMeta: (meta: FitsMeta | null) => void
  setImageData: (data: ImageData | null) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setStretchMode: (mode: StretchMode) => void
  setStretchFactor: (factor: number) => void
  setZoom: (zoom: number) => void
  setPanX: (x: number) => void
  setPanY: (y: number) => void
  toggleInvert: () => void
  setFitToWindow: (fit: boolean) => void
  resetView: () => void
}

export const useFitsStore = create<FitsState>((set) => ({
  filePath: null,
  meta: null,
  imageData: null,
  isLoading: false,
  error: null,
  stretchMode: 'Asinh',
  stretchFactor: 2.0,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  invert: false,
  fitToWindow: true,

  setFilePath: (path) => set({ filePath: path }),
  setMeta: (meta) => set({ meta }),
  setImageData: (data) => set({ imageData: data }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  setStretchMode: (mode) => set({ stretchMode: mode }),
  setStretchFactor: (factor) => set({ stretchFactor: factor }),
  setZoom: (zoom) => set({ zoom, fitToWindow: false }),
  setPanX: (x) => set({ panX: x }),
  setPanY: (y) => set({ panY: y }),
  toggleInvert: () => set((s) => ({ invert: !s.invert })),
  setFitToWindow: (fit) => set({ fitToWindow: fit, zoom: fit ? 1.0 : 1.0, panX: 0, panY: 0 }),
  resetView: () => set({ zoom: 1.0, panX: 0, panY: 0, fitToWindow: true }),
}))
```

---

### Task 7: 实现 FITSViewer Canvas 组件

**文件：**

- Create: `src/components/FITSViewer/index.ts`
- Create: `src/components/FITSViewer/FITSViewer.tsx`

- [ ] **Step 1: 导出**

`src/components/FITSViewer/index.ts`：

```ts
export { FITSViewer } from './FITSViewer'
```

- [ ] **Step 2: 实现主组件**

`src/components/FITSViewer/FITSViewer.tsx`：

```tsx
import { useRef, useEffect, useCallback } from 'react'
import { useFitsStore } from '../../stores/fitsStore'

export function FITSViewer() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const isDragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const { imageData, zoom, panX, panY, invert, fitToWindow, setPanX, setPanY, setZoom } =
    useFitsStore()

  // 绘制到 Canvas
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !imageData) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = imageData.width
    canvas.height = imageData.height
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (invert) {
      const inverted = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height,
      )
      for (let i = 0; i < inverted.data.length; i += 4) {
        inverted.data[i] = 255 - inverted.data[i]
        inverted.data[i + 1] = 255 - inverted.data[i + 1]
        inverted.data[i + 2] = 255 - inverted.data[i + 2]
      }
      ctx.putImageData(inverted, 0, 0)
    } else {
      ctx.putImageData(imageData, 0, 0)
    }
  }, [imageData, invert])

  // 自适应窗口大小
  useEffect(() => {
    if (!fitToWindow || !imageData || !containerRef.current) return
    const container = containerRef.current
    const cw = container.clientWidth
    const ch = container.clientHeight
    const scaleX = cw / imageData.width
    const scaleY = ch / imageData.height
    setZoom(Math.min(scaleX, scaleY, 2))
  }, [fitToWindow, imageData])

  // 滚轮缩放
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      const delta = e.deltaY > 0 ? 0.9 : 1.1
      setZoom(Math.max(0.1, Math.min(50, zoom * delta)))
    },
    [zoom, setZoom],
  )

  // 鼠标拖拽平移
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isDragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }, [])

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging.current) return
      const dx = e.clientX - lastPos.current.x
      const dy = e.clientY - lastPos.current.y
      lastPos.current = { x: e.clientX, y: e.clientY }
      setPanX(panX + dx)
      setPanY(panY + dy)
    },
    [panX, panY, setPanX, setPanY],
  )

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
  }, [])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-black"
      style={{ minHeight: 0 }}
    >
      {imageData ? (
        <canvas
          ref={canvasRef}
          className="absolute cursor-grab active:cursor-grabbing"
          style={{
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            transformOrigin: '0 0',
            left: '50%',
            top: '50%',
            marginLeft: -(imageData.width / 2),
            marginTop: -(imageData.height / 2),
          }}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-[#666] select-none">
          <div className="text-center">
            <p className="text-lg mb-2">打开 FITS 文件开始</p>
            <p className="text-sm">点击工具栏按钮或拖入文件</p>
          </div>
        </div>
      )}
    </div>
  )
}
```

---

### Task 8: 实现工具栏和状态栏

**文件：**

- Create: `src/components/ImageToolbar.tsx`
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/FileOpenButton.tsx`

- [ ] **Step 1: ImageToolbar**

`src/components/ImageToolbar.tsx`：

```tsx
import { useFitsStore } from '../stores/fitsStore'
import type { StretchMode } from '../types/fits'

const stretchModes: { value: StretchMode; label: string }[] = [
  { value: 'Linear', label: '线性' },
  { value: 'Log', label: '对数' },
  { value: 'Asinh', label: 'ASINH' },
]

export function ImageToolbar() {
  const {
    imageData,
    stretchMode,
    stretchFactor,
    zoom,
    invert,
    fitToWindow,
    setStretchMode,
    setStretchFactor,
    toggleInvert,
    resetView,
    setFitToWindow,
  } = useFitsStore()

  if (!imageData) return null

  return (
    <div
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10
                    flex items-center gap-2 px-3 py-1.5 rounded-md
                    bg-[#111] border border-[#2a2a2a] text-sm select-none"
    >
      {/* 拉伸模式 */}
      <div className="flex items-center gap-1">
        <span className="text-[#666] text-xs">拉伸</span>
        {stretchModes.map((m) => (
          <button
            key={m.value}
            onClick={() => setStretchMode(m.value)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              stretchMode === m.value
                ? 'bg-[#0070f3] text-white'
                : 'text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[#2a2a2a]" />

      {/* 拉伸系数 */}
      <div className="flex items-center gap-1">
        <span className="text-[#666] text-xs">系数</span>
        <input
          type="range"
          min={0.1}
          max={10}
          step={0.1}
          value={stretchFactor}
          onChange={(e) => setStretchFactor(Number(e.target.value))}
          className="w-16 h-1 accent-[#0070f3]"
        />
      </div>

      <div className="w-px h-4 bg-[#2a2a2a]" />

      {/* 视图控制 */}
      <button
        onClick={toggleInvert}
        className={`px-2 py-0.5 rounded text-xs ${
          invert ? 'bg-[#0070f3] text-white' : 'text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]'
        }`}
      >
        反色
      </button>
      <button
        onClick={() => setFitToWindow(!fitToWindow)}
        className={`px-2 py-0.5 rounded text-xs ${
          fitToWindow
            ? 'bg-[#0070f3] text-white'
            : 'text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]'
        }`}
      >
        适应
      </button>
      <button
        onClick={resetView}
        className="px-2 py-0.5 rounded text-xs text-[#a1a1a1] hover:text-white hover:bg-[#1a1a1a]"
      >
        重置
      </button>

      <span className="text-[#666] text-xs ml-1">
        {zoom < 10 ? zoom.toFixed(1) : zoom.toFixed(0)}x
      </span>
    </div>
  )
}
```

- [ ] **Step 2: FileOpenButton**

`src/components/FileOpenButton.tsx`：

```tsx
import { open } from '@tauri-apps/plugin-dialog'
import { useFitsStore } from '../stores/fitsStore'
import { loadFits, applyStretch } from '../lib/tauri'

export function FileOpenButton() {
  const { setFilePath, setMeta, setImageData, setLoading, setError, stretchMode, stretchFactor } =
    useFitsStore()

  const handleOpen = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'FITS', extensions: ['fits', 'fit', 'fts'] }],
      })
      if (!selected) return

      setLoading(true)
      setError(null)

      const meta = await loadFits(selected as string)
      setFilePath(selected as string)
      setMeta(meta)

      const result = await applyStretch({ mode: stretchMode, factor: stretchFactor })
      const imageData = new ImageData(
        new Uint8ClampedArray(result.buffer),
        result.width,
        result.height,
      )
      setImageData(imageData)
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      onClick={handleOpen}
      className="px-3 py-1.5 rounded-md text-sm font-medium
                 bg-[#0070f3] text-white hover:bg-[#0058cc] transition-colors"
    >
      打开
    </button>
  )
}
```

- [ ] **Step 3: StatusBar**

`src/components/StatusBar.tsx`：

```tsx
import { useFitsStore } from '../stores/fitsStore'

export function StatusBar() {
  const { meta, zoom, isLoading } = useFitsStore()

  return (
    <div
      className="h-[22px] flex items-center px-3 text-xs font-mono
                    bg-[#0d0d0d] text-[#666] border-t border-[#2a2a2a] select-none gap-4"
    >
      {isLoading ? (
        <span>加载中...</span>
      ) : meta ? (
        <>
          <span>{meta.header.object || '(无目标)'}</span>
          <span>
            {meta.width}×{meta.height}
          </span>
          <span>BITPIX {meta.header.bitpix}</span>
          {meta.header.ra > 0 && (
            <span>
              RA {meta.header.ra.toFixed(5)}° Dec {meta.header.dec.toFixed(5)}°
            </span>
          )}
          <span className="ml-auto">{zoom.toFixed(1)}x</span>
        </>
      ) : (
        <span>就绪</span>
      )}
    </div>
  )
}
```

---

### Task 9: 组装 App 主页面

**文件：**

- Modify: `src/App.tsx`
- Replace: `src/App.css`

- [ ] **Step 1: 重写 App.tsx**

`src/App.tsx`：

```tsx
import { FITSViewer } from './components/FITSViewer'
import { ImageToolbar } from './components/ImageToolbar'
import { StatusBar } from './components/StatusBar'
import { FileOpenButton } from './components/FileOpenButton'

function App() {
  return (
    <div className="h-screen w-screen flex flex-col bg-[#0a0a0a] overflow-hidden">
      {/* 菜单栏 */}
      <div className="h-10 flex items-center px-3 gap-2 bg-[#0d0d0d] border-b border-[#2a2a2a] select-none">
        <span className="text-[#ededed] font-semibold text-sm mr-2">SkyEye</span>
        <FileOpenButton />
      </div>

      {/* 主区域 */}
      <div className="flex-1 flex flex-col relative min-h-0">
        <FITSViewer />
        <ImageToolbar />
      </div>

      {/* 状态栏 */}
      <StatusBar />
    </div>
  )
}

export default App
```

- [ ] **Step 2: 替换 App.css**

`src/App.css`：

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html,
body,
#root {
  height: 100%;
  width: 100%;
  overflow: hidden;
  background: #0a0a0a;
  color: #ededed;
  font-family:
    Geist,
    Inter,
    system-ui,
    -apple-system,
    sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 自定义滚动条 */
::-webkit-scrollbar {
  width: 8px;
}
::-webkit-scrollbar-track {
  background: #0a0a0a;
}
::-webkit-scrollbar-thumb {
  background: #404040;
  border-radius: 4px;
}
```

---

### Task 10: 配置 Tauri 对话框插件

Tauri v2 需要插件系统，文件对话框需要添加 `@tauri-apps/plugin-dialog`。

- [ ] **Step 1: 安装前端插件**

```bash
cd D:\MyWork\sky-eye
pnpm add @tauri-apps/plugin-dialog
```

- [ ] **Step 2: 添加 Rust 插件**

```bash
cd D:\MyWork\sky-eye\src-tauri
cargo add tauri-plugin-dialog
```

- [ ] **Step 3: 注册插件**

在 `src-tauri/src/lib.rs` 中注册 dialog 插件：

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            current_fits: std::sync::Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_fits,
            commands::apply_stretch,
        ])
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}
```

- [ ] **Step 4: 更新 tauri.conf.json 启用对话框权限**

在 `src-tauri/capabilities/default.json` 中添加 dialog 权限：

```json
{
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": ["core:default", "dialog:default", "dialog:allow-open"]
}
```

---

## 验证

- [ ] **编译检查：**

  ```bash
  cd D:\MyWork\sky-eye
  pnpm tauri build
  ```

  预期：编译通过，生成可执行文件

- [ ] **功能验证：**
  1. 启动应用，看到 SkyEye 窗口
  2. 点击"打开"按钮，选择 FITS 文件
  3. 图像在 Canvas 中渲染显示
  4. 切换拉伸模式（线性/对数/ASINH），图像变化
  5. 调整拉伸系数滑块，图像变化
  6. 鼠标滚轮缩放，拖拽平移
  7. 反色切换正常
  8. 状态栏显示元数据

- [ ] **边界测试：**
  - 打开非 FITS 文件，显示错误信息
  - 打开 32-bit float FITS
  - 窗口缩放时图像自适应
