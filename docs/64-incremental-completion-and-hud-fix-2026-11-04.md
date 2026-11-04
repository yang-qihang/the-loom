# 64 — 分次运行自动结算、坐标标题避让与真实 REPL

> 状态：修复、回归与 Linux 打包完成｜负责人：Codex / 独立 Reviewer｜最后更新：2026-11-04
> 上游：用户反馈 L01 分次补完代码后目标全勾选但不结算；全屏坐标框与标题重叠；docs/46、docs/48、docs/61、docs/63。
> 追加反馈：REPL 显示「照做了」，Minecraft 的灰崽却不动；用户明确要求修复真实动作接线。

## 1. Write scope

`apps/studio/src/components/{Workbench,PositionHud}.tsx`、`apps/studio/src/engine/httpEngine.ts`、`apps/studio/src/styles.css`；必要时 `packages/session/src/session.ts`、`apps/engine/src/server.ts`；`bot/manager.mjs`、`apps/engine/src/bot-arrival.test.ts`（独立 Reviewer 发现并确认真实移动完成判定与评分距离不一致，纳入本轮修复）；`apps/studio/e2e/{auto-beat,desktop-ui-regressions}.spec.ts`、`packages/session/src/incremental-completion.test.ts`；README.md、STATUS.md、本文件；`evidence/incremental-fix/*`。

不修改冻结测试、版本锁、关卡评分条件或学生 API。先用真实引擎回归定位分次运行问题，修复完成后保留复现、测试与打包证据。

REPL 追加 scope：`apps/studio/src/components/ReplScreen.tsx`、`apps/studio/src/copy/catalog.json`、`packages/runner/src/repl.ts`、`packages/session/src/session.ts`、`apps/engine/src/{server.ts,live-repl.test.ts}`、`apps/studio/src/engine/httpEngine.ts`、`apps/studio/e2e/repl.spec.ts`；`docs/{11-decisions-and-open-questions,27-repl-rune-bench}.md`。新增契约将记录为 ADR：真实模式 UI 明确请求 live REPL，复用当前关卡会话和物理灰崽，不另建影子世界、不清掉当前关卡；无关卡时创建独立真实试符台。未显式请求 live 的旧接口与本地演示保持兼容。

## 2. 复现与根因

### 分次运行后不能结算

用户已确认第二次是保留原代码、补齐后整段运行。普通 Mock 世界的六行三灯 → 补回程七行对照原本可以通过；问题不能归结为「分次运行一律不支持」。

真实 bot 原 `moveTo` 允许距目标方块中心 ≤2.4 格直接返回，而快照和 `agent.mark` 使用真实位置的 floor 坐标。例如目标 (-12,10)，实际 (-9.9,12.1) 到中心为 2.26，但采样方块 (-10,12) 距灯为 2.83。评分要求放置前有 2 格内到达证据，首轮放置由此留下隐藏失败。三灯完成后 playerBeatReady=true，后续运行保留世界和玩家进度，旧放置的失败不能靠后来的走路补到其 seq 之前；于是三个目标勾选，但评分仍未过。

修复：提前返回和每条寻路成功出口统一验证真实方块位置 ≤2 格；回退寻路也必须满足该后置条件。没有改评分、伪造到达坐标或清掉玩家的第四盏灯。新测试用 production GolemBot + GameSession + 原关卡规则，将旧逻辑稳定复现为「目标全过、隐藏失败」；换回 HEAD 原版 bot 的同一测试为 3 FAIL / 1 PASS，修复后 4 PASS。真服修复前没有稳定复现原始结算问题，不以 Mock 证据冒充真服基线。

### 坐标与标题重叠

`.card-head h3` 绝对居中，右侧坐标/操作组没有为其留位。HUD 标题回到正常布局，标题与坐标/按钮分行；操作组可换行，坐标沿用 Maple Mono。1920、1440、1024 宽度均检查元素交集，并保留截图。

### REPL 显示成功但不动

原 Paper 模式创建 REPL 时实际选用 MockWorldPort。修复前对真实引擎发 live 请求，返回端口为 mock，动作报告成功而原关卡真实坐标保持 (1,11,5)；证据 `repl-before.json`。

按 docs/11 D47，Studio 显式请求 live；Paper 下挂接当前同关卡真实会话，没有活跃世界则创建真实试符台。保留当前世界/epoch/源码；不直接评分，不另建影子世界。不同关卡拒绝误挂接，换关后旧会话失效。UI 明示真实动作改变现场，恢复现场会重置本关；工作台随 reset 清除旧结算。旧客户端未请求 live 的内存隔离接口、本地演示保持兼容。

执行期间与程序/玩家确认互斥；reset/stop/dispose 撤销 worker，过期结果不写历史。简单参数的裸 SDK 动作允许等待 60 秒，循环、复杂参数求值仍保留 3 秒预算；HTTP 等待长于动作预算。共享会话的 REPL reset 在发请求前撤销旧 run token，旧 HTTP 202 不能刷新旧结果。

## 3. 验证

- 单测：32 files / 272 PASS，含 4 个 bot 到达/完整分次流程、5 个真实 REPL 接线/排他/取消/超时回归。
- 浏览器：主配置完整 62 PASS；新增 live 请求和 REPL reset 晚确认回归后定向 13 PASS；本地演示 7 PASS。后续源变更只跑对应定向回归，没有把多次运行伪写成一次完整矩阵。
- 真服结算：独立 Paper 26.1.2 build 74 / RPC 8869 / game 25619 + 真实 bot + source engine + headless Chrome；六行点灯 → 模拟真人第四盏 → 补回程整段运行，自动出现结算，epoch 仍为 0，三个目标全过。真人步骤由测试接口模拟，不冒充人手 GUI 验收。
- 真服 REPL：同一关卡会话，`golem.moveTo(lamp2)` 实际由 (0,11,0) 到 (-11,11,-1)，耗时 3080ms；读取坐标一致，原代码保留，移动不改 epoch；恢复现场后 epoch 0→1、位置回初始且无旧结算。`repl-paper-ui-summary.json` 与 `repl-real-move.png`。
- 跨关卡回归：隔离 Paper 上 `it/l10-real.ts` PASS，双织偶搭桥与第三个玩家实体放合龙石正常、3 星、无 virtual fallback、评分/digest 与 Mock 一致、reset hash 稳定；检查共用移动适配器没有破坏第十关。见 `l10-cross-level.log`、`l10-real.json`。
- 全量质量门：`verify-reports/20261104T043715Z-incremental-live-repl-final.log` exit 0；l0/l1/l2/l3 PASS，lg 仅既有 G-FRESH-READER 告警。报告里的 commit 为工作树验证前基线 418fdb5。
- 独立 Reviewer 抽跑并检查真实端口、取消、晚确认和动作参数循环；指出的两项边界已修复并复核。

### 保留的失败与测量修正

首轮单测因互斥守卫误把已发布结果、尚在 finally 的 run 也视为玩家确认忙碌而失败；已改为独立 beat token，保留原失败日志，原断言不变。类型检查捕获了 paper/paper+bot 类型拼写，已修正。

浏览器首次最终定向 12 PASS / 1 FAIL 是旧时间采样器误差：同一次同步 DOM 采样先读结算时间再读目标时间，产生 1817.6 / 1817.7ms 的假先后。独立 Reviewer 复现后，统一同次采样时间戳，25ms 频率与全部断言不变。证据只能说明「目标不晚于结算首次被采样观察到」，不能证明采样间隔内部的精确顺序。未给产品额外加延迟，也未放宽断言。

## 4. 边界与交付

Windows 原生 GUI 未在本机实测；已验证 Chromium 与真实 Paper/物理 bot。撤销 worker 不保证已发出的原生 bot 动作立即停止，不能把历史/结果撤销测试夸大为物理动作已取消。

Linux 运行时与 release 重建成功，AppImage 522.52 MiB、RPM 452.79 MiB，SHA-256 见 `package-sha256.txt`。保留既有 Rust/Java 编译警告。浏览器测试与正式桌面构建共用 Studio 输出目录，最终已顺序执行，避免测试构建混入正式资源。自动测试生成的旧 evidence 目录产物不纳入本轮；用户未跟踪的 slides/ 保留。

复现到达判定旧缺陷：`node evidence/incremental-fix/reproduce-arrival-baseline.mjs`（预期 exit 1，3 FAIL / 1 PASS）；它只在临时目录装配原版 bot 与相同测试，产品文件不回退。修复版使用 `npx vitest run apps/engine/src/bot-arrival.test.ts`（4 PASS）。真服脚本须连接专用隔离栈，默认端口见各脚本头；不要对正在试玩的世界运行。
