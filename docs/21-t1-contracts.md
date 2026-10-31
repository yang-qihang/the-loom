# 21 — T1 实施契约（WorldPort / Engine API / 内容格式 / 分工）

> 状态：v1 冻结（T1 开工基线）｜负责人：Lead｜最后更新：2026-10-31
> 目的：让 MC 插件/织偶、Engine、Studio、内容、QA 五条线可以并行且能拼起来。
> 规则：本文件的接口先于实现；变更走 ADR。

## 1. T1 目标（唯一验收）

Studio 打开 → 选 L01 → 编辑器里运行 **referenceSolution** → 织偶在真实 Minecraft 里点亮 3 盏灯 → 玩家（bot 模拟右键）点第 4 盏 → 返回艾拉身边 → 评分 3 星 + 目标面板全绿 + 重置可重玩。
**同时**：同一流程在 MockWorld 上 100% 可跑（无 MC 也能验收）。

## 2. WorldPort（TS，`packages/worldport`）

```ts
export interface AgentActions {
  readonly pos: Vec3;
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
}

export interface WorldPort {
  readonly kind: "mock" | "paper+bot";
  prepare(content: LevelContent): Promise<void>; // 建场景/清实体/生成 agent/传送玩家
  reset(content: LevelContent): Promise<void>;   // 回到检查点（≤2s）
  snapshot(levelId: string): Promise<WorldSnapshot>; // 评分唯一真值
  agent(name: string): AgentActions;             // "golem"
  readonly world: World;                          // vars 等只读
  onEvent(listener: (event: WorldEvent) => void): () => void;
  teleportPlayer(pos: Vec3): Promise<void>;
  fx(cue: FxCue): Promise<void>;                  // title/sound/particle 的最小集合
  dispose(): Promise<void>;
}

export type FxCue =
  | { kind: "title"; text: string }
  | { kind: "sound"; id: string }
  | { kind: "particle"; id: string; at: Vec3; count?: number };

export interface LevelContent {
  def: LevelDef;                                  // 来自 packages/level-spec
  prepare(port: WorldPort): Promise<void>;        // 场景数据（方块/实体/时间）
  playerBeat?(port: WorldPort): Promise<void>;    // 玩家节拍的自动化替代（测试/无人演示）
}
```

## 3. Engine HTTP API v1（`apps/engine`，默认 http://127.0.0.1:4317）

| 方法 | 路径 | 请求/响应 | 说明 |
|---|---|---|---|
| GET | `/api/health` | `{ ok, mc, version }` | MC/插件/bot 状态 |
| GET | `/api/levels` | `{ levels: [{id,title,act,order,priority}] }` | 关卡选择 |
| GET | `/api/levels/:id` | `{ def, starterCode }` | 编辑器加载 |
| POST | `/api/session` | `{ levelId } -> { sessionId, snapshot }` | 建会话并 prepare 场景 |
| POST | `/api/run` | `{ sessionId, source } -> { runId }` | 异步执行；结果走 SSE |
| POST | `/api/stop` | `{ sessionId } -> { ok }` | 中止（撤销 capability） |
| POST | `/api/reset` | `{ sessionId } -> { ok }` | 重置并回 READY |
| POST | `/api/player-beat` | `{ sessionId } -> { ok }` | 测试/无人模式：模拟玩家右键第 4 盏 |
| GET | `/api/events?sessionId=` | SSE：`state/log/objective/result/hint/error` | Studio 订阅 |

SSE 事件：`state {state}`；`log {line}`；`objective {id,text,done}`；`result {passed,stars,criteria,hidden,failures}`；`hint {level,text}`；`error {message,line?}`。

## 3b. 试符台（REPL）API（v1，docs/27）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/repl` | `{sessionId, line}` → `{ok, kind, display, log, error?}`；一次一行，自动 await |
| GET | `/api/repl/history?sessionId=` | 历史（不含敏感信息） |
| POST | `/api/repl/reset` | 重建试符台场景 |

创建会话时 `mode: "repl"`：prepare L01 场景，不进入评分状态机。

## 3b2. 游戏内中文提示 API（WorldPort Fx）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/in-game` | `{sessionId, text, kind?}`，`kind` 为 `title`/`actionbar`；短提示用 title（大字），长提示用 actionbar（物品栏上方小字，不裁切）。Studio 在开始运行、等待玩家、代码报错、通关、重置时调用；Mock 世界无界面，静默 no-op。 |

插件侧实现：`fx.title`（标题/中央）与 `fx.actionbar`（物品栏上方小字）已通；真实客户端截图见 `apps/studio/evidence/20-in-game-title.png`、`21-in-game-actionbar.png`。后续可加 `fx.chat`（聊天栏）。

## 3c. 桌面壳能力（Tauri，非 HTTP）

- `window.setAlwaysOnTop(bool)`：标题栏「置顶」开关，持久化到本地设置；
- 全局快捷键 `Ctrl+Shift+L` 切换置顶（MC 有焦点时生效）；
- `window.setCompanionMode(bool)`：420×620 伴玩布局；
- 窗口位置/尺寸/置顶状态存 `~/.loomcraft/settings.json`。

## 4. 插件 RPC（Paper，JSON-RPC over WS；T1 子集）

`session.prepare {levelId, layout}`、`world.reset`、`world.snapshot {levelId}`、`world.setBlocks {entries}`、`world.clearRegion {from,to}`、`entity.spawn {type,id,name,pos}`、`entity.clear {ids?}`、`player.teleport {pos}`、`fx.title/fx.sound/fx.particle`、`events.drain {since}`、`bots.set {names}`。
所有响应带 `tick`；评分只读插件快照。

## 5. 织偶（Mineflayer）接口

`connect(name) -> Promise`；`moveTo(x,z,timeoutMs)`；`place(block,x,y,z)`（预检：reference 方块/air/reach≤4.5）；`say(text)`；`reconnect()`。只允许服务通道走位、禁止自动挖掘/垫高；每个动作带 timeout。

## 6. 内容格式

每个关卡一个文件：`content/levels/L01.content.ts`：
```ts
import { L01 } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";
export const content: LevelContent = { def: L01, prepare, playerBeat };
```
T1 只需 L01（L02–L04 由 content 线跟进）。

## 7. 分工与写 scope（同一文件只允许一个 owner）

| 线 | owner | 写 scope | 交付 |
|---|---|---|---|
| MC 插件+织偶 | scout-minecraft | `plugin/`, `bot/`, `scripts/mc-*.sh`, `it/` | 真实 L01 场景 + 织偶动作 + 插件快照/事件 + 重置 |
| Engine | scout-language | `apps/engine/`, `packages/session/` | HTTP/SSE + 会话状态机 + WorldPort 适配 + Mock 验收 |
| Studio | scout-prior-art | `apps/studio/` | 关卡选择/编辑器/目标/教练/Run/Stop/Reset（Mock API 可跑） |
| 内容 | smith-act1 | `content/levels/L02–L04.content.ts` + 场景数据 | 三关可被 MockWorld 验收 |
| QA | scout-assurance | `qa/`, `scripts/verify.sh`, 测试补充 | 自动验收脚本、红队、盲测、证据 JSON |
| Lead | — | `packages/worldport/`, `docs/`, 集成 | 契约、评审、真实 L1 联调、demo |

## 8. 完成标准（T1 门禁）

- `npm run verify` 全绿（typecheck + 全部单测 + 契约测试）。
- MockWorld：L01 reference 3 星；starter 失败；玩家节拍缺失失败。
- 真实 MC：bot 无头跑完 L01 全流程，插件快照与 Mock snapshot 的评分结果一致（WorldDigest diff = 空）。
- Studio：Playwright 走完「选关→编辑→运行→3 星→重置」；无 console error。
- 任何一项不过，不算 T1 完成。
