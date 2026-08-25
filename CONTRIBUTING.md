# 贡献指南

感谢你愿意为 Sky Eye 贡献代码。本文档说明开发环境、质量门槛和提交流程。所有贡献默认遵循 [GPL-3.0-or-later](LICENSE)。

## 技术栈

- 桌面框架：Tauri 2（Rust 后端 + WebView 前端）
- 前端：React 18 + TypeScript + Vite + pnpm
- 后端：Rust（edition 2021），仓库根目录为前端，Rust crate 位于 `src-tauri/`
- 架构与设计决策见 [`docs/`](docs/)，特别是 `02-architecture.md` 和 `07-technical-decisions.md`

## 环境准备

| 依赖 | 版本 | 说明 |
|---|---|---|
| Node.js | 22.x | 前端构建与工具链 |
| pnpm | 11.1.3 | 由 `package.json` 的 `packageManager` 字段锁定 |
| Rust | stable 工具链 | 含 `clippy`、`rustfmt` 组件；与 CI 的 `dtolnay/rust-toolchain@stable` 一致 |
| Tauri 系统依赖 | 平台相关 | Linux 见 [Tauri 官方文档](https://v2.tauri.app/start/prerequisites/)（CI 安装 `libwebkit2gtk-4.1-dev` 等） |

首次拉取后：

```bash
pnpm install
```

## 本地开发

```bash
pnpm dev          # 前端热重载（vite）
pnpm tauri dev    # 完整桌面应用开发模式
```

## 质量门槛

合并前必须通过以下全部检查（CI 也会逐项验证，job 名为 `Frontend quality` 和 `Rust quality`）。**最简方式：一条命令跑完全部检查。**

```bash
pnpm check
```

它依次执行：

| 命令 | 内容 |
|---|---|
| `pnpm format:check` | Prettier 格式检查 |
| `pnpm lint` | ESLint（`--max-warnings 0`，零容忍） |
| `pnpm version:check` | 三处版本号一致性（`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`） |
| `pnpm build` | TypeScript 类型检查 + Vite 生产构建 |
| `pnpm rust:fmt:check` | `cargo fmt --check` |
| `pnpm rust:clippy` | `cargo clippy --all-targets -- -D warnings`（零告警） |
| `pnpm rust:test` | `cargo test --all-targets` |

> Rust 侧语法改动（新增 `as_chunks` 等较新的标准库 API）前，确认你的工具链与 CI 的 stable 一致，避免本地通过、CI 失败。

## 提交规范

提交信息使用 Conventional Commits，参考仓库历史：

```
feat: 支持从本地 .gz 文件导入 MPCORB 星表
fix: 修正 Windows 上 NSIS 更新后版本回退
style: 统一应用内设计系统
docs: 更新 README
chore: 同步 Cargo.lock 版本
perf: 优化 Blink 热路径渲染
```

### 原则

- **小而集中**：一个提交只做一件事；主题无关的改动（格式调整、lint 修复、重构）不要混入功能提交或功能 PR。
- **先小后大**：涉及行为变化时，优先小步提交、频繁验证。
- **不破坏主线**：改动后确保 `pnpm check` 全绿再推送。

## 提交流程

1. Fork 仓库并在自己的 fork 上开分支（`feat/...`、`fix/...` 命名）。
2. 完成改动并运行 `pnpm check`。
3. 向 `main` 分支发起 Pull Request，填写 PR 模板（背景 / 改动清单 / 测试 / 平台说明）。
4. 仓库开启分支保护：**main 分支禁止直接推送，PR 需至少 1 个 reviewer 批准且 CI 通过**。
5. **首次贡献者的 PR，CI 不会自动运行**，需要维护者在 PR 页面点击 "Approve and run workflows" 后才开始检查；如未运行请耐心等待或提醒维护者。

## 测试要求

- 后端逻辑改动（`src-tauri/src/`）应补充或更新 Rust 单元测试；无法用小样本覆盖的路径（如受 `MIN_RECORD_COUNT` 门槛限制的导入流程），请在 PR 描述中说明已做的真实数据验证方式。
- 前端改动至少保证 `pnpm build`（含类型检查）与 `pnpm lint` 通过。

## 发布流程（维护者）

- 版本号三处同步（`pnpm version:check` 校验），提交 `chore: release vX.Y.Z`。
- 推送形如 `vX.Y.Z` 的 tag，触发 `.github/workflows/release.yml` 自动构建并发布（需要 `TAURI_SIGNING_PRIVATE_KEY` secret）。
