# it/ — 真实 MC 集成验收（L01–L10 + 引擎/玩家路径）

> 状态：已交付（L01–L10 真实 Paper 全 PASS；2026-11-01 增加试玩修复验收）｜负责人：scout-minecraft / verifier｜最后更新：2026-11-01
> 上游：`docs/21-t1-contracts.md` §8、`docs/46-playtest-fix-plan.md` §4、`packages/worldport/src/paper-port.ts`、`it/action-mapping.md`

## 一条命令跑完（无头，无需 MC 客户端）

```bash
cd <repo-root>
bash scripts/mc-up.sh          # 起 Paper 26.1.2（首次下载 jar + sha256 校验），等 Done + 25565/8765
for L in 1 2 3 4 5 6 7 8 9 10; do npx tsx it/l$L-real.ts || break; done   # 串行；exit 0 = 全绿
bash scripts/mc-reset.sh       # 单独测 world.reset（打印 hash/ms）
bash scripts/mc-down.sh        # 停服
```

`it/.mc-server/` 是运行时数据目录（world、paper.jar、console.log、pid），已 gitignore；`MC_DATA_DIR` 可覆盖。
服务端日志：`it/.mc-server/console.log`；RPC：`ws://127.0.0.1:8765`。
**真实 e2e 必须串行**（同一个 Paper 同时跑两个会 `STALE_SESSION`）；换端口时用 `MC_PORT` / `MC_RPC_PORT`（verifier 用 25566/8766 与主环境隔离）。

## 每关 e2e 的检查项

每个 e2e 跑同一套骨架（`it/real-harness.ts`）：连接织偶 bot → `session.begin` → `content.prepare`/`afterPrepare` →
`session.finalize`（场景由 def vars + prepare 调用推导）→ **同一份 referenceSolution 经同一 runner 变换** →
`playerBeat.arm` + `playerBeat.activate` + 玩家节拍 → `world.snapshot` → production grader → 与 MockWorldPort 的 report/digest 对比 →
REQ-EPOCH（stale session 拒绝 + epoch 递增）→ REQ-RESET-01（两次 reset hash 相同、稳定、事件清空）。

| 文件 | 关卡 | 检查数（最新证据） | 附加检查 |
|---|---|---|---|
| `it/l1-real.ts` | L01 | 21 | starter 必失败、无玩家节拍必失败、`reset-hash-stable`、与 Mock 报告/digest 对比 |
| `it/l2-real.ts`–`l9-real.ts` | L02–L09 | 各 13 | 各关评分与 Mock 一致、reset 稳定 |
| `it/l10-real.ts` | L10 | 19 | 双织偶邮箱握手 + 合龙石玩家节拍 + 多 bot 评分 |
| `it/l10-studio.ts` | L10 | 11 | Studio 会话注入（多 agent SDK）真实引擎链路 |
| `it/engine-paper.ts` | L01–L04 | 34 | 引擎 HTTP/SSE 真实 MC 冒烟（`LOOM_LEVELS` 可覆盖） |

最新结果：`evidence/l1-real-latest.json` … `l10-real-latest.json`、`l10-studio-latest.json`、`engine-paper-latest.json` 全部 `ok:true`。

## 其它验收脚本

- `it/playtest-fix/`：2026-11-01 试玩修复的独立验收（基线复现 + 修复后全流程/全关卡可达性/reset/纯净 sandbox）；报告 `evidence/playtest-fix/report.md`。
- `it/acceptance-user-l01.mjs` / `acceptance-user-l01-physical.mjs`：玩家视角（真实操作路径）L01 验收。
- `it/reset.mjs`：单独驱动 `world.reset` 并打印 hash/耗时；`scripts/mc-reset.sh` 调用它。
- `it/mc-ready.mjs`：等 Paper RPC 就绪（`scripts/engine-paper.sh` 用）。
- `it/debug-scene.ts`：L01 场景/寻路调试工具。

`WorldPort` 实现（含场景推导、虚拟块、reset、sessionId 校验）在 `packages/worldport/src/paper-port.ts`，
engine 直接 `new PaperWorldPort({ rpc, bot, def, scene? })` 注入；rpc 客户端用同文件的 `WsJsonRpcClient.connect()`。动作映射见 `it/action-mapping.md`。

## 证据

每次运行写 `evidence/<name>-real-<UTC>.json` + `evidence/<name>-real-latest.json` + `evidence/<name>-real-snapshot-<UTC>.json`；
stdout 日志 `evidence/<name>-real-latest.log`。汇总说明见 `evidence/README-t2-mc.md`、`evidence/README-engine-paper.md`。

## 已知限制

- 无 MC 客户端：只做协议/状态级验证；视觉观感需真实客户端（见 `docs/34`）。
- 玩家节拍：`it/l*-real.ts` 用插件 `playerBeat.arm/activate` + 模拟玩家右键（`actorType=player`）；真人客户端联调由 Lead/verifier 在隔离 X 环境做（`it/acceptance-user-*`、`evidence/playtest-fix/`）。
- 已知两项真实玩家体验遗留（不影响机制验收）：L03 玩家出生点在钟楼结构内、L02 蛋糕目标格被塔基占用；详见 `evidence/playtest-fix/report.md` §4。
- Mock 对比是「评分相关投影」相等（report + agent 放置序列 + say 文本 + Mock 已知方块键），不比较完整世界差分。
