# 41 — AI / 新开发者接手指南

> 状态：可执行（当前事实源：`docs/46-playtest-fix-plan.md`、`STATUS.md`）｜负责人：Lead｜最后更新：2026-11-01｜上游：AGENTS.md、docs/07、docs/40、docs/46

## 1. 开工顺序

1. `README.md` 快速开始 + `STATUS.md` + `docs/46-playtest-fix-plan.md`（2026-11-01 试玩修复与当前契约）+ 本文件
2. `AGENTS.md` 红线
3. `docs/40-development-history.md` 踩坑
4. `docs/42-player-guide.md` 玩家实际流程
5. `docs/43-environment-and-bundling.md` 环境/依赖边界
6. `docs/06` 关卡体系、`docs/07` 架构、`docs/12` SDK 命名、`docs/47` 文档审计结论

## 2. 不可违反

- 版本锁：Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0 / Node 22 / TS 6 / Monaco 0.57。
- 不改测试/断言/隐藏测试来变绿；评分真值在 engine/plugin。
- 真实 e2e 同一 Paper 串行；GUI 自动化只用 `:98/:99`，禁止 `:0`。
- 改插件必须冷启动；不 `/reload`。
- 不把 Mock 全绿当真实可玩；真实 e2e 要 report/digest/reset 全过。
- 参考解不站到容器/机关/农田格中心；并发任务里不要并发 moveTo。
- 目标面板只认 `LevelDef.progress` 真值；玩家节拍严格线性（`result.playerBeatReady` 前插件会拦截提前右键）。
- 切关/reset 必须保持 sandbox 纯净：不得只还原部分方块、不得保留跨关背包/实体（插件全区域 checkpoint 已实现，改场景时不要绕开）。

## 3. 典型任务路径

### 修一关真实路径
1. `npx tsx it/lN-real.ts` 复现，记录失败坐标；
2. 用 RPC `world.block`/`session.status` dump 目标附近方块；
3. 判断是「站到不可站立格 / 门洞 / 支撑柱 / 并发 moveTo」中的哪类；
4. 改参考解先走主路/旁边格；必要时对已占用格子清出站位（不往空走廊写 air）；
5. 跑 Mock 单测 + 真实 e2e；PASS 后提交证据。

### 加一个 SDK/API
`docs/12` 先登记 → level-spec allowlist → worldport + session + runner 注入 → Mock/Paper 双实现 → 单测 + 真实 e2e → 文档。

### 改目标进度 / 玩家节拍
1. 只改 `content/levels/LXX.content.ts` 的 `progress`（2–3 条、稳定 id、可机器判定；玩家亲手做的步骤标 `player:true`，且不能是第一条）；
2. 玩家节拍目标/道具/hint 用 `task.playerBeatHint` + `afterPrepare` 的 `playerGive`；插件容错由 `playerBeat.arm/activate` 统一处理；
3. 跑 `npx tsx it/lN-real.ts` + `npm test` + Studio `test:e2e`；进度真值契约见 docs/46 §2.2–2.3。

### 改桌面 UI
`apps/desktop/shell` 是桌面壳；Studio 内容在 `apps/studio`。窗口尺寸/缩放/会话消息走 `apps/desktop/src-tauri/src/main.rs` 与 `shell.js`。改完必须重建桌面包（`bash scripts/package-desktop.sh`）并在 `:98` 启动检查，不在 `:0` 自动化。

## 4. 常用命令

```bash
npm test
npm run typecheck
bash scripts/verify.sh
npm --prefix apps/studio run test:e2e        # 6/6（自动起 engine:4399 + 静态 Studio:5186）
npm --prefix apps/studio run test:e2e:local  # 2/2
bash scripts/mc-up.sh
for L in 1 2 3 4 5 6 7 8 9 10; do npx tsx it/l$L-real.ts || break; done
npx tsx it/l10-studio.ts
bash scripts/launch-desktop.sh               # 桌面 App（自包含真实运行时）
```

## 5. 证据格式

- `evidence/lN-real-latest.json`
- `evidence/l10-real-latest.json`
- `evidence/l10-studio-latest.json`
- 截图：`apps/studio/evidence/`、`evidence/scene-shots/`
- 试玩修复独立验收：`evidence/playtest-fix/report.md`、`evidence/playtest-fix/after/*.json`
- 任何 PASS 都要能指向一份 JSON/截图，不接受口头「应该可以」。

## 6. 当前剩余工作（按优先级，2026-11-01）

1. **真人可达性两项**：L03 玩家出生点 `(0,65,0)` 位于钟楼结构内、L02 蛋糕目标格被塔基占用；修 `playerSpawn` 派生/Beat 坐标并补真实玩家从出生点走到的验收（`evidence/playtest-fix/report.md` §4）。
2. **挑战层从说明卡升级为可玩会话**（当前所有关卡只展示「挑战层」说明卡）。
3. **真人多背景盲测**：现有玩家路径证据都是 AI 自动化（真实 Paper e2e + Studio e2e + UOS）。
4. **真实客户端截图重拍**：按 docs/34 固定机位补拍部分关卡（第 4 盏灯发光标记、L01 去石阶后的画面）。
5. **Fresh Reader Round 4**：全新 2 个 fresh agent 复读，清零 G-FRESH-READER 前不写「完成」。
6. **文案后续批次**：L05–L10 引导与织典页文案继续覆盖（docs/22）。
