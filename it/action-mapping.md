# it/action-mapping.md — 内容动作 → PaperWorldPort 真实语义（T2）

> 状态：T2 冻结｜负责人：scout-minecraft｜最后更新：2026-10-31
> 用途：说明 L02–L04 的 content 在 MockWorld 里用的「等价动作」，在真实 Paper + mineflayer 端分别落到哪个插件操作/事件。
> 结论：**当前 content 不需要改**即可在真实端与 Mock 的 criteria/hidden/failures 完全一致（L2/L3/L4 真实 e2e 13/13）。

## 1. 学生 API / content 动作 → 真实语义

| content 写法（Mock 等价动作） | PaperWorldPort 真实实现 | 插件侧操作 | 产生的评分事件 | Mock 对应 |
|---|---|---|---|---|
| `golem.moveTo(x, z)` | `bot.moveTo`：选目标附近可站立格；若已在其 2.4 格内直接「近距到位」（L04 性能）；到位后 `agent.mark` | `agent.move`（PlayerMoveEvent + 显式 mark） | `agent.move{actorType:agent,pos}` | Mock `agent.move` |
| `golem.place("lantern"/"torch"/"bell"/"cobblestone", x,y,z)` | `world.classify` 判定是真实方块 → `bot.place`（预检 ref/air/reach≤4.5，BlockPlaceEvent） | `block.place`（BlockPlaceEvent） | `block.place{actorType:agent,data.block}` | Mock `golem.place` |
| `golem.place(...)` 目标被占 / 物品不可得 | 自动 fallback `world.virtualPlace`（mock 语义=覆盖） | 设置物理 fallback + alias；`block.place` | 同上 | 同上 |
| `golem.place("air", x, y, z)`（收蛋/收残株） | `world.classify` 判 air → `world.virtualPlace` | 逻辑平面：只改 alias；普通方块：物理清空 | `block.place{data.block:"minecraft:air"}` | Mock 写 `minecraft:air` |
| `golem.place("egg", 桶边)`（倒蛋计数） | 虚拟块：物理 `turtle_egg`，snapshot/alias 报 `minecraft:egg` | `virtualPlace` | 同上，`data.block:"minecraft:egg"` | Mock 写 `minecraft:egg` |
| `golem.place("wheat_sprout" / "wheat")`（种植/残株） | 虚拟块：物理 `wheat`，snapshot 报请求 id | `virtualPlace` + 逻辑平面 | 同上 | Mock 写请求 id |
| `golem.say(text)` | `bot.chat` | `AsyncChatEvent` → `say` 事件 | `say{data.text}`（供「报数」判定） | Mock `say` |
| `port.playerPlace(block,pos)`（playerBeat） | RPC `player.place`（testMode） | 设置方块+alias；事件 `actorType:player` | `block.place{actorType:player}` | Mock `playerPlace` |
| `port.setBlocks([...])` | RPC `world.setBlocks`；场景声明（reset 不丢） | 写 checkpoint；逻辑平面块只存 alias | （不产生评分事件） | Mock setBlocks |
| `port.clearRegion(from,to)` | RPC `world.clearRegion`；并被推导为 arena | 清方块+实体；记录 arena | — | Mock no-op |
| `port.spawnEntity({type,id,name,pos})` | RPC `entity.spawn`：`golem/agent` 只登记出生点并传送 bot；其他生成 NPC | NPC 表 + reset 重生成 | — | Mock no-op |
| `port.setTime/setWeather` | RPC `world.setTime/world.setWeather` | 时间/天气/规则 | — | Mock no-op |
| `port.fx(...)` | RPC `fx.title/sound/particle` | 演出 | — | Mock no-op |

## 2. 场景推导（不用为每关写 Java 分支）

`PaperWorldPort.prepare(content)` 的步骤：
1. `session.begin {levelId, seed, vars, groundY}`（groundY 由 def vars 中坐标的众数推导，如 L02–L04 = 65）。
2. 执行 `content.prepare(port)`，记录 setBlocks/clearRegion/spawnEntity/setTime/setWeather 调用。
3. `session.finalize {layout}`，layout 由以下数据推导：vars 里所有 `[x,y,z]` + 记录到的 setBlocks 坐标（→ tracked）+ golem 出生点（→ agentSpawn）+ clearRegion（→ arena）+ 参考解里 `place("…")` 的字面量（→ bot kit）。插件只按 layout 干活，无关卡分支。
4. L01 需要 scene hint（`groundY: 11`）因为它的灯柱几何与 mock 坐标不同；L02–L04 全部自动推导。

## 3. 逻辑平面（L04 田地类内容）

`groundY` 层上的 farmland/water/wheat/wheat_sprout/hay_block 若物理落块会把整块田变成 1 格高的墙，路径 finder 无法跨越。插件把这些块当作「逻辑平面」：只存 checkpoint alias（snapshot 按请求 id 报告），脚下 floor 层保持可走；`place("air")` 只移除 alias。其他方块（bell/torch/door/蛋/木桶等）仍然是物理方块。

**已知视觉限制（headless 验收不受影响）**：L04 的田块目前物理上是 floor（stone_bricks），田垄/作物仅存在于逻辑层。若之后真机 demo 需要视觉一致，建议内容线把 L04 场景改成「土/水在 floor 层、作物在 groundY 层」（这是 content action 表改动，需 Lead 协调，非当前阻塞项）。

## 4. 需要 content 改动吗？

- L02/L03/L04：**不需要**（真实 e2e 与 Mock report/digest 完全一致）。
- 可选（不阻塞）：①L04 视觉分层（见 §3）；②未来把 content 的等价动作替换成 docs/12 的 `collect/deposit/ringBell/plant/harvest` SDK 形式时，真实端口需要新增对应 SDK 语义（`golem.collect` → 走到蛋窝 + virtualPlace air + 背包计数；`deposit` → 容器 RPC + egg 事件；`ringBell` → virtualPlace bell/激活钟；`plant` → wheat_sprout 虚拟块；`harvest` → virtualPlace air），映射关系与上表一致，可作为下一波的接口预留。
