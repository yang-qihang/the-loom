# HANDOFF — 项目续跑快照（新 conversation / 新 agent 从这里开始）

> 更新时间：2026-10-31 13:05（Asia/Shanghai）｜当前 commit：见 `git log -1`
> 用户要求：**全权由 AI 推进整个项目；用户不参与测试/操作；必须美观、精致、coherent、层层递进、易用、文字清晰无 AI 味。**
> 本文件是「断点续跑」入口：新会话先读 `HANDOFF.md` → `AGENTS.md` → `docs/21-t1-contracts.md` → `STATUS.md`，然后跑 `npm run verify`。

## 0. 里程碑（2026-10-31 14:30 最终交付快照）

**最终交付快照**：L01–L09 可玩（Mock + Studio），L01–L04 真实 MC e2e 全绿；Engine paper 模式 L01–L04 34/34；Tauri AppImage/rpm 无浏览器；试符台/织典/序章/手记/纯中文完成；185 测试全绿；verify exit 0（lg warn：Fresh Reader tracked fail）。L10 为终局设计/预演，多织偶运行时未接；桌面包 engine 默认 Mock-only。Fresh Reader Round2 仍 10 blocker，Round3 复读进行中。

**T1 门禁通过（真实 Minecraft）**：Paper 26.1.2 上，织偶用参考解点亮 3 盏灯 → 插件 testMode 触发玩家节拍 → 评分 **PASSED / 3 星 / 隐藏测试全过**；starter 失败、缺玩家节拍失败；reset ≤2s 且两次 hash 一致；**真实评分与 MockWorld 逐项一致**（digest 相同）。证据：`evidence/l1-real-2026-10-31T05-14-40-618Z.json`。
Mock/Engine 侧：`npm test` 70 测试全绿；`bash scripts/verify.sh` l0–l3 全绿；Engine HTTP/SSE 全流程 3 星；Studio `vite build` 通过（Playwright mock e2e 待跑）。
安全加固：worker+vm 沙箱、world.vars deep-freeze、snapshot epoch/digest 绑定、guard-tests 已接入 verify l0（warn）。

## 1. 已完成（可运行）

- 设计交付包 v1.3：docs/00–21（审计/评审/架构/课程/关卡/美术/质量门/契约），13 份 level spec。
- 技术实证（真实 MC）：Paper 26.1.2 build74 + Java 25 + mineflayer 4.39.0；双通道 7/7；L10 铺桥 10/10；3 bot；actorType；Mannequin。
- **T1 代码基线**（commit `98964dd`）：
  - `packages/protocol`（zod：LevelMeta/WorldEvent/WorldSnapshot/RPC + ASYNC_SDK_METHODS）
  - `packages/sdk`（Golem/World 类型）
  - `packages/level-spec`（defineLevel/validateLevel/**L01 定义**）
  - `packages/grading`（g API/0–3 星/隐藏测试）
  - `packages/mockworld`（无 MC 确定性世界）
  - `packages/runner`（**顺序门面 auto-await AST 变换** + esbuild + 执行 + L01 e2e 测试 + `npm run demo:l01`）
  - `packages/worldport`（WorldPort/LevelContent/FxCue + MockWorldPort）
  - `content/levels/L01.content.ts`（场景 prepare/playerBeat 钩子）
  - 测试：**7/7 通过**；`npm run demo:l01` 输出 3 星/失败/缺玩家三种情形。
- `docs/20-quality-bar.md`（用户质量标准的可执行门禁）、`docs/21-t1-contracts.md`（并行契约）。

## 2. 当前正在跑的进程

- Paper 26.1.2 spike 服：`spikes/mc-bot-paper/server/`，Java 进程（`pgrep -ax java` 中含 `paper.jar`），端口 **25565**，日志 `server/console.log`，插件 `loom-spike-plugin-0.1.0.jar`（7/7 RPC 已验证）。
- 若需重启：见 `spikes/mc-bot-paper/README.md` / `docs/02`；先 `kill` 该 java PID，再 `nohup java -Xms1G -Xmx2G -jar paper.jar --nogui </dev/null >console.log 2>&1 &`。
- 无其他常驻进程；`incoming/other-plan/` 是对照方案（只读，已评审）。

## 3. 当前并行（T1 已过，T2/T3/T4 铺开）

- T2-MC（scout-minecraft，task-30）：L03/L04 13/13；L01 20/21（no-beat 对照差异）、L02 回归 8/13（收蛋映射/摘要与 Mock 不一致），MC 线修复中；PaperWorldPort 适配器待交 Engine。
- T3-TAURI（scout-language，task-31）+ T4-DESKTOP-REBUILD（task-54）：**完成**（AppImage 120MB/rpm 18MB、Xvfb/X11、置顶/伴玩、无浏览器、纯中文、v3.1/试符台/织典）。**桌面包 engine 默认 Mock-only**；真实 Paper 用 `npm run dev:engine:paper`。
- T3-ENGINE-PAPER（scout-minecraft，task-49）：**完成**（`LOOM_WORLD=paper`，真实 server/bot/engine 四关 34/34，3 星）。
- T3-EXPLICIT/L09（task-51/52）：**完成**（显式 await；L09 14/14，185 测试）。
- T3-CODEX/REPL UI（task-47/36）：**完成**（Studio e2e 5/5，截图 14–18）。
- Fresh Reader Round 1（docs/31）：FAIL（11 blocker/20 major）；task-41 文案 v3.1、task-42 内容、task-43 Studio UI 修复中；task-44 Round 2 复读待跑。
- T2-STUDIO（scout-prior-art，task-26）：真实 Engine 联调 + 纯中文 UI + L01–L04 关卡墙。
- T2-CONTENT（smith-act1，task-27）：L02–L04 挑战层/体量/叙事。
- T2-COPY v3（scout-pedagogy，task-32）：**已完成**（328 条纯中文；序章 8 屏/三幕开场/每关三句/手记；25/25 盲读）。Studio 需接 prologue/journal（task-38）。
- T2-SPEC（smith-act2/act3，task-33/34）：**已完成**（L05–L10 全部 ≥50/60 行、2–3 阶段、挑战层）。
- T3-ACT2/ACT3（smith-act2/act3，task-45/46）：L05–L08 MockWorld 内容实现进行中。
- T3-TAURI（scout-language，task-31）：Tauri 2 桌面封装 spike（不许浏览器）。
- QA（scout-assurance，已交付）：pure-zh lint + verify 分层；待内容线齐后升 `--strict-copy`。

## 3b. 下一步（T2：Act I 全可玩 + Studio live）

1) Studio ↔ Engine live 联调（HttpEngine + copy JSON + 截图/UX 走查）→ 浏览器里真实可玩 L01。
2) 真实 MC 的 L02–L04 场景（插件 SceneManager 按 content 的 vars/regions 摆放）+ 真实 e2e；MockWorld 与真实 digest 对齐。
3) 美术 pass：L01–L04 的 palette/机位/道具密度（docs/19）+ 3 张截图/关。
4) 文案：L01–L04 回写已完成（docs/22），L05–L10 下一批。
5) Act II 内容：先扩 SDK（fill/clear/placeSign、容器、plot），再 L05–L07 content。
6) 最终：demo 录像/报告更新/彩排。

## 3b. 原并行工作流（已完成/收尾）

| 线 | owner | 目标 |
|---|---|---|
| MC 插件+织偶 | scout-minecraft | `plugin/` 正式插件（T1 RPC 子集）+ `bot/` 管理器 + `scripts/mc-up.sh` + 真实 L01 场景/重置 + 无头 e2e |
| Engine | scout-language | `apps/engine/` HTTP+SSE、`packages/session/` 会话状态机、WorldPort 适配、Mock 验收 |
| Studio | scout-prior-art | `apps/studio/` Vite+React+Monaco：关卡选择/编辑器/目标/教练/Run/Stop/Reset |
| 内容 | smith-act1 | `content/levels/L02–L04.content.ts` + MockWorld 场景/断言 |
| QA | scout-assurance | `qa/` 盲测/红队、契约测试、verify 扩展、证据 JSON |
| Lead | — | 契约/评审/集成/真实 L1 联调/报告/美术 |

## 4. 关键约束（所有 agent）

1. 不越 write scope；不改别人文件；**不要 git commit**（Lead 统一提交）。
2. 所有完成必须附证据：命令 + exit 0 + 产物路径。
3. 版本锁：MC/Paper 26.1.2、Java 25、mineflayer 4.39.0、TS 6.0.3、esbuild 0.28.2、Monaco 0.57.0。
4. 学生 API 只能来自 `docs/12`；语法不越级；类型错误不阻断、语法错误阻断。
5. 文案遵守 `docs/20` §3（无 AI 味、动词按钮、错误=哪里错+怎么改）。
6. 用户不测试：所有验收必须自动化；人工只做最终看截图/彩排（Lead 代看）。

## 5. 验证命令

```bash
npm run typecheck
npm test
npm run demo:l01
npm run verify        # typecheck + test
```

## 6. 已知待修（下一轮）

- `packages/worldport` 的 MockWorldPort 命名冲突（private world vs getter world）需修（若已修则忽略）。
- `content/levels/L01.content.ts` 的 prepare 目前只做最小场景；真实 MC 版等插件 RPC。
- 尚未有 `apps/engine` / `apps/studio` / 正式 `plugin/` / `bot/` 代码（本轮起由各 owner 建）。
- `docs/20` 的文案检查脚本与 `docs/19` 美术机位尚未落地。

## 7. 新会话续跑建议

1. 读本文件 + `STATUS.md` 最新段 + `docs/21`。
2. `git log --oneline -5` 确认 commit；`npm run verify` 确认绿。
3. 用 `team_task_list` 看并行任务；用 `list_agents` 看谁在跑；不要重复它们的文件。
4. 优先做：集成各线 → 真实 L1 无头 e2e → Studio UI 可玩 → 复制 L02–L04 → 美术/文案/报告。
