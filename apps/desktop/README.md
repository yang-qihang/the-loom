# apps/desktop — 织界桌面应用（Tauri 2）

Windows/macOS/Linux 桌面壳：**不开浏览器**，窗口内加载 Studio 构建产物，并负责 engine sidecar、Paper 世界、
Minecraft 客户端（Prism）与窗口/设置生命周期。业务逻辑在 `apps/studio` 与 `apps/engine`，本目录只做壳。

## 运行与构建

```bash
# 1) 准备前端资源 + 打包 engine 单文件（会自动构建 apps/studio，vite base './'）
npm run desktop:assets

# 2) 开发模式（tauri dev，热更新）
npm run desktop:dev

# 3) 生产构建（rpm + AppImage）
npm run desktop:build
# 产物：
#   apps/desktop/src-tauri/target/release/bundle/rpm/Loomcraft-0.1.0-1.x86_64.rpm
#   apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage
#   apps/desktop/src-tauri/target/release/loomcraft-desktop   # 直接运行

# 4) 直接运行已构建二进制
npm run desktop:run
```

环境变量（联调/测试用）：
- `LOOM_REPO_ROOT`：仓库根（找 `scripts/mc-up.sh` 与 `apps/desktop/src-tauri/runtime/`）
- `LOOM_ENGINE_PORT`：覆盖引擎端口（默认 4317）
- `LOOM_PRISM`：覆盖 Prism 启动命令
- `GDK_BACKEND=x11|wayland`：选择测试的窗口系统后端

## 结构

```
apps/desktop/
├── shell/                 # 壳页面：index.html（标题栏 + iframe）、wizard.html（首启向导）、companion.html（伴玩）
├── scripts/build-assets.mjs  # studio 构建 + 前端复制 + engine.cjs 打包 + 图标生成 + 引擎冒烟测试
├── dist/                  # 生成：壳页面 + studio/
├── src-tauri/
│   ├── src/main.rs        # Tauri 2：窗口/设置/快捷键/子进程生命周期
│   ├── tauri.conf.json    # 窗口、bundle（rpm/appimage）、resources
│   ├── capabilities/      # 最小权限（core:default）
│   ├── runtime/           # 生成：engine.cjs（CJS 启动器）+ engine.mjs
│   └── icons/             # 生成：暖色织纹 PNG
└── evidence/              # 截图证据
```

## 功能（T3 spike 范围）

- **无地址栏**：窗口标题「织界」，内容为壳页面 + `studio/index.html`（相对资源路径）。
- **首启向导**（中文）：检测 Java 25 / Node / Prism / Paper / 引擎，给可操作提示与「重新检测」。
- **引擎 sidecar**：自动用 `node runtime/engine.cjs` 起 127.0.0.1:4317；退出时清理子进程；日志 `~/.loomcraft/logs/`。
- **世界与客户端**：`启动世界` 调 `scripts/mc-up.sh`；`启动 Minecraft` 走 Prism（flatpak 默认，可配置）。
- **置顶**：标题栏「置顶/取消置顶」按钮 + 设置项；**全局快捷键 Ctrl+Shift+L**（MC 有焦点时也生效）。
- **伴玩模式**：窗口 420×620 小窗（标题栏收紧），只留目标/艾拉一句/运行·停止·重置/世界日志，可一键回工作台。
- **设置持久化**：`~/.loomcraft/settings.json`（置顶、模式、页面、窗口位置尺寸、Prism 命令）。
- **单实例**：第二次启动检测到已有实例会退出（`~/.loomcraft/desktop.lock`）。
- **首启说明**：向导中提示把 MC 设为无边框窗口或窗口化全屏（F11）并排伴玩。

## 世界端口（当前状态）

桌面 App 当前只内置 **Mock 世界**（`LOOM_WORLD=mock`）：`build-assets.mjs` 用 stub 顶替 Paper 适配器与织偶 bot，
避免把 mineflayer/minecraft-protocol 打进桌面包（engine.mjs 约 1 MB）。真实 Paper 联调由 task-49 用仓库内
`npm run dev:engine:paper` 另行验证；桌面版在 `LOOM_WORLD=paper` 下会给出中文提示引导到该命令。

## T4 待办（本 spike 有意不做）

- 打包 Node 运行时（当前依赖系统 `node`）与 Paper/插件资源。
- 自定义无边框标题栏（当前用系统窗口装饰 + 应用内工具条）。
- engine 随机 token 与 Studio 注入、CSP 收紧、安装包签名。
- Wayland 下全局快捷键的 portal 适配（X11 已实测；见 EVIDENCE 风险）。
