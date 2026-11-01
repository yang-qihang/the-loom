# LoomCraft 试玩反馈修复 — 独立验收报告（verifier）

> 验收方：verifier（独立于 3 个实现 teammate，不写功能代码）
> 日期：2026-11-01（Asia/Shanghai）
> 依据：`docs/46-playtest-fix-plan.md` §4 验收清单 + 用户 2026-11-01 试玩反馈 4 条
> 环境：自建真实 Paper（端口 25566 / 插件 RPC 8766）+ 自建引擎（端口 4321），mineflayer 玩家直连；
> 与 Lead 的 25565/8765/4320 完全隔离。基线用修复前 HEAD `f1e40eb` 快照 + 旧插件 jar；修复后用最终插件
> jar（sha256 `2e1d9159…`，211340 B）+ 工作区最新 TS + Lead 修复后的 `bot/manager.mjs`。
>
> 最终状态：基线 3 份 JSON 全部复现缺陷；修复后 L01 acceptance **RESULT PASS**（35 项检查全 PASS，
> 用 12:21 重启的最新引擎/bot 复跑固证）、全关卡可达性 17/17 beat PASS（L03 出生点问题单列 §4）。
> 验收用 Paper/引擎已在完成后停止，端口 25566/8766/4321 已释放。

## 0. 结论总表

| # | 用户反馈 | 基线复现（修复前） | 修复后验收 | 同类问题是否全关卡闭环 |
|---|---|---|---|---|
| 1 | L01 第一个任务做完了也不打勾；只点亮 1 盏就弹「第 4 盏灯怎么点」 | ✅ 复现。旧目标面板把目标 0 映射到 `four-lamps-lit`（要求 4 盏全亮），参考解后仍 false；任一失败 result 即判 `waitingForPlayer` → 卡片/guide/游戏内 actionbar 提前出现（`baseline/l01-progress.json`） | ✅ 通过。starter→目标 0=false、`playerBeatReady=false`、无等待 UI、无提前 actionbar；参考解→目标 0/2=true、`playerBeatReady=true`、插件 `active=true` 并只在此时发 hint；确认→3 星（`after/l01-acceptance.json`） | ✅ 10 关 `progress` 均 3 条（id/text/player 契约）；L01–L10 逐关真实会话 prepare 通过；L01/L03/L05/L08/L10 含 `player:true` 步骤（`after/all-levels-reachability.json`） |
| 2 | 不同关卡地图/道具揉在一起；重置不彻底 | ✅ 复现。玩家离线时 L02→L01：进服同时收到 cake 8+lantern 8 并收到「第 4 盏灯…」提前提示；在线切关背包 cake 8→30、lantern 8→46；L02 场景方块残留在 L01；客户端可见实体 72→76 累积；reset 后背包/掉落物/L02 残留均不恢复（`baseline/pollution-reset.json`） | ✅ 通过。L02→L01→L03→L01 三次切关：L01 背包只有 lantern 8（无 cake）、L02 方块在 L01 会话全为空气、NPC 数 4 稳定不累积；reset 后：挖掉 gravel 还原、乱放方块清除、玩家回 spawn (2.5,11,4.5)、背包回 lantern 8、掉落物清除、events=0、连续两次 reset hash 相同（`after/l01-acceptance.json`） | ✅ 插件 begin 每次清上一 arena + 全局非玩家实体 + 背包重建 playerKit；reset 全区域 checkpoint（L01–L10 共用插件机制）；首启清扫沙盒带（本次验收日志 `startup sandbox cleanup: entities=81 blocks=5431`） |
| 3 | L01 第 4 盏灯在柱顶，只能仰望时右键放不上去 | ✅ 复现（几何证据）：地面眼高 12.62 < 柱顶面 14.0，射向顶面中心的第一个命中面是石柱北侧面（face=north），顶面不可见；旧石阶视角才能命中顶面（face=up）（`vision/baseline-vision.json` + PNG） | ✅ 通过。玩家站地面 `(2.5,11,14.5)`/`(2.5,11,15.5)`、手持灯笼、看向柱子右键（不看不看顶面）→ `(2,14,16)` 变 lantern、进度 1=true、事件 `actorType=player`、插件 status done、确认 3 星；旧的两块不对称石阶已删除（`(1,11,17)`/`(1,12,16)` 均为空气） | ✅ 机制全关卡覆盖：17/17 个 beat 由真实玩家右键完成（见 §3.2）；⚠️ 但 L03 玩家出生点位于钟楼实心结构内（`player-spawn-usable=false`，§4-1），属关卡/引擎 playerSpawn 派生问题，不是容错交互问题 |
| 4 | 每条反馈都要按同一类问题在全部关卡一次性解决 | 影响面确认：L01–L10（catalog 无 progress、目标猜 index、切关污染、reset 范围不足、player beat 脆交互）（`docs/46` §0 + 基线证据） | 见下 §3 | 目标进度：10/10 关 progress 契约通过（每关 3 条、按 id 更新）；纯净/reset：插件通用机制 + L01 实证；节拍容错：10 关 17 个 beat 全部可由真实玩家右键完成；剩余 2 个非机制类问题见 §4（L03 出生点、L02 蛋糕落块表现） |

## 1. 验收环境与方法

### 1.1 环境隔离
- Paper 数据目录：`tmp/verify/paper`（从 `~/.loomcraft/runtime/paper` 复制，端口改 25566，插件 RPC 改 8766）。
- 引擎：`tmp/verify/run-engine.ts`，`PORT=4321 LOOM_WORLD=paper LOOM_RPC_URL=ws://127.0.0.1:8766 LOOM_MC_PORT=25566`。
- 玩家：mineflayer 4.39.0（工作区锁定版本）直连 25566，offline 模式；不使用真实 Minecraft 客户端，不触碰 `DISPLAY=:0`。
- 基线：`git archive HEAD`（f1e40eb）到 `tmp/verify/baseline-src`，旧插件 jar `sha256 a33b8532…`，引擎 4321 跑 HEAD TS 代码。
- 修复后：工作区最新 TS（tsx 直跑）+ 最终插件 jar `sha256 2e1d9159…` + `bot/manager.mjs`（Lead 12:17 移动恢复修复）。
- 真实 Paper 串行执行：所有 e2e/节拍/重置脚本同一时间只跑一个。
- verifier 改动范围：新增 `it/playtest-fix/**`（验收脚本）、`tmp/verify/**`、`tmp/viewer/**`、`evidence/playtest-fix/**`；**未修改任何功能代码**（plugin/packages/apps/content/bot 的改动均来自实现 teammate/Lead）。

### 1.2 玩家视角截图说明（prismarine-viewer 版本边界）
- 按要求先试 `prismarine-viewer@1.33.0`（`tmp/viewer`）：页面与 WebGL 正常（1024×576 canvas），但其内置方块状态表只到 **1.21.4**，而 Paper 是 **26.1.2**，绝大多数方块渲染成 `missing_texture`（`evidence/playtest-fix/vision/baseline-l01-*-viewer-attempt.png` 存证）→ 渲染结果不可信，按 `docs/46` 允许的退化方案改用**真实服务端体素 + 真实玩家眼位**的透视光栅化（`tmp/viewer/render-voxel.mjs`，逐像素 3D DDA 体素求交，非手绘示意图）。
- 截图上叠加：红框 = 目标空位 `(2,14,16)`，青框 = 灯柱顶面（`(2,13,16)` 的 up 面），白十字 = 准星，便于直观对比两条视线。
- 硬证据不依赖截图观感：对每个视点记录 `bot.blockAtCursor` 与体素射线命中面（face=north/up）、眼高与顶面高度比较。

## 2. 基线复现证据（修复前 HEAD f1e40eb + 旧插件）

| 文件 | 内容 |
|---|---|
| `evidence/playtest-fix/baseline/l01-progress.json` | A-1：starter/参考解的 SSE objective/result/state 序列、旧 Studio waitingForPlayer 判定、提前 actionbar 实际送达、无 `progress`/`playerBeatReady` 字段 |
| `evidence/playtest-fix/baseline/l01-progress.raw-events.json` | 原始事件流投影（可复查） |
| `evidence/playtest-fix/baseline/pollution-reset.json` | A-2/A-3/A-4：pending 道具跨关污染 + 进服提前提示、在线切关背包叠加、L02 方块残留、实体累积、reset 不彻底（背包/掉落物/L02 残留）与 hash 稳定 |
| `evidence/playtest-fix/vision/baseline-vision.json` + `baseline-l01-ground-view.png` / `baseline-l01-step-view.png` | A-5：地面视角 vs 石阶视角、射线命中面硬证据 |
| `evidence/playtest-fix/vision/baseline-l01-*-viewer-attempt.png` | prismarine-viewer 1.33 在 26.1.2 下的渲染失败对照（版本不匹配） |

关键数字（基线）：
- starter 后旧 Studio 目标面板 `0/3`（goal0=false 映射 `four-lamps-lit`），`waitingForPlayer=true`；参考解后仍 `0/3`，`four-lamps-lit=false`。
- 旧接口 `GET /api/levels/L01` 与 result 均无 `progress` / `playerBeatReady`；L01 criteria 只有 4 条（four-lamps-lit/golem-home/player-lit-fourth/no-shortcut）。
- L02→L01 离线 pending：进服背包 `lantern×8 + cake×8`，聊天收到「第 4 盏灯在村道尽头：x=2, z=16…」（提前提示）。
- 在线切关：cake 8→30、lantern 8→46；L02 方块 `(4,65,-6)=stone_bricks` 等残留在 L01 会话；客户端可见实体 72→76。
- reset：tracked 方块能还原、玩家能回 spawn（旧插件本就有），但背包不重置、掉落物不清、L02 残留仍在。

## 3. 修复后验收证据（最终插件 jar + 最新 TS + 最新 bot/manager.mjs）

| 文件 | 内容 |
|---|---|
| `evidence/playtest-fix/after/l01-acceptance.json` | B-1/B-2/B-3/B-4：L01 全流程进度/门控/拦截/玩家右键/3 星、纯净切关、reset 全项 |
| `evidence/playtest-fix/after/all-levels-reachability.json` | B-5：L01–L10 progress（10×3 条）+ 每关真实会话 prepare + playerBeat.arm/activate + 17 个 beat 的真实玩家右键可达性/落块稳定性/事件 actorType |
| `evidence/playtest-fix/vision/after-vision.json` + `after-l01-ground-view.png` / `after-l01-close-view.png` | 修复后玩家视角：地面眼高 12.62 仍看不见柱顶面（射线首个命中面=north 侧面），但站地面右键柱侧面即可完成节拍；旧石阶两格已删除（`1,11,17`/`1,12,16`=air） |
| `evidence/playtest-fix/after/real-e2e-*.log/json` | it/l1-real.ts 等真实 Paper e2e 回归（若执行） |

### 3.1 B-1 L01 全流程（真实引擎 + 新插件，`RESULT PASS`）
- starter（只点 1 盏）：`progress=[{l01-three-lamps:false},{l01-fourth-by-player:false},{l01-golem-home:false}]`、`playerBeatReady=false`、等待 UI 判定 false、玩家 actionbar 采集为空（无提前提示）。
- 未 ready：`/api/player-beat` 不报错但世界无变化（按 Lead 11-01 口径，端点保持可调用）；玩家提前右键目标 → 插件拦截，方块保持空气，玩家真实收到 actionbar「先让灰崽完成它那部分」。
- 参考解：`progress[0]=true`、`progress[2]=true`、`progress[1]`（player 步骤）=false、`playerBeatReady=true`、插件 `active=true`；激活时 actionbar＝`LevelDef.task.playerBeatHint`「手持灯笼，对着灯柱按右键，不用看顶面」。
- ready 后玩家：站地面 eye=(2.5,12.62,14.5)，看向 `(2.5,14.5,16.5)`，手持灯笼右键 → `(2,14,16)=minecraft:lantern`、`playerBeat.status.done=true`、事件 `{type:block.place, actorType:player, pos:[2,14,16], data.block:minecraft:lantern}`；确认 → `passed=true`、`stars=3`、progress 三条全 true。
- B-3 纯净：L02→L01→L03→L01 三次切关，L01 背包 `lantern=8, cake=0`；L02 方块在 L01 会话全为 `minecraft:air`；NPC 数 L01 每次都是 4（不累积）。
- B-4 reset：挖掉小径 `(0,10,14)`（gravel→air）、乱放 `(4,11,14)` lantern、丢 2 个物品、走到 `(0.5,11,24.5)` → reset → gravel 还原、乱放清除、玩家回 spawn `(2,11,4)` 的 `(2.5,11,4.5)`（±0.5）、背包回 lantern 8（丢的/多余道具清除）、掉落物 2→0、events=0、NPC 数稳定 4、连续两次 `world.reset` hash 相同（`sha256:a95befa4…`）。

### 3.2 B-5 全关卡 player beat 可达性（`after/all-levels-reachability.json`）
- `GET /api/levels/L01–L10` 每关 3 条 progress（id/text/player）：L01 `l01-three-lamps / l01-fourth-by-player(player) / l01-golem-home`；L03/L05/L08/L10 各含 1 条 player 步骤；L02/L04/L06/L07/L09 无 player 步骤（按设计）。
- 10 关依次真实创建会话（prepare）：10/10 成功，`playerBeat.arm` 全部 `armed=true`、beats 数 1/1/1/1/5/1/3/1/2/1；`playerBeat.activate` 全部 `active=true` 并显示对应 hint。
- 真实玩家（mineflayer）按插件容错规则（站目标 6 格内、手持本关 playerKit 道具、看向目标、右键）完成：**17/17 个 beat 全部完成**，placement 型目标坐标方块变成目标 block 且下一 tick 仍稳定（无弹出/掉落），事件均为 `actorType=player`；所有 beat 的完成都不依赖“看见顶面/精确面”。
- 覆盖的目标：L01 lantern@(2,14,16)、L02 cake@(4,65,-6)、L03 bell@(0,65,0)、L04 pumpkin@(14,66,26)、L05 5×oak_sign@（1/13/25,64,3 与 1/25,64,17）、L06 loom_thread@(13,65,20)（虚拟物品，只发事件）、L07 3×oak_trapdoor@笼门 (-10,65,0/6/12)、L08 lever@(0,65,8)、L09 potion@(10,65,7)+bell@(0,65,14)、L10 lodestone@(12,65,0)。
- 另检查每关玩家出生点可用性：9/10 关出生点正常（空气且可移动）；**L03 出生点 `(0,65,0)` 即钟格，6 邻居全实心 → 真实玩家会被传送进封闭石室**（`L03.player-spawn-usable=false`，B-5 汇总因此为 FAIL，但 17 个 beat 机制本身全部 PASS）。

## 4. 遗留问题 / 处置结果

> 说明：以下 2 条真实玩家体验问题在本报告提交后已由 Lead/level-content 修复（2026-11-01 12:40 前后），不影响「插件容错交互机制」本身的验收结论（17/17 beat 可完成）。Lead 的 10 关 real e2e 使用模拟 playerBeat，不会触发这两个问题；修复后已由打包运行时无头验收覆盖（L03 spawn / L02 cake / L04 pumpkin 目标）。

1. **L03 玩家出生点位于钟楼实心结构内部（真实玩家可达性缺陷）— ✅ 已修**
   - 原现场：L03 会话插件 `playerSpawn=[0,65,0]`，与 player beat 目标（钟）坐标相同、6 邻居全 stone_bricks。
   - 修复：`apps/engine/src/world.ts` `PAPER_SCENE_HINTS.L03 = { playerSpawn: [0,65,12] }`（南侧主路、air/air、脚 gravel、正对钟楼）。
   - 复验：打包运行时 `playerSpawn=[0,65,12]`（`pkg.L03.playerSpawn PASS`）。
2. **L02 player beat 的 cake 目标格被塔基 stone_bricks 占用 — ✅ 已修**
   - 修复：`vars.cakeTower` 改 `[4,66,-6]`（塔基上方空气格），prepare 塔基放 `(4,65,-6)`；插件判定为 place 型会真落块。
   - 同类同修：L04 南瓜目标改 `[14,67,26]`（草人头顶空气格，下方 hay）。复验：`pkg.L02.cake-placed`/`pkg.L04.pumpkin-air-supported` PASS。
3. **prismarine-viewer 与 MC 26.1.2 不兼容**（内置 blocksStates 到 1.21.4），本报告用体素光栅化替代；若后续需要“真客户端风格”截图，建议加一个 26.1 blocksStates 的 viewer 构建或走真实客户端隔离栈。
4. 基线环境噪声（非缺陷）：旧插件下真实 Paper 首个 run 偶发 pathfinder 首跑失败（`criteria=[]`），已用 reset 重试并在证据里保留全部 attempt；修复侧 Lead 已修 `bot/manager.mjs` 通用移动卡死（`_gotoWithRecovery`），最终 B 阶段脚本均带重试与记录。

## 5. 复现命令

```bash
# 环境（verifier 自建，端口与 Lead 隔离）
# 1) Paper 25566 / RPC 8766
cd tmp/verify/paper && tail -f /dev/null > console.in &
java -Xms1G -Xmx2G -jar paper.jar --nogui < console.in > console.log 2>&1 &
# 2) 引擎 4321（工作区最新代码；修复前基线改用 tmp/verify/baseline-src/tmp/run-engine.ts）
PORT=4321 LOOM_WORLD=paper LOOM_RPC_URL=ws://127.0.0.1:8766 \
  LOOM_MC_PORT=25566 LOOM_BOT_NAME=GolemAfter npx tsx tmp/verify/run-engine.ts

# 基线复现（需旧插件 jar + HEAD 快照）
ENGINE_URL=http://127.0.0.1:4321 MC_PORT=25566 npx tsx it/playtest-fix/baseline-l01-progress.mjs
ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
  npx tsx it/playtest-fix/baseline-pollution.mjs
PHASE=baseline ENGINE_URL=http://127.0.0.1:4321 MC_PORT=25566 MC_RPC_URL=ws://127.0.0.1:8766 \
  VIEWER_PORT=3010 npx tsx tmp/viewer/shot.mjs

# 修复后验收（最终插件 jar）
ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
  npx tsx it/playtest-fix/after-acceptance.mjs
ENGINE_URL=http://127.0.0.1:4321 MC_RPC_URL=ws://127.0.0.1:8766 MC_PORT=25566 \
  npx tsx it/playtest-fix/after-reachability.mjs
PHASE=after ENGINE_URL=http://127.0.0.1:4321 MC_PORT=25566 MC_RPC_URL=ws://127.0.0.1:8766 \
  VIEWER_PORT=3010 npx tsx tmp/viewer/shot.mjs

# 真实 Paper e2e 回归（串行）
MC_PORT=25566 MC_RPC_PORT=8766 npx tsx it/l1-real.ts
MC_PORT=25566 MC_RPC_PORT=8766 npx tsx it/l2-real.ts
# …
```

---

## 附：Round 2 视觉素材（2026-11-01，verifier 后续任务）

- `evidence/playtest-fix/start-positions.md`：10 关起始点审计（真实 MC 客户端出生视角；L02/L09 出生点与灰崽 spawn 重合的糊屏缺陷、修复前后对比、L10 朝向说明、L02 时间偏暗观察）。
- `evidence/scene-shots/hi-res/`：10 关真实客户端原始 2560×1440 截图（`birth-L0X.png` 出生视角 / `hero-*` 场景）、`asset-cand/` 候选机位、`spawn-audit.json`、`audit.json`、`assets-manifest.json`。
- `apps/studio/public/world/L01–L10.png`：2560×990 真实客户端条带（含此前缺失的 L10），共 ~9.7 MB；`report/evidence/mc-l0*.png` 同步替换。
- `evidence/ui-hires/`：Studio 高清 UI 截图（2× DPR，地图墙/工作台/手册/REPL/轮到你/结算概念卡/字体与右键菜单验证）+ `ui-verify.json`；`report/evidence/{ui-workbench,report,report-full}.png` 已替换为高清版。
- 截图流水线：Docker + Xvfb 2560×1440 + Mesa llvmpipe + 真实 Minecraft 26.1.2 客户端（Prism assets/libraries/Java 只读挂载，离线账号），相机与 HUD 用插件 RPC + F1 控制；脚本在 `tmp/shots/`。
