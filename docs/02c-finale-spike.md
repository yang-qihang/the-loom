# docs/02c-finale-spike.md — L10 双 bot 铺桥实证（唯一红区验证）

> 状态：v1（已完成实测）｜负责人：scout-minecraft｜最后更新：2026-10-31
> 上游：`docs/02b-level-feasibility.md` §2.3/U8/U9/U11、`content/levels/L10-two-weavers.md`（v1）、`spikes/mc-bot-paper/`（Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0 锁定栈）
> 证据：`spikes/mc-bot-paper/bridge-run.log`、`bridge-spike-results.json`、`bridge-spike.js`、`server/plugins` 内 plugin v2 源码 `plugin/src/main/java/dev/loom/spike/LoomSpikePlugin.java`。**本文件不改 docs/02b**，合并建议见 §5。
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

## 0. 结论（TL;DR）

1. **路线 A 可用，建议 Day-2 设计冻结采用**：10/10 次成功、**0 次掉落**、0 次兜底 teleport 触发、单轮端到端 **6.75–6.85s**（3 个实体走位 + 3 次 `placeBlock`+前进 + 玩家合龙石）。"无兜底"对照组 5/5、0 掉落 → 在 1 宽桥 + 4 格缺口条件下 bot 实际是**走上去的**，teleport 只作安全网。
2. **placeBlock 的真实约束比文档写的多**：bot 必须先站到参考方块中心并 `look(yaw)` 朝向；目标格必须为 air、参考方块必须相邻实心、距离 ≤4.5；`placeBlock` 内部等 `blockUpdate`（默认 5s），目标被占/不可达会**静默等 5s 后抛错**（我们踩过一次）。
3. **路线 B 也可用（作为 fallback / 预录素材）**：5/5，桥面由插件逐 tick `world.fill` 完成（11 格稀疏填充 **750–850ms**），3 条 `ItemDisplay` 飞行在 bot 端可见；bot 只负责走位/挥臂/触发，评分看「材料到位 + 合龙石 + bot 到达对岸」。
4. **actorType 区分实测通过**：`bots.set` 名单内两个 bot 的放置事件 `actorType=bot`；未登记第三人（模拟真人）合龙石事件 `actorType=player, byPlayer=true`。**bot 本身也是 player 实体，必须显式名单**，否则"玩家亲手放合龙石"会被 bot 误判。
5. **两 bot 同服消息**：MC chat 10 轮 p50 **1ms**、max **3ms**（10/10 送达；20 条连发也 20/20 送达）——但**协议不要走 MC chat**：那是玩家台词通道，会被聊天格式/插件干扰；进程间消息应走 runner mailbox（docs/12 `agent.send/receive`），本次只验证了 MC 侧时间尺度。
6. **视觉兜底（无 MC 客户端，只能服务端/协议级验证）**：Mannequin spawn 成功、用真实 Mojang 皮肤 URL 经 `PlayerProfile#setTextures` + `ResolvableProfile` 注入成功、bot 端可见 `mannequin`（type=living）；`ItemDisplay` 沿路径移动 60 ticks，bot 采样到 **30 个唯一位置（x −1.73→14）**。**皮肤外观与插值平滑度需真客户端目测**（列 §5 U12）。
7. **对 L10 spec 的硬建议**：把"两岸 bot 铺满 24–32 格"改为"插件预铺 80% 桥面，两侧 bot 各铺 1–2 格 + 玩家合龙石"；材料箱语义、`deck-full`/`materials-exact` 断言需同步改（§4）。

## 1. 测试装置与方法

- 服务端：Paper 26.1.2 build 74（Java 25），flat 世界；插件为 v2 spike（在 v1 上增加 `world.fill/world.block/events.drain/bots.set/player.teleport/player.gamemode/player.give/player.clear/entity.mannequin/display.spawnItem/display.animate/display.remove`，并用 `BlockPlaceEvent` 记录带 `actorType` 的事件流）。
- 地形（y=99，桥面 z=0 单宽）：左平台 x∈[-6,0]、右平台 x∈[13,19]；**预铺 80%**：x=1..4 与 x=9..12 为 oak_planks；**缺口 4 格**：x=5..8。左 bot 铺 x=5,6，右 bot 铺 x=8，玩家合龙石铺 x=7（与 L10「中央基座」同构）。
- 三名"玩家"：`LeftWeaver`/`RightWeaver`（在 bot 名单内）+ `HumanLike`（不在名单内，模拟真人）；均 survival，材料由插件 `player.give` 发放。
- 单轮流程：teleport 三人到平台 → 清缺口 → 清背包/发材料 → 走位到桥边 → bot 逐格 place+前进（可选兜底 teleport）→ 模拟真人放 lodestone → 插件 `world.block` 校验 12 格 + `events.drain` 校验归属 → 记录指标。
- 复现：`node spikes/mc-bot-paper/bridge-spike.js`（结果写 `bridge-spike-results.json`，完整 stdout 在 `bridge-run.log`）。

**一个关键 harness 教训**：reset 必须"**先 teleport、再挖缺口**"。首版顺序反了，缺口方块被清的瞬间站在上面的 bot 掉下去摔死（记录到 1 次 death），看起来像"bot 自己掉桥"——实施时 reset 脚本必须按此顺序，否则会误判并影响评分。

## 2. 实测数据

| 路线 | 次数 | 成功率 | 端到端耗时 | 铺桥核心耗时 | 掉落 | 兜底 teleport |
|---|---|---|---|---|---|---|
| A（预铺 80% + bot 铺 3 格 + 兜底 teleport） | 10 | **10/10** | 6.70–6.85s（均值 6.77s） | 见下注 | **0** | **0 次触发** |
| A 对照（无兜底 teleport） | 5 | **5/5** | 6.75–6.80s | 同上 | **0** | — |
| B（插件铺桥 + display 演出） | 5 | **5/5** | 7.00–7.05s（均值 7.04s） | 桥面 fill **750–850ms** | 0 | — |

注：A 的 `placeMs`（从三人走位完成到合龙）均值 **3.33s**，其中包含模拟真人从 x=15.5 走到 x=9 的时间；按结构估算 **bot 单次 `placeBlock`+前进 ≈0.3–0.4s（3 次合计约 1.0–1.2s）**，其余为真人走位 ≈2.0s + 合龙石 ≈0.2s。总时长波动仅 ±50ms，说明 bot 行为在该 rig 下是确定性的。

**归属与事件（10/10 轮一致）**：`by = {LeftWeaver: 2, RightWeaver: 1, HumanLike: 1}`；合龙石事件 `{by:"HumanLike", actorType:"player", byPlayer:true}`；两 bot 的 3 次放置 `actorType:"bot"`。桥面校验：x=1..12 共 11 格 oak_planks + x=7 lodestone，`complete=true` 每轮。

**消息延迟**：10 轮 `PING` 往返 p50=1ms、max=3ms；20 条无间隔连发 20/20 送达（首轮测试曾出现 12/20，复测为测试脚本统计窗口问题，非服务端丢包——不要把它当"chat 不可靠"证据）。

## 3. `placeBlock` 约束与踩坑（实现 agent 必读）

1. **站位**：先 `player.teleport`/走位到**参考方块中心**（+0.5, feetY, +0.5），否则浮点漂移会让服务端拒绝或把方块放到相邻格。每次放之前都校准一次，成本 <150ms。
2. **朝向**：`bot.look(yaw, pitch)` 后再 `placeBlock`；+x 方向 yaw=−90°，−x 方向 yaw=+90°；pitch≈0.45 向下看。朝向不对时 `placeBlock` 会超时而不是报错。
3. **支撑/目标约束**：参考方块必须是实心且与目标相邻；目标格必须是 air 且在 4.5 格 reach 内；我们使用"脚下的桥面格为 ref、face=(±1,0,0)"，这是最稳的铺桥姿势。
4. **blockUpdate 等待**：mineflayer 的 `placeBlock` 会等服务端 blockUpdate，默认 5s；**目标被占/不可达时表现为挂 5s 后抛错**（route B 首跑因把真人放在 7 格外而踩到）。放之前 `bot.blockAt(target).name === 'air'` 预检。
5. **前进**：同层桥面无需跳跃；`setControlState('forward', true)` + 40ms 轮询位置，到目标 x±0.25 或 700ms 超时即停。1 宽桥 + 700ms 窗口在 15 次测试中 0 掉落，但仍保留"检测 y < 桥面+0.5 → teleport 到目标格中心"的兜底（0.5s 内恢复，不影响评分）。
6. **材质**：survival 下 `placeBlock` 消耗背包 planks；每次 `equip` 后再放；插件 `player.give` 足够（4–8 块/轮）。
7. **掉落判定与恢复**：本轮全部成功，没有真实坠落样本；建议 demo 现场保留 `player.teleport` 兜底并在评审前用无兜底模式跑 5 次（我们已跑，5/5）。

## 4. 对 L10 spec 的实现配方（Day-2 冻结建议）

```js
// bot 侧（runner 的 agent 实现，学生不可见）
async function weaveSegment(bot, startX, dir, count) {   // dir=+1 左岸 / -1 右岸
  await walkTo(bot, startX); await equipPlanks(bot)
  let refX = startX
  for (let i = 0; i < count; i++) {
    await faceAndPlace(bot, refX, dir)      // look(yaw) + placeBlock(ref,face) + 校验 blockUpdate
    refX += dir; await advanceOrTeleport(bot, refX)  // 40ms 轮询 walk；掉桥则 teleport 兜底
    await equipPlanks(bot)
  }
}
// 编排：Promise.all([weaveSegment(left, 4, +1, 2), weaveSegment(right, 9, -1, 1)])
// 玩家节拍：bridge.keystoneSlot 只剩 1 格时，真人右键放 lodestone → 插件广播 block.place/byPlayer
```

**必须同步修改的 spec 语义**（否则评分与实现打架）：
1. `deck` 24–32 **不再由 bot 全部铺**；改为「预铺 80% + 缺口 4–6 格」，`materials` 箱只放缺口块数（我们的 rig 是 3 块：左 2 + 右 1，玩家合龙石 1 不算材料）。「各取一半」的教学点保留为：左取 `ceil(gap/2)`、右取 `floor(gap/2)`。
2. `deck-full` 断言改查「全桥面（预铺 + bot 铺 + 合龙石）无缺口」；`materials-exact` 改查 `bot 放置数 === 材料箱初始数` 且箱归零；`both-weavers`/`keystone-by-player` 不变（actorType 已验证）。
3. 桥面建议从 1 宽改 **3 宽（z=−1..1）**：掉落零容忍的 demo 更稳，bot 走中间列，两侧是观感护栏；代价是 fill 量 ×3（仍 <2s），需 Day-2 用同一 harness 复跑一次（30 分钟预算）。

## 5. 视觉兜底验证 + 对 docs/02b 的合并建议（不改 02b）

| docs/02b 项 | 新状态 | 证据 |
|---|---|---|
| U8「L10 bot 铺桥+前进」 | **关闭（绿）**：路线 A 可行，10/10、0 掉落、0 兜底触发；剩余风险=1 宽观感 | 本文件 §2 |
| U9「≥3 bot / 消息」 | 部分：3 bot 同服早已实测；本 turn 补 MC chat 延迟（p50 1ms/max 3ms，20/20 连发）；runner mailbox 仍未测（TS 层） | §2；建议保留 runner 层未验证 |
| U11「Mannequin 皮肤」 | 部分：spawn + 皮肤 profile 注入 + bot 可见 `mannequin` 全部通过；**视觉皮肤未验证（无 MC 客户端）** | §0-6；Day-0 装客户端后 30s 目测 |
| 新增 U12「ItemDisplay 飞行动画」 | 部分：bot 端可见 `item_display` 且位置沿路径变化（30 唯一位置/4s）；客户端插值观感未验 | §0-6 |
| 新增 U13「placeBlock 在 3 宽桥/更长缺口」 | 未验证：本 rig 只有 1 宽 + 3 次放置；若 spec 要 bot 各铺 3 格（gap 6）需 30 min 复跑 | `bridge-spike.js` 改常量即可 |

**Day-2 前给 lead 的决策项**：① 采用路线 A + 上表 spec 修改；② 路线 B 只作 demo 机异常时的 fallback，且按 §4 录一段 15s 预录保险；③ 3 宽桥复跑 30 min（建议做，降低现场观感风险）。

## 6. 剩余风险 & 未验证

- **无 MC 客户端**：Mannequin 皮肤、ItemDisplay 插值、粒子/音效观感全部只能服务端/协议级验证；Day-0 装 26.1.2 客户端后按 U11/U12 目测。
- **rig 与真实 L10 几何不同**：真实 spec 是 deck 24–32、两岸 x=-2 与 deck+2、桥面 y=64；本次是 12 格桥、缺口 4 格、y=99。机制已验证，参数需在真 L10 场景复跑一次（即 U13）。
- **两 bot 同时 place 的竞争**：本 spike 是 JS 串行调用（左 2 次→右 1 次），未测真正并行 `Promise.all` 同时放块；bot 动作都走同一 WS/runner 队列，预计无竞争，但要在 U9 runner 层确认。
- **performance**：3 bot + 插件 tick 未测 MSPT；但 15 轮时长稳定（±50ms），无明显卡顿。demo 前用 `spark tps` 采一次基线。
- **预录 fallback**：路线 B 的 5/5 可作预录素材；建议录 A 成功一轮（15s）+ B 一轮，放 demo 保险箱。

## 7. 复现命令与证据文件

```bash
cd spikes/mc-bot-paper
# 1) 起服（插件 v2 已装入 server/plugins，冷启动约 9s）
cd server && (tail -f stdin.pipe | java -Xms1G -Xmx2G -jar paper.jar --nogui > server.log 2>&1 &)
grep -E 'LOOM SPIKE v2|WS listening|Done \(' server.log
# 2) 跑 spike（A 10 + A控制 5 + B 5 + chat/mannequin/display）
cd .. && node bridge-spike.js
# 3) 证据
cat bridge-run.log | grep -E 'ROUTE_A_TRIAL |ROUTE_B_TRIAL|SUMMARY|CHAT_LATENCY|MANNEQUIN|ITEMDISPLAY'
python3 -m json.tool bridge-spike-results.json | head -40
```

插件 v2 源码：`plugin/src/main/java/dev/loom/spike/LoomSpikePlugin.java`（新增 12 个 RPC + `BlockPlaceEvent` 事件流；Gradle Wrapper 构建）。测试后服务端已停止，无残留进程。

---

## 8. 实现落地补充（2026-10-31，L10 运行时专项）

路线 A 已落成真实关卡与真实 e2e，不再是 spike：

- **关卡实现**：`content/levels/L10.content.ts`。桥面 y=65、宽 3（z=-1/0/1）、x=0..27；缺口 5 列从 x=10 开始；两只 bot 各补 2 块（`ceil/floor`），中央 x=12 留给玩家合龙石。y=63 是桥墩/岩壁，侧轨 z=±1 预铺，bot 只补中心列。`prepare` 建两岸/缺口/玩家基座；`afterPrepare` 把 LeftWeaver / RightWeaver 分别传送到两岸；`playerBeat` 在正式流程里由玩家右键放 `lodestone`（e2e 用第三人真实玩家实体 HumanLike 走位/放置，不是 RPC 改世界）。
- **双 bot 通道**：`packages/worldport/src/paper-port.ts` 增加 `agents` 选项与 `teleportAgent()`；一次 `bots.set` 同时登记两个真实 mineflayer bot（LeftWeaver / RightWeaver），事件 actor 用真实玩家名，`actorType=agent`。消息不走 MC chat，按 docs/02c §0-5 走 runner 邮箱（`packages/worldport/src/multi-agent-sdk.ts` 的 `agent.send/receive`，语义：send 发到目标 agent 邮箱，receive 读自己邮箱）。
- **学生面**：L10 使用 `runMode: "explicit"`；`agent("左织")/agent("右织")`、`world.supply(pos).count(block)`、`world.keystone()` 由 runner 注入（`packages/runner/src/run.ts` 现在会把 SDK 的所有注入口作为工厂参数），单织偶关卡行为不变。
- **真实 e2e**：`npx tsx it/l10-real.ts`（真实 Paper 26.1.2 + 两个真实 bot + 一个真实玩家实体）：prepare → 双 bot 邮箱握手 → 真实 `moveTo`/`placeBlock` 4 块（无 virtualPlace 兜底）→ HumanLike 以 `actorType=player` 放合龙石 → 生产 grader 3 星 → 与 MockWorld report/digest 对照（并发事件按内容 canonical 排序后比较）→ 双重 reset。证据 `evidence/l10-real-latest.json`：17 项 check 全 PASS、3 星、参考解 2.6s、digest=MOCK、reset 4/3ms 且 hash 稳定、握手消息 8 条（4 发 4 收，数字份额）、`no-virtual-fallback` PASS。
- **未完成/边界**：① Studio/Engine 会话层（`packages/session`）尚未把 `agent()`/邮件箱注入沙箱，L10 目前可经 `it/l10-real` 真实跑通、但 Studio 内点运行还未接线（write scope 未含 packages/session）；② e2e 的玩家合龙走真实玩家实体（HumanLike，actorType=player），但还不是真人键鼠；真实客户端右键需 Lead 人工复验；③ 隐藏随机变体（gap 4–6、宽 1/3、右织延迟）目前在 Mock 侧覆盖，真实随机复跑留给后续；④ GUI 仅用 :99，未在 :0 运行。
