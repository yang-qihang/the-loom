# 10 关起始点审计（Round 2 视觉验收）

> 状态：已完成｜负责人：verifier（visual-capture）｜日期：2026-11-01
> 上游：`docs/48-round2-guidance-api-visual-plan.md` §1.8/§3.1、用户第二轮反馈第 5 条（加载进关卡时起始点必须合理）
> 环境：真实 Minecraft 26.1.2 客户端（Docker + Xvfb 2560×1440 + Mesa llvmpipe，Mojang 客户端 jar/资源来自本机 Prism 安装，离线账号 LoomShot），Paper 25575 / 插件 RPC 8775，引擎用**工作区最新源码**（含 content `world.playerSpawn` / L02 时间修正）。
> 相机：每关 `player.teleport {name,pos:playerSpawn,yaw,pitch}`（截图机位；玩法不改），HUD 用 F1 隐藏（不含调试屏），截图后 ImageMagick 截 root 窗口。

## 1. 结论总表

| 关 | 最终 playerSpawn | 脚/头/下方方块 | 最近 NPC / 灰崽距离 | 画面检查结论 | 异常 |
|---|---|---|---|---|---|
| L01 | `[2,11,4]` | air / air / gravel | villager-1 @2.0m（身后，不在视野）；灰崽 4.5m | ✅ 正常：村道、灯柱、艾拉、灰崽同框，无穿模/悬空/看墙 | 无（近 NPC 在身后，可接受） |
| L02 | `[0,65,10]`（本轮新修） | air / air / gravel | eira @6.0m；灰崽 10m | ✅ 正常：谷仓/草垛/蛋窝/主路可辨，不再怼脸 | **修复前 `(0,65,0)` = 灰崽 spawn，镜头在灰崽体内糊屏**（见 §2） |
| L03 | `[0,65,12]`（Round1 已修） | air / air / gravel | eira @6.0m；灰崽 9m | ✅ 正常：初夜营地/钟楼/火把，脚下结实 | 无（时间 13100 初夜为美术设定） |
| L04 | `[12,65,8]` | air / air / hay_block | eira @20.4m；灰崽 18.4m | ✅ 正常：麦田/水渠/村舍/艾拉远处可见 | 无 |
| L05 | `[13,64,6]`（Round1 已修） | air / air / gravel | mason @3.6m；灰崽 7m | ✅ 正常：民居夹道、村民走动、货箱/干草可见 | 无 |
| L06 | `[8,65,12]` | air / air / barrel | taka @8.25m；灰崽 14m | ✅ 正常：工坊货箱/干草/铁轨，视野开阔 | 无 |
| L07 | `[0,65,2]` | air / air / gravel | allays @10.8m；灰崽 22m | ✅ 正常：农场/铁轨/货箱/谷仓 | 无 |
| L08 | `[0,65,-5]` | air / air / polished_andesite | worker @10.6m；灰崽 5m | ✅ 正常：雨天工坊（内容设定 rain），铜管/砖塔清晰可辨 | 无（雨天为设计） |
| L09 | `[0,65,10]`（本轮新修） | air / air / gravel | eira @6.0m；灰崽 10m | ✅ 正常：营地/篝火/钟楼在视野内，不再糊屏 | **修复前 `(0,65,0)` = 灰崽 spawn，镜头在灰崽体内糊屏**（见 §2） |
| L10 | `[14,65,6]`（Round1 新修） | air / air / moss_block | villager-2 @16.1m；灰崽 14.3m | ⚠️ 可站立、无穿模/悬空，但出生朝向为草地夹道，**看不到双织偶桥/合龙石**（桥面在 z≈0 一侧） | 仅构图问题：Studio 素材改用桥面机位（见 §3），出生朝向建议后续加 `playerYaw` 契约 |

- 所有 10 关：脚部空气、头部空气、脚下有实心支撑（无穿模/卡方块/悬空）。
- 所有 10 关截图（出生视角）在 `evidence/scene-shots/hi-res/birth-L01.png … birth-L10.png`（2560×1440 PNG）。
- 机制辅助数据（spawn 方块、灰崽 spawn、NPC 距离）：`evidence/scene-shots/hi-res/spawn-audit.json`；每关取景/遮挡/画面亮度：`evidence/scene-shots/hi-res/audit.json`。
- 说明：`audit.json` 里 L03/L04/L05/L06 的「看向场景锚点被遮挡」是**启发式误报**（锚点取的是场景方块中位数，可能落在建筑内部）；人工看 `birth-L0X.png` 均正常，未据此判失败。

## 2. L02 / L09 修复前后对比（本轮关键缺陷）

| 项 | 修复前 | 修复后 |
|---|---|---|
| 插件 `health.playerSpawn` | L02/L09 都是 `(0,65,0)` | L02 `(0,65,10)`、L09 `(0,65,10)`（content `world.playerSpawn`，engine `deriveLayout` 已支持） |
| `world.snapshot.agents.golem.pos` | 同为 `(0,65,0)`（玩家 spawn == 灰崽 spawn） | 灰崽在 `(0,65,0)`，玩家在 10 格外 |
| 出生截图 | 整屏木质贴脸（镜头在灰崽模型体内，无法游玩）`birth-L02.png`/`birth-L09.png`（旧） | 正常营地/谷仓第一人称画面（`birth-L02.png`、`birth-L09.png` 现版本） |
| 修复代码位置 | — | `content/levels/L02.content.ts` / `L09.content.ts` 的 `world.playerSpawn` + `content/levels/L10.content.ts` `[14,65,6]`；`packages/worldport/src/paper-port.ts` deriveLayout `hint.playerSpawn ?? content.def.world.playerSpawn ?? arenaCenter` |

## 3. 截图机位与「仅截图」说明（诚实记录）

- 出生视角：相机固定在 `playerSpawn`，仅旋转 yaw/pitch 朝向该关主目标（玩家节拍目标或场景锚点），不移动位置。
- L10 出生视角看不到桥，Studio/report 素材 `L10.png` 采用**桥面机位**（右岸桥头 `(26,65,0)` 看向合龙石 `(12,66,0)`）——这是为展示「双织偶桥」的**仅截图机位**，不代表出生第一人称；出生视角图仍保留在 `birth-L10.png` 供审计。
- L02 素材截图时用控制台 `time set 1000` 临时改为白天（content 默认 23200 凌晨仍偏暗，见下），截完即弃；玩法时间不变。报告与图注写明「截图为白天机位」。
- L09 素材采用钟楼正面机位（`asset-cand/assetL09-bell.png`）。
- 其余 7 关素材直接用出生视角图。
- 原始 2560×1440 全图在 `evidence/scene-shots/hi-res/{birth,hero}-L0X.png` 与 `asset-cand/`；素材裁切为 2560×990 条带（`apps/studio/public/world/L01–L10.png`），清单见 `evidence/scene-shots/hi-res/assets-manifest.json`。

## 4. 其他观察（非起始点，供 Lead 参考）

1. **L02 时间 23200 仍偏暗**：截图时天刚蒙蒙亮、带星（`birth-L02.png` 原图 mean≈0.31）。旧素材是白天，用户会感知「又暗回去了」。建议 content 再调到 0/1000 或 6000（如希望清晨可 23500+ 并加雾色），需美术确认；当前 Studio 素材用白天临时机位规避。
2. **L10 出生朝向**：spawn 本身可站立，但默认朝草地夹道，看不到本关核心（桥/合龙石）。建议 engine/content 后续给 `playerYaw`（或 L10 spawn 移到右岸桥头 `[26,65,0]` 附近），让玩家出生第一眼就看见桥。
3. **切关纹理**：截图过程中 Paper 日志出现 1–2 次 `Villager ... suffocated in a wall`（旧关 NPC 在新场景重建瞬间被方块夹住），发生在会话切换瞬间，不影响截图与终态；如果在意可让 begin 在放置新方块前先移除旧 NPC（插件侧已做大部分，仍有个别 NPC 因场景方块同 tick 生成而短暂窒息）。

## 5. 复现命令

```bash
# 1) Paper（打包运行时数据目录副本，端口 25575/RPC 8775）
cd tmp/shots/paper && mkfifo console.in && tail -f /dev/null > console.in &
../../../tmp/pkgtest/real/java/bin/java -Xms1G -Xmx2G -jar paper.jar --nogui < console.in > console.log 2>&1 &
# 2) 工作区源码引擎（content playerSpawn 生效的关键）
PORT=4330 LOOM_WORLD=paper LOOM_RPC_URL=ws://127.0.0.1:8775 LOOM_MC_PORT=25575 \
  npx tsx tmp/verify/run-engine.ts
# 3) 真实客户端容器（Prism libraries/assets/Java 只读挂载；镜像内置 Xvfb+Mesa+ImageMagick）
docker run -d --name loomshot --network host \
  -v ~/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher:/prism:ro \
  -v ~/.var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/java/java-runtime-epsilon:/prism-java:ro \
  -v "$PWD/tmp/shots":/work -v "$PWD/tmp/shots/mcdata":/mcdata -w /work loomshot:1 sleep infinity
docker exec loomshot /work/run-client.sh        # Xvfb 2560x1440 + MC --quickPlayMultiplayer 127.0.0.1:25575
# 4) 逐关截图 + 审计
LEVELS=all npx tsx tmp/shots/orchestrate.mjs
python3 tmp/shots/make-assets.py                # 2560x990 条带 + report 图
```
