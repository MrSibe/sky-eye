---
version: alpha
name: SkyEye Design System
website: ''
description: SkyEye 的设计语言 — 一款面向天文工作者的桌面图像处理软件。以暗色为默认底色，低对比度界面确保长时间观测操作时不刺眼。借鉴 Vercel 的克制和品质感：单色 primary、清晰的信息层级、精确的间距系统。

seo:
  title: 'SkyEye Design System — Dark-first astronomical image processing app'
  metaDescription: 'SkyEye design language as a DESIGN.md file. Dark-first, Geist + Geist Mono, astronomy-optimized UI.'
  highlights:
    - "Dark-first — default bg #0a0a0a, ink-like interface that doesn't interfere with FITS image viewing"
    - 'Single accent #0070f3 — used for measurement overlays, selected targets, active annotations'
    - 'Geist + Geist Mono — clean sans for UI, mono for RA/Dec coordinates and technical data'
    - 'Adaptive canvas — FITSViewer is always pure black (#000000), panels use stepped grays'
    - 'Scientific precision — monospace tables, consistent decimal alignment, show-all-the-digits'
  tags:
    - 'Scientific Desktop'
    - 'Astronomy'
    - 'Image Processing'
  lastUpdated: '2026-07-13'

colors:
  primary: '#0070f3'
  on-primary: '#ffffff'
  ink: '#ededed'
  body: '#a1a1a1'
  mute: '#666666'
  hairline: '#2a2a2a'
  hairline-strong: '#404040'
  canvas: '#111111'
  canvas-soft: '#0d0d0d'
  canvas-soft-2: '#0a0a0a'
  canvas-viewer: '#000000'
  accent-green: '#38d9a9'
  accent-green-soft: '#0a2e22'
  accent-yellow: '#ffd43b'
  accent-yellow-soft: '#332b00'
  accent-red: '#ff6b6b'
  accent-red-soft: '#331111'
  link: '#74c0fc'
  link-deep: '#4dabf7'
  success: '#38d9a9'
  error: '#ff6b6b'
  error-soft: '#331111'
  warning: '#ffd43b'
  warning-soft: '#332b00'
  selection-bg: '#1a3a5c'
  selection-fg: '#ededed'

typography:
  display-xl:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 48px
    fontWeight: 600
    lineHeight: 48px
    letterSpacing: -2.4px
  display-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: -1.28px
  display-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.96px
  display-sm:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: -0.6px
  body-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 18px
    fontWeight: 400
    lineHeight: 28px
    letterSpacing: 0px
  body-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 15px
    fontWeight: 400
    lineHeight: 22px
  body-md-strong:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
  body-sm:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
  body-sm-strong:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  caption:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
  caption-mono:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 11px
    fontWeight: 400
    lineHeight: 14px
    letterSpacing: 0.5px
  code:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
  coord:
    fontFamily: Geist Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0.5px
  button-md:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
  button-lg:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 15px
    fontWeight: 500
    lineHeight: 22px
  tab-label:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0.3px
  label:
    fontFamily: Geist, Inter, system-ui, -apple-system, sans-serif
    fontSize: 11px
    fontWeight: 500
    lineHeight: 14px
    letterSpacing: 0.5px

rounded:
  none: 0px
  xs: 2px
  sm: 4px
  md: 6px
  lg: 8px
  xl: 12px
  pill: 9999px

spacing:
  xxs: 2px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 20px
  2xl: 24px
  3xl: 32px
  4xl: 40px
  5xl: 48px
  6xl: 64px

components:
  fits-viewer:
    backgroundColor: '{colors.canvas-viewer}'
    rounded: '{rounded.none}'
    border: 'none'
    description: 'WebGL2 FITS image display using a single-channel float texture and fragment-shader stretch. Always pitch-black background. User controls: zoom, pan, stretch mode selector in a floating toolbar.'

  fits-toolbar:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.body}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs} {spacing.sm}'
    borderColor: '{colors.hairline}'
    description: 'Floating overlay toolbar on top of FITSViewer. Buttons: zoom in/out, fit, stretch mode, invert, reset view.'

  panel:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.none}'
    padding: '{spacing.md}'
    borderColor: '{colors.hairline}'
    description: 'Side panel / docked panel container for configuration and results.'

  panel-header:
    backgroundColor: '{colors.canvas-soft}'
    textColor: '{colors.body}'
    typography: '{typography.label}'
    padding: '{spacing.sm} {spacing.md}'
    borderColor: '{colors.hairline}'
    description: 'Panel title bar. Shows section name, collapse toggle on right.'

  button-primary:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.on-primary}'
    typography: '{typography.button-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs} {spacing.md}'
    height: 32px
    description: "Primary action button — 'Data Reduction', 'Solve', 'Accept'."

  button-secondary:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.button-md}'
    rounded: '{rounded.md}'
    borderColor: '{colors.hairline}'
    padding: '{spacing.xs} {spacing.md}'
    height: 32px
    description: "Secondary action — 'Cancel', 'Reset', 'Skip'."

  button-ghost:
    backgroundColor: 'transparent'
    textColor: '{colors.body}'
    typography: '{typography.button-md}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs}'
    height: 28px
    description: 'Icon-only or ghost button in toolbars and dense areas.'

  button-icon:
    backgroundColor: 'transparent'
    textColor: '{colors.body}'
    rounded: '{rounded.md}'
    padding: '{spacing.xs}'
    width: 28px
    height: 28px
    description: 'Circular/square icon button for toolbar actions.'

  form-input:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    borderColor: '{colors.hairline-strong}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '0px {spacing.sm}'
    height: 32px
    description: 'Text input for numeric parameters (focal length, pixel size, etc.).'

  form-input-mono:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    borderColor: '{colors.hairline-strong}'
    typography: '{typography.coord}'
    rounded: '{rounded.sm}'
    padding: '0px {spacing.sm}'
    height: 32px
    description: 'Monospace input for RA/Dec coordinate entry.'

  form-select:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    borderColor: '{colors.hairline-strong}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.sm}'
    padding: '0px {spacing.sm}'
    height: 32px
    description: 'Dropdown select for stretch mode, catalog selection, etc.'

  form-label:
    textColor: '{colors.body}'
    typography: '{typography.label}'
    marginBottom: '{spacing.xs}'
    description: 'Form field label.'

  form-group:
    gap: '{spacing.sm}'
    description: 'Vertical group of label + input.'

  slider:
    trackColor: '{colors.hairline-strong}'
    fillColor: '{colors.primary}'
    thumbColor: '{colors.ink}'
    height: 4px
    thumbSize: 14px
    rounded: '{rounded.pill}'
    description: 'Range slider for numeric parameters (stretch factor, blink speed, threshold).'

  toggle:
    trackColor: '{colors.hairline-strong}'
    trackActiveColor: '{colors.primary}'
    thumbColor: '{colors.ink}'
    description: 'Binary toggle for boolean settings.'

  tab:
    textColor: '{colors.body}'
    activeTextColor: '{colors.ink}'
    activeIndicatorColor: '{colors.primary}'
    typography: '{typography.tab-label}'
    padding: '{spacing.sm} {spacing.md}'
    description: 'Section tabs in configuration panels.'

  object-table:
    headerBackground: '{colors.canvas-soft}'
    headerTypography: '{typography.caption-mono}'
    bodyTypography: '{typography.coord}'
    cellPadding: '{spacing.xs} {spacing.sm}'
    rowBorder: '{colors.hairline}'
    rowHoverBackground: '{colors.canvas-soft}'
    selectedRowBackground: '{colors.selection-bg}'
    description: 'Astronomical measurement results table. Monospace alignment, zero-padded coordinates.'

  data-table:
    headerBackground: '{colors.canvas-soft}'
    headerTypography: '{typography.caption-mono}'
    bodyTypography: '{typography.body-sm}'
    cellPadding: '{spacing.xs} {spacing.sm}'
    rowBorder: '{colors.hairline}'
    rowHoverBackground: '{colors.canvas-soft}'
    description: 'Generic data table for star lists and catalog display.'

  blink-controls:
    backgroundColor: '{colors.canvas}'
    borderColor: '{colors.hairline}'
    typography: '{typography.body-sm}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm} {spacing.md}'
    gap: '{spacing.sm}'
    description: 'Blink comparison control bar. Buttons: play/stop, frame prev/next, speed slider, frame counter.'

  star-chart-overlay:
    knownObjectColor: '{colors.accent-green}'
    candidateColor: '{colors.accent-yellow}'
    referenceStarColor: '{colors.link}'
    selectedColor: '{colors.primary}'
    labelTypography: '{typography.caption-mono}'
    description: 'Overlay drawn on top of FITS canvas. Known objects in green, candidates in yellow, reference stars in blue.'

  crosshair:
    color: '{colors.accent-green}'
    size: 40px
    lineWidth: 1px
    description: 'Target selection crosshair centered on clicked FITS pixel.'

  mpc-report-preview:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    typography: '{typography.code}'
    rounded: '{rounded.md}'
    padding: '{spacing.md}'
    borderColor: '{colors.hairline}'
    description: 'Monospace text area showing raw MPC report content before submission.'

  status-bar:
    backgroundColor: '{colors.canvas-soft}'
    textColor: '{colors.body}'
    typography: '{typography.caption-mono}'
    padding: '{spacing.xs} {spacing.md}'
    borderColor: '{colors.hairline}'
    description: 'Application status bar at bottom. Shows current frame, cursor RA/Dec, pixel value, FWHM.'

  config-section:
    gap: '{spacing.md}'
    description: 'Group of related configuration fields (Telescope / CCD / Catalog / Observer sections).'

  dialog:
    backgroundColor: '{colors.canvas-soft}'
    textColor: '{colors.ink}'
    rounded: '{rounded.lg}'
    padding: '{spacing.xl}'
    borderColor: '{colors.hairline}'
    overlayColor: '#00000080'
    description: 'Modal dialog for confirmations, alerts, and MPC report preview.'

  toast:
    backgroundColor: '{colors.canvas}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '{spacing.sm} {spacing.md}'
    typography: '{typography.body-sm}'
    borderColor: '{colors.hairline}'
    description: 'Brief notification toast for operation success/failure feedback.'

  progress-bar:
    trackColor: '{colors.hairline-strong}'
    fillColor: '{colors.primary}'
    height: 4px
    rounded: '{rounded.pill}'
    description: 'Progress indicator for long operations (plate solving, catalog download).'

  scrollbar:
    width: 8px
    thumbColor: '{colors.hairline-strong}'
    trackColor: '{colors.canvas}'
    rounded: '{rounded.pill}'
    description: 'Custom thin scrollbar for panels and tables.'
---

## 参考边界

本文参考 [Vercel Design Guidelines](https://vercel.com/design.md) 的设计判断，而不是复制其报告网站外壳或 `vbg-*` 组件：保留克制、清晰层级、共享网格、语义化 token、可访问焦点与响应式重排；不使用 Vercel 品牌标识，也不直接引入 Vercel 报告页 CSS。SkyEye 的暗色优先、纯黑图像画布、科学数据等宽排版和高密度桌面布局仍是最高优先级。

## 实现约定

- `src/index.css` 是主题 token 的唯一来源；业务组件不得新增十六进制色值。
- `src/components/ui/` 承载 Button、Field、Input、Select、Toolbar、Panel、Notice 等基础组件；业务组件只负责数据和组合。
- 颜色必须表达交互或状态。普通分组优先使用间距与层级，避免卡片嵌套、装饰阴影和无意义边框。
- 所有可交互控件必须有可见的键盘焦点；仅图标按钮必须提供可访问名称。
- UI 文本使用 Geist Sans 字体栈，路径、坐标、像素值、时间与短技术标识使用 Geist Mono 字体栈。

## 设计原则

### 1. 暗色优先

天文观测在夜间进行，软件界面的暗色是刚需，不是主题切换的选项。

- 默认背景 `#0a0a0a`，比纯黑高一档以区分图像区域
- FITS 图像显示区域使用纯黑 `#000000`，确保像素值不被界面亮色干扰
- 所有面板、对话框、工具栏使用不同深度的灰色分层，不依赖彩色阴影
- 每一步灰度都经过推敲：`#0a0a0a` → `#0d0d0d` → `#111111` → `#2a2a2a` → `#404040`

### 2. 图像是主角

- FITSViewer 占最大面积，不留任何界面元素在图像上方（工具栏悬浮且半透明）
- 所有颜色都要考虑在暗色背景上的可读性，以及**不干扰对天文图像的视觉判断**
- 叠加层（参考星、已知天体、十字线）颜色选择绿色/蓝色光谱，避开红色（夜视保护）——但红色仍用于错误和警告

### 3. 精确的数据显示

- RA/Dec 坐标使用等宽字体，固定列宽，零补全
- 表格里的数字右对齐，小数位统一
- 科学记数法只在真正需要时使用

### 4. 克制的色彩

借鉴 Vercel 的原则——主色只有一个：`#0070f3`

| 颜色           | 用途                                             | 示例                                    |
| -------------- | ------------------------------------------------ | --------------------------------------- |
| `#0070f3` 蓝   | 主操作、选中状态、任何需要"这就是交互对象"的地方 | Data Reduction 按钮、选中目标、活跃标签 |
| `#38d9a9` 绿   | 确认、成功、叠加标注                             | 参考星圈、已知天体、测量完成            |
| `#ffd43b` 黄   | 警告、候选目标                                   | 可疑移动目标、未验证测量                |
| `#ff6b6b` 红   | 错误、失败、危险操作                             | 解算失败、操作错误                      |
| `#74c0fc` 浅蓝 | 链接、信息性标注                                 | 文档链接、次要标注                      |

色彩的使用量和饱和度都低——界面大面积是灰色，颜色只出现在有意义的地方。

## 间距

基础单位：**4px**。所有间距值都是 4 的倍数。

| Token | 值   | 用途                           |
| ----- | ---- | ------------------------------ |
| `xxs` | 2px  | 极紧凑内边距                   |
| `xs`  | 4px  | 图标/紧凑按钮 padding          |
| `sm`  | 8px  | 小间距（按钮和输入框 gap）     |
| `md`  | 12px | 表单组 gap、面板 padding       |
| `lg`  | 16px | 组件间间距、表格单元格 padding |
| `xl`  | 20px | 面板内部 padding               |
| `2xl` | 24px | 面板间间距                     |
| `3xl` | 32px | 大卡片 padding                 |
| `4xl` | 40px | 大区块间距                     |
| `5xl` | 48px | 窗口边距                       |
| `6xl` | 64px | 最大间距                       |

**原则：** 紧凑但不拥挤。桌面工具的信息密度天生比营销页面高，但每个区块内部仍然有呼吸感。

## 布局

### 主窗口布局

```
┌──────────────────────────────────────────────────┐
│  Menu Bar                                         │
├──────────────────────┬───────────────────────────┤
│                      │                            │
│   Panel Sidebar      │    FITSViewer              │
│   (260px)            │    (flex-1)                │
│   ├ Config           │    ┌──────────────────┐    │
│   ├ Object Table     │    │                  │    │
│   ├ MPC Report       │    │    FITS Canvas   │    │
│   └ Status           │    │    (100% H/W)    │    │
│                      │    │                  │    │
│                      │    └──────────────────┘    │
│                      │    ┌──────────────────┐    │
│                      │    │ Blink Controls   │    │
│                      │    └──────────────────┘    │
├──────────────────────┴───────────────────────────┤
│  Status Bar                                        │
└──────────────────────────────────────────────────┘
```

- **面板侧栏：** 固定 260px 宽，可折叠
- **FITSViewer：** 占据剩余空间，纯黑背景
- **Blink Controls：** 浮动在 FITSViewer 底部，不阻挡图像
- **状态栏：** 22px 高，显示帧信息 / 鼠标位置 RA/Dec / 像素值 / FWHM

### 断点

桌面端只有宽度变化：

| 宽度       | 行为             |
| ---------- | ---------------- |
| > 1200px   | 全布局，侧栏展开 |
| 800-1200px | 侧栏可折叠       |
| < 800px    | 面板堆叠在下方   |

## 暗色主题参考

Tailwind CSS 暗色模式配置：

```js
// tailwind.config.js 参考值
colors: {
  'sky-canvas': '#111111',
  'sky-canvas-soft': '#0d0d0d',
  'sky-canvas-soft-2': '#0a0a0a',
  'sky-canvas-viewer': '#000000',
  'sky-ink': '#ededed',
  'sky-body': '#a1a1a1',
  'sky-mute': '#666666',
  'sky-hairline': '#2a2a2a',
  'sky-hairline-strong': '#404040',
  'sky-primary': '#0070f3',
  'sky-accent-green': '#38d9a9',
  'sky-accent-yellow': '#ffd43b',
  'sky-accent-red': '#ff6b6b',
  'sky-link': '#74c0fc',
  'sky-success': '#38d9a9',
  'sky-error': '#ff6b6b',
  'sky-warning': '#ffd43b',
  'sky-selection': '#1a3a5c',
}
```
