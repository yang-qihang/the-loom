# 41 — AI / 新开发者接手指南

> 状态：可执行｜最后更新：2026-10-31｜上游：AGENTS.md、docs/07、docs/40

## 1. 开工顺序

1. `README.md` 快速开始 + 本文件
2. `AGENTS.md` 红线
3. `docs/40-development-history.md` 踩坑
4. `docs/42-player-guide.md` 玩家实际流程
5. `docs/43-environment-and-bundling.md` 环境/依赖边界
6. `docs/06` 关卡体系、`docs/07` 架构、`docs/12` SDK 命名

## 2. 不可违反

- 版本锁：Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0 / Node 22 / TS 6 / Monaco 0.57。
- 不改测试/断言/隐藏测试来变绿；评分真值在 engine/plugin。
- 真实 e2e 同一 Paper 串行；GUI 自动化只用 `:98/:99`，禁止 `:0`。
- 改插件必须冷启动；不 `/reload`。
- 不把 Mock 全绿当真实可玩；真实 e2e 要 report/digest/reset 全过。
- 参考解不站到容器/机关/农田格中心；并发任务里不要并发 moveTo。

## 3. 典型任务路径

### 修一关真实路径
1. `npx tsx it/lN-real.ts` 复现，记录失败坐标；
2. 用 RPC `world.block`/`session.status` dump 目标附近方块；
3. 判断是「站到不可站立格 / 门洞 / 支撑柱 / 并发 moveTo」中的哪类；
4. 改参考解先走主路/旁边格；必要时对已占用格子清出站位（不往空走廊写 air）；
5. 跑 Mock 单测 + 真实 e2e；PASS 后提交证据。

### 加一个 SDK/API
`docs/12` 先登记 → level-spec allowlist → worldport + session + runner 注入 → Mock/Paper 双实现 → 单测 + 真实 e2e → 文档。

### 改桌面 UI
`apps/desktop/shell` 是桌面壳；Studio 内容在 `apps/studio`。窗口尺寸/缩放/会话消息走 `apps/desktop/src-tauri/src/main.rs` 与 `shell.js`。改完必须重建桌面包并在 `:98` 启动检查，不在 `:0` 自动化。

## 4. 常用命令

```bash
npm test
npm run typecheck
bash scripts/verify.sh
npm --prefix apps/studio run test:e2e
bash scripts/mc-up.sh
npx tsx it/l10-real.ts
npx tsx it/l10-studio.ts
```

## 5. 证据格式

- `evidence/lN-real-latest.json`
- `evidence/l10-real-latest.json`
- `evidence/l10-studio-latest.json`
- 截图：`apps/studio/evidence/`、`evidence/scene-shots/`
- 任何 PASS 都要能指向一份 JSON/截图，不接受口头「应该可以」。

## 6. 当前剩余工作（按优先级）

1. 把真实 Paper/引擎/Java/Paper/插件/世界依赖真正打进桌面包，做到「只装 Minecraft 即可玩」。
2. 挑战层从说明卡升级为可玩会话。
3. 真人多背景盲测。
4. 补 UOS/桌面真实模式的自动化回归。
