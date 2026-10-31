# 36 — GitHub 交接说明（给人类开发者）

> 状态：L01–L10 真实 Paper 已 PASS｜最后更新：2026-10-31
> 目的：让另一个人能复现、定位并继续修复，不需要再开新的可行性 spike。

## 1. 先看哪几份

1. `README.md` → 快速开始
2. `AGENTS.md` → 红线（版本锁、测试冻结、write scope、不要 :0 自动化）
3. `STATUS.md` → 当前交付状态
4. `docs/07-architecture.md` → 双通道、WorldPort、场景/评分
5. `docs/06-level-spec-system.md` → 关卡/评分/隐藏测试
6. 本文件 → 当前 blocker 与复现命令

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
npm test                         # 应全绿；基线 230 tests
npm run typecheck
bash scripts/verify.sh           # exit 0

# 真实 Paper（需要本地 Paper jar 与客户端环境）
bash scripts/mc-up.sh
npx tsx it/l5-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l6-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l7-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l8-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l9-real.ts            # PASS (3 星, digest=MOCK)
npx tsx it/l10-real.ts          # PASS (双织偶, 17 checks)
```

证据：`evidence/l5-real-latest.json` … `l9-real-latest.json`；harness 会输出每步 CHECK 与失败坐标。

## 5. 当前真实 blocker（按优先级）

1. **L05–L09 真实可走性**：织偶真实 Paper 上被脚手架/房屋/自动支撑柱堵路；解析现场：
   - `it/real-harness.ts` 是入口；`packages/worldport/src/paper-port.ts` 的 `moveTo` / `agent.mark` 是织偶动作；
   - `plugin/src/main/java/dev/loomcraft/mc/SceneManager.java` 的 `buildArena` 曾自动给 tracked 高点补石柱；需要判断是保留还是要求内容自支撑；
   - 不允许用后台 teleport 冒充玩家路径，也不允许削弱 grading 来「变绿」。
2. **L10 多织偶运行时**：engine 当前单 bot；需扩展 `WorldPort.agent` / runner SDK / plugin `bots.set` / 消息收发，接入 docs/02c 的 lane。
3. **Fresh Reader 剩余 blocker**：见 `docs/31-fresh-reader-report.md` 与 `docs/32-fresh-reader-fix-tracker.md`；含错误提示、标注可读性、序章身份说明等。
4. **桌面真实 Paper 集成**：桌面包当前 Mock-only（Paper/bot 为 stub）；真实 Paper 走 `npm run dev:engine:paper`，未收进安装包。

## 6. 交接时必须先做的清理

- 不要提交 `node_modules/`、`apps/desktop/dist/`、`apps/desktop/src-tauri/target/`、`it/.mc-server/`、Paper jar、世界存档、contact sheet 大图。
- `scripts/prepare-github-handoff.sh` 会生成一个干净的新仓库目录（新 git 历史、只含源码/文档/锁文件/小证据），不包含 .git 历史里的旧大文件。
- 仓库历史里若已有大文件，直接推旧历史可能超 GitHub 建议大小；**推荐用脚本生成的新仓库作为 GitHub 主仓**，旧历史留在本地。

## 7. 红线（不要重蹈）

- 不升级锁死版本；不 `/reload` 插件，改插件必须冷启动。
- 不改测试/断言来变绿；评分真值只在 engine/plugin。
- 自动化只在 `:98/:99`，不碰 `:0`。
- 提交前 `npm test`、`npm run typecheck`、`bash scripts/verify.sh` 必须绿；`G-FRESH-READER` 仍是 tracked fail，不能假绿。
