# HANDOFF — 项目续跑快照（新 conversation / 新 agent 从这里开始）

> 更新时间：2026-11-01 22:5x（Asia/Shanghai）｜当前 commit：`git log -1`（Round 4 已推送 main；工作区在 Round 4 收尾时可能有 docs/evidence 的未提交改动；**不要自行 git commit**，Lead 统一提交）
> 用户要求：**全权由 AI 推进整个项目；用户不参与测试/操作；必须美观、精致、coherent、层层递进、易用、文字清晰无 AI 味。**
> 本文件是「断点续跑」入口：新会话先读 `README.md` → `STATUS.md`（顶部 Round 4）→ `docs/49-round4-teaching-ux-and-textbook-plan.md`（本轮契约/结果）→ `docs/46`/`docs/48`（前两轮事实源）→ `AGENTS.md` → `docs/41-ai-contributor-guide.md`，再跑验证命令。

## 0. 当前交付快照（2026-11-01，Round 4 完成）

- **可玩**：L01–L10 全部可玩；真实 Paper e2e 全 PASS（本轮 Windows 原生复跑 L01/L10 + 引擎 P0 回归；完整 L01–L10 由 `it/l1-real.ts`–`it/l10-real.ts` 串行覆盖）。
- **Round 4 交付**（提交 `715b8e5`/`31580e3`/`1d87085`/`c1ba514`/`4227b5d`，详见 `STATUS.md` 顶部）：
  ① 玩家任务自动检测/自动结算（引擎 snapshot 附带 progress，Studio 轮询同步目标 + 自动 confirm → 自动结算；手动按钮兜底）；
  ② 运行鲁棒性（失败重试自动恢复场景、真语法检查、runId/SSE 旧事件过滤、后端错误原因透传、双击防重入）；
  ③ 剧情浮层排版（固定头/滚动内容/固定底、对称留白、小视口不裁切、同类浮层同修）；
  ④ 字体系统（代码=Maple Mono、长文=Noto Sans SC 随包子集、短标题/按钮=像素）；
  ⑤ 10 章配套教材（76,429 汉字）+ 可拖动/缩放/置顶教材窗口（首次进关自动打开、随时回看）；
  - **质量（Round 4 验收）**：`tsc --noEmit` 0；`npm test` 28 files / 251 tests；Studio real-config e2e **37/37**、mock-config e2e 4/4；教材校验 0 error；真实 Paper e2e L01/L10 + 引擎回归 PASS（`evidence/l*-real-latest.json`、`evidence/engine-paper-regressions-latest.json`）。
- **桌面**：AppImage ≈429MB / RPM ≈436MB（上一轮产物）；内置 Node/Java/Paper/插件/世界/引擎/织偶；**新桌面包需同学在原生 Linux 重新打包**（本轮源码含新字体/教材/引擎，未在 Linux 侧打包验证）。
- **明确边界**：挑战层仍是说明卡；真人多背景盲测未执行；Fresh Reader Round 4 未清零；教材为长文阅读、真人学习效果未测；L09 取金苹果仍用旧写法 `place("air", chest)`（内容侧待改）；L01 hidden `h1` 的 `agent.move` 采样边界仍偶发（判星公平性问题，见 STATUS 顶部 Round 3 段）。
- **Windows 原生验证栈（canonical 端口）**：Paper `25567` / 插件 RPC `8765` / engine `4317` / Studio `5173`；`it/.mc-server/server.properties` 为 25567；Paper 用 `.tools/win/paper-host.mjs` 托管。Fedora VM 已清理（`loom-vm` 仅 3 份报告 md），AppImage/RPM 由同学原生 Linux 打包。
- **下一轮建议先做**：① L01 hidden `h1` 采样边界（判星公平性）；② 挑战层从说明卡升级为可玩会话；③ L09 取苹果改 `collect`/语义 API；④ 真人多背景盲测 + Fresh Reader Round 4；⑤ Linux 侧重新打包并复验字体/桌面壳。

## 1. 现在可直接跑的命令

```bash
# 质量门（typecheck / 单测 / 契约 / 内容 / 专项 gate）
npm ci
npm test                       # 28 files / 251 tests
npm run typecheck
bash scripts/verify.sh         # 默认 l0,l1,l2,l3,lg；exit 0

# Studio 验收（Playwright 自动起引擎与静态站；用系统 Chrome；Windows 可直接跑）
npm --prefix apps/studio run test:e2e        # 37/37（含 narrative-layout/typography/textbook-window/auto-beat/runtime-recovery）
npm --prefix apps/studio run test:e2e:local  # 4/4（mock 构建）
node scripts/check-copy.mjs --self-test     # 文案分类器 14/14

# 配套教材（10 章 Markdown → 结构化数据；--check 只校验）
npx tsx scripts/build-textbook.ts --write

# 真实 Paper（无头；同一服务端串行）
bash scripts/mc-up.sh
npx tsx it/l1-real.ts          # … l2 … l10 逐关串行
npx tsx it/engine-paper-regressions.ts   # 引擎 P0 回归（会话重入/L10 双织偶/bot 复用）
bash scripts/mc-reset.sh       # 单独测 world.reset
bash scripts/mc-down.sh

# 桌面 App / 重新打包（唯一入口；Linux 原生环境）
bash scripts/launch-desktop.sh
bash scripts/package-desktop.sh
```

## 2. 当前正在跑的进程

- **无必须常驻的进程**。手跑真实 e2e 时 Paper 用 `.tools/win/paper-host.mjs`（Windows）或 `scripts/mc-up.sh`（Linux）起，用完停掉。
- 端口约定：HTTP 引擎 `4317`（`PORT` 可覆盖）、Paper `25565`（本机开发用 `25567`，25565 曾被旧 Prograft 占用）、插件 RPC `8765`；Studio dev `5173`；真实 e2e 的 Studio/引擎用 `4399`/`5186`（跨平台 env 已在 playwright.config 配好）、mock 用 `5185`。
- 日志：`~/.loomcraft/logs/`（桌面/内置 Paper/引擎）、`it/.mc-server/console.log`（手跑 Paper）。


## 3. 下一轮优先级（按用户价值）

1. **L01 hidden `h1` 的 `agent.move` 采样边界**（`it/l1-real.ts` 负例 `l1.starter.report-equals-mock`：Mock 判 `h1` 过、真实 Paper 偶发不过，差 1 星；属判星公平性已知问题，需改成容差/事件顺序判定）。
2. **挑战层从说明卡升级为可玩会话**（当前所有关卡「挑战层」只是可阅读说明卡）。
3. **L09 语义化收尾**：内容侧「取金苹果」仍用旧写法 `place("air", chest)`（教材已标注为旧写法，代码侧建议改 `collect`/`deposit` 语义 API 并同步参考解/教程）。
4. **真人多背景盲测 + Fresh Reader Round 4**：目前玩家路径证据都是 AI 自动化（真实 Paper e2e + Studio e2e + UOS）；Fresh Reader 清零前不写「完成」。
5. **Linux 侧重新打包并复验**：本轮新增字体（Noto 子集）、教材内容、引擎/会话改动；需在原生 Linux 重新打包 AppImage/RPM，复验桌面壳字体/滚动/教材窗口（WebKitGTK）。
6. **文案后续批次**：L05–L10 引导与织典页文案继续覆盖（docs/22），按新政策「自然中文 + 必要英文术语」复核。
7. **`it/engine-paper.ts:191` 旧 testMode 断言**：仍按旧 testMode 逻辑断言，建议改成显式 `simulate`/confirm 语义（不属于本轮必修）。

## 4. 关键约束（所有 agent）

1. 不越 write scope；不改别人文件；**不要 git commit**（Lead 统一提交）；不改测试/断言变绿。
2. 版本锁：MC/Paper **26.1.2 build 74**、Java **25**、mineflayer **4.39.0**、minecraft-protocol 1.68.0、pathfinder 2.4.5、TS **6.0.3**、esbuild 0.28.2、Monaco 0.57.0。升级 = ADR + Lead 签字。
3. 学生 API 只能来自 `docs/12`；语法不越级；类型错误不阻断、语法错误阻断（Round 4 起：语法错误在执行前拦截，半截代码不执行）。
4. 文案遵守 `docs/20` §3/§3b/§3b4（无 AI 味、动词按钮、错误=哪里错+怎么改）：自然中文 + 必要英文计算机术语保留英文，概念统一「中文名（English term）」；UI 英文标签仍禁止。
5. 字体红线（Round 4）：代码 = Maple Mono；长段正文 = Noto Sans SC；短标题/按钮/标签 = 像素字体；不得把长文换回像素字，也不得把短标题按钮换成正文/代码字体（见 `docs/20` §3b4 + e2e/typography.spec.ts）。
6. 真实 e2e 同一 Paper 串行；GUI 自动化只用 `:98/:99`；改插件必须冷启动，不 `/reload`。
7. 事实/完成标准：命令 + exit 0 + 产物路径；`STATUS.md` 每个集成点更新；不要用「应该可以」代替证据。
8. **提交规范（2026-11-01 用户确认）**：任务完成并验证后由 Lead **直接提交到 `main`**（不再单开 fix 分支）；提交前过质量门（`tsc`、`npm test`、涉及面 e2e/验收）；**Windows 侧改动只能改善跨平台一致性，不得破坏 Linux 上建立的基线**（版本锁、真实 Paper e2e、AppImage/RPM 打包流程）；**完成一个阶段就及时 commit + push**。
9. 教材内容红线：`apps/studio/src/textbook/content/*.md` 的代码块只用该关及之前 API（`scripts/build-textbook.ts` 会校验 API 白名单/语法）；改 README/类型/校验器后须重跑 `npx tsx scripts/build-textbook.ts --write` 并提交 `library.generated.ts`。
10. 原生模块红线：C 工具是**可选**构建路径（无 cmake/编译器自动 SKIP）；不得让 `npm ci`/`npm test`/Tauri 打包强依赖 C 工具链；图标契约是「像素 + PNG 结构一致」，不是文件字节 hash。

## 5. 文档地图（新 agent 按需读）

- 当前事实源：`STATUS.md`（顶部 Round 4）、`docs/49-round4-teaching-ux-and-textbook-plan.md`（本轮契约/结果）、`docs/46-playtest-fix-plan.md`、`docs/48-round2-guidance-api-visual-plan.md`、`README.md`、`docs/41-ai-contributor-guide.md`。
- 本轮新增：教材写作规范 `apps/studio/src/textbook/README.md`；C++20 并行 e2e 执行器 `native/e2e-runner`（`docs/58`）。旧 C 图标生成器方案已废弃（`docs/60`），不存在 `docs/50-native-build-system.md`。
- 架构/契约：`docs/07-architecture.md`、`docs/21-t1-contracts.md`（T1 基线，2026-11-01 的 RPC/进度变更见 docs/46 §2）。
- 设计期历史（结论保留、当前实现以代码为准）：`docs/00`–`docs/18`、`docs/24`。
- 质量/流程：`docs/20`（§3b4 字体策略）、`docs/28`、`docs/29`、`docs/30`、`qa/README.md`。
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
