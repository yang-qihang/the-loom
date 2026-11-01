# 26 — 桌面封装（Tauri 2）：最终交付不让用户开浏览器

> 状态：ADR / T4 计划（Accepted；**已落地**，当前事实见 `apps/desktop/README.md`、`docs/43`）｜负责人：Lead｜最后更新：2026-11-01
> 用户要求：项目是 web-based，但**最后要封装成桌面应用（如 Tauri），不要让用户用浏览器**。
> 工具链实测（2026-10-31，本机 Fedora 44）：rustc/cargo **1.98.1**、webkit2gtk-4.1 **2.54.2**、gtk+-3.0 **3.24.52**、`@tauri-apps/cli` **2.12.4**、Electron **45.2.1** 可用。
> 上游：docs/09-execution-plan.md（T4）、docs/07-architecture.md

---

## 1. 决策

**最终交付 = Tauri 2 桌面应用**（Linux AppImage + rpm/deb）。开发期仍可用 Vite 热更新，但**发布物与演示都不用浏览器**。
**兜底 = Electron**：若 Tauri 的 WebKitGTK 渲染（尤其 Monaco）或 sidecar 打包在 2 小时内无法达标，切 Electron（同一套 React UI，主进程直接跑 Node 引擎，风险更低、体积更大）。

- 理由：Tauri 体积极小、原生窗口、无浏览器地址栏；Node/Rust 工具链已就绪；WebKitGTK 对 Monaco 的支持需实测（T3 第一个 spike）。
- 不做：Electron vs Tauri 同时维护（只保留一个最终封装；另一个只作应急）。

## 2. 进程与组件

```
Tauri 窗口 (WebView, 加载打包后的 Studio 静态资源)
  └─ Tauri Rust 主进程
       ├─ sidecar: engine（Node 运行时 + 打包后的 engine JS）
       │     ├─ HTTP/SSE 127.0.0.1:4317（只绑本地 + 随机 token）
       │     ├─ bot 管理（mineflayer，子进程/自带）
       │     └─ 调 Paper 插件 RPC（127.0.0.1:8765）
       ├─ 子进程: Paper 26.1.2 服务端（system Java 25；可选 JRE sidecar）
       ├─ 子进程: Minecraft Java 客户端（通过 Prism flatpak 启动）
       └─ 插件 jar 随 app 分发，启动时安装到 it/.mc-server/plugins
```

- **不内嵌 MC 客户端**（Minecraft 无法嵌进 webview）；app 负责**拉起/检测/复位**它，并把 Studio 与 MC 两个窗口并排。
- **engine 打包**：esbuild 把 `apps/engine/src/server.ts` 及依赖打成单文件 CJS；sidecar = 随包附带的 Node 22 二进制 + 该 JS（课程项目可接受 ~100MB）；后续可换 Node SEA/Bun 单文件。
- **Paper/Java**：优先用系统 Java 25（`java -version` 检测）；缺失时提示安装或切换 bundled JRE（T4 有余力再做）。
- **Prism 启动**：`flatpak run org.prismlauncher.PrismLauncher --launch <instance-id>`；若失败，app 显示「请手动打开 Prism 并进入 26.1.2 实例」，并继续等待连接。

## 3. 生命周期

1. App 启动 → 单实例锁 → 建本地 token/端口 → 起 engine sidecar → 健康检查（`/api/health`）。
2. 检查 Java 25 / Paper jar / 插件 jar → 缺失则下载（Fill API + sha256）或提示。
3. 起 Paper（离线模式、锁定 26.1.2、doMobSpawning=false）→ 等 `Done` + RPC 8765。
4. 检测 MC 客户端是否已连接（bot/事件）→ 未连接则尝试拉起 Prism；UI 显示「等待世界」。
5. 关卡选择 → 建会话 → 运行 → 评分；窗口内完成全部操作，**无需浏览器**。
6. 退出：停 engine、停 Paper、清理 bot/端口；日志写 `~/.loomcraft/logs/`；异常退出也要清理（drop guard）。
7. 「重置全部」按钮：停服 → 重装插件 → 重建世界 → 重新起服（用于演示前复位）。

## 4. 安全与体验

- WebView 只加载 `tauri://localhost` 打包资源；**禁止**任意导航、外部 URL、`window.open`；CSP 收紧。
- engine/插件只绑 127.0.0.1，启动时随机 token；Studio 通过注入的 token 访问，避免本机其他程序乱调。
- Tauri capabilities 只开 shell/process 所需最小范围；sidecar 路径写死，不接受用户输入命令。
- 首启向导：①检测 Java ②检测 Prism/客户端 ③检测网络（仅下载 Paper）④测试世界；每步中文说明 + 「重试」。
- 所有界面文案走 docs/20 §3b 纯中文；不使用浏览器式「标签页/地址栏」。

## 4b. 「总在最前」与伴玩模式（用户要求）

玩家在 MC 全屏/最大化时仍要能操作我们的窗口，因此桌面壳必须提供：

1. **「置顶」开关**（标题栏一个按钮 + 设置项）：调用 Tauri `alwaysOnTop`；默认关闭，用户手动开启；**记住上次选择**。
2. **全局快捷键**：`Ctrl+Shift+L` 切换置顶（Tauri global-shortcut 插件；MC 有焦点时也生效），并在应用内显示提示。
3. **伴玩模式（紧凑布局）**：窗口切到约 420×620，只保留「本关目标 / 艾拉一句 / 运行·停止·重置 / 世界日志」；代码编辑仍在完整工作台。一个「展开/收起」按钮切换，置顶时可自动建议切到伴玩模式。
4. **与 MC 全屏共存**：独占全屏（exclusive fullscreen）可能盖住所有窗口；启动向导与设置里明确建议 **MC 用「无边框窗口/窗口化全屏」**，并在检测到 MC 全屏时提示（T3 可做，无法做则文档说明）。
5. **多显示器/缩放**：置顶窗口在 100%/125%/150% 缩放下不溢出；窗口位置记住，但不强行跨屏。
6. **退出行为**：关闭伴玩模式不影响 MC；关闭 App 时询问「同时关闭世界服务端？」（默认不关，避免误停）。

**验收**：
- [ ] 置顶开启后，MC 最大化（或窗口化全屏）时该窗口仍可点击/输入；
- [ ] `Ctrl+Shift+L` 在 MC 有焦点时能切换置顶；
- [ ] 重启 App 记住置顶状态与窗口位置；
- [ ] 伴玩模式可一键切回完整工作台；
- [ ] 置顶按钮/快捷键的文案纯中文（「置顶」「取消置顶」「伴玩」），并在 X11 与 Wayland 各测一次（Wayland 若被合成器拒绝，记录并给 X11/无边框窗口兜底）。

## 5. 构建与产物（T4）

```bash
# 前置（Fedora 44）：Tauri v2 系统依赖
sudo dnf install -y webkit2gtk4.1-devel gtk3-devel librsvg2-devel openssl-devel
npm install -g @tauri-apps/cli@2.12.4   # 或项目内 devDependency

# 1) 构建 Studio 静态资源（相对路径，供 WebView 加载）
npm --prefix apps/studio run build
# 2) 构建 engine 单文件
npx esbuild apps/engine/src/server.ts --bundle --platform=node --format=cjs --outfile=apps/desktop/runtime/engine.cjs
# 3) 构建桌面应用
cd apps/desktop && npm run tauri build
# 产物：target/release/bundle/{appimage,rpm,deb}
```

- `apps/desktop/`（Tauri 壳）在 T3 创建；只放 Rust 配置、窗口、sidecar 启动、错误页；UI 代码继续在 `apps/studio/`。
- 版本号/图标/窗口标题：`织界`；主题色与 docs/19 一致；启动画面用织机纹样（不是纯白）。
- 安装包不需要签名（课程内部演示），但必须能在一台干净 Fedora 上双击启动。

## 6. 验收（不允许「用浏览器凑合」）

- [ ] 干净 Fedora 上安装 rpm/AppImage，双击启动，**没有浏览器窗口/地址栏**；
- [ ] 首启向导能检测 Java/Prism/Paper，并给出中文可操作提示；
- [ ] 从 App 内完成：选关 → 运行参考解 → 玩家节拍 → 3 星 → 重置；MC 客户端窗口由 App 拉起/等待；
- [ ] 退出 App 后无残留 engine/Paper/bot 进程；再次启动可恢复；
- [ ] 截图：App 主窗口 + MC 窗口并排（演示形态）；
- [ ] 若 WebKitGTK 下 Monaco 出现渲染/输入问题：切 Electron（同一 UI），并在报告写明取舍。

## 7. 风险与兜底

| 风险 | 处理 |
|---|---|
| WebKitGTK 对 Monaco/SSE 兼容问题 | T3 第一个 spike 实测；不达标 → Electron（1 天内可切，UI 不变） |
| sidecar Node 体积/路径 | 课程项目接受；用固定路径 + 启动校验；后续换单文件运行时 |
| Java/Paper/Prism 路径因机器而异 | 首启向导 + 环境变量覆盖（`LOOM_JAVA`/`LOOM_PRISM`）+ 中文错误页 |
| 打包签名/分发 | 课程内部分发，不做签名；报告注明 |
| 演示机无 GPU/WebKit 加速 | 关闭 WebView 硬件加速（Tauri 配置可加）或 Electron 兜底 |

## 8. 与其它文档

- 计划：`docs/09` T4 增加「桌面封装」轨道；T3 做 Tauri spike。
- 演示：`docs/10` 的「Studio 窗口」改成「App 窗口」；不再出现浏览器。
- UI：`apps/studio` 需保证资源路径相对（`vite base: './'`）且不依赖 `window.location.origin`。
- 命令：`npm run dev:studio` 仅开发用；发布走 `apps/desktop`。

## 9. 落地结果（2026-11-01）

- Tauri 2 AppImage + RPM 已产出（2026-11-01 重打包 AppImage ≈400MB / RPM ≈417MB），无浏览器、自绘标题栏、伴玩/置顶/Alt+Z 焦点切换均有实现。
- 安装包已内置 Node 22 / Java 25 / Paper 26.1.2 / 插件 / 干净世界 / 真实引擎 / mineflayer 织偶；用户只需装 Minecraft 26.1.2。
- 世界布局版本 marker 迁移：旧可写世界自动替换为包内干净世界（见 `apps/desktop/README.md`）。
- 构建入口统一为 `bash scripts/package-desktop.sh`。
