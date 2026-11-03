# 57 — 启动流程 / EnvState / 客户端启动器契约（task-7/8/9/11/16/17/18/20）

> 当前补充（2026-11-03）：实际壳接线、退出取消与跨源缩放已按 §7.2 恢复；当前验收见 docs/62。下方 2026-11-02 数字是历史快照。
> 状态：已实现并完成对抗性 P0/P1 加固 + 集成真机修复 + 版本门控 + 窗口几何 clamp + 产品直启启动器；**已合入 main（`b9a92af`，2026-11-02）**。合入后 Linux 验证：verify 绿（仅 G-FRESH-READER 已知告警）、cargo check/test 49 passed / 4 ignored、mock e2e 7/7、完整 e2e 41/41｜日期：2026-11-02
> 基线：`main@5b31af9` → 合入 `b9a92af`；Windows 真机行为与 Linux 静态/无头验证分层记录。
> 上游：`docs/53-game-start-flow-design.md`、`docs/54-takeover-audit-and-task-plan.md`、`docs/58-client-version-compatibility-review.md`、`tmp/audit/ui-issues.md`、`tmp/audit/launcher-adversarial-review.md`、`tmp/integrated-screen.png`
> 实现范围：`apps/desktop/src-tauri/**`、`apps/desktop/shell/**`、`apps/studio/src` 的 EnvState/顶栏接入、`docs/**`；不改关卡内容、评分真值与版本锁。
> 本文是壳 / L0 UI / Studio 三方共用的接口契约；Studio 侧消费由 UI 任务接入（壳已通过 `postMessage` 下发同一份快照）。

---

## 1. 状态机（L0 → L1 → L2）

```text
App 启动
  └─ L0（wizard.html / 壳 iframe）：四灯 EnvState，自动启动 Paper+engine（织偶随 engine）
       → **task-11：自动检测/拉起《我的世界》客户端；失败才在卡片显示「去安装启动器」/重试**
       ├─ 四灯全绿 → 「进入工坊」可点 → L1（Studio 地图墙）
       └─ 未全绿：卡片内「启动/重试/去安装启动器」，不阻塞重试

L1（Studio 地图墙 / 关卡墙）
  ├─ 右上角 X / Alt+F4 / 顶栏「退出游戏」→ 红色确认 → 完整退出 App
  └─ 进关卡 → L2（Studio 工作台）

L2（关卡内）
  ├─ 客户端掉线（引擎就绪 + 关卡会话进行中 + 之前亮过客户端灯）→ clientLost=true
  │     → 壳显示红色阻断（覆盖 iframe，阻止继续操作）
  │     → 「一键重启并连接」重新拉起客户端并 quickPlay 回 127.0.0.1:25565
  └─ 客户端恢复 → 阻断自动消失（事件驱动，不需要手动 reset）
```

- **每次启动固定 L0**：`Settings` 初始化时 `force_l0_page()`；`shell.js:loadSettings()` 无条件 `show("wizard")`；伴玩模式启动时先恢复工作台窗口尺寸。
- **L0 自动准备（task-11/16）**：`env_autostart` 依次自动启动 Paper → engine → **自动检测/拉起客户端**（只尝试一次；**只有版本兼容的已运行客户端才会被复用**；Mock 演示或 `LOOM_DISABLE_CLIENT_AUTOSTART=1` 时跳过）。客户端适配器失败/版本不匹配时才在卡片显示「失败/需要处理 + 去安装启动器/重试」；等待期间卡片显示「启动中」并给「取消启动」。
- **版本门控（task-16 P0，`docs/58`）**：目标固定 MC **26.1.2 / 协议 775**。客户端必须实际运行 **26.1.x**（`--version` 命令行或窗口标题解析）且服务端 health 确认 `mc.version=26.1.x`；1.21.1 在跑、版本未知、旧 Paper 占 25565 → **绝不绿、`allReady=false`、禁止进入工坊**，并显示中文版本提示。自动准备 26.1.2（方案 A）与 ViaVersion（方案 C）**未实现**，只做检测/门控/引导。
- **一个 App 只有一个窗口**：L0/L1/L2 都是同一个 Tauri 窗口里的 iframe 路由，不新开窗口。
- **L1 退出 = 完整退出 App**：`quit_game` 先中止进行中的客户端启动链（`client_cancel`）→ 关客户端（Windows：只对校验过的 java/javaw 进程窗口发 WM_CLOSE；Linux：只对校验过的 PID 发 SIGTERM，最多等 5s）→ 停 engine → 停 Paper（**Windows/Linux 都先 stdin `stop` 等待落盘 8s** 再 kill）→ 保存设置/窗口几何（全屏时不写屏幕尺寸）→ 删 `desktop.lock` → `app.exit(0)`。
- **X/Alt+F4 统一确认（P0-2 加固）**：
  1. 第一次 CloseRequested：`prevent_close()` + emit `loom://quit-requested`，开始 10s 兜底计时；
  2. 同一次会话 6s 内再次请求（第二次点 X/Alt+F4）→ **直接放行**（用户坚持关闭）；
  3. shell 收到事件后必须调用 `quit_ack`；若 10s 内没有 ack（JS 崩了/事件没接上）→ Rust 强制退出全屏并关闭窗口；
  4. shell 自身引导异常时调用 `window_allow_close`（下次请求直接放行）或 `window_force_close`（立即关闭）。

## 2. EnvState（唯一状态源）

Rust `envstate::EnvState`（camelCase JSON）：

```jsonc
{
  "engine": { "state": "ready", "detail": "...", "hint": null, "canStart": false, "canRetry": false, "guide": null },
  "paper":  { ... }, "bot": { ... }, "client": { ... },
  "allReady": true,              // L0「进入工坊」唯一门控
  "launching": ["engine"],       // 正在启动中的长操作（全局启动锁）
  "clientLost": false,           // L2 红色阻断
  "sessionActive": false,        // shell 同步的关卡会话
  "clientAdapter": "prism",      // 最近一次成功使用的适配器
  "clientAvailableLauncher": null, // 探测到的启动器（给「去安装/打开」引导）
  "clientVersion": "26.1.2",     // task-16/18：多客户端时优先 26.1.x（读不到为 null）
  "otherClientVersion": "1.21.1", // task-18：同机其它版本客户端；仅提示，不阻塞
  "serverVersion": "26.1.2",     // task-16：engine health `mc.version`
  "expectedVersion": "26.1.2",   // task-16：本作要求版本（前端口径）
  "minecraftDir": "D:\\...\\.minecraft", // task-16：实际选中的 .minecraft（诊断）
  "clientInstallDir": "D:\\...\\.minecraft", // task-20：本机已找到的 26.1.2 安装（一键准备/启动）
  "clientPrepareAvailable": false, // task-20：本机没有 26.1.2 文件 → 前端可显示「准备 26.1.2」
  "versionBlocked": false,       // task-16：客户端/服务端版本不匹配 → 禁止进入工坊
  "mock": false,                 // 本地演示（Mock 世界）
  "updatedAt": 1710000000000
}
```

灯态：`checking | starting | ready | needs_action | error`。
四灯判定（`envstate::poll_lights`，已单测）：

| 灯 | ready | 备注 |
|---|---|---|
| engine | `/api/health` 可用（或端口 4317 探测到） | 监视线程只读本地 health，不拉 PowerShell/UIA |
| paper | **Mock，或 engine health `mc.connected=true` 且 `mc.version` 属 26.1.x**；**端口 25565 打开本身不算 ready** | task-16：旧 1.21.1 Paper/其他服务端占 25565 → needs_action/error + 中文版本提示；`spawn_bundled_paper`/`start_paper_wait` 用 `paper_owned_by_us` 校验 java 命令行，端口被外部占用时直接报错而不是假装已启动 |
| bot | `health.bot.connected`；Mock 模式直接 ready | engine 自动连接；engine+paper（版本确认后）60s 仍未连 → 转 needs_action + canRetry（不再永久 starting） |
| client | **运行中且版本兼容（26.1.x，协议 775）**；Mock 直接 ready | 版本来源：Windows 已校验 java/javaw 进程命令行 `--version <ver>`（读不到时用该进程窗口标题解析），Linux `/proc/*/cmdline`；运行中但 1.21.1/26.3/未知版本 → needs_action，detail 含「当前 X / 需要 26.1.2 / 协议 767≠775」，canRetry=true、canStart=false；**绝不绿** |

### 2.1 命令（壳根据 capability 允许；L0/壳都在主 frame 调用）

| 命令 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `env_state` | — | `EnvState` | 读最近快照（不触发探测） |
| `env_refresh` | — | `EnvState` | 立即探测一次并入队 emit |
| `env_autostart` | — | — | 幂等：自动启动 Paper+engine（L0 加载时调用） |
| `env_start` | `{ kind: "engine"\|"paper"\|"bot"\|"client"\|"all" }` | `OpStatus` | 立即返回，后台线程执行；启动锁防重复 |
| `env_retry` | `{ kind }` | `OpStatus` | 同 env_start（语义别名） |
| `launch_client` | — | `OpStatus` | 客户端启动链：**direct（产品自管 26.1.2）→ Prism→HMCL→official→PCL2**；已运行 26.1.x 复用；旧版本不杀不阻塞 |
| `client_prepare` | — | `OpStatus` | task-20 一键准备：本机已有 versions/26.1.2 → 采用并写入设置；没有 → 打开官方下载页 + 明确诊断（不下载/不打包 Mojang 资产） |
| `restart_client_and_reconnect` | — | `OpStatus` | L2：优先复用上次适配器，quickPlay 回当前 Paper；不重建会话 |
| `set_game_session` | `{ sessionId, levelId }` / 空 | — | 壳收到 Studio 的 `loom:session` 后同步；空 = 清除 |
| `clear_game_session` | — | — | 回 L0 / 退出关卡时清除 |
| `open_launcher_download` | `{ kind: "prism"\|"hmcl"\|"official"\|"pcl2"\|"install" }` | `OpStatus` | 只打开 http(s) 下载页；URL 经 scheme/字符白名单，Windows 用 `rundll32 url.dll` 不经 shell |
| `env_cancel` | — | `OpStatus` | P1-3：取消进行中的《我的世界》启动链；等待窗口的直启 child 会 kill |
| `quit_game` | — | — | L1 完整退出（含客户端/服务端/织界） |
| `quit_ack` | — | — | shell 已显示退出确认（停止 Rust 10s 兜底计时） |
| `quit_cancel` | — | — | 用户取消退出，撤销二次关闭捷径及旧 watchdog 请求 |
| `window_allow_close` | — | — | shell 引导异常兜底：下次 X/Alt+F4 直接放行 |
| `window_force_close` | — | — | shell 引导异常兜底：立即关闭窗口 |

### 2.2 事件（Rust → 主 frame；壳再转发给 iframe）

| 事件 | payload | 消费者 |
|---|---|---|
| `loom://env` | `EnvState` | 壳顶栏四灯、L0 四卡、L2 阻断、**Studio「织机在线」** |
| `loom://window-state` | `{ fullscreen, maximized, visible }` | 壳顶栏「全屏/退出全屏/还原窗口」按钮与双击标题栏 |
| `loom://quit-requested` | `()` | 壳红色退出确认（X/Alt+F4） |
| `loom://session-changed` | `{ sessionId, levelId }` / `null` | 壳会话跟踪（L2 判定） |
| `loom://client-restored` | `detail: string` | 壳 toast + 收起阻断 |
| `loom://client-failed` | `detail: string` | 壳 toast + 重试入口 |
| `loom://restore-companion` | `()` | Ctrl+Shift+F 兜底：Rust 已把窗口切回工作台尺寸，壳负责 show("workbench") |

### 2.3 主 frame → iframe 的 postMessage（壳下发；Studio 侧待接入）

**P0-4 IPC 桥安全**（`shell.js`）：
- `loom:invoke` 必须同时满足：`event.source === iframe.contentWindow`、`event.origin` ∈ {壳自身 origin, 本机 engine origin}、命令在 `BRIDGE_COMMANDS` 白名单内；否则拒绝（返回 `命令不在白名单`）。
- `save_settings` 经桥转发时，`prismCommand` 先剥 shell 元字符；Rust `save_settings` 再做第二道 `sanitize_program_setting`。
- `loom:navigate` 只接受 `workbench|companion|wizard`；`loom:toast` 长度截断 500。
- **`engineUrl` 只允许 `http://127.0.0.1|localhost|::1:<port>`**：壳 `frameUrl/waitEngineThen` 用 `currentEngineUrl()` 校验；wizard 保存地址时同样校验，非本机地址不会写入/不会装进 iframe。

| 消息 | payload | Studio 应做什么 |
|---|---|---|
| `loom:env` | `{ env: EnvState }` | 顶栏「织机在线/本地演示/未运行」改为读 `env.engine/paper/bot/client`；不要自己 fetch `/api/health` 或 `client_running` |
| `loom:session` | 由 Studio 发给壳（已有，`Workbench.tsx`） | 壳回复 `set_game_session`；Studio 无需改 |
| `loom:client-lost`（建议新增，壳可同时发） | `{ lost, sessionActive, hint }` | Studio 在 lost 时禁用「运行/评分/切关」；暂由壳的红色阻断覆盖层兜底 |
| `loom:request-quit` | 无（L0 → 壳） | L0 的「退出游戏」按钮已用；Studio 可选 |

> Studio 接入点（交给 ui-shell-fixer）：`apps/studio/src/...` 里现有的模式 chip「织机在线/本地演示」改为从 `window.parent` 的 `loom:env` 消息派生；**不要新增第二个轮询**。

### 2.4 壳顶栏四灯 ↔ L0 卡片的同一性（task-11）

- **同一状态源**：两者都消费同一份 Rust EnvState；壳通过 `loom://env` 事件 + **每 2s `env_state` 快照兜底**（`syncEnvSnapshot`，不触发探测、不是第二数据源），并用去掉 `updatedAt` 的签名去重；L0 卡片通过壳转发的 `loom:env` + 自己的 `env_state` 周期兜底。事件丢失/监听不可用/时序错开时，顶栏最多 2s 内追上卡片。
- **颜色映射（`lightDotState` + `shell.css`）**：`ready = ok = 绿 #9fd08a`；`starting/checking = busy = 黄 var(--warm) #d9b25c`；`error = bad = 红 #e08a7a`；`needs_action / 未启动 = off = 灰 #5c4a34`；`mock = 暖色`。
- 受控验证：`tmp/audit/shell-dot-harness.html` + `task11-dot-verify.mjs`（真实 shell.js/shell.css + Tauri IPC stub，headless Chromium，不启 GUI）断言 11/11：初始 ready 绿、starting 黄、error 红、client off 灰、事件路径、**仅靠 2s 快照兜底也能变绿**、mock 暖色。证据 `tmp/audit/task11-dot-harness-*.png/.json`。

### 2.5 版本门控（task-16 P0，源码 `launcher.rs`/`envstate.rs`/`main.rs`）

依据 `docs/58-client-version-compatibility-review.md`（file:line 见该文 §2/§6.1/§7.1）：

1. **判定规则**
   - 目标：MC **26.1.2**，协议 **775**；同协议族 26.1.x 视为兼容（26.1/26.1.1/26.1.2），1.21.1（767）/26.3/未知一律不兼容。
   - `client_ok = mock || (running && compatible)`；`allReady` 因此绝不包含「在跑但版本不对」的客户端。
   - `versionBlocked = !mock && (客户端运行但不兼容 || engine 已连服务端但版本不兼容/未知)`；L0「进入工坊」禁用，且 `shell.show("workbench")` 在 `versionBlocked` 时直接拒绝并 toast（任何来源的工坊导航都过不去）。
2. **客户端版本来源**：已校验 java/javaw 进程命令行 `--version <ver>`（`parse_client_version`，1.21.1 用户实测命令行 9891 字符、含 `--version 1.21.1`）→ 读不到时用该 PID 窗口标题解析（`parse_version_from_title`）→ 仍未知则 `clientVersion=null` 并**保守不绿**。
3. **启动链复用/适配器校验**：`launch_client` 复用分支先 `client_probe().compatible()`，1.21.1 在跑直接 fail（中文提示，不杀旧客户端）；Prism/HMCL/官方/PCL2/直启成功等到进程后再用 `finish_launch` 校验版本，不兼容 → needs_manual + 版本提示；直启发现版本不符会 kill 自己 spawn 的 java。
4. **服务端身份校验**：`paper_ready` 要求 engine health `mc.connected=true` 且 `mc.version` 兼容；端口开但 health 未确认 → needs_action「25565 可能被旧 1.21.1 Paper 占用」，不绿；`spawn_bundled_paper`/`start_paper_wait` 用 `paper_owned_by_us`（子进程存活或 java 命令行含 `paper.jar` 且属 loomcraft 目录）识别，外部占端口 → 明确报错；`runtime_status.world_ok` 也改为 health 版本确认。
5. **`.minecraft` 目录扫描**（`minecraft_dir_candidates` + `pick_minecraft_dir`）：
   - 候选：settings/`LOOM_MINECRAFT_DIR`/`LOOM_MINECRAFT_DIRS` → `%APPDATA%\.minecraft`、用户 `.minecraft`/Desktop/Documents/Downloads → 仓库 `.minecraft`（dev）→ **PCL2 常见便携目录 `D:\Prograft`、`C:\Prograft`、`E:\Prograft`、`D:\PCL2`、`D:\PCL` 及其 `.minecraft`/`tools/pcl/launcher-2.14`** → `%LOCALAPPDATA%\Programs\PCL2` 等。
   - 选择优先级：**含 `versions/<26.1.2>/<26.1.2>.json` 的目录** > 含 `versions/` 的目录 > 第一个存在目录。空 `%APPDATA%\.minecraft`（只有 runtime、无 versions）不再挡住 repo/`D:\Prograft` 的真实 26.1.2。
   - `EnvState.minecraftDir` 记录实际选中目录；直启失败时 attempts 里列出该目录现有版本。
6. **明确不做（等用户确认）**：方案 A 自动准备 26.1.2（下载器）、方案 C ViaVersion/ViaBackwards —— 本任务未实现；L0 只给「关闭旧客户端/旧 Paper → 重试」与安装引导。

## 3. 客户端启动器适配（`launcher.rs`）

**触发时机（task-11/16/18/20）**：L0 启动后 `env_autostart` 在 Paper/engine 就绪后自动调用一次启动链（`should_autostart_client` 单测覆盖：正常环境未运行/不兼容→尝试；**版本兼容在跑**/mock/`LOOM_DISABLE_CLIENT_AUTOSTART`→跳过）；之后用户也可在卡片点「启动 26.1.2」或 L2「一键重启并连接」——**三条入口都走 `spawn_client_worker` → `launch_client` 同一条路径**。失败（含只拉起了启动器 UI 但窗口超时、拉起的版本不匹配）会在 EnvState 里给出 error/needs_action + guide，L0 显示「准备 26.1.2/重试」与中文版本提示。quickPlay 只在 engine 确认 26.1.2 Paper 时追加（`spawn_client_worker` 校验 health 后才传 server）。

顺序（`launch_client`）：

1. **已运行**：版本匹配（26.1.x）→ `adapter="reuse"`，绝不重复启动；**不兼容（如 1.21.1）→ 不杀、不失败**，记下旧版本并继续启动产品 26.1.2（task-18）。
2. **默认产品自管 26.1.2 直启（task-20 第一优先）**：官方 `versions/26.1.2/26.1.2.json` + **client jar 进 classpath** + 包内 Java 25 + 离线账号（token=0）+ `--quickPlayMultiplayer 127.0.0.1:25565`；成功后再探测版本（`wait_for_client(expected)` + `client_probe`），不是 26.1.x 会 kill 自己 spawn 的 java 并给中文提示。
   - 目录候选：设置 `minecraftDir` / 检测到的 26.1.2 `--gameDir` / `LOOM_MINECRAFT_DIR(S)` / **产品目录 `~/.loomcraft/minecraft`** / APPDATA/用户目录 / repo `.minecraft`（dev）/ PCL 常见目录；`pick_minecraft_dir` 优先含 `versions/26.1.2` 的目录。
   - 缺少 client jar / 找不到版本目录时返回可操作错误，不启动残缺客户端。
3. **外部启动器**（Prism/HMCL/官方/PCL2，按 `launch_adapter_order` 排后备）：只有检测到 **26.1.x** 才接受（`external_client_accepted` + `finish_launch`/`wait_for_client` 双重校验）；版本不匹配明确提示、不进入游戏、不点亮客户端灯。
   - Prism：Windows 常见路径 + `where prismlauncher.exe`；Linux flatpak 或 PATH；从 `mmc-pack.json` 匹配 26.1.2 实例 → `--launch <instance>`；找不到实例只拉 UI + 引导。
   - HMCL：`HMCL.jar`/`hmcl.exe` → UI + 等待窗口 + 引导。
   - 旧设置 `prismCommand`：P0-4 后只接受可执行文件路径/名称并直启（不经 shell，不接受参数/元字符）。
4. **一键准备（task-20，`client_prepare`）**：本机已有 `versions/26.1.2/26.1.2.json` → 采用（写 `settings.minecraftDir`/`client_game_dir`）并返回可启动；本机没有 → 打开官方下载页 + 诊断（已扫描目录/现有版本、支持设置路径/`LOOM_MINECRAFT_DIR`）。不实现自动下载游戏资产（遵守「不打包 Mojang 资产」红线）。
5. **都没有**：`guide="install"`，L0 显示「准备 26.1.2」入口。

启动链预算（P1-3）：
- 总预算 150s；适配器内部等待取 `min(剩余预算, 120s)`；
- **等待窗口只认 26.1.x**（`wait_for_client(..., expected_version)` 用 `client_probe().compatible()`）：旧 1.21.1 在跑时不能被误判为「新客户端已启动」；
- 一旦某适配器**已成功 spawn**（Prism/HMCL/官方/PCL2 的 UI，或直启 java），窗口超时就**停止链路**转人工引导，不再继续拉起下一个启动器（避免多客户端）；direct 失败（未 spawn/已 kill）会继续尝试 Prism/HMCL；
- `env_cancel` / 退出 App 会置 `client_cancel`，等待循环立刻退出并清理已 spawn 的直启 child。

**多客户端（task-18）**：
- `client_probe`/`probe_from_cmdlines` 同时解析所有已校验 java 进程的 `--version` 与 `--gameDir`；**优先返回 26.1.x**，其余版本放 `otherVersions`，EnvState 显示「已连接 26.1.2（另有 1.21.1 在运行，未关闭、不影响）」，不阻塞四灯绿。
- 首次检测到 26.1.2 的 `--gameDir` 会记入 `AppState.client_game_dir` 并写入设置 `minecraftDir`（若用户未显式设置），下次 direct 可直接复用该 `.minecraft`。
- 退出 App/L1 只对**版本匹配的 26.1.x** 发关闭（`close_client_window_for_version`）；用户自己的 1.21.1 进程不动。Alt+Z 聚焦也优先 26.1.x 窗口。

边界（不承诺）：
- 不能代替用户登录正版账号；离线 profile 只用于本地教学服（Paper `online-mode=false` 场景）。
- 一键安装只装启动器/打开下载页，不下载游戏本体、不绕过账号验证。
- Linux 的 .minecraft 直启依赖本机 Java 与资源文件完整；官方/Prism 优先级更高。

## 4. 全局启动锁与防重复（P0-1/P1-8 加固）

`AppState.starting: Mutex<HashSet<String>>`：

- 每个长操作（engine/paper/client/bot/all）先 `try_begin_start(kind)`，重复调用返回「正在启动中，请稍候」。
- **锁覆盖到「端口就绪」或「子进程退出/超时」才释放**（不再 spawn 后立刻 end_start）：`start_paper_wait`/`start_engine_wait` 内等端口，UI 在等待期间始终显示「启动中」，不会再次出现可点的「启动」。
- `spawn_bundled_paper`/`spawn_engine_child` 幂等：端口已开 或 已有存活子进程 → 直接返回「已在启动中」，**不会 spawn 第二个 Paper/engine/java**。
- `all` 分支开始前逐个 `try_begin_start("paper")/("engine")`；拿不到子锁说明其他入口正在启动，直接跳过并写 lifecycle 日志（不再并发 spawn）。
- 客户端启动前先做进程级「已运行」检测（`launch_client` 第一分支），绝不重复拉起。
- 关卡进行中禁止「重启织机/织偶」类操作（`env_start("bot")` 会拒绝，避免丢会话）。
- `EnvState.bot`：engine+paper 就绪后 60s 仍未连 → 从「启动中」转 `needs_action + canRetry`，L0 出现「重试」（P1-7），不会永久死局。

## 5. 全屏 / 还原窗口（task-8）

| 入口 | 行为 |
|---|---|
| 顶栏注入按钮 | 普通态「全屏」；全屏态「退出全屏」；最大化态「还原窗口」 |
| 窗口按钮 `□` | 全屏时 = 退出全屏；否则最大化/还原 |
| 双击标题栏 | 全屏 → 还原；否则最大化/还原 |
| F11 | 切换全屏（壳 frame 有焦点时） |
| Esc | 全屏 → 还原；弹窗打开时先关弹窗（L2 阻断不响应 Esc，必须先重连或回 L0） |
| **Ctrl+Shift+F（Rust 全局快捷键）** | **P0-2/P1-11 兜底**：全屏 → 退出全屏；伴玩 → 切回工作台尺寸 + `loom://restore-companion`（壳 show workbench）；否则还原/聚焦窗口。**即使 shell JS 卡死/iframe 抢焦点也可用**。 |
| 窗口 X / Alt+F4 | 红色确认（二次请求 6s 内直接放行；10s 无 ack 由 Rust 强制退出全屏并关闭） |

命令：`window_toggle_fullscreen` / `window_restore_main` / `window_state` / `quit_ack` / `window_allow_close` / `window_force_close`。
事件：`loom://window-state`（Resized 时也发；Rust 在全屏时**不**保存窗口几何，`quit_game`/`cleanup` 也走 `save_geometry_if_windowed`）。
**伴玩模式出口**（P1-11）：顶栏注入的「主页」「退出游戏」在伴玩模式仍可见（只隐藏「全屏」）；`Ctrl+Shift+F` 也能退出伴玩；`apply_mode` 切模式前先退出全屏。
跨平台：Tauri `set_fullscreen` 在 Windows/WebView2 与 Linux/GTK 均可用；Wayland 下仍走既有的 X11 兼容路径（`GDK_BACKEND=x11`）。

### 5.1 窗口几何恢复 clamp（task-17 P0）

真机问题：保存过的大窗口几何恢复后超出当前屏幕（用户约 1707 宽，右侧被裁）。规则：

- **纯逻辑**（`window_geometry.rs`，15+ 单测）：`restore_rect(saved, work, min, preferred)` 先夹 width/height 到工作区、再夹 x/y；**与工作区零交集**（旧显示器被拔/换屏/负坐标）→ 夹好尺寸后居中回退；`None`/0 尺寸 → 默认 1440×900 居中；工作区小于最小窗口（420×620）→ 允许缩到工作区大小。`fully_visible` 做恢复后校验。
- **Windows 工作区**：`win_work_area` 用 `MonitorFromPoint` + `GetMonitorInfoW` 取 **rcWork**（已扣任务栏），不是整块屏幕；其它平台退化为 monitor 全尺寸。真实 Win32 查询单测 `win32_work_area_query_and_real_screen_clamp` 已在本机通过。
- **恢复前**：`apply_saved_window` 用 `choose_saved_work_area` 选交集最大的显示器（都不相交 → 主屏），逻辑坐标 clamp 后 set；**恢复后**：窗口可见时 `show_main_window`/ScaleFactorChanged 再按物理外框 clamp 一次（WM/DPI 二次调整兜底），并写回修正几何。
- **保存时**：`save_window_geometry`/`save_geometry_if_windowed` 在 **全屏或最大化时直接跳过**（不写 geometry）；写盘前也 clamp 到当前工作区，超屏/负坐标不会进 settings.json。
- **模式切换**：`apply_mode`（伴玩/工作台）与 `window_restore_main`（取消最大化/全屏）后都 clamp，窄工作区不会因固定 1440×900 溢出。
- **DPI**：保存的是逻辑坐标，恢复按当前 monitor 逻辑工作区 clamp；本机 125% 场景测试（逻辑工作区 1365×768，保存 1585×891）验证物理 1707×960 内 fit。

## 6. 跨平台与 cfg 约束

- Windows 专属：`win_focus`（EnumWindows + 只聚焦 launcher 校验过的 PID）、`launcher::win32`（Toolhelp 枚举 java/javaw + PEB 读命令行 + 对校验 PID 的窗口发 WM_CLOSE）、`CommandExt` 隐藏控制台、`where` 探测。
- Linux 专属：`x11_focus`、`/proc/*/cmdline` 进程探测、`kill(2)` SIGTERM、`xdg-open`、`flatpak`。
- 其余（环境状态机、启动器编排、窗口命令）平台无关；所有 Windows 特殊逻辑都在 `#[cfg(target_os = "windows")]` 内，Linux 编译走 `#[cfg(target_os = "linux")]` 分支。
- **命令注入收口**：`launcher.rs` 不再出现 `cmd /C start` / `sh -lc`（自定义启动器直启 exe；下载页走 `rundll32 url.dll` / `xdg-open`）；`SHELL_META` 拒绝 `& | < > ^ ` " ' ; $ % !` 与控制字符。
- Linux 打包不受影响：未新增 Cargo 依赖；只用 `serde/serde_json`（已有）。

## 7. 测试与证据

本轮（task-20 启动器后端）实际跑过（Windows host，`4109095` + 本地改动）：

- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：**exit 0，0 warnings**。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：**52 passed / 0 failed / 4 ignored（Linux 合入后）**；Windows 本机原记录为 50 passed。跨平台修正：直启命令单测原先写死 `natives-windows`，在 Linux 会误判合法 OS 过滤；已改为按宿主 OS 断言，测试语义不变。
  - `envstate`：四灯判定/全绿/错误+启动中、客户端丢失→恢复、mock 不阻断、织偶超时 needs_action、client 1.21.1 不绿 / 26.1 族绿 / 未知版本不绿 / 端口-only 不算 Paper ready / 旧 Paper error / L2 版本不匹配 / 多客户端优先 26.1.2 + 旧版本提示不阻塞；
  - `launcher`：rules/arch、Maven→路径、Prism 实例、直启命令、离线 UUID、命令注入拒绝、quickPlay、cancel、open_url、`--version` 解析与兼容矩阵、空目录不挡 versions/26.1.2、PCL 候选、多客户端 probe + gameDir、**task-20 默认 direct 第一顺序、外部启动器仅接受 26.1.x、现有安装检测（要求 26.1.2.json）**；
  - `window_geometry`：窗口几何 clamp 全套（见 §5.1）+ 真实 Win32 rcWork 查询。
  - 4 个 ignored 机器只读测试（本机显式 `--ignored` 跑过）：**repo `.minecraft/26.1.2` 被一键准备识别**、**直启 argv = 官方 JSON + 包内 Java + 离线 token + quickPlay 25565 + client jar 进 classpath**；客户端运行时另验证 `client_probe` 优先 26.1.x / `launch_client` 走 reuse（客户端关闭时自动 skip）。
- 仓库根 `npm test`：**28 files / 251 tests PASS**（本批未触碰 JS 测试域）。
- 静态契约/回归检查：`tmp/audit/launcher-contract-check.log` **65/65** + `tmp/audit/task17-window-contract-check.log` **18/18** + `tmp/audit/task18-multiclient-contract-check.log` **17/17** + `tmp/audit/task20-launcher-contract-check.log`（task-20 默认直启/一键准备/外部校验/退出只关产品客户端）。合计 **约 110 项静态回归 PASS**。
- **真机只读探测**（`task20` 机器测试，未杀任何进程）：本轮开始时 java PID 8280 `--version 26.1.2 --gameDir D:\VScode_code\the-loom\.minecraft`、25565/4317 有监听；测试期间客户端被外部关闭（测试自动 skip 运行中用例），repo `.minecraft/26.1.2` 与包内 Java 25 资产始终可用。
- **未做**：真机 GUI 启动（按约束不重复启动/不抢焦点）；1.21.1 在跑 + App 自动/点击启动 26.1.2 的完整时序需重建安装包后验收。

## 7.1 Linux 客户端补强（2026-11-02 合入后修复）

- **Prism/MultiMC 检测**：NewLaunch 的宿主进程是 `org.prismlauncher.EntryPoint`，不一定有 `--version`；现在接受该包装器，并同时要求 classpath 含 `minecraft-<ver>-client.jar`，从 jar 名兜底解析版本。避免把 Prism 启动器 UI 误判成游戏，也避免 26.1.2 游戏漏检。
- **启动后前台**：客户端第一次 ready 时自动聚焦；Linux 先走 X11 `map+raise+focus`（含最小化恢复），KDE Wayland 再走 KWin scripting DBus（按 PID/窗口标题找游戏、取消最小化、activate）。focus-follow 在 3 秒内让位，避免织界把刚弹到前面的游戏又盖回去。
- **任务栏归属**：外部启动器/直启 Java 使用独立进程组，并清除从织界继承的 `DESKTOP_STARTUP_ID` / `XDG_ACTIVATION_TOKEN` 等启动令牌，避免 KWin 把游戏窗口合并到织界图标下。
- **卡片文案**：四张 L0 卡片只保留用户可操作的信息；移除协议号、task 编号、内部实现口径（如「写死」「产品自管直启」「version JSON + 包内 Java」）等开发者说明。
- **验证**：cargo test **52 passed / 0 failed / 4 ignored**（含真实 /proc 的 Prism EntryPoint 模拟）；完整 Playwright e2e 见本次运行；verify 绿（仅既有 G-FRESH-READER 告警）。

## 7.2a 2026-11-03 卡顿修复

启动页安装诊断只在首次/手动执行，env_probe 与 env_refresh 在后台运行；周期状态仍读 env_state。壳和 Studio Hook 忽略 updatedAt 去重，iframe load 强制补发。兼容 start_paper 入口进入同一后台启动锁。测量与回归见 docs/63。

## 7.2 2026-11-03 审计修复

接手时 shell.js 缺少 §2 声明的 env/quit/session 接线与 IPC 白名单；本轮已按契约恢复，并以真实 shell 源文件 + Tauri stub 的浏览器回归验证。EnvState 来自 Rust 事件与 2s env_state 兜底；Workbench 卸载会清除旧会话（切到伴玩时由壳保留）；退出确认显式 ack；伴玩恢复事件会切回工作台页面。跨源缩放改用 loom:scale，无需刷新学生编辑器。事件订阅失败时保留初始化和快照轮询。

## 8. 未完成 / 交给后续

1. ~~Studio 侧切换状态源~~ **已完成并合入**：`apps/studio/src/shell-env.ts` 消费壳下发 `loom:env`；地图墙/工作台状态胶囊与 L2 禁用运行/玩家节拍已接入；e2e「桌面壳嵌入」覆盖无第二标题栏、EnvState 驱动与 zoom 100% 链。
2. **P1-5 已补齐（2026-11-03）**：Workbench 卸载发送 loom:session(null)，壳同步到 set_game_session；清理消息带 previousSessionId，避免误清新会话。
3. **L2 阻断已接线（2026-11-03）**：壳显示客户端掉线覆盖层并提供重连/返回启动页/退出入口；Studio 使用同一 EnvState 禁用运行与玩家节拍。
4. **打包期（task-11/16/17/18/20）**：`build-assets.mjs` 会把新的 wizard.html/shell.js 复制进 dist/runtime；**Lead 已在合入后重建 Linux 包（AppImage 459M / RPM 453M，2026-11-02 23:28）**。Windows 安装包仍需在 Windows host 重建/重装后做 GUI 真机验收。
5. **真机 GUI 回归**（1.21.1 在跑 + 点击/自动启动 26.1.2 最终四灯绿且旧客户端仍在、26.1.2 已连接不重复启动、缺 26.1.2 时一键准备采用 repo 资产、退出只关产品客户端）：Linux 包已重建、无头 e2e/静态契约已过；Windows GUI 待 Windows host 重装后执行。窗口几何查 `~/.loomcraft/logs`「恢复窗口几何已夹到工作区」，启动器行为查 `launcher.log`（direct/reuse/一键准备）。L01 hidden h1、world 干净包等既有问题不在本任务内。
6. **版本门控/启动器已知边界（task-16/18/20）**：
   - 「客户端灯 ready」= 版本匹配的 26.1.x 进程在运行；不等于已成功进服（插件 health 只报 bot 连接）。真正进服由 L2 会话/Studio 事件确认。
   - 版本解析依赖 `--version` 命令行或窗口标题；读不到时保守「未知版本」不绿。
   - **task-20 一键准备只采用本机现有资产**（`versions/26.1.2/26.1.2.json`，并可把路径写入设置）；不在运行时下载游戏资产、不打包 Mojang 资产。没有现有资产时打开官方下载页并给路径/环境变量引导。
   - 方案 A 完整自动下载、方案 C ViaVersion 未实现，等用户确认；不改 Paper/客户端版本锁。
   - **UI 接线（不在本任务范围）**：`client_prepare` 命令已注册，`EnvState.clientPrepareAvailable/clientInstallDir` 已下发；shell 的 `BRIDGE_COMMANDS` 白名单与 L0 按钮由 UI agent（task-19）接入——本任务按约束未改 shell。
   - Linux 版本探测用 `/proc/*/cmdline`；Paper ownership 检查用进程命令行；未在 Linux 实机回归。
