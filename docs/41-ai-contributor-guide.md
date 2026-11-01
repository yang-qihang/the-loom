# 41 — AI / 新开发者接手指南

> 状态：可执行（当前事实源：`docs/46-playtest-fix-plan.md`、`docs/48-round2-guidance-api-visual-plan.md`、`STATUS.md`）｜负责人：Lead｜最后更新：2026-11-01｜上游：AGENTS.md、docs/07、docs/40、docs/46、docs/48

## 1. 开工顺序

1. `README.md` 快速开始 + `STATUS.md` + `docs/46-playtest-fix-plan.md`（上一轮修复）+ `docs/48-round2-guidance-api-visual-plan.md`（Round 2 契约）+ 本文件
2. `AGENTS.md` 红线
3. `docs/40-development-history.md` 踩坑
4. `docs/42-player-guide.md` 玩家实际流程
5. `docs/43-environment-and-bundling.md` 环境/依赖边界
6. `docs/06` 关卡体系、`docs/07` 架构、`docs/12` SDK 命名（v2 语义 API/命名点）、`docs/47` 文档审计结论

## 2. 不可违反

- 版本锁：Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0 / Node 22 / TS 6 / Monaco 0.57。
- 不改测试/断言/隐藏测试来变绿；评分真值在 engine/plugin。
- 真实 e2e 同一 Paper 串行；GUI 自动化只用 `:98/:99`，禁止 `:0`。
- 改插件必须冷启动；不 `/reload`。
- 不把 Mock 全绿当真实可玩；真实 e2e 要 report/digest/reset 全过。
- 参考解不站到容器/机关/农田格中心；并发任务里不要并发 moveTo。
- 目标面板只认 `LevelDef.progress` 真值；玩家节拍严格线性（`result.playerBeatReady` 前插件会拦截提前右键）。
- 切关/reset 必须保持 sandbox 纯净：不得只还原部分方块、不得保留跨关背包/实体（插件全区域 checkpoint 已实现，改场景时不要绕开）。
- 文案：**自然中文 + 必要英文计算机术语保留英文**（`for`、`let`、`Promise.all`、`async/await`、`closure`、`higher-order function`、`interface` 等），统一「中文名（English term）」；不为「纯中文」硬翻术语，也不把英文当普通叙述词。UI 英文标签（Run/Stop/Reset）仍禁止。政策见 docs/20 §3b。

## 3. 典型任务路径

### 修一关真实路径
1. `npx tsx it/lN-real.ts` 复现，记录失败坐标；
2. 用 RPC `world.block`/`session.status` dump 目标附近方块；
3. 判断是「站到不可站立格 / 门洞 / 支撑柱 / 并发 moveTo」中的哪类；
4. 改参考解先走主路/旁边格；必要时对已占用格子清出站位（不往空走廊写 air）；
5. 跑 Mock 单测 + 真实 e2e；PASS 后提交证据。

### 加一个 SDK/API
`docs/12` 先登记 → level-spec allowlist → worldport + session + runner 注入 → Mock/Paper 双实现 → 单测 + 真实 e2e → 文档。

### 改语义 API / 命名点（Round 2）
1. API 命名先改 `docs/12`（v2：命名点 + PointLike + 语义动作），再改 `packages/sdk` 类型与 `packages/sdk/src/api-registry.ts`（指令手册单一数据源，每条必须有签名/一句人话/可照抄示例/sinceLevel）；
2. 运行时实现：`packages/worldport`（端口/PointLike 解析）、`packages/mockworld`（Mock 语义）、`packages/runner`（沙箱注入与语义方法）、`packages/session`（转发/日志）；
3. 关卡声明 `LevelDef.world.points`（键名即学生可见全局变量名），内容示例优先用命名点；旧 `(x,z)`/`(x,y,z)` 签名保留兼容；
4. 跑 `npm test`、`npx tsx it/lN-real.ts`、Studio `test:e2e`；语义事件与旧 API 的 `block.place` 序列必须一致（评分真值不变）。

### 改引导 / 概念揭晓（Round 2）
1. `progress[i].hint` 写 2–4 句：怎样算完成 + 可照抄写法 + 坐标从哪来（命名点/手册/`golem.pos`）；
2. 概念揭晓统一「中文名（English term）」+ 一句人话 + 映射到玩家刚做的事（docs/04 §11.5）；不硬翻术语（docs/20 §3b）；
3. 名实相符：每关 `codeRequirements` ≥2 条，starter 不满足、参考解满足（docs/48 §1.4b）。

### 改目标进度 / 玩家节拍
1. 只改 `content/levels/LXX.content.ts` 的 `progress`（2–3 条、稳定 id、可机器判定；玩家亲手做的步骤标 `player:true`，且不能是第一条）；
2. 玩家节拍目标/道具/hint 用 `task.playerBeatHint` + `afterPrepare` 的 `playerGive`；插件容错由 `playerBeat.arm/activate` 统一处理；
3. 跑 `npx tsx it/lN-real.ts` + `npm test` + Studio `test:e2e`；进度真值契约见 docs/46 §2.2–2.3。

### Round 2 快速定位

- 语义 API/命名点：`docs/12` v2、`packages/sdk/src/index.ts`、`packages/worldport/src/index.ts`（`PointLike`/`toSdkPoints`）、`packages/mockworld/src/index.ts`；
- 指令手册数据源：`packages/sdk/src/api-registry.ts`（Studio 的 `GuidanceManual.tsx` 与 REPL 共用）；
- 学习设计/术语：`docs/04` §11.5、`docs/20` §3b、`content/levels/*.content.ts` 的 `progress[].hint`/`codeRequirements`；
- 引导 UI：`apps/studio/src/components/{GuidanceManual,PositionHud,ConceptRevealCard}.tsx`、`apps/studio/src/guidance.css`；
- 字体与素材：`apps/studio/public/fonts/`（Maple Mono + OFL）、`apps/studio/public/world/*.png`、`report/evidence/*.png`；
- 引擎端点：`GET /api/api-reference`、`GET /api/session/:id/snapshot`（HUD/手册用）。

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
node scripts/check-copy.mjs --self-test     # 文案分类器 14/14
bash scripts/launch-desktop.sh               # 桌面 App（自包含真实运行时）
```

## 5. 证据格式

- `evidence/lN-real-latest.json`
- `evidence/l10-real-latest.json`
- `evidence/l10-studio-latest.json`
- 截图：`apps/studio/evidence/`、`evidence/scene-shots/`
- 试玩修复独立验收：`evidence/playtest-fix/report.md`、`evidence/playtest-fix/after/*.json`
- 任何 PASS 都要能指向一份 JSON/截图，不接受口头「应该可以」。

## 6. 当前剩余工作（按优先级，2026-11-01 Round 2）

1. **Round 2 收尾验收**：按 `docs/48` §3 验语义 API/指令手册/HUD/REPL/概念揭晓/codeRequirements/Maple Mono/右键菜单/高清截图与起始点，跑 `npm test`、`verify.sh`、Studio e2e、L01–L10 真实 e2e，重新打包；未确认的数字（包体积/截图尺寸）不要写进文档。
2. **挑战层从说明卡升级为可玩会话**（当前所有关卡只展示「挑战层」说明卡）。
3. **真人多背景盲测**：现有玩家路径证据都是 AI 自动化（真实 Paper e2e + Studio e2e + UOS）。
4. **Fresh Reader Round 4**：全新 2 个 fresh agent 复读，清零 G-FRESH-READER 前不写「完成」。
5. **文案后续批次**：L05–L10 引导与织典页文案继续覆盖（docs/22），按「自然中文 + 必要英文术语」政策复核。
