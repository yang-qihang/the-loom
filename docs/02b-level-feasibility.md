# docs/02b-level-feasibility.md — 逐关 MC 可行性审查 + 演出实现方案 + Day-1 Runbook

> 状态：v1（基于锁定栈 Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0）｜负责人：scout-minecraft｜最后更新：2026-10-31
> 上游：`docs/05-curriculum.md` §8、`docs/06-level-spec-system.md` §5.4、`docs/07-architecture.md` §2/§3/§6、`docs/12-sdk-api-registry.md`、`content/levels/L01/L02/L08/L10`（v1 稿）、`docs/02-minecraft-stack.md`、`spikes/mc-bot-paper/`
> 审查基准：L01/L02/L08/L10 对 v1 spec 原文审；L03–L07/L09 对 docs/05 §8 brief 审（最终 spec 落地后需按 §8 清单复核）。
> 证据等级：**实测**＝本机 spike 跑过（`spikes/mc-bot-paper/`）；**API**＝Paper 26.1.2 Javadoc/Docs 确认存在但未运行；**无**＝确认无现成能力。
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

## 0. TL;DR（8 条）

1. **没有一关因为 MC 能力不可做而必须砍**；但有 **1 处结构性红区（L10 bot 在峡谷上铺桥+前进）**和约 **14 处必须换实现方式的黄区**（下文逐关列）。实现 agent 按黄区方案写就不会撞墙。
2. 本 turn 新增实测：**3 个 bot 同服互通**（2.75s，`multibot.js`）、**survival 模式 dig/place 可用**、**item entity（鸡蛋）可被 bot 拾取 0→1**（`test3.js`）、**`/locate` village 可用**（seed 1042：[-1616,~,880]，1901 格外，857ms）。
3. 反面实测：superflat 世界里残留 slime 在 50s 内**击杀 survival bot 3 次**（`difficulty=peaceful` 仍发生，持久化旧实体未被清除）→ 每关 setup 必须 `clearEntities` + `doMobSpawning=false`，不能只靠难度。
4. **Paper 26.1.2 有 `org.bukkit.entity.Mannequin`**（`setProfile(ResolvableProfile)`、`setSkinParts(SkinParts)`，API 核实）→ 艾拉/村民等 NPC 用 Mannequin 即可有玩家模型与皮肤；**resource pack 不能改 player 皮肤**（07 §2.2 需要改），bot 皮肤只能走 `Player#setPlayerProfile`。
5. 动画能力边界：**无自由相机、无骨骼动画**。可做：Display 实体（`ItemDisplay/BlockDisplay/TextDisplay`，`setInterpolationDuration/setTeleportDuration` 可做平滑位移/缩放/旋转）、粒子、音效、block state 切换、实体 teleport/`Entity#setRotation`；相机用 `Player#setSpectatorTarget(Entity)` 跟拍 + 定点切换（该 API 在 26.1.2 Javadoc 存在）。
6. **L01/L02/L08/L10 的评分依赖 `block.place/byPlayer`、`lever.pull/byPlayer` 事件，而 spike 只验证了 RPC+snapshot，事件采集管线未实测**；且 bot 本身也是 player 实体，`byPlayer` 必须用「session bot 名单」排除 bot（见 §5 U1）。
7. **必须先解决的 spec/文档冲突**（§7 列全）：L01 starterCode 写死坐标但 seed 是 session 随机；docs/12 的 L8 `Machine` 契约用 `Promise<void>` 而 L08 spec 学生面用 `void`（L9 才教 async）；docs/12「坐标一律 (x,z)」与 `golem.collect(item, pos)` 签名不一致（L02 已按 (item,x,z) 写）。
8. Day-1 Runbook（§4）可直接复制执行：Fill API + sha256、server.properties、Gradle/plugin.yml、shade、启动/重启脚本、bot pathfinder 配置、Docker、MC 客户端。

## 1. 本 turn 新增实测（证据）

| 实验 | 结果 | 数字/摘录 | 证据 |
|---|---|---|---|
| 3 bot 同服（L10） | ✅ | 3 bot 2.75s 内全部 `players=3` 且互相看到对方实体 | `spikes/mc-bot-paper/multibot.js` 输出 `MULTIBOT_OK {"bots":3,"allSeeEachOther":true}` |
| survival 模式挖/放（L01/L04/L05） | ✅ | `/gamemode survival` 后 `dig`→air、`place`→stone | `test3.log` `survival-dig air` / `survival-place stone` |
| bot 拾取 item entity（L02） | ✅ | 掉落物鸡蛋拾取前后 0→1（期间被 slime 杀 3 次，重生后仍拾取成功） | `test3.log` `egg-pickup {"before":0,"after":1}` |
| 生物干扰（所有 Act I 关） | ⚠️ | 残留 slime 50s 内杀 survival bot 3 次 | `server/server.log` `Golem3 was slain by Slime` ×3 |
| `locate`（L1/L10 anchor） | ✅ | village_plains 1901 格外/857ms；plains biome 755 格外/52ms；seed 1042 | `server-normal` 控制台输出（已清理目录，命令见 §5 U2） |

## 2. 逐关可行性表

图例：🟢 直接做；🟡 能做但要换实现方式（列在「做法」）；🔴 结构性风险（需专门 spike + 降级）。

| 关卡 | spec 要求的关键 MC 能力 | 证据 | 等级 | 做法 / 替代 |
|---|---|---|---|---|
| L01 | lampPath 灯柱（setBlock 批量）、黄昏锁定、4 灯粒子、advancement、玩家右键第 4 灯 | setBlock 实测；time/gamerule/particle API；Interact/BlockPlace API；advancement API 需 datapack | 🟡 | lampPath 走 `buildProps` 批量 setBlock；`doDaylightCycle=false`+`time 12000`；**事件管线 Day-1 补 spike**；advancement 预置 datapack，失败用 title |
| L01 | 村庄 anchor（seed-first）、村民沿路回家、远处火把回应 | `/locate` 实测（857ms/1901 格）；村民 AI 走精确路点不受控 | 🟡 | 预扫 seed 把 anchor 坐标写死进 spec（运行时 locate 只作 fallback）；村民回家用 Mannequin/村民 teleport 折线 + 粒子，**不要依赖村民 AI 寻路** |
| L02 | 鸡×7、鸡蛋 item 实体、木桶容器、玩家喂种子催蛋、孵蛋窝 | spawnEntity/Barrel API；bot 拾取实测；vanilla 喂种子=繁殖不是立刻下蛋 | 🟡 | 喂种子：`PlayerInteractEvent` 拦鸡 + `wheat_seeds` → 插件 spawn 1 个 `Item`(egg)+心形粒子；鸡开 `setAI(false)` 或取消自然蛋掉落（`EntityDropItemEvent`），防随机蛋污染「恰好 6 枚」判定 |
| L02 | 小筐容量 4、分两趟 | runner/SDK 状态，不碰 MC | 🟢 | 状态放 runner；reset 清 item entity |
| L03 | 三夜 scenario 注入（time/weather/实体/村民受伤/北门开）、敲钟、僵尸/铁傀儡、三夜剪辑 | time/weather/spawn API；AI 行为不可精确脚本；铁傀儡点头**无动画 API** | 🟡 | 用 `trialPatch`（§6 新增 primitive）；僵尸 spawn 在目标附近 + `Mob#getPathfinder().moveTo()`；「点头」用 `Entity#setRotation` 两帧 + villager_happy 粒子 + 音效；**不要真让村民死** |
| L04 | 25 格耕地/作物、随机水渠、bot 种植、稻草人、镜头升起 | Farmland/Wheat block data API；种子不是方块 → bot 不能真"use seeds"；无相机 API | 🟡 | `golem.plant` = 插件设 `farmland`+`wheat[age]`，bot 播 `swingArm`+音效；稻草人=armor stand+南瓜+干草（不实现加速，只粒子演出）；「镜头升起」= 把玩家传送到高台 + `freezeInput`（spec 本就写站高台） |
| L05 | buildHut 参数化、4 栋房、告示牌写字、烟囱、门/窗朝向 | setBlock batch API；`Sign#setLine` 确认；UI 输入在 Studio | 🟢 | 全部插件 setBlock；sign 由插件放置并 `setLine`；注意 door 需设 hinge/facing；烟囱用粒子 |
| L06 | 旅商/羊驼 spawn、3 木桶、物品飞行动画、桶盖自动合、交易 | WanderingTrader/Llama/ChestedHorse API；`Barrel` block data `setOpen` 确认；ItemDisplay 插值 API | 🟡 | 旅商用 `setPersistent(true)` 防 despawn；飞行用 **ItemDisplay + `setTeleportDuration/setInterpolationDuration`**（比 Item 物理更可控更漂亮）；交易简化为右键交材料→给织线（不做真 Merchant UI） |
| L07 | 悦灵释放/assign/patrol、物品弧线、容器分拣、20+ 只悦灵 | Allay `setAI/setAware/getPathfinder` 确认，但 Pathfinder 是**地面**寻路 | 🟡 | 悦灵 `setAI(false)` + 插件每 2 tick `teleport` 沿贝塞尔曲线飞（或 ItemDisplay 替代视觉），弧线用 ItemDisplay；压测 16 只上限 |
| L08 | 熔炉/红石门/红石灯/状态灯带、机器状态、拉杆、grader 注入 | block data `setLit/isLit`、`setOpen` 确认；真 4×4 活塞门无可靠搭法 | 🟡 | **不搭真红石**：直接切 block state + 播活塞/熔炉音效 + 粒子；机器状态存插件 device registry（`machine.start/report` 事件由插件发）；grader 注入是 TS 层，不碰 MC |
| L09 | 酿造计时、bossbar、僵尸村民治疗、黎明控制、缺材料降级 | `BrewingStand#setBrewingTime`、`ZombieVillager#setConversionTime`、BossBar API 均确认 | 🟢 | 计时用插件 tick 任务（不依赖真实酿造配方）；治疗设 `conversionTime` + 虚弱粒子/金苹果音效；黎明=tick 推进 time + bossbar 渐变 |
| L10 | **两 bot 同服**、两岸铺桥、共享材料、消息、合龙石、村民过桥 | 3 bot 实测 ✅；bridge 需 bot 自铺自走，pathfinder 不过缺口 | 🔴 | 见 §2.3；若不 spike 通过 → 降级：plugn 预铺 80% 桥面，bot 只铺两侧各 2–3 格 + 玩家合龙石（判定仍查全覆盖+每块 `block.place` 的 `by`） |
| EP | 附魔台右键、刻字、指令表流动 | Interact API；`TextDisplay#text/setLine`；粒子 | 🟢 | `writeRune` 用 TextDisplay/告示牌；「流动」用粒子+display 动画 |
| Labs | 递归塔、断言信标 | setBlock batch；Beacon 需金字塔+天空 | 🟡 | 递归塔限 ≤400 block 并分帧；信标简化为发光柱+`end_rod` 粒子（或插件搭 4 级金字塔+激活） |

### 2.3 L10 桥段（唯一红区）的具体解法

问题：`mineflayer-pathfinder` 不能跨越缺口；设计要 bot「从两岸铺满桥面」并站在自己铺的桥上。这不是 API 能一键给的，属于**自定义行为**，必须 Day-2 前 spike。

两种可行路线（按推荐顺序）：
1. **贴近岸边铺**：把 deck 预算从 24–32 降到 **12–16**，两岸各铺 6–8 格。bot 站岸边用「向前下看→`placeBlock`→`setControlState('forward')` 一步」循环；每铺 1 格后插件 `player.teleport` 校正到方块中心防掉落（不算作弊，是防抖），失败兜底传回岸边。判定逻辑不变，只改 spec 参数。
2. **插件托底**：插件先以 `barrier` 或 `oak_planks` 预铺桥面并逐 tick 移除/替换，bot 沿桥走位并「放置」视觉上最后一层；对判定透明（事件仍记在 bot 名下）。风险：观感可能有重影，需 demo 时检查。

**不推荐**：真让 bot 从岸上「飞」铺 24 格——每格 0.5s+寻路抖动，20–25 min 关卡会变成 5 分钟纯走路。

## 3. Showpiece 实现方案（primitive 组合 + tick 调度 + 加载约束）

| showpiece | primitive 组合 | 必须 tick 调度？ | 约束/风险 |
|---|---|---|---|
| L1 灯河 | `buildProps(lampPath)` → 玩家 Interact → `setBlock(lantern)`×4 → `particle(end_rod)` 沿灯柱顺序喷（每 2t 一组）→ `sound(block.enchantment_table.use)` → `advancement` → 村民走位 + 火把块 | 是：粒子/村民折线按 tick 时间轴 | 玩家需在灯路径 32 格内；`view-distance=6` 时超出 96 格的远处灯不可见 → 灯柱间距 ≤ 12 |
| L2 蛋糕节 | `Item` 蛋 → 收蛋 → `Barrel` 盖开合（`setOpen`）→ `buildProps(cakeTower)` → `particle(totem)` → `sound(note_block.chime)` → advancement | 部分：桶盖动画 2–3 tick | 鸡/蛋实体在 reset 时必须清空；否则「恰好 6」被污染 |
| L3 三夜剪辑 | `trialPatch`(time/weather/entities) → `title` 每夜字幕 → `freezeInput` → 僵尸/铁傀儡走位 → `bossbar(夜数)` → `sound(bell)` | 是：三夜要按时间轴自动切换，禁止整段硬 wait 卡 UI | 每夜之间 `teleportPlayer` 回村口；NPC 路径避开村庄门（protectedBlocks） |
| L4 麦田 | 插件批量 `plant`（每 tick ≤2000 块）→ `particle(composter)` → `sound(block.crop.break)` 麦浪 → `title` → 玩家高台 teleport | 是：分帧+进度条，不能卡 1 个 tick | 25×25 一次 625 块，2 tick 内可完成；`simulation-distance` 需覆盖整块田（≥6） |
| L5 建筑师的黄昏 | `buildProps(hut)`×4 并行/串行 → `setBlock(sign)`+`Sign#setLine` → `particle(campfire)` 烟囱 → `sound` → 晚霞（time 12500） | 部分：四栋房分 4 个 tick 批次防卡顿 | 4×6×5×4≈500 块，预算内；update 区块加载 |
| L6 商队 | `spawnEntity(wandering_trader/llama)` → `ItemDisplay` 飞行分拣 → `Barrel#setOpen` 合盖 → `sound(raid.horn)` → `TextDisplay` 清单 | 是：ItemDisplay 每 2–4 tick 更新目标变换 + interpolation | ItemDisplay 的 `viewRange` 要 ≥ 场景半径，否则远处看不见 |
| L7 信风 | open cage（`setBlock air`）→ allay `setAI(false)` → 插件每 2 tick teleport 贝塞尔轨迹 → ItemDisplay 弧线 → `particle(end_rod)` → 管道高亮（Studio 侧） | 是：20 只×每 2t，需预算测试 | 16 只上限；allay 飞行路径别穿方块（会卡）；用 noClip 视觉？无 API，绕开建筑 |
| L8 工坊启动 | `device` 状态 → `setBlock` 灯带（海晶灯/红石灯）→ `particle(electric_spark/flame)` → `sound(blastfurnace.fire_crackle/piston.extend/bell)` → `title` | 是：四台机器依次启动的卡点（每 10t 一台） | 不搭真红石；门用 block swap 模拟滑动，注意 protectedBlocks 不含门 |
| L9 破晓 | bossbar 倒计时 → 酿造 timer → `particle(weakness/golden_apple)` 治疗 → time 推进 0→1000 → bossbar 红→白 → `sound(bell)` | 是：黎明渐变按 tick；缺材料走 `try/catch` 演出 | 治疗完的僵尸村民会变村民，记得 reset 时换回（重置=重新 spawn） |
| L10 桥合龙 | bot 铺桥 → 玩家 `keystone` → `particle(end_rod)` 120 → `setBlock` 桥面亮起（海晶灯渐变）→ `sound(bell+levelup)` → time 23000 → 村民过桥 | 是：合龙后 40t 的连续演出 | 峡谷区域大，必须 `setChunkForceLoaded` 覆盖桥面；远端粒子用 volume>1 的 `playSound`（半径=16×volume） |
| EP 元织机 | `TextDisplay` 指令表流动 → 粒子 → `writeRune` → 附魔台 Interact | 是：滚动字幕 | 用 display 插值，不用每 tick teleport |

**相机结论**：Paper 无自由相机；可用 `Player#setSpectatorTarget(Entity)` 跟拍单个实体（织偶/桥），但不能做轨控、不能平滑切换。所有演出按「定点机位 + cut」设计；横移镜头用「玩家站高台 + 视角朝向 NPC」实现。不要为镜头写 primitive。

## 4. Day-1 Runbook（可复制）

```bash
# 0) 目录
mkdir -p ~/loom/{server,plugin,spikes} && cd ~/loom

# 1) 服务端：从 Fill API 取 build 74 + sha256 校验（2026-10-31 实查）
curl -s https://fill.papermc.io/v3/projects/paper/versions/26.1.2/builds/latest -o build.json
URL=$(python3 -c "import json;print(json.load(open('build.json'))['downloads']['server:default']['url'])")
SHA=$(python3 -c "import json;print(json.load(open('build.json'))['downloads']['server:default']['checksums']['sha256'])")
curl -sL "$URL" -o server/paper.jar
echo "$SHA  server/paper.jar" | sha256sum -c -   # 期望 1d70b1da…e5f7（26.1.2-74）

# 2) server.properties（关键项）
cd server && echo "eula=true" > eula.txt && cat > server.properties <<'EOF'
online-mode=false
enforce-secure-profile=false
level-type=minecraft\:flat
level-seed=1042
generate-structures=true
gamemode=creative
difficulty=peaceful
doMobSpawning=false
spawn-protection=0
view-distance=8
simulation-distance=8
server-port=25565
motd=THE LOOM
EOF
(java -Xms1G -Xmx2G -jar paper.jar --nogui > server.log 2>&1 &)   # 冷启动 ~12s

# 3) 插件（Gradle Wrapper 9.8.2；paper-api 26.1.2.build.74-stable）
cd ../plugin && cat > build.gradle.kts <<'EOF'
plugins { java; id("com.gradleup.shadow") version "9.6.1" }
repositories { maven("https://repo.papermc.io/repository/maven-public/"); mavenCentral() }
dependencies {
    compileOnly("io.papermc.paper:paper-api:26.1.2.build.74-stable")
    implementation("org.java-websocket:Java-WebSocket:1.6.0")
}
java { toolchain.languageVersion.set(JavaLanguageVersion.of(25)) }
tasks.shadowJar { archiveClassifier.set("") }
EOF
# plugin.yml: name/version/main + api-version: '26.1'（经典 plugin.yml，不用 paper-plugin.yml）
# 依赖走 shade（离线演示可启动）；libraries: 方式实测可用但首启需联网
./gradlew build && cp build/libs/*.jar ../server/plugins/ && cd ../server && printf 'stop\n' > stdin.pipe

# 4) 重启脚本 scripts/dev-restart.sh
pkill -f 'paper.jar' ; sleep 2
cd server && (tail -f stdin.pipe | java -Xms1G -Xmx2G -jar paper.jar --nogui > server.log 2>&1 &)
for i in $(seq 1 40); do grep -q 'Done (' server.log && break; sleep 1; done; tail -3 server.log

# 5) Docker 跑法（注意 --network host，否则插件 WS 127.0.0.1 宿主不可达）
docker run -d --name loom-mc --network host \
  -e EULA=TRUE -e TYPE=PAPER -e VERSION=26.1.2 -e PAPER_BUILD=74 \
  -e ONLINE_MODE=false -e ENFORCE_SECURE_PROFILE=false -e MEMORY=2G \
  -v "$PWD/server:/data" itzg/minecraft-server:java25

# 6) bot 连接（pathfinder 必须 canDig+timeout；实测平地 4.2 格/s）
# bot/bot.js:
# const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
# bot.loadPlugin(pathfinder); const m = new Movements(bot); m.canDig = true
# bot.pathfinder.setMovements(m); await bot.pathfinder.goto(new goals.GoalBlock(x,y,z), 15000)
# 连接：mineflayer.createBot({host:'127.0.0.1',port:25565,username:'Golem1',auth:'offline',version:'26.1'})
npm i mineflayer@4.39.0 mineflayer-pathfinder@2.4.5 minecraft-protocol@1.68.0 ws@8.22.0
node bot/bot.js

# 7) MC 客户端：Java Edition 26.1.2（Day 0 安装），多人游戏 localhost:25565（offline，任意用户名）
```

## 5. 未验证项清单（每条：验证命令 / 通过判据 / 最晚时间）

| # | 未验证项 | 验证方法 | 通过判据 | 最晚 |
|---|---|---|---|---|
| U1 | **事件采集管线**（BlockPlace/PlayerInteract/Lever → WS notify；`byPlayer` 区分 bot） | 插件加 listener + WS notify；bot 放 1 块、人放 1 块；用 `bots.attach` 名单打 `isBot` | 事件字段齐全、`byPlayer` 只对真人 true、延迟 <100ms | Day 1 |
| U2 | `locateNearestStructure` Java API（本 turn 只验证了 `/locate` 命令） | 插件 `/loom locate village` → `World#locateNearestStructure` | 返回坐标 <2s；找不到时优雅返回 null | Day 1 |
| U3 | `setPlayerProfile` 离线 bot 皮肤 | 插件对 bot player 注入 profile 纹理，真客户端观察 | 客户端看到自定义皮肤（非默认 Steve） | Day 1 |
| U4 | resource pack + ItemDisplay/TextDisplay 观感 | 本地 HTTP 发 resource pack（自制 2 个 item model），真客户端看 | 客户端成功加载、模型/符文正确，无紫色缺失纹理 | Day 1 |
| U5 | 批量 setBlock 性能 | 插件 `/loom fill 2000 块`，测单 tick 耗时 | ≤2000 块/tick、MSPT 增幅 <10ms、客户端不闪 | Day 1 |
| U6 | advancement（datapack 预置 + `AdvancementProgress#awardCriteria`） | 插件放 datapack 的 advancement，玩家满足条件后 award | 客户端出 toast；失败则统一降级为 title+音效 | Day 1 |
| U7 | 悦灵/村民等「插件驱动移动」观感 | allay `setAI(false)`+每 2t teleport 沿曲线 30s | 不卡墙、不抖、客户端不橡胶带 | Day 2 |
| U8 | **L10 bot 铺桥+前进**（红区） | 按 §2.3 路线 1 写 30 行行为，桥长 12 | 无坠落、每块 `block.place` 记到对应 bot、≤60s | Day 2（失败即切降级） |
| U9 | 3 bot 已实测 ✅、2 bot 消息互通未测 | runner 双 agent 发/收消息，测握手与超时 | 无死锁、消息顺序可复现 | Day 2 |
| U10 | sound/particle id 在 26.1.2 存在性（如 `block.enchantment_table.use`、`totem_of_undying`、`electric_spark`） | 插件运行时用 `Registry.SOUNDS`/`Particle.valueOf` 解析，未知 id 记 warn | 关卡用到的 id 全部解析成功 | Day 1 |
| U11 | Mannequin 实体（NPC/艾拉/织偶外观兜底）运行期可用性 | 插件 `world.spawn(loc, Mannequin.class)` + `setProfile(ResolvableProfile)` + 真客户端看 | 玩家模型带自定义皮肤、可命名、可 `setRotation` | Day 1 |

## 6. 对 docs/06 §5.4 primitive 白名单的修正建议

| 动作 | primitive | 理由 |
|---|---|---|
| **增** | `gamerule {key, value}` | 现 `time` 只能设时间；L1 要 `doDaylightCycle=false`、所有关要 `doMobSpawning=false`（slime 实测事故）、L4 `randomTickSpeed` |
| **增** | `clearEntities {region, types?}` | reset 必须清残留 mob/掉落物；实测 peaceful 下旧 slime 仍能杀 bot |
| **增** | `spawnItem {type, at, count, motion}` | L2 鸡蛋、L6/L7 分拣飞行的物理载体 |
| **增** | `setBlockBatch [entries]` | 现 `setBlock` 单块、`fillRegion` 整块；灯柱/桥面/门是稀疏方块，逐条 RPC 会打爆性能 |
| **增** | `trialPatch {time?, weather?, blocks?, entities?, scenario?}` | L3「三夜试炼」、L8 过热 patch 是评分核心，现白名单没有注入通道 |
| **增** | `device {id, kind, at, states}` + 事件 `device.on/off/report` | L8 四台机器需要可枚举状态机；否则 `world.machines()` 无数据源 |
| **增** | `display {id, kind: item/block/text, at, scale, interpolation}` | L6/L7 飞行、EP 刻字、L1 远处标识的统一载体（比 Item 实体可控） |
| **增** | `setChunkForceLoaded {region, value}` | 大场景（L10 峡谷、L1 灯河远端）必须 force-load，否则方块写不进/看不见 |
| **改** | `animate` → 关闭集合 `{walk_path, bubble, nod, sink}`（带明确参数） | 现 L10 用了 `run_path/bubble/fray_retreat` 等自由 kind，插件无法穷举实现 |
| **改** | `freezeInput/unfreezeInput` 注明实现 = 取消 `PlayerMoveEvent` + `setWalkSpeed(0)` | 不是 spectator（会破坏手部/UI）；`Player#setFreezeTicks` 是细雪冻结，不能锁输入 |
| **改** | `advancement` 标注「需 datapack 预置；无 datapack 时降级 title+音效」 | API 只能 award 已注册的 advancement |
| **改** | `time` 拆成 `setTime`（世界时间）与 `gamerule`（规则） | 名字歧义，实现容易漏 |
| **删** | `saveSnapshot/restoreSnapshot` | v1 不做区域 NBT 快照（成本高、易与 block entity 冲突）；reset 用「重建 staging + clearEntities」，≤2s 预算可达 |
| **删/改** | `loadScene` 只允许加载构建期打包的 scene id | 运行时读任意文件是安全面；scene 数据由插件 classpath 资源提供 |

另：`buildProps` 的 builder 清单（07 §6）当前 6 个（lampPath/hut/bridgeSegment/ritualCircle/supplyChest/farmPlot），逐关还缺 **henhouse、barnBarrel、cakeTower、loomWorkshop、brokenBridge、henhouseNest、signBoard**，建议在 07 §6 补齐为显式清单（否则每个 level smith 都会自己发明 builder 名）。

## 7. 发现的 spec/文档冲突（最终 spec 复核清单）

> 已核对：L02/L08/L10 已按 registry 改名并附「草稿名→registry」映射表，**没有 API 名漂移**（这点比预期好）。以下是仍然真实存在的冲突：

1. **L01 starterCode 写死坐标 vs seed 随机（必修）**：spec 说灯柱位置 session 随机（4 模板 + 整体平移 ≤6 格），但 starterCode 里 `moveTo(-12,10)` / `place("lantern",-12,14,10)` 是常量；`y=14` 也依赖 anchor 地形。要么 L01 固定坐标（最简），要么 starterCode 支持模板变量注入（`{{lamp1.x}}`）。
2. **L01 `byPlayer` 判定语义**：bot 也是 player 实体，`BlockPlaceEvent` 对 bot 同样触发。必须用 `bots.attach` 的 session bot 名单把 `byPlayer` 定义为「非 bot 的真人」，否则「第 4 盏灯由玩家亲手点」会被 bot 放置误判。
3. **docs/12 坐标约定 vs 签名（影响 validator/类型生成）**：§1.4 规定水平位置一律 `(x, z)` 两参数，但 §3 的 `golem.collect(item, pos)` / `golem.deposit(pos, item, count)` 用 `pos`；L02 spec 已按 `collect("egg", x, z)` 写。建议 registry 统一为 `collect(item, x, z)`、`deposit(x, z, item, count)`（或声明 Vec2 重载），否则 validator 与 `.d.ts` 会互相打脸。
4. **docs/12 的 `Machine` 契约 vs L08 学生面（语义冲突）**：registry §2 写 `interface Machine { start(): Promise<void>; ... }`，但 L08 明确「本关不引入 async/Promise，学生面契约用 `void`」（L9 才教 async），L08 映射表也这么写。两份文档必须其一让步（建议 registry 加「L8 学生面签名」注记）。
5. **L08 评分事件计数与组合语义（潜在评分 bug）**：`four-started` 判 `events("machine.start").length === 4`，而学生用「熔炉+警钟」组合出第四台；若组合机的 `start()` 内部再调用子机器 `start()`，事件会重复计数（>4）。建议断言改为「按 machineId 去重后恰为 4」或组合机不发子事件。
6. **07 §1 组件表**写 `plugin/` 是 Java 21 → 应为 **Java 25**（Paper 26.1+ 要求；本机 spike 用 25 通过）。
7. **07 §2.2 外观**说「server resource pack 给 bot 皮肤」→ resource pack 改不了 player 皮肤；改为「`Player#setPlayerProfile` 注入 或 Mannequin NPC」。
8. **L01 隐藏测试 id 含空格**：`id: h-extr lamppost`（未加引号，值带空格）大概率过不了 schema/CI 命名约束，改名 `h-extra-lamp`。

## 8. 最终 spec 复核清单（L03–L07/L09 落地后照此勾）

- [ ] 每关 `wow` 只用 §3 能力集合（无自由相机/无骨骼动画）；
- [ ] 每关 setup 含 `clearEntities` + `gamerule doMobSpawning=false` + region `setChunkForceLoaded`；
- [ ] 评分事件字段（`byPlayer`/`by`/`block`/`pos`/`tick`）与 U1 实现一致；
- [ ] 引用的 builder 名都在 07 §6 清单内；
- [ ] 学生 API 名 ∈ docs/12（或已登记映射）；
- [ ] 演出时间轴考虑 12s 冷启动 + 2s reset + 1–2s bot 动作延迟（不能把 wow 压在 0.5s 内）。

## 9. 证据与来源

- 实测脚本与日志：`spikes/mc-bot-paper/`（`multibot.js`、`test3.js`+`test3.log`、`bot.js`、`test2.js`、`server/server.log`、`plugin/`、`README.md`）；本 turn 的 locate 命令与输出见 §5 U2。
- 版本/API 事实：`docs/02-minecraft-stack.md` §1/§2/§9（Mojang manifest、Fill API、Paper 26.1.2 Javadoc 27 个类的 HTTP 200 校验、mineflayer `testedVersions`、#4189）。
- 逐关设计：`docs/05-curriculum.md` §8；`content/levels/L01/L02/L08/L10`；`docs/07` §2/§3/§6/§10；`docs/06` §5.4；`docs/12`。
