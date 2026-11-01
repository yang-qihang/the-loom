# task-31 证据 — Tauri 2 桌面封装 spike（2026-10-31）

> 历史证据（T3/T4，2026-10-31）：文中「Mock-only / 未收进安装包」是当时状态；**2026-11-01 起安装包已内置真实运行时**（Node 22 / Java 25 / Paper 26.1.2 / 插件 / 干净世界 / 真实引擎 / 织偶），当前事实见 `apps/desktop/README.md` 与 `docs/43-environment-and-bundling.md`。

> 负责人：scout-language｜环境：Fedora 44 / Rust 1.98.1 / WebKitGTK 2.54.2 / Tauri 2.12.5 / Node 22.23.1
> 用户不测试；以下均为自动化 + 截图证据。
> 最后更新：2026-10-31T09:32Z（task-65 最终：无系统窗框 + 自绘像素标题栏 + 原生行为收口 + 字号控件；见 §9；桌面 engine 当前 **Mock-only**）。

## 1. 构建命令与产物

```bash
npm run desktop:assets     # studio（vite base './'）+ engine 单文件 + 图标 + 引擎冒烟测试
npm run desktop:build      # tauri build --bundles rpm,appimage
```

| 产物 | 路径 | 大小 | sha256 |
|---|---|---|---|
| rpm | `apps/desktop/src-tauri/target/release/bundle/rpm/Loomcraft-0.1.0-1.x86_64.rpm` | 23.15 MiB（24,276,777 B） | `6f4dee5c674c974b03fd479f8b8e468993bdc7c8eb19a6be43f43642d03071c0` |
| AppImage | `apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage` | 124.20 MiB（130,230,776 B） | `2bf0ff995098c8f9e200d0d7c6bde6ad070ae1e162262efd9e6bda7038a1db89` |
| 裸二进制 | `apps/desktop/src-tauri/target/release/loomcraft-desktop` | — | — |

> 上表为 **task-65 最终重打包（2026-10-31T09:32Z，含并发合入的 pointerdown 拖动兜底与系统页）** 的最新产物；旧包已被覆盖。

rpm 元数据（`rpm -qpi/-qlp`）：Name=loomcraft、Version=0.1.0、/usr/bin/loomcraft-desktop、
/usr/lib/Loomcraft/runtime/{engine.cjs,engine.mjs,node_modules/*}、.desktop 与 hicolor 图标（32/128/256/512）。
AppImage 内置 AppRun/linuxdeploy 打包（tauri CLI 自动下载并校验）。

## 2. 截图（`apps/desktop/evidence/`）

| 文件 | 说明 |
|---|---|
| `xvfb-wizard.png` | 首启向导（Xvfb/X11）：Java 25 / Node / Prism / Paper / 引擎 四项中文检测全绿 |
| `xvfb-workbench.png` | 地图墙：Studio（React）在 Tauri WebView 内渲染，无地址栏/标签页 |
| `xvfb-editor-monaco.png` | L01 工作台：Monaco 编辑器在 WebKitGTK 内正常渲染，目标/教练/世界日志齐全 |
| `xvfb-editor-run.png` | 在编辑器内「运行」starter：SSE 结果 1/3 星 + 世界日志（WebKitGTK SSE 正常） |
| `xvfb-companion.png` | 伴玩模式：420×620 小窗，只留目标/艾拉一句/运行·停止·重置/世界日志 |
| `xvfb-companion-run.png` | 伴玩模式内运行：SSE 日志与结果在 420 宽窗口内正常 |
| `appimage-companion.png` | 最终 AppImage 启动截图（复用已保存的伴玩设置） |
| `wayland-workbench.png` / `wayland-window.png` | Plasma **原生 Wayland** 窗口截图（2560×1600 截图裁切）；原生窗口标题「织界」，无浏览器 chrome |

另：`xvfb-wizard/workbench/editor/companion` 均由 Xvfb（:99，1600×1000，X11）启动 app 后 `import` 抓窗口；
Wayland 用 `spectacle` 抓屏。`xvfb-restart-companion.png` 记录重启后恢复伴玩尺寸的界面。

## 3. 生命周期与窗口能力（实测）

- **引擎 sidecar**：启动后自动 `node runtime/engine.cjs` 起 127.0.0.1:4317（测试用 `LOOM_ENGINE_PORT=4321/4325`），
  日志 `~/.loomcraft/logs/engine.log`；AppImage 内 `LOOM_ENGINE_PORT=4325` 实测 `/api/health` 可达。
- **退出清理**：向窗口发 `WM_DELETE_WINDOW` → 生命周期日志 `停止子进程 engine（pid 351821）`，端口关闭，锁文件删除；
  `SIGTERM` 强杀不做清理（系统级 kill，T4 可加信号处理）。
- **单实例**：第二个实例立即 `exit 0` 并打印「已有实例在运行（pid …），本实例退出」；锁 `~/.loomcraft/desktop.lock`。
- **置顶**：标题栏「置顶/取消置顶」按钮；全局快捷键 **Ctrl+Shift+L**（X11 下发 XTEST 实测）→ `window.log` 记录
  `置顶 = true/false`，`settings.json.alwaysOnTop` 同步。
- **伴玩模式**：一键切 420×620（`WINDOW 420x620`），标题栏收紧；可回工作台（1280×840）。
- **持久化**：`~/.loomcraft/settings.json` 保存 `alwaysOnTop/mode/page/window{python…}/prismCommand`；
  重启后窗口以伴玩 420×620 打开、置顶状态保留（截图 `xvfb-restart-companion.png` + settings.json）。
- **首启向导**：Java 25（openjdk 25.0.4.1）✓、Node 22.23.1 ✓、Prism flatpak ✓、Paper 世界 25565 已在运行 ✓；
  缺失项给中文可操作提示与「重新检测」；含 MC「无边框窗口或 F11 窗口化全屏」中文说明。
- **纯中文**：窗口标题「织界」；壳标题栏只留「织界」（已移除英文 THE LOOM）；向导/伴玩/设置全中文
  （Java/Minecraft/Prism/Paper 为产品名，保留原名）。产物包名因 rpm/AppImage 命名限制使用 ASCII `Loomcraft`。

## 4. WebKitGTK 兼容结论（Monaco/SSE）

- Monaco 编辑器在 WebKitGTK 2.54.2 内正常渲染、可编辑（截图）；React Studio 地图墙/工作台/目标面板正常。
- SSE（`/api/events`）在 WebView 内正常：starter 运行后 UI 收到 state/log/objective/result 并显示 1/3 星。
- 结论：**Tauri/WebKitGTK 路线可用，不触发 Electron 兜底**。已知限制：Monaco 大 chunk 首次加载约 3–5s；
  WebKitGTK 无 GPU 时粒子/动画帧率未测（Xvfb 下不可评估审美）。

## 5. 剩余风险（T4）

1. **Wayland 全局快捷键**：X11 已实测；Wayland 下全局热键依赖合成器/portal，本次无输入注入工具，未自动化验证（手动注册成功日志在 `~/.loomcraft/logs/shortcut.log`）。
2. engine 打包依赖系统 `node`；且为解析 esbuild/typescript，runtime 内复制了约 47MB node_modules（AppImage 119MB、rpm 18MB）——T4 可改 SEA/Bun 或精简 runner。
3. 当前标题栏使用系统窗口装饰 + 应用内工具条；无边框自定义标题栏留给 T4。
4. engine/插件未加随机 token；CSP 为 null（WebView 仅本地资源）。打包签名未做（课程内部分发，docs/26 允许）。
5. rpm 仅验证文件内容与 AppImage 运行；未在干净 Fedora 上做 `dnf install` 安装测试（无 sudo；T4 演示机做一次）。

## 6. T4 重打包与 smoke（Studio v3.1，task-54，2026-10-31T06:14–06:21Z）

构建流程：`node apps/desktop/scripts/build-assets.mjs`（Studio `vite build --base ./` → `dist/studio` → engine bundle/图标/引擎冒烟）
→ `tauri build --bundles rpm,appimage`。磁盘产物与 sha256 见 §1（AppImage 120.39 MiB / rpm 18.34 MiB）。

**Studio v3.1 新截图（`apps/desktop/evidence/`）**：

| 文件 | 说明 |
|---|---|
| `wizard-v31.png` | 首启向导（v3.1 文案：运行环境/织机运行时/《我的世界》客户端/世界服务端） |
| `mapwall-v31.png` | 关卡墙：三幕 L01–L10，右上「打开旅途手记」/「织机在线」 |
| `prologue-v31.png` | 序章·断线之夜（旅记「回看序章」入口） |
| `repl-v31.png` | 试符台：执行 `golem.pos` 后对话显示 `[0,65,0]`（真实引擎返回） |
| `codex-v31.png` | 织典：17 页目录 + 详情 + 跨语言 tab（TypeScript/Python/C/Haskell/JavaScript） |
| `journal-v31.png` | 旅途手记：世界/我是谁/名词表/上一关/回看序章 |
| `companion-v31.png` | 伴玩 420×620（工作台/取消置顶/设置，目标+艾拉一句+运行·停止·重置+世界日志） |

**Xvfb smoke（:99，1600×1000，X11）**：
- 无浏览器地址栏/标签页；窗口标题「织界」；页内品牌只留「织界」。
- 置顶：「置顶」→「取消置顶」切换有效；`Ctrl+Shift+L` 全局快捷键生效（`~/.loomcraft/logs/window.log`：`置顶 = true/false`）。
- 伴玩：1280×840 ↔ 420×620 切换成功，设置持久化到 `~/.loomcraft/settings.json`（`alwaysOnTop/mode/page`）。
- 退出清理：向窗口发 `WM_DELETE_WINDOW` → 生命周期日志 `停止子进程 engine（pid …）`，4317 端口关闭、`desktop.lock` 删除、无残留进程。
- AppImage 实跑：`LOOM_ENGINE_PORT=4331 ... Loomcraft_0.1.0_amd64.AppImage` 启动成功，内置 engine 日志 `world=mock`，退出后 4331 关闭。

**世界端口说明（不假称已接真实 MC）**：桌面 App 当前接 **Mock 世界**（engine 启动默认 `LOOM_WORLD=mock`）。
为使桌面包不被 mineflayer/minecraft-protocol 撑大（曾达 589 MB），`build-assets.mjs` 把 `paper-port` 与 `bot/manager.mjs`
换成 `runtime/*.stub.ts`（中文提示「桌面版当前只内置 Mock…」）；真实 Paper 世界联调由 task-49 以仓库内
`npm run dev:engine:paper` 另行验证，不在本 AppImage 内。

## 7. T4 重打包-2：最新 Studio（世界提示条/顶栏重置/等待态/试符台/织典）+ `/api/in-game`（task-56，2026-10-31T07:18–07:22Z）

构建：`node apps/desktop/scripts/build-assets.mjs`（Studio `vite build --base ./` → `dist/studio`；engine bundle 含 `/api/in-game`，
仍为 Mock-only stub；图标/冒烟）→ `tauri build --bundles rpm,appimage`。产物 / sha256 / 时间见 §1。

**本次截图（`apps/desktop/evidence/`）**：

| 文件 | 说明 |
|---|---|
| `wizard-v32.png` | 首启向导（最新文案） |
| `mapwall-v32.png` | 关卡墙（三幕 L01–L10） |
| `workbench-v32.png` | L01 工作台：**世界提示条**（左「世界在 Minecraft 窗口里」+ 真实 L01 画面缩略）+ **顶栏「重置本关」** + 打开旅途手记/织典/织机在线 |
| `workbench-waiting-v32.png` | 运行 starter 后的等待态：右栏「轮到你」——请切到 Minecraft 窗口、走到 4 号灯下右键点亮 |
| `workbench-result-v32.png` | 运行结束后的结果/世界日志态 |
| `repl-v32.png` | 试符台成功：`golem.pos` → 「灰崽现在在：左右 0，高度 65，前后 0」 |
| `repl-error-v32.png` | 试符台错误态：中文提示「这一句还没跑通。检查括号、引号是否成对，再试一次。」 |
| `codex-v32.png` | 织典 17 页 + 详情 + 跨语言 tab |
| `companion-v32.png` | 伴玩 420×620（工作台/取消置顶/设置） |

**Xvfb smoke（:99，1600×1000，X11）**：
- 无地址栏/标签页；窗口标题「织界」；页面品牌只留「织界」。
- 工作台新 UI 正常：世界提示条 + 顶栏「重置本关」+ 等待态「轮到你」均可见/可用。
- 置顶按钮 + `Ctrl+Shift+L` 生效（`window.log`：`置顶 = true/false`）；伴玩 1280×840 ↔ 420×620 切换成功并持久化到 `settings.json`。
- 退出清理：`WM_DELETE_WINDOW` → 生命周期日志 `停止子进程 engine（pid …）`，4317 关闭、`desktop.lock` 删除、无残留进程。
- AppImage 实跑（`LOOM_ENGINE_PORT=4332`）：启动成功、内置 engine 起来、退出后端口关闭（见构建日志 / 本次 smoke）。

**`/api/in-game`（新增接口，桌面 engine 内含）**：以 mock 会话实测
`POST /api/in-game {"sessionId":"sess-…","text":"桌面版 in-game 提示自检"} → {"ok":true}`；
Studio 用它把游戏内中文提示映射为 `fx.title`。Mock 世界下为静默 no-op（属于预期），真实 MC 下由 PaperWorldPort 呈现。

**打包注意（本次环境）**：GitHub 下载 AppImage runtime 被网络拦截（`Failed to download runtime`），
rpm 正常出包；AppImage 用 `~/.cache/tauri/linuxdeploy-plugin-appimage.AppImage` 解出的 `appimagetool --runtime-file /tmp/runtime-x86_64 <AppDir> <out>`
以 api.github.com 下载的 runtime 手工完成（产物等价，已实测启动）。

**世界端口说明（不假称已接真实 MC）**：桌面 App 当前接 **Mock 世界**（`LOOM_WORLD=mock`）；Paper 适配器与织偶 bot 在打包时用
`runtime/*.stub.ts` 顶替（避免 mineflayer/minecraft-protocol 把包撑大，engine.mjs ≈1 MB）；真实 Paper 联调由 task-49 以仓库内
`npm run dev:engine:paper` 另行验证，不在本 AppImage 内。

## 8. T4 重打包-3：像素 UI + 随包像素等宽字体 + 按关卡世界条 + 标注开关（task-64，2026-10-31T08:53–08:55Z）

构建：`node apps/desktop/scripts/build-assets.mjs`（Studio 最新工作区：像素皮肤 + Departure Mono/Zpix 随包字体 + UI 不变量
`vite build --base ./` → `dist/studio`，含 `world/L01–L09.png`；engine bundle 含 `/api/in-game`、`/api/annotations`，仍为
Mock-only stub；图标/冒烟）→ `tauri build --bundles rpm,appimage`。本次 tauri 一键出双包，大小/sha256/时间见 §1。

**截图（`apps/desktop/evidence/`，最终包）**：

| 文件 | 说明 |
|---|---|
| `mapwall-v33.png` | 关卡墙（像素皮肤；标题/文字无重影、无装饰文字阴影） |
| `mapwall-act3-v33.png` | 第三幕 · 时光之核：第 9 关标题 **「入夜之前」** |
| `workbench-v33.png` | **L04 工作台**：像素皮肤 + **像素等宽代码字体**（Departure Mono/Zpix 随包）；世界条为 **L04 麦田场景**（红谷仓/水渠，非 L01）；顶栏「重置本关/世界标注：开/打开旅途手记/打开织典」与居中标题 **不重叠**、同行控件等高 |
| `workbench-waiting-v33.png` | L04 运行 starter 后的等待态（「轮到你」/玩家节拍） |
| `repl-v33.png` | 试符台成功：`golem.pos` → 「灰崽现在在：左右 0，高度 65，前后 0」（像素等宽字体） |
| `codex-v33.png` | 织典 17 页 + 跨语言 tab（代码块像素等宽） |
| `companion-v33.png` | 伴玩 420×620（伴侣页由桌面壳自带，不随 Studio 像素皮肤） |
| `wizard-v33.png` | 首启向导 |

**字体/不变量检查（本次重打重点）**：
- 代码字体已为随包像素等宽：`dist/studio/fonts/DepartureMono-Regular.woff2`（+ `zpix.woff2` 中文 fallback）随包存在；
  工作台编辑器/织典代码块字形为像素等宽（见截图）。
- 地图墙标题「关卡墙」无重影/无文字阴影；按钮/胶囊同行等高；工作台标题与顶栏按钮不重叠（截图核对）。
- 世界条按关卡校验：L04 工作台世界条区域与 `world/L04.png` 的 mean-abs-diff = **38.5**，与 `L01.png` = **55.3** → 确认是 L04 截图。

**Xvfb smoke（隔离 Xvfb :98，1600×1000；:99 上有并发真实 MC 客户端占用焦点/指针，故独立 display）**：
- 无浏览器地址栏/标签页；窗口标题「织界」；像素皮肤/硬边框/平涂配色生效。
- 置顶按钮 + `Ctrl+Shift+L` 生效（`window.log`：`置顶 = true/false`）；伴玩 1280×840 ↔ 420×620 切换并持久化到 `settings.json`。
- 退出清理：最终 AppImage（`LOOM_ENGINE_PORT=4334`，App 自启并持有 mock engine）`WM_DELETE_WINDOW` → 日志
  `停止子进程 engine（pid 695933）`，4334 关闭、`desktop.lock` 删除、无残留进程。

**API（bundled engine 实测）**：`POST /api/in-game {"sessionId","text"}` → `{"ok":true}`；
`POST /api/annotations {"sessionId","visible":false|true}` → `{"ok":true}`（Mock 世界下为静默 no-op，属预期；真实 MC 由 PaperWorldPort 呈现）。

**世界端口说明（不假称已接真实 MC）**：桌面 App 当前接 **Mock 世界**（`LOOM_WORLD=mock`）；Paper 适配器与织偶 bot 在打包时用
`runtime/*.stub.ts` 顶替（避免 mineflayer/minecraft-protocol 撑大包，engine.mjs ≈1.1 MB）；真实 Paper 联调由 task-49 以仓库内
`npm run dev:engine:paper` 另行验证，不在本 AppImage 内。

## 9. T4 重打包-4：无系统窗框 + 自绘像素标题栏 + 原生行为收口 + 字号控件（task-65，最终 2026-10-31T09:32Z）

构建：`node apps/desktop/scripts/build-assets.mjs`（Studio 最新像素 UI/字体/系统页 → `dist/studio`；engine bundle 含 `/api/in-game`、
`/api/annotations`，Mock-only stub）→ `tauri build --bundles rpm,appimage`。首次构建（09:21Z）后工作区又并入自绘 chrome 的
`window_start_drag` pointerdown 拖动兜底与系统页，故按最新工作区**再次重打**（09:32Z），产物见 §1；AppImage 因 GitHub runtime 下载受限，
用缓存 `appimagetool --runtime-file` 由 AppDir 生成（同 task-64 方法），已实测启动。

**截图（`apps/desktop/evidence/`，v36 = 最终包）**：

| 文件 | 说明 |
|---|---|
| `desktop-no-frame-v36.png` | :98+Openbox 桌面根截图：仅自绘像素标题栏，无系统标题栏/窗框（`_NET_FRAME_EXTENTS=0,0,0,0`） |
| `titlebar-v36.png` | 自绘标题栏：织界 / THE LOOM + 织机/世界状态 + 置顶/伴玩/设置 + — □ ✕ |
| `mapwall-v36.png` | 关卡墙（像素 UI，L09「入夜之前」在第三幕） |
| `workbench-v36.png` | L04 工作台（世界条 L04、标题不被按钮压、A-/A+ 字号控件） |
| `repl-v36.png` | 试符台：`golem.pos` →「灰崽现在在：左右 0，高度 65，前后 0」；输入框高度/文字比例正常 |
| `codex-v36.png` | 织典 |
| `companion-v36.png` | 伴玩 420×620（自绘标题栏在 420 宽下完整可见/可点） |
| `native-guard-page-v36.png` | 页面空白处右键：无浏览器默认菜单 |
| `native-guard-editor-v36.png` | Monaco 编辑器右键：保留 Cut / Copy / Paste |
| `editor-font-19-v36.png` | A+：字号 18→19（代码区实际放大；A- 可回到 18，见 v35 的 18/19 对照） |

**窗口行为实测（隔离 Xvfb :98 + 独立 Openbox；全程不用 :0，并确认无 :0 loom 自动化进程）**：
- 无系统窗框：`_NET_FRAME_EXTENTS = 0, 0, 0, 0`；桌面截图仅见自绘标题栏。
- 拖动：按住标题栏空白拖动，窗口位置 `(160,80) → (280,155)`（原生 `data-tauri-drag-region` + `window_start_drag` 兜底）。
- 双击标题栏：最大化到 1600×1000（`_NET_WM_STATE_MAXIMIZED_HORZ/VERT`），再次双击还原到 1280×840。
- 最大化按钮：同双击（几何/状态生效）；还原按钮：回到原尺寸。
- 最小化按钮：`WM_STATE = Iconic`、`_NET_WM_STATE_HIDDEN`。
- 关闭按钮 / `WM_DELETE`：进程退出、自启 engine 子进程被停（日志 pid）、4317 关闭、`desktop.lock` 删除、无残留。
- 最终 AppImage 实跑（`LOOM_ENGINE_PORT=4336`）：标题「织界」、内置 engine 日志 `world=mock`、退出后 4336 关闭、锁删除。

**原生行为实测（:98）**：
- 页面右键：默认菜单不出现；Monaco 编辑器右键保留 Cut/Copy/Paste（跨 iframe realm 的 `instanceof` 误判已修复）。
- F12 / Ctrl+Shift+I：无 devtools 窗口出现（窗口配置 `devtools:false` 双保险；窗口列表始终仅 1 个织界窗口）。
- Ctrl+R / F5：不刷新页面（仍停留在 L04 工作台；`ctrlr-before-v35.png` / `ctrlr-blocked-v35.png`，差异仅光标 RMSE 0.0007）。
- 文件拖入：`dragDropEnabled:false` + `dragover/drop preventDefault`（代码/配置证据；未做端到端文件拖入模拟）。
- 字号 A-/A+：16→19→18，Monaco 字号真实变化；REPL 输入框高度正常。

**世界端口说明（不假称真实 MC）**：桌面 App 当前接 **Mock 世界**（`LOOM_WORLD=mock`）；Paper 适配器与织偶 bot 用
`runtime/*.stub.ts` 顶替；真实 Paper 联调由 task-49 以仓库内 `npm run dev:engine:paper` 另行验证，不在本 AppImage 内。
