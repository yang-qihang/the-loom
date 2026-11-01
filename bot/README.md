# bot/ — 织偶（Mineflayer）管理器

> 状态：已交付（T1 起实现；2026-11-01 增加 pathfinder 卡死恢复）｜负责人：scout-minecraft｜最后更新：2026-11-01
> 上游：`docs/21-t1-contracts.md` §5、`docs/02-minecraft-stack.md`
> 锁定栈：mineflayer **4.39.0** + mineflayer-pathfinder **2.4.5** + minecraft-protocol 1.68.0（Node 22；版本写在 `package.json`）

## 安装

```bash
cd bot && npm install     # 独立 node_modules，不污染仓库根依赖
```

## 用法

```js
import { GolemBot, GolemError } from "../bot/manager.mjs";

const bot = new GolemBot({ name: "Golem1234", host: "127.0.0.1", port: 25565 });
await bot.connect();                 // spawn + chunks loaded（45s 超时）
await bot.moveTo(-12, 10);           // 寻路到灯位旁的可站立格，15s 总预算
await bot.place("lantern", -12, 14, 10);  // 预检后放置并校验方块变化
await bot.say("灯亮了。");
await bot.disconnect();
```

## 接口与约束（docs/21 §5）

| 方法 | 说明 |
|---|---|
| `connect(timeoutMs=45000)` / `reconnect()` | 连接与重连；每次 spawn 后重建 pathfinder `Movements` |
| `moveTo(x, z, timeoutMs=15000)` | 目标是灯位/坐标；自动选择 2 格内**可站立**的格子（灯柱本身不可站），按「离 bot 最近」优先，逐个候选尝试（每个 ≤7s），总预算内失败抛错 |
| `place(block, x, y, z, timeoutMs=8000)` | **预检**：目标 air / 下方 reference 方块实心 / 视线 reach ≤4.5；装备物品→`lookAt`→`placeBlock(ref, 向上)`→轮询校验方块变成目标 |
| `say(text)` | 聊天台词（不要用 chat 传协议；消息走 runner mailbox） |
| `disconnect()` | 退服 |

**服务通道原则（不可绕过）**：没有自动行为——不自动挖掘（`Movements.canDig=false`）、不垫高（`allow1by1towers=false`）、不做跑酷（`allowParkour=false`）；所有移动都是显式 `moveTo`，每个动作都有 timeout。

## 错误码（`GolemError.code` + 中文人话）

`BOT_OFFLINE`、`BOT_CONNECT_TIMEOUT`、`NO_STAND_CELL`、`MOVE_TIMEOUT`、`MOVE_FAILED`、`NO_ITEM`、`TARGET_UNLOADED`、`TARGET_OCCUPIED`、`NO_SUPPORT`、`OUT_OF_REACH`、`PLACE_TIMEOUT`、`PLACE_REFUSED`、`PLACE_NOT_APPLIED`。

## T2 行为补充

- `ensureChunks()`：传送/场景 prepare 后目标区块仍在流式加载，`moveTo`/`place` 会先等区块就绪并轮询；
- `moveTo` 的目标 2.4 格内直接「近距到位」（L04 一行行种田有上百次移动，避免每次都起 pathfinder），到位由适配器补 `agent.mark` 事件；
- 可站立判定用 `block.boundingBox === "block"`（不再用材质白名单），hay/farmland/planks 等都按碰撞盒判断；
- 导出 `pathfinder, Movements, goals` 供 `it/debug-*.ts` 调试复用。

## 实测参数（Paper 26.1.2 本机，2026-10-31）

- 平地寻路：约 2.3–3.1s/10–14 格（L01 全流程 3 次移动+3 次放置 ≈ 12s）。
- 单次 place+前进约 0.3–0.4s；1 宽桥逐格铺 15 次实测 0 掉落（见 `spikes/mc-bot-paper/bridge-spike.js`）。
- 已知坑：路径目标若正好在障碍物后面（灯柱另一侧），pathfinder 会原地打转 → 已用「候选格按离 bot 距离排序 + 逐个重试」解决（`it/debug-scene.ts` 可复现调试）。

## 2026-11-01：pathfinder 卡死恢复（`_gotoWithRecovery`）

- L05–L10 真实路径上偶发「路径被头部高度的装饰方块拐角挡住」→ 现在 `moveTo` 走 `_gotoWithRecovery`：
  失败后按左右方向做一次短距横向 nudge 再重试，仍失败抛 `MOVE_STUCK`（中文人话）。
- 错误码新增 `MOVE_STUCK`；其余错误码不变。
- 对应证据：`it/l5-real.ts`–`it/l10-real.ts` 真实 Paper PASS（`evidence/l*-real-latest.json`）。
