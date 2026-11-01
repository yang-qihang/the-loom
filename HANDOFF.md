# HANDOFF — 项目续跑快照（新 conversation / 新 agent 从这里开始）

> 更新时间：2026-11-01 13:40（Asia/Shanghai）｜当前 commit：`git log -1`（工作区有未提交改动；**不要自行 git commit**，Lead 统一提交）
> 用户要求：**全权由 AI 推进整个项目；用户不参与测试/操作；必须美观、精致、coherent、层层递进、易用、文字清晰无 AI 味。**
> 本文件是「断点续跑」入口：新会话先读 `README.md` → `STATUS.md` → `docs/46-playtest-fix-plan.md`（上一轮事实源）→ `docs/48-round2-guidance-api-visual-plan.md`（Round 2 契约）→ `AGENTS.md` → `docs/41-ai-contributor-guide.md`，再跑验证命令。

## 0. 当前交付快照（2026-11-01，v1.4）

- **可玩**：L01–L10 全部可玩；真实 Paper e2e 全 PASS（`it/l1-real.ts`–`it/l10-real.ts`，L01 21 项 / L02–L09 各 13 项 / L10 19 项；L10 额外有 Studio 会话注入 11 项）。
- **今天修复的 4 类试玩问题**（详见 `docs/46-playtest-fix-plan.md` §5）：① 目标面板由 `LevelDef.progress` 单一真值驱动、逐条打勾；② 严格线性玩家节拍（`playerBeatReady` 门控 + 插件拦截提前右键）；③ 切关/reset 的 sandbox 纯净（清场景/实体/背包，全区域 checkpoint 还原）；④ 第 4 盏灯容错右键（站地面、手持灯笼对柱子右键即可，不用看柱顶）。
- **桌面**：AppImage ≈428MB / RPM ≈435MB，内置 Node 22 + Java 25 + Paper 26.1.2 + 插件 + 干净世界 + 真实引擎 + mineflayer 织偶；用户只需安装 Minecraft 26.1.2。旧 `~/.loomcraft/runtime/paper/world` 会按世界布局版本 marker 自动换干净世界（进度/星级存 Studio，不存世界）。
- **质量（Round 1 验收快照；Round 2 收尾后由 Lead 更新）**：`npx tsc --noEmit` 0；`npm test` 235/235（25 files）；Studio `test:e2e` 6/6、`test:e2e:local` 2/2；`bash scripts/verify.sh` exit 0（lg 有 tracked warn）；文案门禁（自然中文 + 术语白名单）0 违规。
- **Round 2（2026-11-01 第二轮试玩反馈，实施中）**：语义 API（collect/deposit/count/world.container/goTo/place(block,point)）与命名坐标点；指令手册/位置 HUD/REPL 当前关卡；progress hint + 概念揭晓；codeRequirements 名实相符；Maple Mono 与 Monaco 菜单不透明；真实客户端高清截图与起始点验收。契约/验收见 `docs/48`，最终数字/包路径以 Lead 集成后为准。
- **明确边界**：挑战层是说明卡非可玩会话；真人（非 AI 代理）多背景盲测未执行；Fresh Reader Round 4 未清零（G-FRESH-READER 仍 tracked fail）。L03/L05 出生点已修（README 边界 5）；L03 钟本体在钟楼结构内不可见属美术边界；Round 2 截图/字体验收待最终回归。

## 1. 现在可直接跑的命令

```bash
# 质量门（typecheck / 单测 / 契约 / 内容 / 专项 gate）
npm ci
npm test                       # 25 files / 235 tests
npm run typecheck
bash scripts/verify.sh         # 默认 l0,l1,l2,l3,lg；exit 0
bash scripts/verify.sh --layers l0,l1,l2,l3,lg,ux   # 彩排前跑 UOS

# Studio 验收（Playwright 自动起引擎与静态站；用系统 Chrome）
npm --prefix apps/studio run test:e2e        # 6/6
npm --prefix apps/studio run test:e2e:local  # 2/2
node scripts/check-copy.mjs --self-test     # 文案分类器 14/14

# 真实 Paper（无头；同一服务端串行）
bash scripts/mc-up.sh
npx tsx it/l1-real.ts          # … l2 … l10 逐关串行
bash scripts/mc-reset.sh       # 单独测 world.reset
bash scripts/mc-down.sh

# 桌面 App（自包含真实运行时）
bash scripts/launch-desktop.sh

# 重新打包（唯一入口）
bash scripts/package-desktop.sh
```

## 2. 当前正在跑的进程

- **无必须常驻的进程**。桌面 App/`launch-desktop.sh` 会自己拉起内置 Paper + 真实引擎，并在启动前清理旧实例；手跑真实 e2e 时 `mc-up.sh` 起的 Paper 用完 `mc-down.sh` 停掉。
- 端口约定：HTTP 引擎 `4317`（可用 `PORT` 覆盖）、Paper `25565`、插件 RPC `8765`；Studio dev `5173`；真实 e2e 的 Studio/引擎用 `4399`/`5186`；自动化 GUI 只允许 `:98`/`:99`，禁止 `:0`。
- 日志：`~/.loomcraft/logs/`（桌面/内置 Paper/引擎）、`it/.mc-server/console.log`（手跑 Paper）。

## 3. 下一轮优先级（按用户价值）

1. **Round 2 收尾**：等 api-runtime/api-engine/content-act1/content-late/guidance-ui/monaco-font/visual 各线合入后，按 `docs/48` §3 跑完整验收（语义 API 回归、指令手册/HUD/REPL、Maple Mono/右键菜单、10 关高清截图与起始点）、重新打包；文档里未确认的数字不要填（包体积/截图尺寸）。
2. **挑战层从说明卡升级为可玩会话**（当前所有关卡「挑战层」只是可阅读说明卡）。
3. **真人多背景盲测**：目前所有玩家路径证据都是 AI 自动化（真实 Paper e2e + Studio e2e + UOS）。
4. **Fresh Reader Round 4**：用全新 2 个 fresh agent 复读，清零前不写「完成」。
5. **文案后续批次**：L05–L10 引导与织典页文案继续覆盖（docs/22），按新政策「自然中文 + 必要英文术语」复核。

## 4. 关键约束（所有 agent）

1. 不越 write scope；不改别人文件；**不要 git commit**（Lead 统一提交）；不改测试/断言变绿。
2. 版本锁：MC/Paper **26.1.2 build 74**、Java **25**、mineflayer **4.39.0**、minecraft-protocol 1.68.0、pathfinder 2.4.5、TS **6.0.3**、esbuild 0.28.2、Monaco 0.57.0。升级 = ADR + Lead 签字。
3. 学生 API 只能来自 `docs/12`；语法不越级；类型错误不阻断、语法错误阻断。
4. 文案遵守 `docs/20` §3/§3b（无 AI 味、动词按钮、错误=哪里错+怎么改）：自然中文 + 必要英文计算机术语保留英文，概念统一「中文名（English term）」；UI 英文标签仍禁止。
5. 真实 e2e 同一 Paper 串行；GUI 自动化只用 `:98/:99`；改插件必须冷启动，不 `/reload`。
6. 事实/完成标准：命令 + exit 0 + 产物路径；`STATUS.md` 每个集成点更新；不要用「应该可以」代替证据。

## 5. 文档地图（新 agent 按需读）

- 当前事实源：`docs/46-playtest-fix-plan.md`（上一轮）、`docs/48-round2-guidance-api-visual-plan.md`（Round 2 契约）、`STATUS.md`、`README.md`、`docs/41-ai-contributor-guide.md`。
- 架构/契约：`docs/07-architecture.md`、`docs/21-t1-contracts.md`（T1 基线，2026-11-01 的 RPC/进度变更见 docs/46 §2）。
- 设计期历史（结论保留、当前实现以代码为准）：`docs/00`–`docs/18`、`docs/24`。
- 质量/流程：`docs/20`、`docs/28`、`docs/29`、`docs/30`、`qa/README.md`。
- 玩法/交接：`docs/42-player-guide.md`、`docs/43-environment-and-bundling.md`、`docs/36-github-handoff.md`、`docs/40-development-history.md`。
- 文档审计：`docs/47-docs-audit-2026-11-01.md`（本次审计的判定表与删除清单）。

## 6. 历史记录（2026-10-31 及更早）

- T1 真实 MC 垂直切片：L01 真实 Paper e2e 3 星、评分与 Mock 逐项一致、reset ≤2s hash 稳定（`evidence/l1-real-2026-10-31T05-14-40-618Z.json`）。
- T2/T3：Engine paper 模式接入、Studio 真实联调、文案 v3 + 序章/手记、试符台/织典、桌面封装、L10 双织偶真实运行时、Fresh Reader 1–3 轮。
- 更早里程碑（设计交付、L10 铺桥 spike 10/10）见 `STATUS.md` 历史段与 `docs/40-development-history.md`；历史段中的数字/进度已过时，不要当现状引用。

## 7. 新会话续跑建议

1. 读本文件 + `STATUS.md` 最新段（2026-11-01）+ `docs/46`。
2. `git log --oneline -5` 确认 commit；`git status` 看未提交改动；`npm test` + `bash scripts/verify.sh` 确认绿。
3. 用 `team_task_list` 看任务板；不要重复别人文件。当前已知未闭环见 §3。
