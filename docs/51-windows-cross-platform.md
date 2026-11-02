# Windows 开发与桌面打包（跨平台说明）

织界的主目标仍是 Linux 原生桌面包；Windows 分支保证**同一套源码可以开发、验证桌面 release**，行为和 Linux 尽量一致。

## 1. 前置依赖（Windows）

- Windows 10/11 x64
- Node.js 22（仓库内可用 `.tools/node-*`）
- JDK 25（`.tools/jdk25/...`；Tauri release 的 Paper 由包内 JDK 启动）
- Rust stable + `x86_64-pc-windows-msvc`
- Visual Studio 2022 Build Tools（MSVC + Windows SDK）
- WebView2 Runtime（Windows 11 自带）
- Paper server 目录：`it/.mc-server`（含 `paper.jar`、插件、世界）
- `bot/node_modules` 已安装

## 2. 快速开始

```powershell
npm install
npm --prefix apps/studio install
npm --prefix apps/desktop install

# 浏览器 Studio（mock 世界）
npm run dev:studio

# 仅准备 Tauri 前端资源（dist + runtime stub）
npm run desktop:assets
```

## 3. 桌面 release

```powershell
# 1) 组装包内真实 runtime：Node + Java + Paper + 插件 + 世界 + 真实引擎 + 织偶
npm run desktop:runtime:win

# 2) 构建 Studio + Tauri release + Windows NSIS 安装包
npm run desktop:package:win

# 只验证 release exe，不生成安装包
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-desktop.ps1 -SkipRuntime -NoBundle
```

产物：

```text
apps/desktop/src-tauri/target/release/loomcraft-desktop.exe
apps/desktop/src-tauri/target/release/bundle/nsis/Loomcraft_0.1.0_x64-setup.exe
apps/desktop/src-tauri/runtime/real/
```

`runtime/real` 布局与 Linux 一致，仅可执行文件后缀不同：

```text
runtime/real/
  engine.mjs
  bot/manager.mjs
  bot/node_modules/
  node/bin/node.exe
  node_modules/{esbuild,typescript,@esbuild/...}
  java/bin/java.exe
  paper/paper.jar
  paper/plugins/loomcraft-plugin.jar
  paper/world/
  studio/
```

## 4. 质量门禁

Linux 入口仍是：

```bash
bash scripts/verify.sh
```

Windows 入口：

```powershell
npm run verify:win
# 或
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify.ps1 -Layers "l0,l1,l2,l3"
```

已覆盖：

- l0 typecheck + 纯中文文案告警 + guard-tests
- l1 packages 单测
- l2 spec/contract
- l3 content acceptance

Windows 和 Linux 共用同一套 Vitest / tsx / zod / `yaml` 依赖；`qa/spec-check.mjs` 不再依赖 `python3 + PyYAML`。

## 5. 平台差异

| 能力 | Linux | Windows |
|---|---|---|
| Tauri 窗口/Studio/伴玩 | ✅ | ✅ |
| 包内真实 Paper + engine + bot | ✅ | ✅ |
| AppImage / RPM | ✅ | —（Windows 产物是 NSIS `.exe`） |
| 自动焦点跟随 | 不做（docs/45 决策：全屏游戏下不可靠） | 不做；仅 Alt+Z 显式切换，Win32 `SetForegroundWindow` + Escape 释放鼠标 |
| Alt+Z 全局快捷键 | ✅ | ✅（Tauri global-shortcut） |
| Prism 检测/启动 | flatpak / PATH | 常见安装路径 / `prismlauncher.exe` |
| `G-DESKTOP` / `G-TOP` 证据 | Linux 桌面壳 smoke | `qa/desktop-smoke-win.mjs` 的 G-DESKTOP-WIN / G-TOP-WIN；Linux-only G-DESKTOP/G-TOP 在 Windows 显式 blocked |

> 平台声明：Windows 没有 Wayland/X11 会话；Windows 使用 Win32 前台锁（`SetForegroundWindow`/`AttachThreadInput`），独占全屏（exclusive fullscreen）下任何外部窗口/焦点切换都可能被系统阻止，因此自动焦点跟随按 docs/45 禁用，只保留 Alt+Z 显式切换。Wayland: N/A。

## 6. 注意事项

- `runtime/real` 约 1.1 GB，NSIS 安装包约 350 MB，首次构建会下载 NSIS 工具（Tauri 自动处理）。
- 打包前请关闭正在运行的织界/Paper/engine，否则 Windows 文件锁会导致复制失败。
- 不要提交 `runtime/real`、`target/`、`tmp/`；这些是构建产物（`.gitignore` 已覆盖）。
- Windows 下的 `desktop:assets` 如果重新生成 `icons/*.png`，属于本地构建噪音；提交前只保留必要的 `icons/icon.ico`。
