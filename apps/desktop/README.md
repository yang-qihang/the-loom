# apps/desktop — 织界桌面应用（Tauri 2）

Windows/macOS/Linux 桌面壳：**不开浏览器**，窗口内加载 Studio 构建产物，并负责内置 Paper/真实引擎 sidecar、
Minecraft 客户端（Prism）与窗口/设置生命周期。业务逻辑在 `apps/studio` 与 `apps/engine`，本目录只做壳。

> 状态：已交付（自包含真实运行时）｜最后更新：2026-11-01
> 当前安装包已内置 Node 22 / Java 25 / Paper 26.1.2 / 插件 / 干净世界 / 真实引擎 / mineflayer 织偶：
> 用户只需安装 Minecraft 26.1.2 并连 `localhost:25565`。边界见 `docs/43-environment-and-bundling.md`。

## 构建与运行

```bash
# 一键打包（推荐唯一入口）：插件 jar → 真实引擎 → Studio → 自包含 runtime → AppImage/RPM
bash scripts/package-desktop.sh

# 或分步：
npm run desktop:assets     # 构建 Studio + 壳页面 + engine.cjs 冒烟测试
npm run desktop:dev        # tauri dev（热更新）
npm run desktop:build      # tauri build（rpm + AppImage）
npm run desktop:run        # 运行已构建二进制
```

产物：

```text
apps/desktop/src-tauri/target/release/bundle/rpm/Loomcraft-0.1.0-1.x86_64.rpm
apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage
apps/desktop/src-tauri/target/release/loomcraft-desktop
```

体积（2026-11-01 重打包，供参考）：AppImage ≈400MB / RPM ≈417MB；构建期 `src-tauri/runtime/real` 约 1GB，不入 Git。

## 自包含运行时与启动顺序

1. `src-tauri/runtime/real/`：`node/`、`java/`、`paper/`（含 `paper.jar`、插件、干净 world/config）、`engine.mjs`。
2. App 启动 → 从可写目录 `~/.loomcraft/runtime/` 复制/复用 Paper → 起 Java，等 25565 + 插件 RPC 8765。
3. 起内置 Node + 真实引擎，4317 对 Studio 提供 HTTP API；织偶用包内 mineflayer 连 Paper。
4. **世界布局版本迁移**：包内 `paper/world/.loom-world-version` 与可写世界 marker 不一致时，自动用包内干净世界替换
   `~/.loomcraft/runtime/paper/world`（旧关卡残留会污染 sandbox；关卡进度/星级存于 Studio，不存于世界，不受影响）。

环境变量（联调/测试用）：
- `LOOM_REPO_ROOT`：仓库根（找 `scripts/mc-up.sh` 与 `apps/desktop/src-tauri/runtime/`）
- `LOOM_ENGINE_PORT`：覆盖引擎端口（默认 4317）
- `LOOM_PRISM`：覆盖 Prism 启动命令
- `GDK_BACKEND=x11|wayland`：选择测试的窗口系统后端

## 结构

```
apps/desktop/
├── shell/                    # 壳页面：index.html（标题栏 + iframe）、wizard.html、companion.html
├── scripts/build-assets.mjs  # studio 构建 + 前端复制 + engine.cjs 打包 + 图标 + 冒烟
├── dist/                     # 生成：壳页面 + studio/
├── src-tauri/
│   ├── src/main.rs           # 窗口/设置/快捷键/子进程生命周期/世界版本迁移
│   ├── tauri.conf.json       # 窗口、bundle、resources
│   ├── capabilities/         # 最小权限
│   ├── runtime/              # 生成：engine.cjs/engine.mjs；real/ = 内置 Node/Java/Paper/引擎
│   └── icons/
└── evidence/                 # 截图证据
```

## 功能

- **无地址栏**：窗口标题「织界」，内容为壳页面 + `studio/index.html`（相对资源路径）。
- **首启向导**（中文）：检测 Java / Node / Prism / Paper / 引擎，给可操作提示与「重新检测」。
- **引擎 sidecar**：优先内置真实引擎；退出时清理子进程；日志 `~/.loomcraft/logs/`。
- **世界与客户端**：`启动世界` 起内置 Paper；`启动 Minecraft` 走 Prism（flatpak 默认，可配置）。
- **置顶**：标题栏「置顶/取消置顶」+ 设置项；全局快捷键 **Ctrl+Shift+L**。
- **Alt+Z 焦点切换**：织界 ↔ Minecraft 双向切换（Minecraft 聚焦时先发 Escape 释放鼠标）；KWin 有备用脚本。
- **伴玩模式**：420×620 小窗，只留目标/艾拉一句/运行·停止·重置/世界日志；返回工作台先恢复窗口尺寸。
- **设置持久化**：`~/.loomcraft/settings.json`；**单实例**：`~/.loomcraft/desktop.lock`。
- 桌面默认 WebView 缩放 80%；Minecraft 客户端 baseline 设 `pauseOnLostFocus:false`（见 `docs/37`）。

## 已知边界

- AppImage 打包依赖构建机 linuxdeploy 图标工具；RPM 可直接产出（见 `scripts/package-desktop.sh`）。
- Wayland 下全局快捷键走 X11 兼容路径（去掉 `WAYLAND_DISPLAY` 以避免 portal 授权框）；跨桌面环境的焦点行为仍需实机验证。
- 真实客户端截图未全部重拍（`docs/34`）；肉眼审美验收仍以固定机位截图为准。
- 桌面壳测试只能跑在隔离 Xvfb（`:98`），禁止 `:0`（`scripts/isolated-x.sh` 会拒绝）。
