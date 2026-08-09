# Sky Eye — 仿 Astrometrica 天文图像处理软件

基于 Tauri v2 (Rust + React) 的跨平台天文图像处理软件，用于小行星/彗星的搜索、测量和报告。

## 文档索引

| 文件                                                        | 内容                                 |
| ----------------------------------------------------------- | ------------------------------------ |
| [01-requirements.md](docs/01-requirements.md)               | 功能需求和非功能需求                 |
| [02-architecture.md](docs/02-architecture.md)               | 系统架构、模块划分、数据流、技术选型 |
| [03-development-plan.md](docs/03-development-plan.md)       | 开发环境搭建、核心算法说明、测试策略 |
| [04-roadmap.md](docs/04-roadmap.md)                         | 分阶段实施路线图与当前状态           |
| [05-design.md](docs/05-design.md)                           | 界面与视觉设计                       |
| [06-mvp.md](docs/06-mvp.md)                                 | MVP 边界、验收标准与交付顺序         |
| [07-technical-decisions.md](docs/07-technical-decisions.md) | 科学计算与依赖技术决策               |

## 项目名

**Sky Eye** — 天空之眼。仓库与包标识统一使用 `sky-eye`。

## 开发检查

```bash
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` 会依次执行 Prettier 格式检查、ESLint、应用版本一致性检查、前端生产构建、Rustfmt、Clippy 和 Rust 测试。需要自动修正前端格式时运行 `pnpm format`，Rust 格式化使用 `pnpm rust:fmt`。

## CI/CD

- 普通分支推送和 Pull Request 会触发 CI。
- 发布前需同步修改 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json` 中的版本号。
- 推送与版本一致的标签（例如 `v0.1.0`）会触发发布流程，构建 Windows x64、Linux x64、macOS Apple Silicon 和 macOS Intel 安装包。
- 所有平台构建成功后，工作流才会正式发布 GitHub Release。
- 发布仓库为 `MrSibe/sky-eye`；Tauri updater 会随 Release 生成已签名更新包和 `latest.json`，客户端在“设置 > 关于”中检查、下载并安装更新。
- 首次发布前，将本机 `C:\Users\MrSibe\.tauri\sky-eye.key` 的完整内容保存为仓库的 GitHub Actions Secret `TAURI_SIGNING_PRIVATE_KEY`。私钥不得提交到仓库；公钥已嵌入 `src-tauri/tauri.conf.json`。
- 当前本地私钥未设置密码。如果以后轮换为带密码的密钥，还需创建 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` Secret，并同步替换客户端公钥；已发布客户端无法使用丢失或不匹配的密钥更新。
