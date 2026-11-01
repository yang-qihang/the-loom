# 43 — 环境、依赖、打包边界

> 状态：交接事实（当前安装包已内置真实运行时；2026-11-01 Round 2 补字体/截图素材）｜负责人：Lead｜最后更新：2026-11-01｜上游：`README.md`、`apps/desktop/README.md`、`docs/46-playtest-fix-plan.md`、`docs/48-round2-guidance-api-visual-plan.md`

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
- Mock 演示引擎、图标、窗口/缩放/连接灯逻辑
- **嵌包字体**：代码编辑器 Maple Mono（含中文回退，OFL 许可随包）；UI 保留 Zpix/Departure Mono 中文像素字体；全部随包，不依赖系统字体
- **关卡截图素材**（`apps/studio/public/world/*.png` 玩家出生视角；`report/evidence/*.png` 报告配图；成品尺寸/文件以最终提交素材为准）

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
- **世界布局版本迁移**：包内 `paper/world/.loom-world-version` 与可写目录 marker 不一致时，启动时自动用包内干净世界替换 `~/.loomcraft/runtime/paper/world`（旧关卡残留会污染 sandbox；关卡进度/星级存于 Studio，不存于世界，不受影响）。

## 5. 构建自包含运行时

```bash
bash scripts/build-real-runtime.sh
cd apps/desktop
npm run assets
npx tauri build
```

`build-real-runtime.sh` 需要构建机提供 Node 22、Java 25（默认读 Prism runtime，可用 `LOOM_JAVA_HOME` 覆盖）和可用的 Paper server；这些只在构建时使用，不进用户路线。

> 注：AppImage 打包在本机曾遇到 linuxdeploy 图标/体积问题；RPM 可直接生成。可用 AppDir + `linuxdeploy-plugin-appimage.AppImage` 手动补图打包。

## 6. 当前真实模式启动路径（源码开发）

```bash
bash scripts/mc-up.sh
PORT=4320 npm run dev:engine:paper   # 脚本内部会设 LOOM_WORLD=paper
# 桌面向导填 http://127.0.0.1:4320
```

## 7. 打包命令

```bash
# 一键入口（推荐）：插件 → 真实引擎 → Studio → 自包含 runtime → AppImage/RPM
bash scripts/package-desktop.sh

# 或分步：
bash scripts/build-real-runtime.sh
npm run desktop:assets
npm run desktop:build
```

产物：
- `apps/desktop/src-tauri/target/release/bundle/appimage/*.AppImage`
- `apps/desktop/src-tauri/target/release/bundle/rpm/*.rpm`

当前自包含安装包（2026-11-01 Round 2 重打包）：AppImage ≈429MB / RPM ≈436MB；构建期 `apps/desktop/src-tauri/runtime/real/` 约 1GB，不入 Git，构建前请评估磁盘/CI 缓存。

## 8. Round 2 素材与编辑器集成（2026-11-01）

### 8.1 字体

- 代码编辑器使用嵌包 **Maple Mono CN**（开启 ligature）；编辑器右键菜单/补全/悬停/查找用清晰普通字体，不用像素字。
- Studio 其余 UI 保留上一版中文像素字体（Zpix）+ Departure Mono 栈；不把正文/标题改成 Maple Mono。
- 字体文件与 OFL 许可随 Studio 静态资源（`apps/studio/public/fonts/`）打包，桌面 App 与浏览器吃同一份文件，不依赖系统 fallback。
- 验收方式（实现侧）：`document.fonts.check("16px \"Maple Mono\"")` 为 true、`.monaco-editor .view-lines` 的 computed font-family 含 Maple Mono；截图人工核对 0/O、1/l/I 不混淆。

### 8.2 截图素材

- 关卡截图按**玩家出生视角**（playerSpawn 第一人称）重新拍摄，用于 Studio 关卡页与报告页；同时作为「每关起始点是否合理」的验收证据（是否卡墙/贴脸 NPC/看墙/掉虚空/看不到目标）。
- Studio 用 `apps/studio/public/world/L0X.png`（L01–L10）；报告用 `report/evidence/` 下的同名素材。替换时保持 16:9 与一致裁切，避免新旧混用。
- 具体分辨率、文件清单和最终包体积由 Lead 在素材定稿后确认，文档不预填未验证数字（docs/48 §1.8 只写目标：高清、≥1920×1080）。

### 8.3 打包

- 字体与截图属于 Studio 静态资源，随 `apps/studio` 构建进入 `dist`，再由 `npm run desktop:assets` 复制进桌面包；不需要额外运行时依赖。
- 重新打包仍走 `bash scripts/package-desktop.sh`（插件 → 真实引擎 → Studio → 自包含 runtime → AppImage/RPM）。
