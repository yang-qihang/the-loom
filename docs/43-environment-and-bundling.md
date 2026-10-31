# 43 — 环境、依赖、打包边界

> 状态：交接事实｜最后更新：2026-10-31

## 1. 用户应自己安装的

- Minecraft Java **26.1.2** 客户端（Prism / Flatpak 均可）
- 正版账号
- Java 25（Prism 自带 Microsoft runtime 可用）
- 图形驱动 / 桌面会话（Wayland + XWayland 可）

这些属于「用户自己的 Minecraft 环境」，不应由游戏安装包静默替换。

## 2. 当前桌面包已经包含的

- Studio UI（`apps/studio/dist`）
- 桌面壳、伴玩、向导、自绘标题栏
- 内置 **Mock 引擎**（不连 Minecraft）
- 字体、图标、脚本、窗口/缩放/连接灯逻辑

## 3. 真实模式需要、但当前未随包携带的

- Node 22 运行时（当前桌面壳调用系统 `node`）
- Paper 26.1.2 build 74 server jar
- LoomCraft 插件 jar
- Paper 世界/配置（`it/.mc-server`）
- Java 25（当前依赖系统/Prism Java）
- mineflayer/minecraft-protocol/pathfinder 依赖（当前在仓库 `bot/node_modules`）
- 真实引擎（仓库 `npm run dev:engine:paper`；桌面包 engine 仍是 stub）

## 4. 目标安装包（还没完成）

理想目标：

> 用户只安装正确版本的 Minecraft；游戏安装包内置 Node/Java/Paper/插件/世界/织偶运行时，双击后向导自动启动世界和真实引擎。

需要做的事：

1. 构建 Self-contained Node/engine（含 bot 依赖，或用 SEA 单文件）。
2. 打包 Java runtime（或检测 Prism Java 并明确提示）。
3. 把 Paper jar、插件 jar、世界、server.properties、eula 加入 Tauri resources。
4. 改 Rust `start_paper` / `start_engine` 从 resources 启动，而不是 repo 脚本。
5. 向导真实模式作为默认；Mock 仅作演示。
6. 在 AppImage/DEB/RPM 实测：只装 Minecraft 的干净机器上从双击到进服。

在此之前，README/向导必须明确写：**桌面包默认 Mock；真实 Paper 需外部引擎**，不能宣传成「安装即玩真实世界」。

## 5. 当前真实模式启动路径

```bash
bash scripts/mc-up.sh
PORT=4320 LOOM_WORLD=paper npm run dev:engine:paper
# 桌面向导填 http://127.0.0.1:4320
```

## 6. 打包命令

```bash
cd apps/desktop
npm run assets
npx tauri build
```

产物：
- `apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`
- `apps/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

当前包约 125MB（Mock-only），真实运行时全内置后会显著变大，构建前请评估磁盘/CI 缓存。
