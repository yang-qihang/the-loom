# 57 — 启动流程 / EnvState / 客户端启动器契约（task-7/8/9/11/16/17/18）

> 状态：已实现并完成对抗性 P0/P1 加固 + 集成真机修复 + 版本门控 + 窗口几何 clamp + 多客户端启动（本地工作区，未提交）｜日期：2026-11-02
> 基线：`85cc282`（工作区含未提交改动；Studio 侧另有 ui-shell-fixer 的 WIP，见 §8）
> 上游：`docs/53-game-start-flow-design.md`、`docs/54-takeover-audit-and-task-plan.md`、`docs/58-client-version-compatibility-review.md`、`tmp/audit/ui-issues.md`、`tmp/audit/launcher-adversarial-review.md`、`tmp/integrated-screen.png`
> 实现范围：`apps/desktop/src-tauri/**`、`apps/desktop/shell/**`、`docs/**`；**不改 `apps/studio`**。
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
| `launch_client` | — | `OpStatus` | 客户端启动链（复用→Prism→HMCL→direct→official→PCL2→引导） |
| `restart_client_and_reconnect` | — | `OpStatus` | L2：优先复用上次适配器，quickPlay 回当前 Paper；不重建会话 |
| `set_game_session` | `{ sessionId, levelId }` / 空 | — | 壳收到 Studio 的 `loom:session` 后同步；空 = 清除 |
| `clear_game_session` | — | — | 回 L0 / 退出关卡时清除 |
| `open_launcher_download` | `{ kind: "prism"\|"hmcl"\|"official"\|"pcl2"\|"install" }` | `OpStatus` | 只打开 http(s) 下载页；URL 经 scheme/字符白名单，Windows 用 `rundll32 url.dll` 不经 shell |
| `env_cancel` | — | `OpStatus` | P1-3：取消进行中的《我的世界》启动链；等待窗口的直启 child 会 kill |
| `quit_game` | — | — | L1 完整退出（含客户端/服务端/织界） |
| `quit_ack` | — | — | shell 已显示退出确认（停止 Rust 10s 兜底计时） |
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

**触发时机（task-11/16/18）**：L0 启动后 `env_autostart` 在 Paper/engine 就绪后自动调用一次启动链（`should_autostart_client` 单测覆盖：正常环境未运行/不兼容→尝试；**版本兼容在跑**/mock/`LOOM_DISABLE_CLIENT_AUTOSTART`→跳过）；之后用户也可在卡片点「启动《我的世界》」或 L2「一键重启并连接」——**三条入口都走 `spawn_client_worker` → `launch_client` 同一条路径**。失败（含只拉起了启动器 UI 但窗口超时、拉起的版本不匹配）会在 EnvState 里给出 error/needs_action + guide，L0 显示「去安装启动器/重试」与中文版本提示。quickPlay 只在 engine 确认 26.1.2 Paper 时追加（`spawn_client_worker` 校验 health 后才传 server）。

顺序（`launch_client`）：

1. **已运行**：版本匹配（26.1.x）→ `adapter="reuse"`，绝不重复启动；**不兼容（如 1.21.1）→ 不杀、不失败**，记下旧版本并继续启动产品 26.1.2（task-18）。启动顺序变为 **direct 优先**（产品自管 `.minecraft/26.1.2`），Prism/HMCL/官方/PCL2 次之；`launch_adapter_order(prefer, old_incompatible_running)` 单测覆盖。
2. **Prism**（自动化最稳）：
   - Windows 常见路径 + `where prismlauncher.exe`；Linux flatpak `org.prismlauncher.PrismLauncher` 或 PATH。
   - 从 `instances/*/mmc-pack.json` 找 `uid=net.minecraft` 且版本 = 目标版本（默认 26.1.2）的实例 → `--launch <instance>`。
   - 找不到实例 → 只拉起 Prism UI，返回「请在 Prism 里选 26.1.2」（needs manual）。
   - 旧设置 `prismCommand`：**P0-4 后只接受可执行文件路径/名称并直启（不经 cmd /C start / sh -lc，不接受参数或 shell 元字符）**；非法值在保存/启动两层都会被拒绝。
3. **HMCL**：`HMCL.jar`/`hmcl.exe` → 拉起 UI；CLI 未确认，所以走「拉起 + 等待窗口 + 引导」。
4. **直接启动 `.minecraft`**（离线 profile，自动化兜底）：
   - 目录探测：`LOOM_MINECRAFT_DIR` → `%APPDATA%/.minecraft` → 仓库 `.minecraft`（开发机）→ `~/.minecraft`。
   - 版本 JSON：`versions/<version>/<version>.json`；rules 按 `windows/linux/osx` + host arch 过滤；classpath 含所有匹配库（含 `:natives-*` jar，LWJGL 会从 classpath 解压 natives；`${natives_directory}` 指向 `~/.loomcraft/runtime/natives/<version>`）。
   - Java：`LOOM_JAVA` → 随包 `runtime/real/java/bin/java` → `.minecraft/runtime/java-runtime-*` → PATH。
   - 参数（P1-2 修正）：quickPlay features **全部关闭**，不让 version JSON 展开 `${quickPlayPath}` 等半成品占位符；手工只追加一次 `--quickPlayMultiplayer 127.0.0.1:25565`；`--width/--height` 去重；任何残留 `${...}` 清空。
   - 日志：`~/.loomcraft/logs/minecraft.log`；等待窗口/进程超时或**取消**时 **kill 自己 spawn 的 java**（P1-3，不留孤儿）。
5. **官方启动器**：拉起 UI + 引导（自动化 quickPlay 最弱）。
6. **PCL2**：拉起 UI + 引导（CLI 未确认，不承诺自动进服）。
7. **都没有**：`guide="install"`，L0 卡片出现「去安装启动器」，`open_launcher_download` 打开 Prism/官方下载页。

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

- **纯逻辑**（`window_geometry.rs`，15+ 单测）：`restore_rect(saved, work, min, preferred)` 先夹 width/height 到工作区、再夹 x/y；**与工作区零交集**（旧显示器被拔/换屏/负坐标）→ 夹好尺寸后居中回退；`None`/0 尺寸 → 默认 1280×840 居中；工作区小于最小窗口（420×620）→ 允许缩到工作区大小。`fully_visible` 做恢复后校验。
- **Windows 工作区**：`win_work_area` 用 `MonitorFromPoint` + `GetMonitorInfoW` 取 **rcWork**（已扣任务栏），不是整块屏幕；其它平台退化为 monitor 全尺寸。真实 Win32 查询单测 `win32_work_area_query_and_real_screen_clamp` 已在本机通过。
- **恢复前**：`apply_saved_window` 用 `choose_saved_work_area` 选交集最大的显示器（都不相交 → 主屏），逻辑坐标 clamp 后 set；**恢复后**：窗口可见时 `show_main_window`/ScaleFactorChanged 再按物理外框 clamp 一次（WM/DPI 二次调整兜底），并写回修正几何。
- **保存时**：`save_window_geometry`/`save_geometry_if_windowed` 在 **全屏或最大化时直接跳过**（不写 geometry）；写盘前也 clamp 到当前工作区，超屏/负坐标不会进 settings.json。
- **模式切换**：`apply_mode`（伴玩/工作台）与 `window_restore_main`（取消最大化/全屏）后都 clamp，窄工作区不会因固定 1280×840 溢出。
- **DPI**：保存的是逻辑坐标，恢复按当前 monitor 逻辑工作区 clamp；本机 125% 场景测试（逻辑工作区 1365×768，保存 1585×891）验证物理 1707×960 内 fit。

## 6. 跨平台与 cfg 约束

- Windows 专属：`win_focus`（EnumWindows + 只聚焦 launcher 校验过的 PID）、`launcher::win32`（Toolhelp 枚举 java/javaw + PEB 读命令行 + 对校验 PID 的窗口发 WM_CLOSE）、`CommandExt` 隐藏控制台、`where` 探测。
- Linux 专属：`x11_focus`、`/proc/*/cmdline` 进程探测、`kill(2)` SIGTERM、`xdg-open`、`flatpak`。
- 其余（环境状态机、启动器编排、窗口命令）平台无关；所有 Windows 特殊逻辑都在 `#[cfg(target_os = "windows")]` 内，Linux 编译走 `#[cfg(target_os = "linux")]` 分支。
- **命令注入收口**：`launcher.rs` 不再出现 `cmd /C start` / `sh -lc`（自定义启动器直启 exe；下载页走 `rundll32 url.dll` / `xdg-open`）；`SHELL_META` 拒绝 `& | < > ^ ` " ' ; $ % !` 与控制字符。
- Linux 打包不受影响：未新增 Cargo 依赖；只用 `serde/serde_json`（已有）。

## 7. 测试与证据

本轮（task-18 多客户端启动后）实际跑过（Windows host，`85cc282` + 本地未提交改动）：

- `cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml`：**exit 0，0 warnings**。
- `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`：**48 passed / 0 failed / 2 ignored**
  - `envstate`：四灯判定/全绿/错误+启动中、客户端丢失→恢复、mock 不阻断、织偶超时 needs_action、client 1.21.1 不绿 / 26.1 族绿 / 未知版本不绿 / 端口-only 不算 Paper ready / 旧 Paper 版本 error / L2 版本不匹配文案 / **多客户端优先 26.1.2 + 旧版本提示不阻塞**；
  - `launcher`：rules/arch、Maven→路径、Prism 实例、直启命令、离线 UUID、命令注入拒绝、quickPlay、cancel、open_url、`--version` 解析与兼容矩阵、空目录不挡 versions/26.1.2、PCL `D:\Prograft` 候选、**多客户端 probe 优先 26.1.x + gameDir 解析 + otherVersions**、**旧客户端在跑时 direct 优先的启动顺序**；
  - `window_geometry`：窗口几何 clamp 全套（见 §5.1）+ 真实 Win32 rcWork 查询。
  - 2 个 ignored 机器相关测试（本次显式 `--ignored` 跑过，只读/不 spawn）：**机器上 26.1.2 被识别（version/gameDir 有效）+ `launch_client` 走 reuse、不重复启动**。
- 仓库根 `npm test`：**28 files / 251 tests PASS**（本批未触碰 JS 测试域）。
- 静态契约/回归检查：`tmp/audit/launcher-contract-check.log` **65/65**（task-9/11/16）+ `tmp/audit/task17-window-contract-check.log` **18/18**（窗口几何）+ `tmp/audit/task18-multiclient-contract-check.log` **17/17**（多客户端 direct 优先 / 不杀旧客户端 / 只关产品客户端 / gameDir 复用 / machine reuse）。合计 **100 项静态回归 PASS**。
- **受控 UI 验证（headless Chromium，不启 GUI）**：`tmp/audit/task11-dot-verify.mjs` + `shell-dot-harness.html` → **12/12 PASS**（四灯颜色映射 + 事件/快照两条路径 + mock + versionBlocked 硬门控）。证据：`tmp/audit/task11-dot-harness-{event,ready,version-gate}.png`、`task11-dot-harness.json`。
- **真机只读探测**（`tmp/audit/task16-real-env-probe.log` + 本轮 `task18` 机器测试，未杀任何进程）：
  - 本轮运行中：java PID 8280 `--version 26.1.2 --gameDir D:\VScode_code\the-loom\.minecraft`；25565/4317 有监听；26.1.2 已连服（Lead 日志 `Alami joined the game`）；
  - 机器测试验证 `client_probe` 优先 26.1.2、`gameDir` 有效；`launch_client` 命中 reuse、无 child（**不重复启动当前 26.1.2**）；
  - 旧场景（上一轮）PID 41176 `--version 1.21.1` 已由 task-16 门控覆盖；task-18 新增「旧客户端在跑仍继续 direct 启动 26.1.2」的纯逻辑回归。
- 语法检查：`shell.js` 与 `wizard.html` 内联脚本 `node --check` PASS（纳入 65/65）。
- **未做**：真机 GUI 验证（需等 Lead 重建安装包）：1.21.1 在跑 + App 点击/自动启动 26.1.2 最终四灯绿、旧客户端保持不关、quickPlay 进 25565、X 二次放行、全屏/窗口几何。

## 8. 未完成 / 交给后续

1. **Studio 侧切换状态源（P1-10，ui-shell-fixer WIP）**：`loom:env` 消费（顶栏「织机在线」）与 L2 时禁用运行/评分/切关需要改 `apps/studio`；当前工作区有 ui-shell-fixer 的未提交 Studio 改动（`shell-env.ts` untracked 等），本任务未触碰、也未验证。**建议 task-7/8/9 与 Studio 接入原子提交或由 Lead 明确降级**。
2. **P1-5 部分收口**：壳在进入工作室/回 L0/伴随退出时会 `clear_game_session`，但 Studio 从关卡返回地图墙不会主动发 `loom:session(null)`（需要 Studio 改动）；地图墙上的旧会话可能让 L2 阻断多显示一会儿，用户可「回到 L0」清掉。契约：Studio 应在 Workbench unmount 时 `postMessage({type:"loom:session", sessionId:null, levelId:null})`。
3. **L2 阻断在 Studio 内部**：目前壳用全屏红色覆盖层挡住 iframe 交互；Studio 内没有单独禁用按钮（无 Studio 改动时的唯一可行方式）。
4. **打包期（task-11/16/17/18 阻塞点）**：`build-assets.mjs` 会把新的 wizard.html/shell.js 复制进 dist/runtime；本轮未重建安装包。当前安装的 407.5MB 包（sha256 C9BA…）**早于 task-11/16/17/18 修复**，需要重建/重装后才能真机看到「自动拉客户端 / 1.21.1 在跑仍启动 26.1.2 / 顶栏四灯同色 / 窗口几何 clamp」；开发机无打包 runtime 时 Paper 仍会回退 `scripts/mc-up.sh`（仅本地开发兜底，不属于产品路径）。
5. **真机 GUI 回归**（1.21.1 在跑 + 点击/自动启动 26.1.2 最终四灯绿且旧客户端仍在、26.1.2 已连接不重复启动、旧 Paper 占 25565 提示、四灯/门控/退出/全屏/重连、保存大窗口几何不裁边）待 Lead 重建安装包后在桌面阶段执行；窗口几何修复可查 `~/.loomcraft/logs` 的「恢复窗口几何已夹到工作区」日志，多客户端可查 `launcher.log` 的客户端（direct/reuse）与「另有 … 在运行」提示。L01 hidden h1、world 干净包等既有问题不在本任务内。
6. **版本门控的已知边界（task-16/18）**：
   - 「客户端灯 ready」= 版本匹配的 26.1.x 进程在运行；**不等于已成功进服**（插件 health 只报 bot 连接，不报玩家连接）。真正的进服由 L2 会话/Studio 事件确认；进入工坊后的世界内错误仍走 L2。
   - 版本解析依赖 `--version` 命令行或窗口标题；两者都读不到时保守显示「未知版本」不绿（可点重试）。
   - **task-18**：旧客户端在跑不再阻塞启动；direct 优先复用检测到的 26.1.2 `--gameDir`（并持久化到设置 `minecraftDir`），找不到时再 Prism/HMCL。产品仍未实现「自动下载准备 26.1.2」（方案 A）与 ViaVersion（C）；若机器上不存在 26.1.2 客户端，会失败并给安装/指定路径提示。
   - 方案 A/C 未实现，等用户确认；不改变 Paper/客户端版本锁。
   - Linux 版本探测用 `/proc/*/cmdline`；Paper ownership 检查用进程命令行；未在 Linux 实机回归。
