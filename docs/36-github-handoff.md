# 36 — GitHub 交接说明（给人类开发者）

> 状态：交接可用（L01–L10 真实 Paper 已 PASS；2026-11-01 试玩修复已落地）｜负责人：Lead｜最后更新：2026-11-01｜上游：`STATUS.md`、`docs/46-playtest-fix-plan.md`
> 目的：让另一个人能复现、定位并继续修复，不需要再开新的可行性 spike。

## 1. 先看哪几份

1. `README.md` → 快速开始
2. `AGENTS.md` → 红线（版本锁、测试冻结、write scope、不要 :0 自动化）
3. `STATUS.md` → 当前交付状态
4. `docs/07-architecture.md` → 双通道、WorldPort、场景/评分
5. `docs/06-level-spec-system.md` → 关卡/评分/隐藏测试
6. `docs/46-playtest-fix-plan.md` → 2026-11-01 的进度/节拍/sandbox 契约与验收
7. 本文件 → 当前 blocker 与复现命令

## 2. 为什么说「不需要新 spike」

- **L05–L09 真实路径**：已经有一套真实 Paper e2e harness（`it/real-harness.ts`、`it/l5-real.ts`…`l9-real.ts`），能真实 prepare、跑参考解、playerBeat、生产评分、WorldDigest 对照；失败坐标和 evidence 已固定。剩下是场景布局/可走性工程，不是可行性研究。
- **L10 多织偶**：`docs/02c-finale-spike.md` 的双 bot 铺桥路线 A 已 10/10 通过、0 掉落；需要的是把已验证的 spike 接进 engine/worldport/runner，不是再验证「能不能做」。
- **桌面/窗口/字体/标注**：均已有可运行实现和 e2e，问题属于工程细节。

## 3. 环境（锁定）

- Minecraft/Paper **26.1.2 build 74**（客户端用 Prism；服务端 Paper jar 不入库）
- Java **25**、Node **22.23.1**、npm lockfile 固定
- Linux GUI 自动化只能在隔离 Xvfb：默认 `:98`，绝不要 `:0`（会移动用户真实鼠标；见 docs/34 §0）
- 服务端：`bash scripts/mc-up.sh`（`it/.mc-server/`，不入库）；引擎：`npm run dev:engine` 或 `npm run dev:engine:paper`

## 4. 30 分钟复现当前 blocker

```bash
npm ci
npm test                         # 应全绿；基线 235 tests / 25 files
npm run typecheck
bash scripts/verify.sh           # exit 0

# 真实 Paper（需要本地 Paper jar 与客户端环境）
bash scripts/mc-up.sh
npx tsx it/l5-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l6-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l7-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l8-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l9-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l10-real.ts          # PASS (双织偶, 19 checks)
```

证据：`evidence/l5-real-latest.json` … `l9-real-latest.json`；harness 会输出每步 CHECK 与失败坐标。

## 5. 当前真实 blocker / 已知边界（按优先级，2026-11-01）

> L05–L09 真实可走性、L10 多织偶运行时、桌面真实运行时三项已在 2026-10-31 解决（`it/l5-real.ts`–`l10-real.ts` PASS；桌面安装包已内置真实运行时），不再列为 blocker。

1. **真人体验遗留问题已修（11-01）**：L03/L05 显式 `playerSpawn`；L02 蛋糕、L04 南瓜目标格改为空气格（会真的落块）。仅剩 L03 钟本体在钟楼结构内不可见（美术边界，对着钟楼右键可完成）。证据：`evidence/playtest-fix/report.md` §4。
2. **挑战层仍是说明卡**，未接可玩会话。
3. **真人多背景盲测未执行**；G-FRESH-READER 仍 tracked fail（Round 4 未清零），不得假绿。
4. **部分关卡真实客户端截图未全部重拍**（docs/34 §5）。

## 6. 交接时必须先做的清理

- 不要提交 `node_modules/`、`apps/desktop/dist/`、`apps/desktop/src-tauri/target/`、`it/.mc-server/`、Paper jar、世界存档、contact sheet 大图。
- `scripts/prepare-github-handoff.sh` 会生成一个干净的新仓库目录（新 git 历史、只含源码/文档/锁文件/小证据），不包含 .git 历史里的旧大文件。
- 仓库历史里若已有大文件，直接推旧历史可能超 GitHub 建议大小；**推荐用脚本生成的新仓库作为 GitHub 主仓**，旧历史留在本地。

## 7. 红线（不要重蹈）

- 不升级锁死版本；不 `/reload` 插件，改插件必须冷启动。
- 不改测试/断言来变绿；评分真值只在 engine/plugin。
- 自动化只在 `:98/:99`，不碰 `:0`。
- 提交前 `npm test`、`npm run typecheck`、`bash scripts/verify.sh` 必须绿；`G-FRESH-READER` 仍是 tracked fail，不能假绿。
- 改目标进度/玩家节拍前先读 `docs/46` §1–§2；进度唯一真值是 `LevelDef.progress`，玩家节拍严格线性。
