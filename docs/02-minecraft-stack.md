# docs/02-minecraft-stack.md — MC 技术栈调研与选型（D2 双通道 / D4 世界策略）

> 状态：v1（含实证 spike，7/7 通过）｜负责人：scout-minecraft｜最后更新：2026-10-31
> 上游依赖：`BRIEF.md` §1 invariants、§2 D2/D3/D4、§6 环境自测
> 事实口径：本文所有版本号、API 能力、下载地址均在 **2026-10-31** 联网核实（Mojang 清单、PaperMC Fill API、npm registry、GitHub API、Paper Javadoc/Docs）；spike 在本机实测。事实与判断分列，判断标「判断」。
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

## TL;DR（10 条）

1. **锁死组合（Day 1 就用）**：Minecraft/Paper **26.1.2 build 74** + **Java 25** + **mineflayer 4.39.0** + **minecraft-protocol 1.68.0** + **Node 22**（本机 v22.23.1）+ **mineflayer-pathfinder 2.4.5**（npm）+ Paper 插件 API `io.papermc.paper:paper-api:26.1.2.build.74-stable` + **Gradle Wrapper 9.8.2**。**不要用最新的 26.3**，见第 2 条。
2. **不能跟最新 MC**：Mojang 最新正式版是 **26.3**（2026-09-15 发布），但 mineflayer 4.39.0 的 `testedVersions` 只到 **26.1**；26.3 有未关闭 issue #4189「vanilla 26.3 在 join 后约 1.5s 以 `invalid_player_movement` 踢掉 mineflayer bot（未发 `client_tick_end`）」，26.2 的支持 PR 也仍未合并。**26.1.2 是 mineflayer 可用的最新服务端版本**。
3. **Paper 下载服务换代**：旧 `api.papermc.io/v2` 已 sunset（实测返回 `{"ok":false,"error":"sunset"}`），新服务是 **Fill API `fill.papermc.io/v3`**；且 26.1 起插件依赖坐标格式从 `1.21.11-R0.1-SNAPSHOT` 改为 **`26.1.2.build.74-stable`**（旧格式不再可用）。
4. **双通道 spike 实测全通（7/7）**：bot 放置的方块被插件侧快照读到（服务端真值一致）、插件 `world.setblock`/`entity.spawn` 被 bot 观测到、插件与 bot 双向聊天、bot 用 `/loom hello` 调插件命令。两端都用锁定版本、Docker 与宿主机两种跑法都验证过。
5. **Docker 可行**：`itzg/minecraft-server:java25`（buildtime 2026-10-29，digest `sha256:f7f2222512810f0f0e85133913622cf639be77a5dd1d4b11f24ab675da6ba742`）+ `TYPE=PAPER VERSION=26.1.2 PAPER_BUILD=74 ONLINE_MODE=false EULA=TRUE MEMORY=2G` 实测启动 `Done (12.281s)`。插件 jar 挂载到 `/plugins` 正常工作。
6. **Mineflayer 做「玩家能力」够用**：移动/寻路/挖/放/背包/箱子/合成/实体观测/聊天/多 bot 都有 API 且 spike 验证了主链路；**它只是客户端**：不能控制其它实体、不能读服务端真值（TPS/种子/未下发的评分）、看不到未加载区块。
7. **「给物体本身写逻辑」必须走插件**：mineflayer 只能攻击/使用/骑乘/激活实体，不能驱动 mob 的 AI。插件侧有 Mob Goal API、Entity Pathfinder API、tick 调度器，可给实体加任意脚本化逻辑；这是 D2 分成双通道的根本理由。
8. **pathfinder 实测数据**：平地上 8.49 格用时 **2.0s（≈4.2 block/s，含寻路计算）**；单次挖方块约 0.3–0.8s、放方块约 0.5–1.0s（本地服务器）。天然地形必须设 `Movements.canDig=true` 并把 `goto(goal, timeoutMs)` 的 timeout 显式传入——不传时第一次测试 90s 无进展（已复现）。
9. **魔像外观建议**：bot 用自定义 player skin（Paper `Player#setPlayerProfile` 注入纹理，已核实 API 存在）；装饰体/过场用隐形 armor stand + `ItemDisplay`/`BlockDisplay`（26.1.2 Javadoc 确认）；服务端 resource pack 只能改纹理/物品模型/字体，**改不了玩家皮肤和实体模型**，且不要打包 Mojang 资产（EULA）。
10. **对 BRIEF 的唯一必改项**：D2 必须追加「MC/Paper 版本锁 26.1.2 + 每日 integration smoke」；不锁版本会在 Day 2 某次 `VERSION=LATEST` 后全链路失效（26.2/26.3 已复现该风险）。

## 1. 版本矩阵与锁定组合（2026-10-31）

| 组件 | 最新版 | 可用性判断 | 锁版 |
|---|---|---|---|
| Minecraft Java Edition | **26.3**（2026-09-15，正式版；最新快照 26.4-snapshot-6） | mineflayer 不支持 26.2/26.3 | **26.1.2** |
| Paper 服务端 | **26.3 build 231**（2026-10-30 STABLE） | 与 bot 不兼容 | **26.1.2 build 74**（2026-07-06 STABLE） |
| Java 运行时 | 本机 **25.0.4.1** | Paper 26.1+ 官方要求 Java 25（1.20–1.21.11 要求 21） | **25** |
| Paper 插件 API | `26.3.build.231-stable` | 与锁版服务端不匹配 | **`io.papermc.paper:paper-api:26.1.2.build.74-stable`** |
| mineflayer | **4.39.0**（2026-09-06，engines `node>=22`） | 支持到 26.1（`lib/version.js`） | **4.39.0** |
| minecraft-protocol | 1.68.0（2026-08-27） | 26.1 协议在 minecraft-data 中 | **1.68.0** |
| minecraft-data | 3.114.0（mineflayer 依赖） | `supportedVersions.pc` 末位 = **26.1** | 由 mineflayer 锁定 |
| mineflayer-pathfinder | npm **2.4.5**（2023-09-04 后再未发布） | 仓库仍活跃（2026-10-27 有 commit），npm 包陈旧但实测兼容 26.1 | **2.4.5** |
| Gradle（Wrapper） | **9.8.2**（2026-10-19） | 无需全局 gradle，首次 `./gradlew build` 实测 1m | **9.8.2** |
| itzg 服务端镜像 | `java25` tag（2026-10-29 构建） | 实测可跑 26.1.2 | **`itzg/minecraft-server:java25`** |
| 插件运行时库 | Java-WebSocket **1.6.0**（+ slf4j 2.0.13） | `plugin.yml` 的 `libraries:` 自动下载，实测成功 | **1.6.0** |
| 渲染兜底 | prismarine-viewer **1.33.0**（2025-02-09） | 官方只测到 1.21.4，更高版本用最接近纹理渲染 → 26.1 新方块会显示异常，仅作「能看到画面」兜底 | 1.33.0（不推荐当验收） |
| 对照：Fabric | Loader **0.20.1**；Fabric API **0.165.0+26.3**（2026-10-23）；Carpet **v26.3**（2026-09-15） | 生态存在，但见 §4 对比 | 不选 |

**版本证据与查询方式**：MC 清单 `https://piston-meta.mojang.com/mc/game/version_manifest_v2.json`；Paper 版本 `https://fill.papermc.io/v3/projects/paper/versions/26.1.2/builds/latest`（返回 build 74 + jar URL + sha256）；Java 要求 `https://docs.papermc.io/paper/getting-started/`；mineflayer `npm view mineflayer version` + `lib/version.js`（`testedVersions` 末位 26.1，GitHub master）；26.3 不兼容证据 `https://github.com/PrismarineJS/mineflayer/issues/4189` 与 PR #4124；Paper API 坐标 `https://docs.papermc.io/paper/dev/project-setup/`。

## 2. 实证 spike（本机实测，证据优先）

目录：`spikes/mc-bot-paper/`（`bot.js`、`test2.js`、`plugin/`、`server/`）。宿主机跑法：`java -Xms1G -Xmx2G -jar paper-26.1.2-74.jar --nogui`（`eula.txt: eula=true`；`server.properties`：`online-mode=false`、`enforce-secure-profile=false`、`level-type=minecraft\:flat`、`gamemode=creative`、`spawn-protection=0`、`view-distance=6`）。服务端 `Done (11.644s)`。

### 2.1 bot 通道（Spike 1，6.85s 全通）

| 验证项 | 结果 | 实测数据 |
|---|---|---|
| 连接/出生 | ✅ | connect→spawn **2.13s**（本地），`dim=overworld`、`gameMode=creative`、`serverBrand=Paper`、`minY=-64` |
| 寻路移动 | ✅ | `pathfinder.goto(GoalBlock)` 走 **8.49 格用 2.0s** |
| 挖方块 | ✅ | `dig(grass_block)` 后 `blockAt` = `air`（含 0.5s tick 等待共 0.94s） |
| 放方块 | ✅ | creative 背包取 stone → `placeBlock` 后 `blockAt` = `stone`（共 1.0s） |
| 实体观测 | ✅ | 出生点附近 **32 个实体**（含 slime），`bot.entities` 可枚举 name/type/pos |
| 聊天 | ✅ | `bot.chat()` 发送成功；收到 join 消息 |

### 2.2 双通道端到端（Spike 2，7.45s，**7/7 通过**）

插件：`plugin.yml`（经典格式，`api-version: '26.1'`，`libraries: [org.java-websocket:Java-WebSocket:1.6.0]`）→ Paper 26.1.2 + Java 25 编译（Gradle toolchain 25），`./gradlew build` 1m 通过，jar 9KB；启动日志确认 `LOOM SPIKE ENABLED ... bukkit=26.1.2.build.74-stable`、`WS listening on ws://127.0.0.1:8765`。

| # | 检查 | 结果 | 证据 |
|---|---|---|---|
| 1 | WS RPC ping | ✅ | `{"ok":true,"pong":true,"rpc":1}` |
| 2 | bot 放 stone 于 (-4,-60,1) | ✅ | bot 侧 `blockAt=stone` |
| 3 | **插件快照读同一坐标** | ✅ | `{"x":-4,"y":-60,"z":1,"type":"minecraft:stone"}`（服务端真值与 bot 动作一致，双通道闭环） |
| 4 | 插件 `world.setblock` 写 gold | ✅ | `{"ok":true,"set":"minecraft:gold_block",...}` |
| 5 | bot 观测到插件写的方块 | ✅ | 1s 内 bot `blockAt=gold_block` |
| 6 | 插件 `entity.spawn` → bot 观测 | ✅ | 生成 `minecraft:armor_stand`；bot 实体数 41→48，枚举到 armor_stand |
| 7 | 双向聊天/命令 | ✅ | 插件 `player.say` 送达 bot；bot 发 `/loom hello` 收到插件回复 `LOOM hello from plugin ... tick=594` |

### 2.3 Docker 跑法（Spike 3，实测启动成功）

```bash
docker run -d --name loom-mc --network host \
  -e EULA=TRUE -e TYPE=PAPER -e VERSION=26.1.2 -e PAPER_BUILD=74 \
  -e ONLINE_MODE=false -e ENFORCE_SECURE_PROFILE=false -e MEMORY=2G \
  -v "$PWD/server:/data" itzg/minecraft-server:java25
```

日志摘录：`Downloaded /data/paper-26.1.2-74.jar` → `Loaded library .../Java-WebSocket-1.6.0.jar` → `LoomSpike` 加载 → `Done (12.281s)`，容器 `healthy`。bot 连 `:25565`（发布端口 25566）能出生（自然地形 y=87、survival）；**注意**：`--network host` 是我建议的正式跑法，否则插件 `127.0.0.1:8765` 在容器内不可被宿主机进程访问（我测试时只为验证服务端配置，未测容器内 WS）。首次跑天然地形时 `goto` 不设 timeout、`canDig=false` 会卡死 90s；设 `canDig=true` + 20s timeout 后 2 格移动成功。

## 3. Mineflayer 能力/限制清单（逐条依据）

依据：`mineflayer` 4.39.0 `docs/api.md`（GitHub master）+ 本次 spike。**能做什么**：物理与移动（`setControlState`/`setControlState`+physics）、寻路（`mineflayer-pathfinder`，实测）、挖掘/放置（实测）、背包/窗口/箱子/熔炉/附魔台/村民交易（api.md 类目：`mineflayer.Container/Furnace/EnchantmentTable/villager`）、合成（prismarine-recipe）、实体观测（`bot.entities`「All nearby entities」）、方块查询（`bot.blockAt`，未加载区块返回 `null`）、聊天收发与正则解析（`bot.chat`/`chat`/`messagestr` 事件）、分数板/Team/BossBar/Particle 数据结构（api.md 有对应类）、多 bot（FAQ：每个 bot 一个 `createBot` 实例）、creative 模式（`bot.creative.*`，实测取物/放置）、玩家皮肤数据（`player.skinData` 含 url/model/cape，仅在服务端下发时存在）。

**不能做什么（决定架构的边界）**：① 只是客户端，**不能控制其它实体**（只能攻击/使用/骑乘/激活/交易）；② 读不到服务端权威状态（TPS、种子、advancement 真值、未加载区块、未下发的评分），只能看服务端按客户端协议下发的数据；③ 视野=服务端 `view-distance`/实体追踪范围，远处世界不可见（插件用 `setChunkForceLoaded`/`addPluginChunkTicket` 才能保证加载）；④ 没有「客户端渲染」，做 demo 需要真 MC 客户端或 prismarine-viewer；⑤ 协议脆弱性：26.3 直接因缺少 `client_tick_end` 被踢，说明**服务端单方面升级会破坏 bot**；⑥ 离线模式下 bot 皮肤为空（无 Mojang 会话），需插件注入 profile。

## 4. Entity/世界逻辑通道：能力 × 方案对比

Paper 26.1.2 API 能力（Javadoc/Docs 已核实）：Mob Goal API（`docs.papermc.io/paper/dev/mob-goals/`）、Entity Pathfinder API（`/entity-pathfinder/`）、Display 实体（`org.bukkit.entity.Display`/`ItemDisplay`/`BlockDisplay`/`TextDisplay` Javadoc 200）、粒子（`/particles/`）、音效/BossBar/Scoreboard/Advancement（Bukkit Javadoc 200）、世界创建 `WorldCreator`、区块强加载 `World#setChunkForceLoaded`/`addPluginChunkTicket`/`getChunkAtAsync`、结构定位 `World#locateNearestStructure(Location, StructureType, int, boolean)`、生物群系定位 `World#locateNearestBiome`、地图渲染 `MapView`+`MapMeta#setMapView`、玩家传送/旁观 `GameMode.SPECTATOR`、资源包 `Player#setResourcePack`、皮肤 `Player#setPlayerProfile(PlayerProfile)`。

| 能力 | Paper 插件 | Fabric mod | Carpet/Scarpet | op bot + datapack |
|---|---|---|---|---|
| 生成/控制实体 AI（给物体写逻辑） | ✅ Mob Goals + tick 调度 + Entity Pathfinder | ✅ NMS 全权 | ⚠️ `/player` fake player、Scarpet 脚本 | ⚠️ `/summon` 只能摆，不能写逻辑 |
| 过场/装饰（display/armor stand/粒子/音效/title） | ✅ 全套 | ✅ 但要客户端配套 | ⚠️ Scarpet 可发部分 | ✅ 命令可覆盖大部分 |
| 批量摆方块/结构粘贴 | ✅ `setBlock`/`World#setType` 批量、WorldEdit 可选 | ✅ | ⚠️ 命令方块/`/fill` 有限 | ⚠️ `/setblock`/`/fill` 有 32768 上限 |
| 世界创建/种子/void/flat | ✅ `WorldCreator` + `level-seed` | ✅ | ⚠️ 依赖原版 | ❌ 只能改 properties+重启 |
| 区块强加载/跨区逻辑 | ✅ | ✅ | ⚠️ | ❌ |
| locate 结构/生物群系（D4 关键） | ✅ 26.1.2 API | ✅ | ❌ | ❌ |
| 服务端真值快照/评分断言 | ✅ 权威、可逐 tick | ✅ | ⚠️ Scarpet 可读部分 | ❌ 无可靠读取通道 |
| 资源包/皮肤下发 | ✅ `setResourcePack`/`setPlayerProfile` | ✅ | ⚠️ | ⚠️ 仅 server.properties 全局 |
| 开发难度（4 天/AI 可写） | 低-中：Javadoc 全、AI 写 Java 稳 | 中-高：需跟 NMS 版本、Yarn 映射 | 中：Scarpet 是另一门 DSL | 低：但能力天花板低 |
| 与真 MC 客户端兼容 | ✅ 原版客户端直连 | ⚠️ 需服务端 mod、客户端可能反作弊/版本同步 | ✅ Carpet 服务端 mod，原版可进 | ✅ |
| 升级/维护成本 | 中（26.x 坐标/API 变动） | 高（每次 MC 快照都跟） | 中 | 低 |

**判断**：D2 选 Paper 插件作为世界逻辑通道正确；Fabric 的优势只在「需要新增方块/物品/实体渲染或改客户端行为」，本项目用资源包 + display entity 就能覆盖，且 Fabric 会把「客户端也要装 mod」变成新的分发问题。Carpet 适合做开发期调试（fake player、`/tick` 控制），不适合做产品运行时（依赖 mod、Scarpet 是额外语言，违背「教 TS」）。**降级路线**：若插件的 Java 开发在某天受阻，op bot + datapack 能覆盖约 60% 的场景摆放与演出（`/setblock`、`/summon`、`/title`、`/particle`、`function`），但**评分真值、实体逻辑、快照读取不可替代**，只能作为演示兜底。

**插件工程形态（实测选择 `plugin.yml`）**：spike 用经典 `plugin.yml` —— `api-version: '26.1'`、`main:` 指向 `JavaPlugin`、`libraries:` 声明 Java-WebSocket 由 Paper 启动时下载（实测日志 `SpigotLibraryLoader ... Loaded library`），9KB jar 无需 shade。`paper-plugin.yml` 是 Paper 新加载器格式（`bootstrapper`/`loader`/`dependencies.bootstrap|server` 分区），官方明确说**不是 `plugin.yml` 的 drop-in 替换**，外部库要在自定义 `PluginLoader.classloader()` 里 `addLibrary(JarLibrary/MavenLibrary)`，比 `libraries:` 重。结论：**Day 1–4 全用 `plugin.yml`**；只有在需要 world load 之前注册 registry 内容（自定义配方/进度/生物）时才评估 `paper-plugin.yml` + `bootstrapper`。插件保持单 JAR、零编译期外部耦合（`compileOnly` + 运行时 `libraries:`）最稳。

## 5. 对项目的直接建议（可直接开工）

**Day 1 就执行（命令已验证）**：

```bash
# 1) 服务端（宿主机，最快；Java 25 已在本机）
mkdir -p server && cd server
curl -sL -o paper.jar "https://fill-data.papermc.io/v1/objects/1d70b1dab9cf4a6de615209a536f3a45a2186240253c428213ce2188ab95e5f7/paper-26.1.2-74.jar"
echo "eula=true" > eula.txt
# server.properties 关键项：online-mode=false, enforce-secure-profile=false,
# level-type=minecraft\:flat, gamemode=creative, spawn-protection=0, view-distance=6
(java -Xms1G -Xmx2G -jar paper.jar --nogui > server.log 2>&1 &)
# 2) 插件（Gradle Wrapper；仓库里放好 gradlew）
cd plugin && ./gradlew build && cp build/libs/*.jar ../server/plugins/
# 3) SDK / bot
npm i mineflayer@4.39.0 mineflayer-pathfinder@2.4.5 minecraft-protocol@1.68.0 ws@8.22.0
node spikes/mc-bot-paper/bot.js
```

统一 SDK 的 JSON-RPC 形态（spike 已验证最小版，建议 Day 1 定 schema）：

```json
→ {"jsonrpc":"2.0","id":7,"method":"world.snapshot","params":{"center":{"x":-4,"y":-60,"z":1},"radius":4}}
← {"jsonrpc":"2.0","id":7,"result":{"tick":1234,"blocks":[{"x":-4,"y":-60,"z":1,"type":"minecraft:stone"}],
   "entities":[{"uuid":"…","type":"minecraft:armor_stand","x":-2.5,"y":-60.5,"z":-4.5}]}}
```

方法建议（插件侧通用 primitives）：`world.snapshot`（含 WorldDigest 文本变体）、`world.setBlocks`（批量+返回逐项结果）、`world.setTime/gamerule`、`scene.apply`（SceneScript 整体应用，返回 tick）、`entity.spawn/move/remove`（NBT+tags）、`fx.particle/sound/title/bossbar/actionbar/advancement/scoreboard`、`grading.assert`、`player.teleport/gamemode`；事件推送：`world.block_break/place`、`entity.death`、`player.move`、`dialog.answer`。**所有响应带 `tick`**，用于与 bot 侧状态对齐。评分只信插件快照，不信 bot 的本地预测。

**通信拓扑**（重要工程细节）：学生程序 → 本地 `runner` 进程（Node）→ ① mineflayer bot；② 插件 WS。**浏览器/学生代码不直连插件 WS**。插件 WS 默认 bind `127.0.0.1`，配 `token` 配置项；Docker 时用 `--network host`（否则容器内 127.0.0.1 不可达），或改为可配置 `bind=0.0.0.0` + 强 token。插件 jar 建议 **shade Java-WebSocket**（用 Gradle shadow）而不是只依赖 `libraries:`，这样离线演示也能启动（`libraries:` 首次启动需联网，实测会下载 Java-WebSocket+slf4j）。

**世界与美术（D4）**：主舞台用固定 `level-seed` 的自然世界，但 Level 1 用 `flat`（启动快、坐标可控、寻路稳）；结构/村庄坐标**不要运行时碰运气**——Day 1 用插件 `locateNearestStructure` 查询一次、把 (structure, x,y,z) 写进 level spec，运行时只传送；`locateNearestStructure/locateNearestBiome` 在 26.1.2 Javadoc 中存在但本次未做功能验证。魔像外观：bot 走 `Player#setPlayerProfile` 注入纹理；道具/符文/机关用 resource pack 的 item model + `ItemDisplay`；resource pack 通过 `server.properties resource-pack=<https-url>` 下发，仅打包自制资产（EULA 不允许再分发 Mojang 资源）。**热重载不可靠，别用 `/reload`**：改插件→重启（实测冷启动 11.6–12.3s，可接受；写 `scripts/dev-restart.sh`）。

**魔像外观分三层**：① 识别核心 = bot 的 player 皮肤（离线模式用 Paper `Player#setPlayerProfile` 注入纹理）＋队伍前缀/头顶名牌（实体 `customName` + Team prefix，或给 bot 发 `player_info`）；② 装饰体 = 隐形 armor stand 穿盔甲 + `ItemDisplay` 自定义模型（resource pack 定义 item model）；③ 过场 = `BlockDisplay`/`TextDisplay`。**resource pack 改不了玩家皮肤与实体模型**（玩家皮肤是 profile 纹理，实体模型在客户端硬编码），只能改纹理/物品模型/字体/音效，所以别把「魔像外观」压在 resource pack 上；且只打包自制资产（EULA 不允许再分发 Mojang 资源）。

## 6. 风险清单

| 风险 | 证据 | 缓解 |
|---|---|---|
| 服务端升级破坏 bot | mineflayer #4189（26.3 1.5s 被踢）；26.2 PR 未合并 | 锁 26.1.2；CI 每日跑 `test2.js`；升级前置 smoke |
| Java 版本错配 | Paper 26.1+ 要求 Java 25；本机 25 ✅；旧 CI 若 21 会起不来 | 固定 `JAVA_HOME=25`；Docker 用 `java25` tag |
| 下载服务换代 | `api.papermc.io/v2` 已 sunset；`libraries:` 运行时下载依赖网络 | 只用 Fill API；脚本从 Fill API 取 URL+sha256 校验；插件 shade 依赖 |
| pathfinder 卡死 | 天然地形 `canDig=false` 无 timeout → 90s 无进展（实测） | 每关用 flat/void；`Movements` 显式配置；`goto(goal, timeout)`；失败由插件 `/tp` 兜底 |
| bot 动作延迟/抖动 | 本地挖 0.3–0.8s、放 0.5–1.0s、4.2 格/s；公网更差 | 关卡设计允许 1–2s 延迟；UI 显示「施法中」；判分用插件 tick 事件 |
| 离线模式鉴权 | 需 `online-mode=false` + `enforce-secure-profile=false` | 写进启动脚本模板；Day 1 验证 bot join |
| 无客户端/无 GPU | 本机无 `~/.minecraft`；prismarine-viewer 仅测到 1.21.4 | Day 0 装真 MC Java 客户端（26.1.2）；viewer 只作预览 |
| EULA/资产许可 | eula=true 表示同意 Mojang EULA；不能分发客户端资产 | 资源包自制；不发 server jar；报告注明资产来源 |
| Docker 网络 | 插件 bind 127.0.0.1 在容器内对宿主不可见 | `--network host`，或 bind 可配 + token |
| pathfinder npm 陈旧 | npm 2.4.5 是 2023 发布，仓库活跃但未发新版 | 锁 2.4.5；若遇到 bug 再 vendor 仓库 commit（记录 commit hash） |

## 7. 对 D2/D3/D4 的修正建议

- **D2（保留，加固 3 点）**：① 版本锁写进 BRIEF（见 TL;DR #10）；② 明确「世界真值只信插件」的单向权威，bot 状态仅表示意图/预测；③ 世界重置/传送/开门等用插件，不依赖 bot 走位。若只能改一条 BRIEF 决策，我改 D2：**把「MC/Paper 锁 26.1.2 + 每日 smoke 测试」作为不可协商项**——这是整个 4 天计划里唯一一个「上游一变全盘皆输」的外部依赖。
- **D3（保留，细化）**：SceneScript 的通用 primitives 必须包含 `world.snapshot`（供评分/WorldDigest）与 `scene.apply` 幂等重放；建议**插件侧断言**（scoring 在服务端跑，返回结构化结果），因为 bot 端只能看到局部。spike 证明最小 RPC 通道可行；Day 1 把 JSON 手工拼接升级为 Jackson/Gson + schema 校验。
- **D4（保留，降风险）**：seed-first 可行（`level-seed`+`generate-structures`+`locateNearestStructure`），但 Level 1–4 建议 flat/void 为主，自然 seed 世界从 Act 2 起用；否则寻路、生物干扰（spike 里 superflat 都有 32+ slime）会让新手关不稳定。每条关卡 spec 里预存结构坐标，不要运行时 locate。

## 8. 不确定/未验证事项 + 验证方法

1. **26.1.2 的 `locateNearestStructure/locateNearestBiome` 实际行为**（Javadoc 存在，未跑）：Day 1 用插件命令 `/loom locate village` 输出结果并记入 spec。验证命令：重启 server → `echo "loom locate" > stdin` 或写一个 `/loom locate` 子命令。
2. **多 bot 同服（≥3 个）与 20 TPS 稳定性**：写 3 个 bot 循环走位 60s，统计服务端 TPS（`spark tps`）与掉线。当前只测过单 bot。
3. **resource pack + 自定义 item model + ItemDisplay 的端到端观感**：需要真 MC 客户端；Day 0 装客户端后录一段 30s 视频作人类验收证据。
4. **`Player#setPlayerProfile` 注入皮肤在离线模式的实际效果**：写 10 行插件调用 + 真客户端观察；若失败，退化到「隐形 armor stand + 名牌」。
5. **插件行内阴影/世界边界/结构粘贴**（WorldEdit 或自制 schematic 加载）：D4 的村庄改造需要；验证方式：选一个 20×20 区域做 `scene.apply` 方块批量写入，测量 10k 方块耗时与卡顿。
6. **prismarine-viewer 对 26.1 的渲染**：npm 安装后打开 3000 端口截图；预期新方块显示为接近 1.21.4 的纹理，作为 demo 兜底可用性验证。
7. **Java 25 下插件 ABI**：本项目插件 target=25、Paper=Java 25，已验证可加载；若后续引入第三方库需重新验证。

## 9. 来源清单（查询日：2026-10-31）

- Mojang 版本清单：https://piston-meta.mojang.com/mc/game/version_manifest_v2.json （latest release=26.3）
- Paper Fill API（版本/build/下载）：https://fill.papermc.io/v3/projects/paper/versions/26.1.2/builds/latest ；旧 v2 sunset 证据：https://api.papermc.io/v2/projects/paper
- Paper 入门/Java 要求：https://docs.papermc.io/paper/getting-started/
- Paper 插件工程与依赖坐标：https://docs.papermc.io/paper/dev/project-setup/
- paper-plugin.yml / 依赖声明：https://docs.papermc.io/paper/dev/getting-started/paper-plugins/
- plugin.yml（含 `libraries` 字段）：https://docs.papermc.io/paper/dev/plugin-yml/
- Display Entity / Mob Goal / Entity Pathfinder / Particles：https://docs.papermc.io/paper/dev/display-entities/ 、…/mob-goals/ 、…/entity-pathfinder/ 、…/particles/
- Paper 26.1.2 Javadoc（Player/World/Display/MapMeta/WorldCreator/Chunk）：https://jd.papermc.io/paper/26.1.2/org/bukkit/entity/Player.html 等
- mineflayer npm/版本/engines：`npm view mineflayer version time.modified engines`；README 支持版本 https://github.com/PrismarineJS/mineflayer/blob/master/docs/README.md
- mineflayer testedVersions：https://github.com/PrismarineJS/mineflayer/blob/master/lib/version.js
- mineflayer 26.3 不兼容：https://github.com/PrismarineJS/mineflayer/issues/4189 ；26.3 PR：https://github.com/PrismarineJS/mineflayer/pull/4124 ；26.2：#3952
- mineflayer API 文档：https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md
- mineflayer-pathfinder：https://www.npmjs.com/package/mineflayer-pathfinder （2.4.5）+ https://github.com/PrismarineJS/mineflayer-pathfinder （仓库活跃）
- prismarine-viewer：https://www.npmjs.com/package/prismarine-viewer （1.33.0）+ README 支持版本
- itzg 镜像：https://hub.docker.com/r/itzg/minecraft-server ；文档 https://docker-minecraft-server.readthedocs.io/ （TYPE=PAPER/VERSION/PAPER_BUILD）；Fill API 迁移 issue https://github.com/itzg/docker-minecraft-server/issues/3517
- Gradle 当前版本：https://services.gradle.org/versions/current （9.8.2）
- Fabric：Loader https://meta.fabricmc.net/v2/versions/loader （0.20.1）；Fabric API https://api.modrinth.com/v2/project/fabric-api （0.165.0+26.3）
- Carpet：https://github.com/gnembon/fabric-carpet/releases （v26.3，2026-09-15）；Scarpet wiki https://github.com/gnembon/fabric-carpet/wiki/Scarpet
- Java-WebSocket：https://repo1.maven.org/maven2/org/java-websocket/Java-WebSocket/maven-metadata.xml （1.6.0）
- Minecraft EULA：https://aka.ms/MinecraftEULA
- 本地实证脚本与日志：`spikes/mc-bot-paper/`（`bot.js`、`test2.js`、`plugin/`、`server/server.log`、`server.properties`、`docker-pull.log`）
