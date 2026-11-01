# 46 — 试玩缺陷修复方案（任务进度 / sandbox 纯净 / 玩家节拍）

> 状态：已实施完成（2026-11-01 12:25 全部落盘；**当前事实源**）｜负责人：Lead｜最后更新：2026-11-01｜上游：用户 2026-11-01 试玩反馈｜审计记录：`docs/47-docs-audit-2026-11-01.md`
> 用户反馈（原文要点）：
> 1. L01 三个任务，第一个（用代码点亮前 3 盏灯）即使做完了也不打勾；只点亮 1 盏就弹出「如何走到第 4 盏灯并点亮」的提示。要求严格线性：前 3 盏亮后才轮到第 4 盏。
> 2. 不同关卡地图加载后道具揉在一起（L01 底部快捷栏出现一大堆蛋糕）。要求每关都是纯净、每次一样的 sandbox；重置必须彻底（被篡改的方块、玩家位置都回到基准）。
> 3. L01 第 4 盏灯在柱顶，只能仰望时右键放不上去（必须看得见顶面才行）。要求修复。
> 4. **每条反馈都要按「同一类问题」在全部关卡里一次性解决**，不能只修 L01。

---

## 0. 根因（已在真实 Paper 上复现，2026-11-01）

| 现象 | 根因 | 影响面 |
|---|---|---|
| 任务 1 不更新 | Studio 目标面板来自 copy 文案，但勾选来自 `/result` 的 grading criteria，按硬编码/L01 特判映射；L01 目标 0 映射到 `four-lamps-lit`（要求 4 盏全亮），3 盏亮时永远 false。L02–L10 靠事件到达顺序猜测 index，目标与 criteria 顺序/数量不一致（L05 5 条 criteria、L09 6 条）会错位。 | L01–L10 |
| 提示过早 | Studio `waitingForPlayer = result.criteria.length > 0 && !result.passed`，任何一次失败运行都会弹「轮到你 + 第 4 盏灯怎么点」。引擎没有「织偶部分已完成」的信号。 | L01–L10（每关都有 player beat） |
| 快捷栏堆蛋糕 | `player.give` 只 addItem；切关/重置/重进不清理玩家背包；`pendingPlayerItems` 在 `session.begin` 不清空（上个关卡没发出去的道具会补给下个关卡）。 | 全关卡 |
| 场景/实体残留 | `session.begin()` 只清内存状态，不清上一关的物理方块；L01 的 prepare 完全没有 `clearRegion`（L02–L10 有但区域不同）。旧 NPC 从不移除：每次开新会话都在同一坐标再生成一批，累计后实体挤压死亡（Paper 日志 `squished too much`），并跨会话残留。 | 全关卡 |
| reset 不彻底 | 只还原 `baseBlocks ∪ placedPositions` 里登记过的坐标；上一关残留、自然地形、实体、掉落物、玩家背包都不恢复。 | 全关卡 |
| 第 4 盏灯放不上 | 目标在 `(2,14,16)`，柱顶面 y=14.0；玩家站地面眼高 y=12.62，看不到顶面（MC 灯笼只能点顶面/底面）。上一轮加的两级石砖台阶（`1,11,17`、`1,12,16`）不直观，正好被用户描述为「柱子正面左高右低」的怪结构；且玩家不知道要跳上去。 | L01 最严重；L02–L10 的 player beat 同样从没做过真人可达性验收 |

**这次要解决的类别**：① 目标进度与引擎真值脱节；② 会话间/重置的世界与玩家状态不隔离；③ 玩家节拍依赖「精确对准方块面」的脆交互。

---

## 1. 通用修复设计

### 1.1 任务进度（ProgressStep）——单一真值

`LevelDef` 新增：

```ts
export interface ProgressStep {
  id: string;                        // 稳定 id，Studio 按 id 更新
  text: string;                      // 玩家可见目标（≤20 字，≤3 条/关）
  check: (g: GraderApi) => boolean;  // 快照真值
  player?: boolean;                  // true = 需要玩家在世界里亲手完成（玩家节拍）
}
// LevelDef.progress?: ProgressStep[]
```

- 引擎每次 verify（run / player-beat）用同一份快照评估 progress，发 `objective` 事件（id/text/done）。
- `playerBeatReady` = 第一个 `player: true` 步骤之前的所有步骤都 done（若没有 player 步骤：所有 progress 步骤 done）。
- `ResultEvent` 新增 `progress: CriterionResult[]` 与 `playerBeatReady: boolean`。
- `/api/levels/:id` 返回 `progress: [{id, text, player}]`（不含函数）。
- Studio 目标面板直接用引擎返回的 progress id/text；`objective` 事件按 id 更新，不再猜 index。
- Studio 只在 `result.playerBeatReady === true` 时显示「轮到你」卡片、playerBeatGuide、游戏内 actionbar 提示。
- 引擎 `playerBeat()` 保持可调用（既有冻结测试依赖「无 run 也能触发」，且真人 UI/世界交互已双重门控）；**线性由 Studio 隐藏「轮到你」+ 插件拦截提前右键共同保证**。早期调用只会得到未通过的普通失败结果，不产生副作用。
- L01 的 progress 三步 = ①灰崽按 1→2→3 点亮三盏（新 check，不看第 4 盏）②玩家点亮第 4 盏（player）③灰崽回到艾拉身边。

### 1.2 sandbox 纯净（插件 SceneManager）

1. `session.begin`：
   - 清除上一会话 arena 区域（`regionFrom..regionTo`）到空气 + 移除区域内非玩家实体；
   - 移除上一会话登记过的 NPC（按 scoreboard tag `loom-session-entity` 全局扫描兜底，覆盖进程重启残留）；
   - 清空所有非 bot 玩家背包、`pendingPlayerItems`、`playerKit`、事件、标注、bot 位置状态；
   - 服务端启动后第一次 begin：清理一次「高台沙盒带」（y 56–92，x/z ±48）里上一轮进程残留的关卡方块与实体。
2. L01 content 的 `prepare` 增加自己的 `clearRegion`（覆盖其沙盒体积），不再依赖历史状态。
3. 玩家背包：每个会话维护 `playerKit`（content `afterPrepare` 的 `playerGive` 记录）。`session.begin`/`finalize`/`reset`/`onPlayerJoin` 都先清空非 bot 玩家背包再发本关道具——每关打开都是“纯净快捷栏”。
4. `reset`：
   - `finalizeScene` 结束时对 arena 全区域建 checkpoint（`Map<key, material>` 非空气块 + 空地）；
   - reset 时按 checkpoint 还原**全区域**（玩家挖掉的、放错的、上一关残留的全恢复/清掉）；
   - 移除区域内的非会话实体（掉落物、误刷怪），按登记重生 NPC；
   - 非 bot 玩家：清背包 → 发本关 playerKit，传送回 `playerSpawn`（基准位置），恢复时间/天气/gamerules/bot 出生点；
   - 返回稳定 checkpoint hash（沿用现有 `hash` 字段）。
5. 新增 `session.end` RPC：引擎 dispose 会话时通知插件清理 NPC/标记实体。

### 1.3 玩家节拍通用机制（容错交互 + 线性解锁）

- `PaperWorldPort.prepare` 在 `afterPrepare` 之后**录制** `content.playerBeat(port)` 的调用（`playerPlace`/`setTime`/`setWeather` 只记录不执行），得到 `beats: [{pos, block}]` + 完成后的特效；随后 `playerBeat.arm` 给插件（静默）。
- 引擎判定 `playerBeatReady` 后调用 `port.activatePlayerBeat()` → RPC `playerBeat.activate`：插件在目标处显示发光物品标记（ItemDisplay，tag `loom-beat-marker`）+ actionbar 短提示（来自 `LevelDef.task.playerBeatHint`），并允许完成。
- 完成判定（任意一条即算数，全部关卡通用）：
  1. 玩家把对应方块真的放到目标坐标（原生 MC 行为）；
  2. 玩家右键目标方块本身（敲钟/拉杆/笼门/护符盒这种交互型）；
  3. **容错**：玩家手持本关发放的道具（lantern/cake/…；虚拟物品如 loom_thread 接受本关实际发的 string），站在目标 6 格内，且视线方向与目标方向点积 ≥0.7，右键（对着柱子侧面/空气都行）→ 插件把方块放到目标坐标（放不了方块的交互型只发事件+音效）。
- 未 activate 前：任何会完成目标的操作被取消，actionbar 提示「先让灰崽完成它那部分」——严格线性。
- 实现型细节：
  - 目标原为空气 → place 型（L01 灯笼、L02 蛋糕、L04 南瓜、L05 门牌、L10 合龙石）；
  - 目标已有方块 → interact 型（L03 钟、L06 护符盒、L07 笼门、L08 拉杆、L09 笼/钟）。
  - 事件仍发 `block.place`（actorType=player，data.block=录制时的 id，位置=目标坐标），评分真值不变；虚拟方块（loom_thread/potion）只发事件+特效。
  - 新增 debug RPC 便于自动验收：`world.blocks {positions[]}`、`player.inventory {}`、`playerBeat.status {}`。

### 1.4 L01 第 4 盏灯场景

- 删除上一轮加的两块不对称石砖台阶（用户描述的「左高右低怪结构」），保留 `(2,11..13,16)` 石柱 + `(2,14,16)` 目标空位。
- 依赖 1.3 的容错交互：玩家站在柱子旁地面、手持灯笼对着柱子右键即可点亮，**不需要看见顶面**。
- 文案改为「走到灯柱前，手持灯笼，对着柱子按右键就行；不用抬头找顶面」；`playerBeatGuide` 同步改。
- 激活时目标处出现发光灯笼标记，远处也能看见。

---

## 2. 接口契约（实现必须一致）

### 2.1 插件新增/变更 RPC（JSON-RPC 2.0）

| method | params | 说明 |
|---|---|---|
| `session.begin` | 既有 + 语义增强 | 清上一场景/实体/背包/待发道具；首次启动清高台沙盒带 |
| `session.finalize` | 既有 `{layout}` + `layout.playerBeat?` | finalize 后建立全区域 checkpoint |
| `session.end` | `{sessionId}` | 清理 NPC/标注/标记实体（可保留方块，下一次 begin 清） |
| `playerBeat.arm` | `{sessionId, beats:[{pos,block}], items:[string], hint:string}` | 静默登记玩家节拍目标 |
| `playerBeat.activate` | `{sessionId}` | 显示标记+提示，允许完成 |
| `playerBeat.status` | `{sessionId}` | 调试：armed/active/beats done |
| `player.inventory` | `{}` | 调试/验收：所有在线非 bot 玩家背包 |
| `world.blocks` | `{sessionId, positions:[[x,y,z],...]}` | 调试/验收：批量读方块 |
| `world.reset` | 既有 | 全区域 checkpoint 还原 + 玩家回基准 + 背包重置 |

`health`/`session.status` 增加 `checkpointSize`、`playerKit`、`playerBeat`。

### 2.2 WorldPort 新增

```ts
interface WorldPort {
  activatePlayerBeat(): Promise<void>;   // paper → RPC activate；mock → 空操作
  // reset/snapshot/… 语义不变
}
```

`PaperWorldPort.prepare` 的录制约定：`recordingPlayerBeat = true` 时 `playerPlace/setTime/setWeather` 只入队；`playerGive` 始终记录 `grantedItems`。

### 2.3 结果事件 / API

`ResultEvent` 增：`progress: {id,text,passed}[]`、`playerBeatReady: boolean`；SSE result.result 同步带出。
`/api/levels/:id` 增 `progress: [{id,text,player}]`。

---

## 3. 文件归属（避免并发冲突）

| 归属 | 文件 |
|---|---|
| Lead | `docs/46*`、`packages/level-spec/src/index.ts`（progress 契约与评估）、最终集成/打包 |
| plugin-world | `plugin/src/**`、`packages/worldport/src/{index,mock-port,paper-port}.ts` |
| progress-pipeline | `packages/session/src/**`、`apps/engine/src/**`、`apps/studio/src/**`（`copy/levels.json` 除外） |
| level-content | `content/levels/**`、`apps/studio/src/copy/levels.json` |
| verifier | `it/**`（新增脚本）、`scripts/**`（新增）、`evidence/**`、`tmp/viewer/**` |

---

## 4. 验收（必须真实 Paper，串行）

1. **L01 进度**：starter（1 盏）跑完 → 目标 0=false、无「轮到你」、无第 4 盏提示、游戏内无 actionbar 提示；参考解跑完 → 目标 0=true、2=false、3=true、`playerBeatReady=true`、「轮到你」出现。
2. **线性**：未 ready 时玩家提前尝试点亮第 4 盏 → 被拦截并提示；ready 后地面站姿右键柱子（不看不看顶面）→ 灯亮、事件 actorType=player、点「确认」→ 3 星。
3. **纯净**：玩家在线依次开 L02 → L01：L01 快捷栏只有灯笼；L02 场地方块在 L01 场景中不存在；NPC 数量不累积。
4. **重置**：玩家挖掉路面、在地上乱放方块、走出场景后点重置 → 方块全部还原、乱放的清除、玩家回到 playerSpawn、背包回到基准、事件清零。
5. **全关卡同类**：L02–L10 每关 progress 三步能逐条打勾；`playerBeatReady` 只在该亮的时候亮；player beat 容错交互可用。
6. 回归：`npm run typecheck`、`npm test`、`bash scripts/verify.sh`、L01–L10 真实 e2e（或至少 L01/L02/L03/L05/L09/L10 + 全部 progress 单测）。

---

## 5. 实施结果（2026-11-01 12:25，全部落盘）

| 用户反馈 | 修复 | 验证证据 |
|---|---|---|
| ① L01 第一个任务（点亮前 3 盏）不更新 | `LevelDef.progress` 单一真值；L01 三步 = 1→3 号灯 / 玩家点亮 4 号 / 回艾拉；引擎每次 verify 按 progress id 发 objective，Studio 按 id 勾选。 | `it/l1-real.ts` PASS；Lead 集成验收 starter→`l01-three-lamps=false`、参考解→`true`；全仓 `npm test` 235/235。 |
| ② 只点亮 1 盏就弹「第 4 盏怎么点」 | `ResultEvent.playerBeatReady`（第一个 player 步骤之前的 progress 全 done 才为 true）；Studio 只在 ready 显示「轮到你」卡片/guide/actionbar；插件在 `playerBeat.activate` 之前拦截提前右键并 actionbar 提示。 | starter → ready=false、active=false、提前右键后 (2,14,16) 仍为 air；参考解 → ready=true、active=true；41 项集成断言 25/25 PASS。 |
| ③ 切关后快捷栏堆蛋糕 | 插件新增 `playerKit`：begin/finalize/reset/onPlayerJoin 都先清空非 bot 背包再发本关道具；`pendingPlayerItems` 在 begin 清空；首次 begin 清理高台沙盒带 + 全部旧实体。 | L02→L01：背包只剩 lantern、无 cake；97 个旧村民 → 0；跨关 3 次 NPC 稳定 4；L02 场地方块在 L01 会话为空。 |
| ④ reset 不彻底 | `finalizeScene` 建全区域 checkpoint；`world.reset` 按 checkpoint 还原全区域方块、移除区域实体、重生 NPC、非 bot 玩家清背包→发 playerKit→传送 playerSpawn、时间/天气/gamerules 恢复；返回稳定 hash。 | 挖路面 + 乱放 + 丢物 + 离位 → reset 18ms 全还原、玩家回 spawn、events=0、两次 hash 一致；L01–L10 e2e 全部 `reset-hash-stable` PASS。 |
| ⑤ 第 4 盏灯柱顶右键放不上 | 通用玩家节拍容错：PaperWorldPort 录制 `content.playerBeat` → 插件 `playerBeat.arm/activate`；激活后目标处发光标记 + 容错右键（手持本关道具、6 格内、视线点积 ≥0.7 即可，不必看见顶面）；L01 删除误导性的不对称石砖台阶，文案改为「站地面对着柱子右键」。 | 站地面 (1,11,15) 手持灯笼对柱子右键 → (2,14,16) 出现 lantern、事件 actorType=player、`playerBeat.status.done=true`；确认后 3 星；L02–L10 同类 player beat 98/98 PASS。 |
| ⑥「同类问题全关卡一次解决」 | L01–L10 每关 2–3 条可机器判定 progress；全部 player beat 走同一套容错机制；L02–L10 successCriteria/hiddenTests 的重复运行鲁棒性（first-occurrence/distinct 目标）已修。 | `npx tsx it/l1-real.ts` … `l10-real.ts` 全部 PASS；各处 objective/playerBeatReady 真值一致；L10 双织偶 + 合龙石玩家节拍 PASS。 |

### 5.1 新增/变更验证命令

```bash
npx tsc -p tsconfig.json --noEmit        # 0
npm test                                # 25 files / 235 tests
bash scripts/verify.sh                  # 全绿
npm --prefix apps/studio run test:e2e   # 6/6（progress 化后的断言）
npx tsx it/l1-real.ts … it/l10-real.ts  # L01–L10 真实 Paper e2e（串行）
```

### 5.2 老用户世界迁移

桌面壳 `spawn_bundled_paper` 增加「世界布局版本」比对：安装包内 `world/.loom-world-version` 与可写目录不一致时，自动用包内干净世界替换 `~/.loomcraft/runtime/paper/world`（进度/星级存于 Studio，不存于世界，不受影响）。安装包内世界用 `tmp/fresh-paper` 的干净 superflat 世界生成。

### 5.3 桌面安装包与打包运行时验收（2026-11-01 12:50）

- 重新打包：`scripts/package-desktop.sh`（构建插件/真实引擎/Studio/自包含 runtime → RPM → AppImage）。Tauri 的 AppImage 步骤在本机因缺 FUSE 失败，改用 `APPIMAGE_EXTRACT_AND_RUN=1` 直接调用 `linuxdeploy-plugin-appimage` 从完整 `Loomcraft.AppDir` 封包；最终产物 `Loomcraft_0.1.0_amd64.AppImage` ≈400MB（382MiB）、`Loomcraft-0.1.0-1.x86_64.rpm` ≈415MB。
- 包内校验：`paper/world/.loom-world-version = loomworld-v2`；插件 jar sha256 `2e1d9159…`；`engine.mjs` 含 L03/L05 `playerSpawn`、L02 `cakeTower [4,66,-6]`、L04 `scarecrow [14,67,26]`、`playerBeatHint/activatePlayerBeat`；`bot/manager.mjs` 含 `_gotoWithRecovery`；Studio assets 含 `l01-three-lamps` 与 Alt+Z 新手提示。
- 无头验收（用包内 Java + Paper + Node + engine 在 workspace 副本运行，端口 25575/8775/4325）：9/9 PASS —— L03 `playerSpawn=[0,65,12]`；L02 cake 目标格 air+下 stone、模拟节拍后真的落 cake；L04 南瓜目标 air+下 hay；L01 starter→目标0=false/无 ready，参考解→目标0/2=true、playerBeatReady=true。
- 老用户世界迁移：新桌面包首次启动会按 marker 把 `~/.loomcraft/runtime/paper/world` 换成包内干净世界（`main.rs` 的比较逻辑）。
- **Alt+Z**：桌面壳全局快捷键用于在「织界」和 Minecraft 窗口之间切换焦点；已写进 `README` 快速开始、`docs/42` §6、游戏内「第一次玩 Minecraft？」帮助与 `catalog.json`。
