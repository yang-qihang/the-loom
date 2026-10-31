# 43 — 环境、依赖、打包边界

> 状态：交接事实｜最后更新：2026-10-31

## 1. 用户应自己安装的

- Minecraft Java **26.1.2** 客户端（Prism / Flatpak 均可）
- 正版账号
- Java 25（Prism 自带 Microsoft runtime 可用）
- 图形驱动 / 桌面会话（Wayland + XWayland 可）

这些属于「用户自己的 Minecraft 环境」，不应由游戏安装包静默替换。

## 2. 最新桌面包已经内置的

- Studio UI、桌面壳、伴玩、向导、自绘标题栏
- **Node 22 运行时 + 所需共享库**
- **Java 25 运行时**（从本机 Prism Microsoft runtime 打包）
- **Paper 26.1.2 build 74**（含 libraries/cache/versions/world/plugins/配置）
- 真实引擎 bundle（`runtime/real/engine.mjs`）
- **mineflayer / minecraft-protocol / pathfinder** 与 `bot/manager.mjs`
- Mock 演示引擎、字体、图标、窗口/缩放/连接灯逻辑

## 3. 用户只需要

- Minecraft Java **26.1.2**（Prism/Flatpak 均可）
- 能登录的 Minecraft 账号
- 正常桌面/显卡驱动

## 4. 当前实现方式

- App 启动时自动从 Tauri resources 启动内置 Java + Paper；
- 等 Paper 的 25565 与插件 RPC 8765 就绪后，启动内置 Node + 真实引擎；
- 真实引擎在 4317 提供 Studio 使用的 HTTP API；
- 织偶用包内 mineflayer 连接 Paper；
- 向导里仍可选「真实织机地址」连接外部引擎（高级用途），默认不需要。

## 5. 构建自包含运行时

```bash
bash scripts/build-real-runtime.sh
cd apps/desktop
npm run assets
npx tauri build
```

`build-real-runtime.sh` 需要构建机提供 Node 22、Java 25（默认读 Prism runtime，可用 `LOOM_JAVA_HOME` 覆盖）和可用的 Paper server；这些只在构建时使用，不进用户路线。

> 注：AppImage 打包在本机曾遇到 linuxdeploy 图标/体积问题；RPM 可直接生成。可用 AppDir + `linuxdeploy-plugin-appimage.AppImage` 手动补图打包。

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

当前自包含安装包：AppImage 356MB / RPM 382MB；构建时约 1GB 运行时资源，构建前请评估磁盘/CI 缓存。
