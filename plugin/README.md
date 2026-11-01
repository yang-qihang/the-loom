# plugin/ — LoomCraft Paper 插件（WorldPort RPC）

> 状态：已交付（T1 起实现；2026-11-01 试玩修复：sandbox 纯净/彻底 reset/通用玩家节拍）｜负责人：scout-minecraft / plugin-world｜最后更新：2026-11-01
> 上游：`docs/21-t1-contracts.md` §4、`docs/07-architecture.md` §3、`docs/02-minecraft-stack.md`
> 锁定栈：Paper **26.1.2 build 74** / Java **25** / Gradle Wrapper **9.8.2** / Java-WebSocket **1.6.0**（shade 进 jar）

## 构建与安装

```bash
cd plugin && ./gradlew build          # 产物 build/libs/loomcraft-plugin.jar（fat jar，无需运行时下载依赖）
# 或用仓库脚本（会顺带拷贝 jar、起服）：
bash scripts/mc-up.sh                 # 首次从 Fill API 下载 paper.jar 并做 sha256 校验
```

`plugin.yml` 使用经典格式（`api-version: '26.1'`，不用 `paper-plugin.yml`）；`config.yml`：

```yaml
ws:
  host: 127.0.0.1   # 服务通道只绑本机
  port: 8765
```

## RPC：JSON-RPC 2.0 over WebSocket（`ws://127.0.0.1:8765`）

所有响应带 `tick`；错误返回 `{"jsonrpc":"2.0","id":...,"error":{code,message}}`。
> 下表是 T1 冻结方法集，保留作历史；2026-11-01 新增/变更见本节末尾「试玩修复（2026-11-01）」表。

| 方法 | 参数 | 说明 |
|---|---|---|
| `health` / `ping` | — | `{ok,plugin,version,mc,tick,prepared,bots,npcs,events,lastResetHash,lastResetMs}` |
| `session.prepare` | `{levelId, layout}` | 按 layout 重建场景：清区域→铺地板/边界墙/灯柱→时间/天气/gamerule→传送并发放材料；清空事件 |
| `world.reset` | `{}` | 回到 checkpoint（重建方块/清本 session 实体/重生成 NPC/传送/发材料/清事件），返回 `{ok,ms,hash,tick}`；**≤2s**，同 checkpoint 两次 hash 相同（REQ-RESET-01） |
| `world.snapshot` | `{levelId}` | 协议 `WorldSnapshot`：`{levelId,seed,vars,blocks,agents,npcs,events,tick}`；`blocks` 只含 tracked（灯位）与本次运行放置的位置 |
| `world.setBlocks` | `{entries:[{pos:[x,y,z],block}]}` | 场景声明用（写入 checkpoint，reset 会恢复） |
| `world.clearRegion` | `{from,to}` | 清空区域（方块+区域内的非玩家实体），并删除区域内 checkpoint 记录 |
| `entity.spawn` | `{type,id,name,pos,role?}` | 非玩家实体→生成 NPC（`setAI(false)`、持久化、头顶名字）；`type:"golem"/"agent"`→注册织偶出生点并把在线 bot 传送过去（**不会生成假实体**） |
| `entity.clear` | `{ids?}` | 删除指定/全部本 session NPC |
| `player.teleport` | `{pos, name?}` | 传送指定玩家（bot 也可用 `name`）；不带 name 时传送非 bot 玩家 |
| `player.give` | `{name,item,count}` | 给物品（T1 用于发提灯） |
| `player.place` | `{block,pos,testMode:true}` | **无人测试模式**的 playerBeat：直接放方块并记 `actorType:"player"` 事件 |
| `bots.set` | `{names:[...]}` | 登记织偶玩家名；事件 `actorType`（agent/player）与 reset 传送/发材料依赖它 |
| `events.drain` | `{since}` | 取 `seq>since` 的事件：`block.place`（带 `actor/actorType/pos/data.block`）、`agent.move`（bot 每次移动 ≥0.4 格） |
| `fx.title` / `fx.sound` / `fx.particle` | `{text}` / `{id,at?}` / `{id,at,count?}` | 最小演出集合 |

### layout（`session.prepare` 的场景数据）

```json
{
  "levelId": "L01", "seed": 1,
  "vars": { "lamps": [[-12,14,10], [-12,14,-2], [2,14,-2], [2,14,16]], "optionalLamp": [[2,14,24]] },
  "arena": { "from": [-20,8,-10], "to": [8,18,28], "floorY": 10, "groundY": 11 },
  "lamps": [[-12,14,10], [-12,14,-2], [2,14,-2], [2,14,16]],
  "optionalLamp": [[2,14,24]],
  "tracked": [[-12,14,10], [-12,14,-2], [2,14,-2], [2,14,16], [2,14,24]],
  "timeTicks": 12000,
  "gamerules": { "doDaylightCycle": false, "doMobSpawning": false, "doFireTick": false, "keepInventory": true },
  "bots": ["Golem1234"],
  "agentSpawn": [0,11,0], "playerSpawn": [2,11,4]
}
```

`groundY` = 玩家站立脚底 y；`floorY = groundY-1`；每个灯位 `(x,y,z)` 会建 `groundY..y-1` 的灯柱，玩家/织偶站在相邻格（见 `bot/manager.mjs` 的 `findStandCells`）。

### 事件与评分

- `block.place`：`BlockPlaceEvent` 产生；`actorType=agent` 当且仅当玩家名在 `bots.set` 名单里，否则为 `player`；`player.place`（testMode）固定 `actorType=player, actor=player`。
- `agent.move`：bot 的 `PlayerMoveEvent`，每次位移 ≥0.4 格记一条（用于 L01 隐藏测试「放置前真的走到灯下」）；在 `building` 期间（prepare/reset）不记。
- 评分真值只来自 `world.snapshot`；`reset` 会清空事件。

### T2 增量（L02–L04 数据驱动场景 + 多会话隔离）

- **两阶段场景**：`session.begin {levelId,seed,vars,groundY}` → 内容通过 `world.setBlocks/clearRegion/entity.spawn/world.setTime/world.setWeather` 摆场景（插件只记录，不做关卡分支）→ `session.finalize {layout}`：按 layout 自动铺地板/边界墙/灯柱，生成延迟 NPC，传送 bot，发 kit，建立 checkpoint。T1 的 `session.prepare {layout}` 单调用路径保留。
- **虚拟块**：`world.classify {block}` 返回 `{isBlock, physical, virtual}`；`world.virtualPlace {pos, block, actor}` 用物理 fallback（egg→turtle_egg、wheat_sprout→wheat、pumpkin→carved_pumpkin…）落块并把请求 id 写入 alias，snapshot 按请求 id 报告，同时记 `block.place` 事件。等价于 Mock 的 `place("egg"/"wheat_sprout"/"air")` 语义，评分口径不变。
- **逻辑平面**：`groundY` 上的 farmland/water/wheat/wheat_sprout/hay_block 只存 alias（不物理落块），保证织偶能走过整块田；其他方块（钟/火把/门/蛋/木桶）仍落物理块。
- **多会话隔离（REQ-EPOCH）**：`session.begin` 生成新 `sessionId` 并 `epoch++`；所有游戏/场景 RPC 可带 `sessionId`，不匹配返回 `STALE_SESSION`；`world.snapshot`/`world.reset` 也回传 `sessionId/epoch`。两次运行互不污染。
- **`agent.mark {pos}`**：bot 适配器在「已经在目标附近、跳过走路」时显式补一条 `agent.move`，保证隐藏测试「放置前真的走到灯下」不被性能优化破坏。
- **调试读接口**：`world.block {pos}`、`world.regionCount`（返回 floor/区间方块数）。


- 单 session 单世界（`Bukkit.getWorlds().get(0)`）；多关卡并行由不同服/不同进程解决。
- 场景区域大小上限：`clearRegion`/`reset` 为逐方块遍历，建议 ≤100k 方块（L01 约 1.2 万，reset 实测 3–7ms）。
- 无鉴权 token（只绑 127.0.0.1）；公网/容器场景需改成可配置 bind + token（见 docs/02 §5）。
- 本插件不含评分/TS 解析；评分在 engine/grading 层。

### 试玩修复（2026-11-01，当前接口，docs/46 §2.1）

| 方法 | 参数 | 说明 |
|---|---|---|
| `session.begin` | `{levelId,seed}` | 每个会话新 `sessionId`+`epoch`；**清上一 arena 方块与区域实体、全局清非玩家实体、清空非 bot 背包/`pendingPlayerItems`/`playerKit`/事件/标注**；服务端首次 begin 清一次高台沙盒带（y 56–92，x/z ±48） |
| `session.finalize` | `{layout}` | 按 layout 摆场景、建全区域 checkpoint（非空气块 + 空地）、发本关 `playerKit`、传送玩家到 `playerSpawn` |
| `session.end` | `{sessionId}` | 引擎 dispose 会话时清理 NPC/标注/发光标记实体 |
| `playerBeat.arm` | `{sessionId, beats:[{pos,block}], items:[string], hint:string}` | 静默登记玩家节拍目标（引擎在织偶部分完成后才 `activate`） |
| `playerBeat.activate` | `{sessionId}` | 在目标处显示发光标记 + actionbar 提示，并允许完成；**此前任何会完成目标的操作被取消并提示「先让灰崽完成它那部分」** |
| `playerBeat.status` | `{sessionId}` | 调试：`armed/active/beats done` |
| `player.inventory` | `{}` | 调试/验收：所有在线非 bot 玩家背包 |
| `world.blocks` | `{sessionId, positions:[[x,y,z],...]}` | 调试/验收：批量读方块 |
| `player.give` | `{name,item,count}` | 语义增强：计入本关 `playerKit`，begin/finalize/reset/onPlayerJoin 都按它重建快捷栏 |

完成判定（全关卡通用，docs/46 §1.3）：玩家把方块真的放到目标坐标 / 右键目标方块本身 / **容错**（手持本关道具、站目标 6 格内、视线与目标方向点积 ≥0.7，对柱子侧面或空气右键）→ 插件落到目标坐标；未 `activate` 前拦截。

`health` / `session.status` 增加 `checkpointSize`、`playerKit`、`playerBeat`。
