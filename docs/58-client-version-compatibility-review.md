# 58 — Paper 26.1.2 与用户自有 MC 客户端版本兼容审查

> 状态：只读审查报告（task-13）｜审查人：l01-e2e-auditor｜日期：2026-11-02 17:5x（Asia/Shanghai）
> 范围：`docs/26`、`docs/43`、`docs/51`、`docs/53`、`docs/57`、`docs/17`、`docs/02`、`README.md`、`docs/42`
> 代码：`apps/desktop/src-tauri/src/{main.rs,launcher.rs,envstate.rs}`（工作区未提交 WIP）、`bot/manager.mjs`、`packages/*`、`content/levels/*`
> 运行时：`apps/desktop/src-tauri/runtime/real/paper`、`it/.mc-server`、安装后的 `%LOCALAPPDATA%\Loomcraft\runtime\real` 与 `~/.loomcraft/runtime/paper`
> 用户环境（只读）：`%APPDATA%\.minecraft`、`D:\VScode_code\the-loom\.minecraft`、`D:\Prograft\tools\pcl\launcher-2.14`、`C:\Users\Alami\Downloads\PCL*`、运行中进程/日志
> 约束：未改代码、未 commit/push、未启动 GUI/未杀任何进程；结论均为读文件/读日志/读进程命令行/公开资料核对。

---

## 0. 结论（TL;DR）

1. **服务端确实“硬要求” 26.1.2，这不是配置问题**：内置 Paper 是 `26.1.2-74-e4e17fc (MC 26.1.2)`（`runtime/real/paper/version_history.json`），其 `version.json` 的 `protocol_version=775`；用户当前客户端是 **MC 1.21.1（protocol 767）**。Minecraft 原版/Paper 的登录握手只接受**完全相同协议号**的客户端，所以 1.21.1 客户端**原生完全无法连接**（多人列表显示 “Incompatible version!”，进服被踢 “Incompatible client! Please use 26.1.2”）。
2. **服务端版本不能随意改**：版本锁 26.1.2 是硬约束——mineflayer 4.39.0 / minecraft-protocol 1.68.0 的 `supportedVersions` 只到 `26.1`（协议 775），`docs/02` 记录 26.2/26.3 会把 bot 踢掉；插件/内容/世界/10 关真实 e2e 都建立在 Paper 26.1.2 上。降级到 1.21.1 同样是全链路返工，不在合理范围。
3. **用户投诉的产品侧根因是“启动器 adapter 版本盲”，即真实产品缺陷**：
   - 只要检测到**任意版本**的 MC 客户端在跑，就点“客户端已连接”并让四灯全绿 → `进入工坊` 可点（`launcher.rs:118-136,461-463`、`envstate.rs:267-276`、`main.rs:1561,1578`）；
   - 自动启动在“客户端已在运行”时直接跳过（`main.rs:1682-1688`），不会去准备/拉起 26.1.2；
   - 实测证据：安装版 app 在 2026-11-02 17:46:51 记录 `客户端（pcl2）：已通过 PCL2 启动《我的世界》`（`~/.loomcraft/logs/launcher.log`），同一秒用户环境中由 PCL 启动的 java 进程命令行是 `--version 1.21.1`；app 里没有任何版本校验。
4. **推荐方案：D（版本检测+门控+明确引导，P0 立刻做）+ A（产品侧准备/直启 26.1.2 客户端，P1 主方向），服务器保持 26.1.2（B 是约束、不是方案）；C（ViaVersion+ViaBackwards）技术上可行，但只建议作为“用户硬性要求用自己的旧客户端”时的实验性开关，不做默认。**
   - 只做 B（现状/文档“用户须装 26.1.2”）不足以解决投诉；
   - C 的公开可用性已核实（ViaVersion 5.9.1 / ViaBackwards 5.9.1 的 Paper 支持范围正好覆盖到 26.1.2；最新 5.12.x 覆盖到 26.3），但 ViaBackwards 明确“不能给旧客户端增加新特性”，本项目 L09 又用了 26.1 才有的 `minecraft:iron_chain`，且引入 GPL 第三方、扩大测试矩阵；
   - A 能兑现 README 的“用户只需正确版本”承诺：先扫描本机所有启动器里的 26.1.2；没有就（可选）从 Mojang 官方源下载一个产品自管的 26.1.2 profile，用内置 Java 25 直启 + quickPlay 进 25565；**不打包 Mojang 资产、不杀用户已有客户端、不要求用户关掉自己的客户端**。

**一句话**：这不是“服务端太挑”，而是“产品没告诉/没帮用户拿到对的客户端”；先把版本变成可见的状态和硬门控（D），再让产品替用户准备 26.1.2（A）；ViaVersion（C）是另一条能跑通但会牺牲视觉保真与维护简单性的路，只作后手。

---

## 1. 事实：服务端与客户端的版本/协议到底是多少

### 1.1 服务端（内置 Paper）— 只读核对

| 事实 | 值 | 证据 |
|---|---|---|
| Paper 版本 | `26.1.2-74-e4e17fc (MC: 26.1.2)` | `apps/desktop/src-tauri/runtime/real/paper/version_history.json`；安装版 `%LOCALAPPDATA%\Loomcraft\runtime\real\paper\version_history.json`；`~/.loomcraft/runtime/paper/version_history.json` 同值 |
| 协议号 | **775**（`world_version=4790`，data pack 101.1） | Paper jar 内 `version.json`（`runtime/real/paper/paper.jar` 根条目） |
| 端口/模式 | `server-port=25565`、`online-mode=false`、`enforce-secure-profile=false`、`level-type=flat` | `runtime/real/paper/server.properties`；安装版写盘副本同值 |
| 启动方 | 桌面壳 `spawn_bundled_paper` 用包内 Java 25 起 `paper.jar` | `main.rs:696-760`（`MC_PORT=25565` 见 `:25`） |
| 服务端日志 | `Starting minecraft server version 26.1.2`、`Paper 26.1.2-74-ver/...` | `~/.loomcraft/runtime/paper/logs/latest.log`（2026-11-02 17:40 启动） |

### 1.2 客户端（用户机器上实际存在的）

| 位置 | 内容 | 证据 |
|---|---|---|
| `%APPDATA%\.minecraft` | **只有 `runtime/`（官方 launcher 的 Java runtime），没有 `versions/`** | 只读列目录 |
| `D:\VScode_code\the-loom\.minecraft` | **完整 26.1.2**（`versions/26.1.2`、38MB client jar、8446 个 asset objects、140 libs、Java runtime；合计 1.37GB/9036 文件），由 `.tools/install_mc.py`（minecraft_launcher_lib）于 10-31 安装；`.tools/launch_mc.py` 用 `.tools/jdk25` 直启 26.1.2 + quickPlay 到 25567 | 只读列目录/读脚本 |
| `D:\Prograft\tools\pcl\launcher-2.14` | **PCL2 2.14（用户自己常用启动器，UI 进程自 10-31 常驻）**；其 `.minecraft\versions` 只有 **1.21.1** | 进程命令行/`PCL\Log1.txt`/只读列目录 |
| `C:\Users\Alami\Downloads\Plain Craft Launcher 2.exe` + `Downloads\.minecraft`、`Downloads\PCL` | 一份**旧的 PCL2 副本**（2.13.x 日志）+ 空的 `.minecraft\versions`；被产品 adapter 的候选路径命中 | 只读列目录/`Setup.ini`/日志 |
| Prism / HMCL | 本机**未发现**（AppData、Program Files、常见目录均无） | 只读扫描 |
| 官方启动器 profile | 无 `launcher_profiles.json` 用户版本记录 | `%APPDATA%\.minecraft` 只有 runtime |
| 旧 Prograft | MC **1.21.1** / Paper 1.21.1 / Java 21（`D:\Prograft`），与项目 26.1.2 不同代，**不能混用** | `.tools/WINDOWS-SETUP.md` §1；PCL 日志 |

**运行中的客户端（审查时只读观察到）**：`java.exe`（PID 41176，创建于 2026-11-02 17:46:51）命令行含 `-Dminecraft.launcher.brand=PCL`、`--version 1.21.1`、`--gameDir D:\Prograft\...\.minecraft\versions\1.21.1`、`net.minecraft.client.main.Main`——**1.21.1 客户端，用户在跑**。

### 1.3 1.21.1 vs 26.1.2 的协议事实

| 版本 | protocol_version | 来源 |
|---|---|---|
| Minecraft 26.1.2 | **775** | client jar / paper jar 内 `version.json`（同值） |
| Minecraft 26.1 | 775 | `bot/node_modules/minecraft-data/minecraft-data/data/pc/26.1/version.json`（`version: 775`） |
| Minecraft 1.21.1 | **767** | `D:\Prograft\...\versions\1.21.1\1.21.1.jar` 内 `version.json`；minecraft-data `1.21.1/version.json` |

补充：项目 bot 以 **`version: "26.1"`** 连接 26.1.2 服务端（`bot/manager.mjs:48`、`:62-67`），在所有真实 e2e 日志中成功 → **26.1 / 26.1.2 共用协议 775**，同协议族客户端（26.1.x）可原生连；1.21.x 不行。

### 1.4 原版/Paper 的协议兼容边界（回答“26.1.2 服务端能接受哪些客户端”）

- Java 版登录握手由客户端在 `ClientIntentionPacket` 里声明 protocol；**服务端要求 protocol 与服务端完全一致**，否则在登录阶段断开；Paper 没有“多版本/范围放宽”的原生开关（`server.properties` 里没有任何 protocol 选项）。
- 服务端断开文案来自 translation key：`multiplayer.disconnect.incompatible` = `Incompatible client! Please use %s`（Paper 26.1.2 jar 内 `assets/minecraft/lang/en_us.json` 已核对）；多人列表上的红字是 `multiplayer.status.incompatible` = `Incompatible version!`。
- `docs/17-day0-mc-install.md` §0/§6 已把这条事实写进项目文档：“客户端/服务端协议按版本匹配；用错版本会出现 Incompatible client / Outdated client / Outdated server”“客户端必须 26.1.2，不要 1.21.x，也不要 26.3”。
- **认证不是本次阻塞**：`online-mode=false`，1.21.1 客户端即使离线登录也会在协议握手阶段被拒，和账号/皮肤无关。

**因此**：26.1.2 服务端原生只接受 **协议 775（26.1.x 族）** 的客户端；要让 1.21.1（767）连上，只能加协议翻译层（ViaVersion + ViaBackwards，见 §3），或让用户换/装一个 26.1.x 客户端（见 §2、§4）。

---

## 2. 现状：产品“硬绑 26.1.2”到底绑在哪、有没有软件层校验

### 2.1 设计文档最初（Linux/Prism 26.1.2）怎么说

- `docs/26` §2/§3：App 进程树 = Tauri + engine sidecar + **Paper 26.1.2** + “**通过 Prism flatpak 拉起 Minecraft Java 客户端**”；“不内嵌 MC 客户端；app 负责拉起/检测/复位”。§9 落地结果：“用户只需装 Minecraft 26.1.2”。
- `docs/43` §1/§3：用户应自己安装 **Minecraft Java 26.1.2**（Prism/Flatpak 均可）+ 正版账号 + Java 25；“这些属于用户自己的 Minecraft 环境，不应由游戏安装包静默替换”。
- `docs/51` §5：Windows 的 Prism 检测/启动改为“常见安装路径 / prismlauncher.exe”；**没有** PCL/HMCL 版本语义。
- `docs/53`/`docs/57`（task-7/9/11 新增）：启动链 reuse → Prism → HMCL → direct `.minecraft` → 官方 → PCL2 → 引导；Prism 分支会按 `instances/*/mmc-pack.json` 匹配 `net.minecraft == 26.1.2`；direct 分支要求 `versions/26.1.2/26.1.2.json`；**HMCL/官方/PCL2 只“拉起 UI”，不控制版本**。`docs/53:120` 明确“通用 `.minecraft` 版本：检测 `versions/26.1.2/26.1.2.json`”。
- → 设计意图本来就是“客户端必须与 26.1.2 一致”，Prism 路径有版本匹配（只对实例），但**非 Prism 路径 + 已运行复用路径没有版本校验**，这是实现与设计意图脱节之处。

### 2.2 服务端侧“硬绑”审查（确认不是可配置项）

- Paper jar/版本：见 §1.1，写死由运行时分发；`main.rs` 的 `spawn_bundled_paper` 直接 `-jar paper.jar --nogui`，无版本参数可调。
- bot：`bot/manager.mjs:48` `version = "26.1"`；`mineflayer 4.39.0` 的 `supportedVersions`（minecraft-protocol `src/version.js`）= `["1.21.1","1.21.3",…,"1.21.11","26.1"]`，**不含 26.1.2 / 26.2 / 26.3**；`docs/02` §1 记录 26.3 会把 bot 在 join 后 ~1.5s 踢掉（issue #4189）。所以服务端 26.1.2 是 bot 可用的最新/唯一选择。
- 内容/插件/世界/评分基线：`plugin` 以 `paper-api 26.1.2.build.74-stable` 构建；10 关场景/世界布局/真实 e2e 都在 26.1.2 上验证（`docs/02`、`docs/17`、`STATUS.md`）。改服务端版本 = 全链路返工 + 违反 AGENTS 红线 1（版本锁）。
- **结论**：服务端“硬 26.1.2”是**刻意的、有依据的**，不是配置错误；产品需要解决的是**客户端获得与版本检测**，不是改服务端。

### 2.3 客户端检测/启动链的版本盲点（本次投诉的直接原因，按代码位置）

| # | 盲点 | 位置 | 后果 |
|---|---|---|---|
| B1 | “客户端在运行”只校验进程命令行含 MC 主类/GLFW，不解析 `--version` | `launcher.rs:109-136`（`client_process_running`/`minecraft_pids`）、`:290-390`（`process_cmdline`，已有完整命令行文本） | 1.21.1 被当作“客户端已连接” |
| B2 | 复用分支直接返回成功，无版本校验 | `launcher.rs:457-463` | 点“启动客户端”时若旧客户端在跑 → 不采取任何修复动作 |
| B3 | 四灯 `client` = `client_running`；`all_ready` 直接由它构成 | `envstate.rs:267-276`；`main.rs:1561,1578` | 旧版本客户端 → 四灯全绿 → `进入工坊` 可点 |
| B4 | 自动启动在“客户端已运行”时跳过（只按布尔值） | `main.rs:1672-1693`、`envstate.rs:110-113` | 旧版本客户端在跑时，产品永远不会尝试拉起 26.1.2 |
| B5 | EnvState 没有 `clientVersion` / `serverVersion` / `compatible` 字段 | `docs/57 §2` schema；`envstate.rs` `EnvLight`/`EnvState` | UI 无法显示“版本不匹配”，只能显示“已连接” |
| B6 | direct 适配器只认 `versions/<默认版本>/…`，且 `resolve_minecraft_dir` 取**第一个存在的目录**；`available_versions` 是 dead code | `launcher.rs:887-897`、`:1256-1285`、`:1287-1301` | 本机 `%APPDATA%\.minecraft` 只有 `runtime/`，会“挡住”后面的 repo `.minecraft`（即使 `repo_root` 可用也不会 fallthrough）；即便用户 Prism/PCL 里有 26.1.2，也不会被扫描 |
| B7 | PCL2 候选路径只有 Desktop/Downloads/LocalAppData 5 个，且不传版本、拉起后只等“窗口出现” | `launcher.rs:849-883`；`wait_for_client` `:1429-1450` | 命中的是本机 `Downloads` 旧 PCL 副本，而不是 `D:\Prograft` 的常用 PCL；只要出现任意版本 MC 窗口就 `ok("pcl2","已通过 PCL2 启动《我的世界》")` |
| B8 | HMCL/官方同样只拉 UI，无版本控制/校验 | `launcher.rs:749-810`、`:814-847` | 同上，可能拉起旧版本并“假成功” |
| B9 | Prism 分支是唯一有版本匹配的（`mmc-pack.json` 里 `net.minecraft == 26.1.2`）；但本机没有 Prism | `launcher.rs:702-732` | Linux 原生体验尚可；Windows 用户主流 PCL/HMCL 场景失守 |
| B10 | `settings.mcVersion` 存在于 Rust Settings，但 UI 只可编辑 `prismCommand`，且即使改版本也不与服务端版本比对 | `main.rs:56-58,266-270`；`shell.js` 设置页 | 高级用户也无法自助修正；无“客户端版本/目录”可视/可配 |
| B11 | `paper_ready` = 25565 端口打开；“世界已在运行”不校验服务端身份/版本 | `main.rs:25,1528-1530`、`:576-602`、`:696-702` | 用户旧 Prograft Paper 1.21.1 若占住 25565，产品会误判“世界已就绪”，随后 bot 以 26.1 连 1.21.1 失败 |
| B12 | 文档 `docs/53:213-218` 写“本机没有找到 PCL/PCL2”，与实际（PCL2 2.14 常驻、其 1.21.1 客户端在跑）不符；`docs/42`/README 只给 Prism/Linux 步骤 | `docs/53`、`docs/42`、`README.md` | Windows/PCL 用户没有可执行的中文安装引导 |

**实测证据链（2026-11-02）**：

- `~/.loomcraft/logs/launcher.log`：`[…17:46:51] 客户端（pcl2）：已通过 PCL2 启动《我的世界》`；
- PCL（`D:\Prograft\...\PCL\Log1.txt`）同一时刻 17:46:51 记录启动 `1.21.1`（`[ModLaunch] 游戏版本：正式版 1.21.1`），并 `弹出提示：1.21.1 启动成功！`；
- 运行中 java 进程命令行 `--version 1.21.1`（创建时间 17:46:51）；
- app 的 `settings.json`：`prismCommand=null, minecraftDir=null, mcVersion=null`（没有任何版本约束）；
- app 的 Paper（`~/.loomcraft/runtime/paper/logs/latest.log`，17:40 启动）是 26.1.2 监听 25565，日志中只有 bot `Golem` 的连接，**没有玩家加入记录**（用户根本没进得去）；
- 用户 PCL 的 `servers.dat` 里已有 `127.0.0.1:25565` 条目（用户已尝试连接该服务器）。

> 过程说明：无法从日志确定“1.21.1 是 app 的 PCL 拉起事件间接触发，还是用户同时手动点了 PCL 启动”，但两类事实独立成立且都指向同一缺陷：**app 以 pcl2 成功为由把客户端灯点亮，而实际在跑的是 1.21.1，且 app 未做任何版本校验**。

---

## 3. ViaVersion / ViaBackwards 在 Paper 26.1.2 的可用性与风险（方案 C）

### 3.1 方向别搞反

- **ViaVersion** 官方自述：“allow newer Java Edition client versions to connect to older server versions”（新客户端连旧服务端）。
- **ViaBackwards** 官方自述：“Allow Java Edition clients with older versions to connect to your Minecraft server”（旧客户端连新服务端），且 **依赖 ViaVersion** 一起安装。
- 本场景：客户端 1.21.1 旧、服务端 26.1.2 新 → **需要 ViaVersion + ViaBackwards 两个 jar**（单独 ViaVersion 不解决）。
- 若用户以后装 26.3（比服务端新）→ 需要的是 ViaVersion（新客户端→旧服务端，可能再加 ViaBackwards 的跨小版本处理）；版本矩阵会随用户客户端版本变化。

### 3.2 可用性（公开资料核对，2026-11-02；需实测确认）

| 组件 | 版本 | Paper 支持范围 | 说明 |
|---|---|---|---|
| ViaVersion | **5.9.1**（2026-05-04） | **Paper 1.8–26.1.2** | 正好覆盖本项目服务端 26.1.2 |
| ViaBackwards | **5.9.1**（2026-05-04） | **Paper 1.10–26.1.2** | 同上；依赖 ViaVersion |
| ViaVersion | 5.12.2（当前 pinned/latest） | Paper 1.8–26.3 | 也覆盖 26.1.2（范围下限 1.8） |
| ViaBackwards | 5.12.2（当前 pinned） | Paper 1.10–26.3 | 也覆盖 26.1.2 |

来源：[ViaVersion 5.9.1 Hangar](https://hangar.papermc.io/ViaVersion/ViaVersion/versions/5.9.1)（Platforms: Paper 1.8–26.1.2）、[ViaBackwards 5.9.1 Hangar](https://hangar.papermc.io/ViaVersion/ViaBackwards/versions/5.9.1)（Paper 1.10–26.1.2）、[ViaVersion 主页](https://hangar.papermc.io/ViaVersion/ViaVersion)（pinned 5.12.2，Paper 1.8–26.3；GPL、Java 17+、ViaBackwards 为可选依赖）、[ViaBackwards 主页](https://hangar.papermc.io/ViaVersion/ViaBackwards)（pinned 5.12.2，Paper 1.10–26.3；GPL；明确“ViaBackwards 不能给旧客户端增加新特性，某些功能（如 client-side attribute handling）仍会坏”）。另：2026-03 社区公告（[DeepSMP: Java Edition 26.1.2 Support](https://deepsmp.net/news/java-edition-26-1-2-support)）记录“ViaVersion+ViaBackwards 5.8.0 支持 1.8–26.1.2 客户端连入”，旁证 26.1.2 在支持矩阵内。

**结论**：C 在“能不能跑”层面**可行**（两个 jar 有明确支持 26.1.2 的版本），但需要 pin 具体构建 + 在本机真实服务端实测。

### 3.3 对本项目的风险（按影响排序）

1. **内容保真**：ViaBackwards 不能给旧客户端“新增”方块/物品/特性。对本项目做过内容扫描：`content/levels` + `content/scenes` 共出现 **107 个**带 `minecraft:` 前缀的方块/物品 id，其中 **103 个在 1.21.1 已存在**；**唯一 26.1 新增的是 `minecraft:iron_chain`**（`content/levels/L09.content.ts:795,863-865`，钟楼吊钟的链条；1.21.1 没有该方块，旧客户端会缺失/被替代），L09 场景视觉会不对。其余 id 都在 1.21.x 范围（灯笼/羊毛/苔藓/杜鹃/铁砧等），所以**视觉风险总体可控但非零**。
2. **玩法/UI 兼容**：ViaBackwards 自己声明“某些特性（client-side attribute handling 等）仍会坏、无法修”；玩家节拍依赖右键灯柱（`PlayerInteractEvent`/`BlockPlaceEvent` 位置容差）、actionbar 提示、位置 HUD……需要逐关实测，特别是 L03（钟/交互）与 L05–L09（容器/农田/实体交互）。
3. **维护与依赖**：给产品加了**两个 GPL 第三方插件**（需随包分发 license/源码链接、固定版本与 sha256、跟随上游升级）；当前版本锁体系不包含它们；26.1.2 是老版本（最新正式版 26.3），上游未来可能不再为 26.1.2 修 bug；一旦升级 Via* 又可能与 26.1.2 服务端不匹配。
4. **测试矩阵翻倍**：现在真实 e2e 主要验证 bot + 参考解；C 需要**额外**用 1.21.1 真人客户端跑 L01–L10 的进服/玩家节拍/结算/重置 + 视觉截图，且要覆盖 26.1.2 客户端（默认路径）不回归。
5. **协议翻译的“看不见的坑”**：包/属性/注册表差异（26.1.2 的 chain/copper 行为、新 particles/sounds、`client_tick_end` 等）可能造成偶发踢人/交互失灵；与 bot 无关（bot 走 775 原生），但影响玩家。

**判定**：C 是“能解决投诉、但有明确保真与维护代价”的技术路线；如果用户把“必须继续用我现有的 1.21.1”作为硬需求，C 是**唯一**能让其进服的原生路线；否则不建议默认引入。

---

## 4. 方案对比（A/B/C/D）

| 方案 | 内容 | 能解决投诉？ | 优点 | 代价/风险 | 建议 |
|---|---|---|---|---|---|
| **A 产品自带/自动准备 26.1.2 实例** | A-lite：扫描本机所有启动器里的 26.1.2 实例/版本目录并直启；A-full：无 26.1.2 时从 Mojang 官方源下载到产品自管目录（版本 JSON/client jar/libraries/assets；复用内置 Java 25；离线名 + `--quickPlayMultiplayer 127.0.0.1:25565`，`build_direct_command` 已有） | ✅ 让人能玩（换正确客户端） | 服务器/bot/内容锁完全不动；画质与评分真值 100% 一致；不依赖第三方 GPL；与 Prism/Linux 路径同构；`build_direct_command`/`DirectConfig` 可复用；`.tools/install_mc.py` 已证明官方源在本机可下载、`launch_mc.py` 已证明直启+quickPlay 可行 | 需要下载/管理 ~1.4GB（C: 37.8GB / D: 144GB 可用，够）；断网/代理失败需要回退引导；开发量（下载器/进度/重试/哈希/清理）约 1–2 天；法务：**不能打包 Mojang 资产**，只能运行时从官方端点下载（与官方 launcher 同性质），仍需保留“拥有账号”提示 | **P1 主方向**（A-lite 先做，A-full 视网络与法务确认） |
| **B 仅支持 26.1.2（现状）** | 用户必须自己装好 26.1.2，产品只检测/拉起 | ❌ 单独不可行（本次投诉正是它） | 零开发、文档已有（docs/17/42/43） | 用户不知道/不会装；不同启动器差异大；本机 PCL 只有 1.21.1 | **保留为约束，不单独作为方案** |
| **C ViaVersion+ViaBackwards 兼容旧客户端** | 给 bundled Paper 加两个插件（pin 5.9.1 或 5.12.x + sha256），允许 1.21.1 连 26.1.2 | ✅ 直接使用用户现有 1.21.1 | 用户零安装；服务器版本不动；公开支持矩阵覆盖 26.1.2 | GPL 第三方；L09 `iron_chain` 等 26.1 新内容在 1.21.1 缺失；ViaBackwards 明确不能补齐新特性；逐关测试成本；上游版本漂移 | **实验性开关（P2）**，默认关；仅在“必须用旧客户端”时启用并写清限制 |
| **D 版本检测 + 明确引导** | 解析运行中客户端 `--version`（已有 cmdline）+ 扫描启动器版本目录；EnvState 上报 `clientVersion/serverVersion/compatible`；不匹配 → 客户端灯 needs_action + 中文原因 + “去装/一键准备 26.1.2”入口；`allReady` 不通过；修正自动启动/复用逻辑 | ⚠️ 不直接让人能玩，但**让问题可见、可操作**，是 A 的前置 | 代码量小、无新依赖；立刻消灭“假绿灯/假成功”；是正确性修复（本次投诉的产品 bug） | 用户仍需按引导做一次安装（约 0.5–1.4GB） | **P0 立刻做**（与 A 组合） |

---

## 5. 用户环境具体核对（已能解释“为什么用户觉得完全连不上”）

1. **用户用 PCL2 玩 1.21.1**（`D:\Prograft\tools\pcl\launcher-2.14`；PCL 的 `.minecraft\versions` 只有 `1.21.1`）；PCL UI 进程自 2026-10-31 常驻；旧 Prograft 是 Paper 1.21.1 / Java 21。
2. **产品安装版找不到任何 26.1.2**：
   - `%APPDATA%\.minecraft` 只有 `runtime/`（无 `versions/26.1.2`）；
   - repo `D:\VScode_code\the-loom\.minecraft` 有完整 26.1.2（1.37GB），但：
     - 只有从仓库目录启动（`repo_root` 被 `find_repo_root` 识别）时才可能被扫描（`main.rs:785-800`）；
     - 而且 `resolve_minecraft_dir` 取**第一个存在的目录**（`%APPDATA%\.minecraft` 先命中，`launcher.rs:1256-1276`），**不会继续 fallthrough 到 repo `.minecraft`**；
   - Prism 不存在（`try_prism` 匹配不到），PCL2 候选只命中 `Downloads` 的旧副本（`launcher.rs:849-866`），不是 `D:\Prograft` 的常用 PCL；命中后只拉 UI/不指定版本。
3. **产品仍把客户端灯点亮**：`client_process_running()` 只看“有 MC 进程”，不解析版本；`launch_client` 复用分支/自动启动跳过；`allReady` 直接放行。用户于是看到“客户端已连接”、却连不上 25565 的 26.1.2 服务器 → “完全连不上”。
4. **服务器可能被旧 Paper 占端口**：用户环境已有旧 Prograft（Paper 1.21.1）；若它占用 25565，产品的 `paper_ready=port_open(25565)`（`main.rs:25,1528-1530`）会误判“世界已就绪”（`spawn_bundled_paper` 也会直接返回“已在运行”，`main.rs:696-702`），随后 engine 的 bot（以 26.1 协议）连 1.21.1 服务端会失败 —— 这是与本投诉相邻的第二个“版本/身份盲点”，建议同批修。

---

## 6. 推荐方案（按优先级/验收）

### 6.1 P0（正确性修复，立刻做）：版本可见 + 硬门控 + 正确引导（方案 D）

1. **检测运行中客户端版本**：在现有已校验的 MC java 进程命令行里解析 `--version <ver>`（`launcher.rs:290-390` 已能读到完整 cmdline；`launcher.rs:1429-1450` 只做窗口/进程存在性判定）。同时扫描版本目录：
   - `%APPDATA%\.minecraft\versions`、`%USERPROFILE%\.minecraft\versions`、`LOOM_MINECRAFT_DIR`、`settings.minecraftDir`、repo `.minecraft`（仅 dev）；
   - Prism：`instances/*/mmc-pack.json` 里 `net.minecraft` 版本（已有 `prism_instance_for`，`:702-732`）；
   - PCL/HMCL/official：按各自 `.minecraft\versions` 目录（PCL 便携目录、HMCL 配置、官方 AppData）。
2. **EnvState 扩展**（`docs/57 §2` 契约同步）：`client.clientVersion`、`serverVersion`（从 engine `/api/health` 的 `mc.version` 读取，现有 health 已含 `mc.version`）、`client.compatible`、`client.detail/hint/guide`。四灯规则：
   - 兼容（26.1.x，协议 775）→ 绿；
   - 运行中但不兼容 → `needs_action`/`error`，文案示例：“检测到《我的世界》1.21.1；本作服务器需要 26.1.2（协议 767 ≠ 775）。点这里准备 26.1.2，或按指南在启动器里安装。”；
   - 未运行 → 现有逻辑。
3. **硬门控**：`client_ok = mock || (client_running && compatible)`；`allReady` 因此不含不兼容客户端（`main.rs:1561,1578`）。禁止“客户端在跑就绿”。
4. **修正复用/自动启动**：`launch_client` 复用分支必须先版本兼容才 `ok("reuse")`（`:461-463`）；`env_autostart` 只在“已运行且兼容”时跳过（`main.rs:1682-1688`）；不兼容时走 A/引导。
5. **服务端身份校验**：`paper_ready` 除端口外，要求 engine health `mc.version == 26.1.2`（或 SLP 的 version.name）与插件 `loomcraft` 在列；避免旧 Paper 占 25565 假就绪（`main.rs:25,1528-1530`；`spawn_bundled_paper` 的“端口已开=已运行”同理）。不建议随意换端口（用户/文档/服务器列表都用 25565），应先检测并给明确冲突提示。
6. **PCL/文档修正**：`try_pcl2` 命中后必须校验实际客户端版本（用第 1 步的解析），版本不符时不得 `ok`；候选路径补 PCL 常见安装（可通过注册表/快捷方式/`PCL.ini` 或让用户设置“启动器路径”）；更新 `docs/42`/README 增加 **Windows + PCL2** 的 26.1.2 安装步骤（PCL 下载 → 版本 → 26.1.2），并修正 `docs/53:213-218` 的过时“本机没有 PCL”结论。

### 6.2 P1（产品承诺落地，紧随 P0）：准备/直启 26.1.2 客户端（方案 A）

- **A-lite（先做，0.5 天）**：把“扫描已有 26.1.2”做全：多根目录 + Prism 实例 + PCL/HMCL 版本目录；找到就复用/直启（`try_direct` 已有 `build_direct_command`，支持离线名 + quickPlay；Prism 已有 `--launch` 实例匹配）。对“已有 26.1.2 的用户”足够。
- **A-full（视网络/法务确认，1–2 天）**：都没有时，`客户端` 卡片提供“准备 26.1.2 客户端（约 0.6–1.4GB，官方源）”：
  - 从 `piston-meta.mojang.com` 拉 version manifest → 26.1.2 version JSON（`assetIndex` 30、client jar sha1、libraries 规则）→ 下载 client jar + libraries（按 OS/arch 规则）+ assets objects，存到产品自管目录（建议 `~/.loomcraft/minecraft`，与 Paper 的 `~/.loomcraft/runtime` 并列）；
  - 复用包内 Java 25（`main.rs:634 bundled_java_path`；`.tools/launch_mc.py` 已用 `.tools/jdk25` 成功直启 26.1.2）；
  - 用现有 `build_direct_command` + `--quickPlayMultiplayer 127.0.0.1:25565` 启动离线 profile（`--username` 复用 settings/默认），进服后由插件正常发 kit/评分；
  - 进度/失败/重试/取消写入 EnvState 与 `launcher.log`；失败回退到 D 的安装指南（链接 + 启动器步骤）。
  - 法务边界：**只从官方端点下载、不把 Mojang 资产打进安装包**（遵守 AGENTS 红线 8 与 EULA）；文案保留“本地教学服为离线模式，正版购买见 docs/17”。
- **Linux/Prism 对齐**：同样优先匹配 Prism 26.1.2 实例；无实例时给 Prism 内安装步骤或同 A-full 自管目录（不破坏现有 Linux 基线）。

### 6.3 P2（仅当用户硬性要求“就用我现有的旧客户端”时）：ViaVersion + ViaBackwards（方案 C，实验开关）

- `runtime/real/paper/plugins/` 增加 **ViaVersion 5.9.1 + ViaBackwards 5.9.1**（或 5.12.x，二选一后 pin 死；构建脚本 `scripts/build-real-runtime.*`/打包脚本负责下载 + sha256 校验 + license 文件）。
- 设置页加“兼容旧客户端（实验）”开关，默认关；开启时 L0 明确警示：
  - 仅建议 1.21.x+ 与 26.1.x 客户端；
  - 旧客户端看不到 26.1 新增内容（本项目 L09 的 `iron_chain` 链条会缺失/替代）；
  - 不改变 bot/评分（服务端真值不变）。
- 验收见 §7.3。

---

## 7. 验收标准（建议写进任务卡/门禁）

### 7.1 P0（D）验收——版本检测与门控

必须提供**可保存的证据**（日志/JSON/截图，由执行者提供；本审查不启动 GUI）：

1. **矩阵单测**（Rust unit，可 headless）：对 `--version` 解析与兼容判定覆盖 `1.21.1 / 26.1 / 26.1.2 / 26.3 / null`，断言 `compatible` 仅 26.1.x（协议 775）为真；对 EnvState 四灯断言“客户端运行但不兼容 → `allReady=false`、client 灯 needs_action、detail 含版本与协议”。
2. **实测 A（1.21.1 正在跑）**：启动安装版 app（用户当前态）→ 客户端卡片**不是绿色**、`进入工坊` 置灰；卡片显示“当前 1.21.1 / 需要 26.1.2（767 ≠ 775）”；日志 `launcher.log` 记录检测到的版本；**不关闭/不杀死**用户已有的 1.21.1 客户端。
3. **实测 B（26.1.2 正在跑）**：用本机 repo `.minecraft`（`LOOM_MINECRAFT_DIR` 或 A 的产品目录）直启 26.1.2 → 四灯全绿 → 进 25565 → Paper 日志出现玩家 `joined the game` → Studio 建会话、L01 参考解 3 星、玩家节拍可完成。
4. **实测 C（无客户端）**：客户端灯 needs_action + “准备 26.1.2 / 查看安装指南”两个入口；成功准备后自动直启并 quickPlay 进服（A-full 时）。
5. **回归**：26.1.2 客户端中途关闭 → 仍触发 L2 红色阻断 + 一键重连；Mock 模式四灯/流程不变；`cargo test` 全绿；`shell.js`/`wizard.html` 的 `node --check` 通过。
6. **端口/身份**：人为让旧 Paper 1.21.1 占 25565 → app 不显示“世界已就绪”，给出“端口被其它服务端占用/版本不符”的明确错误。

### 7.2 P1（A）验收

1. 本机清掉所有 26.1.2（或换干净用户目录）→ app 提供“准备 26.1.2”；下载/校验/直启成功；client 灯绿；L01 可玩、3 星；日志记录下载源/字节数/耗时/sha256。
2. 断网/代理失败 → 明确错误 + 回退到安装指南，不卡死、不产生半成品目录（失败清理/可重试）。
3. 安装包体积**不因 A 增加 Mojang 资产**（`git ls-files`/打包产物检查无 `.minecraft`/assets/client jar）；仅在运行时下载。
4. Linux（或 Prism 模拟）同样路径可用或有等价引导；不破坏现有 AppImage/RPM 打包脚本。

### 7.3 P2（C，仅在启用时）验收

1. 1.21.1 客户端（PCL，离线名）能进入 25565，Paper 日志无 protocol 错误；L01 可完成 run + 玩家节拍。
2. L01–L10 逐关 smoke（至少进服/出生点/参考解/玩家节拍/结算），并记录 1.21.1 客户端与 26.1.2 客户端的视觉差异截图；**明确文档化 L09 `iron_chain` 缺失**及 ViaBackwards 无法补齐的特性。
3. `plugins/` 中 ViaVersion/ViaBackwards jar 的版本与 sha256 固定、license/来源记录进 `docs/43`/运行手册；关闭开关后行为与现状完全一致。
4. `cargo test` + 现有真实 e2e（26.1.2 客户端/bot 路径）不回归。

---

## 8. 主要风险与开放问题

1. **用户的真实诉求边界**：是“必须继续用 1.21.1 这个客户端”（→ 只能 C，或让用户接受 A 的新客户端），还是“只要能玩、不想折腾装版本”（→ A+D 即可）？**这个问题决定 A/C 优先级**，建议 Lead 向用户确认。按当前证据（用户机器上既有 1.21.1、也有能力安装 26.1.2），A+D 更符合“教学产品+评分一致性”。
2. **网络/下载**：A-full 依赖 `piston-meta/piston-data/libraries.minecraft.net` 可达；本机 10-31 用 minecraft_launcher_lib 成功装好 26.1.2（1.37GB），说明可达，但用户环境可能有代理/加速器/DNS 问题（PCL 日志里 CurseForge 超时说明网络不稳），必须做重试/断点/回退。磁盘：本机 C: 37.8GB / D: 144GB 可用，足够。
3. **法务**：不打包 Mojang 资产/client jar（EULA + AGENTS 红线 8）；运行时下载与官方启动器同性质；正版/账号说明沿用 docs/17；离线 mode 只用于本地教学。
4. **C 的第三方/GPL**：需包含 license 与源码获取说明；版本 pin；若未来 26.1.2 不再被 Via* 支持，需要重新评估。
5. **版本族策略**：26.1 与 26.1.2 同协议（775，bot 实测 26.1 可连 26.1.2）——是否允许 26.1.x 族全部？建议默认目标 26.1.2（与文档一致），检测层接受“协议 775 + 版本号 26.1.*”并在提示里推荐 26.1.2。
6. **Linux/Windows 差异**：Linux 有 Prism flatpak 路径（已有实例匹配）；Windows 用户主流 PCL/HMCL/official，CLI 能力弱；A-full 的产品自管目录反而跨平台一致。
7. **旧 Paper/端口冲突**：用户旧 Prograft Paper 1.21.1 可能占 25565；与版本检测同批修（§2.3 B11），否则会出现“世界灯绿、bot 连不上”的第二种假绿灯。

---

## 9. 证据命令（只读复跑）

```powershell
# 1) 服务端/客户端协议号（无需启动游戏）
#    - 内置 Paper 的 protocol：读 jar 内 version.json
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[System.IO.Compression.ZipFile]::OpenRead((Resolve-Path 'apps\desktop\src-tauri\runtime\real\paper\paper.jar'))
($z.Entries | ? { $_.FullName -eq 'version.json' } | % { $r=New-Object System.IO.StreamReader($_.Open()); $r.ReadToEnd(); $r.Close() })
$z.Dispose()
#    - 1.21.1 客户端协议：同上读 D:\Prograft\tools\pcl\launcher-2.14\.minecraft\versions\1.21.1\1.21.1.jar 的 version.json
#    - bot 支持版本：node -e "console.log(require('./bot/node_modules/minecraft-protocol/src/version.js').supportedVersions)"

# 2) 用户环境（只读）
Get-ChildItem "$env:APPDATA\.minecraft" -Force
Get-ChildItem 'D:\VScode_code\the-loom\.minecraft\versions'
Get-ChildItem 'D:\Prograft\tools\pcl\launcher-2.14\.minecraft\versions'
Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Select-Object ProcessId,CreationDate,CommandLine

# 3) 安装版 app 的客户端判定证据（只读日志）
Get-Content "$env:USERPROFILE\.loomcraft\logs\launcher.log"
Get-Content 'D:\Prograft\tools\pcl\launcher-2.14\PCL\Log1.txt' | Select-String '游戏版本|启动进程|弹出提示' | Select-Object -Last 15
Get-Content "$env:USERPROFILE\.loomcraft\runtime\paper\logs\latest.log" | Select-String 'version|joined|Golem'

# 4) 版本/目录探测代码位置（评审核对）
Select-String -Path apps\desktop\src-tauri\src\launcher.rs -Pattern 'client_process_running|fn launch_client|fn try_pcl2|fn try_direct|fn resolve_minecraft_dir|fn wait_for_client'
Select-String -Path apps\desktop\src-tauri\src\main.rs -Pattern 'MC_PORT|client_ok|all_ready|spawn_client_worker|should_autostart_client|paper_ready'
```

---

## 10. 附：审查边界与未验证点（如实说明）

- 本次为**只读审查**：未启动游戏/未启动 GUI、未杀任何进程、未改代码、未 commit/push；用户环境信息来自只读目录/进程命令行/已有日志（app 的 `~/.loomcraft/logs/*`、PCL 的 `PCL/Log1.txt`、Paper 的 `logs/latest.log`）。
- 未能复现“用户手动点连接 25565 后被踢”的**当次**截图/日志（审查时 app 已退出、Paper 已停；用户客户端 PCL 日志只到主菜单加载完成）；但协议号（775 vs 767）与服务端/客户端行为已由 jar 元数据与仓库文档（`docs/17` §6）双重确认，结论不依赖该次截图。
- ViaVersion/ViaBackwards 的可用性来自 **Hangar 公开元数据**（5.9.1/5.12.x 的 Paper 支持范围包含 26.1.2），**未在本仓库 bundled Paper 26.1.2 上实测**（需新增测试环境/插件 jar）；C 的最终采纳需一次真实服务端 + 1.21.1 客户端联调。
- A-full 的下载器工作量为估算（参考 `.tools/install_mc.py` 已用现成 Python 库完成同类工作），未验证 Rust/Tauri 侧实现细节（HTTP/重试/进度/取消/校验）；建议先做 A-lite（扫描已有 26.1.2）验证需求，再投入 A-full。
- 本文标注的代码行号基于当前工作区（含未提交的 task-7/8/9/11 WIP，`git status` 可见 `launcher.rs`/`envstate.rs` 为 untracked、`main.rs` 为 modified）；提交前请以最终文件为准复核行号。
