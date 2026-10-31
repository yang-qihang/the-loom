# it/ — 真实 MC 集成验收（T1 L01 + T2 L02–L04）

> 状态：T2 实现｜负责人：scout-minecraft｜最后更新：2026-10-31
> 上游：`docs/21-t1-contracts.md` §8、`docs/02c-finale-spike.md`、`packages/worldport/src/paper-port.ts`、`it/action-mapping.md`

## 一条命令跑完（无头，无需 MC 客户端）

```bash
cd <repo-root>
bash scripts/mc-up.sh          # 起 Paper 26.1.2（首次下载 jar + sha256 校验），等 Done + 25565/8765
for L in l1 l2 l3 l4; do npx tsx it/$L-real.ts || break; done   # 四条真实 e2e；exit 0 = 全绿
bash scripts/mc-reset.sh       # 单独测 world.reset（打印 hash/ms）
bash scripts/mc-down.sh        # 停服
```

`it/.mc-server/` 是运行时数据目录（world、paper.jar、console.log、pid），已 gitignore；`MC_DATA_DIR` 可覆盖。
服务端日志：`it/.mc-server/console.log`；RPC：`ws://127.0.0.1:8765`。

## 四个 e2e 的检查项

每个 e2e 跑同一套骨架（`it/real-harness.ts`）：连接织偶 bot → `session.begin` → `content.prepare` →
`session.finalize`（场景由 def vars + prepare 调用推导）→ **同一份 referenceSolution 经同一 runner 变换** →
testMode `playerBeat` → `world.snapshot` → production grader → 与 MockWorldPort 的 report/digest 对比 →
REQ-EPOCH（stale session 拒绝 + epoch 递增）→ REQ-RESET-01（两次 reset hash 相同、≤2s、事件清空）。

| 文件 | 关卡 | 附加检查 |
|---|---|---|
| `it/l1-real.ts` | L01 | starter 必失败、无玩家节拍必失败，二者与 Mock 报告/digest 同时对比（共 21 项 check） |
| `it/l2-real.ts` | L02 | 13 项 check（收蛋/倒蛋/报数/孵蛋窝 + Mock 一致 + reset） |
| `it/l3-real.ts` | L03 | 13 项 check（剧本/守夜/玩家晨钟 + Mock 一致 + reset） |
| `it/l4-real.ts` | L04 | 13 项 check（收残株/种田/水渠/回谷仓 + Mock 一致 + reset） |

`WorldPort` 实现（含场景推导、虚拟块、reset、sessionId 校验）已提取到
`packages/worldport/src/paper-port.ts`，engine 直接 `new PaperWorldPort({ rpc, bot, def, scene? })` 注入即可；
rpc 客户端可用同文件的 `WsJsonRpcClient.connect()`。动作映射见 `it/action-mapping.md`。

## 证据

每次运行写 `evidence/<name>-real-<UTC>.json` + `evidence/<name>-real-latest.json` + `evidence/<name>-real-snapshot-<UTC>.json`；
stdout 日志 `evidence/<name>-real-latest.log`。汇总说明见 `evidence/README-t2-mc.md`。

## 已知限制

- 无 MC 客户端：只做协议/状态级验证；视觉观感（皮肤、粒子、UI）需在有客户端的环境另测（见 `docs/02b` U 列表）。
- 玩家节拍用插件 testMode 模拟（`actorType=player`，`actor="player"`）；真人客户端联调由 Lead 在集成阶段做。
- 逻辑平面（L04 田块）目前只存在于 snapshot 逻辑层，物理上田块不可见（headless 不影响；视觉改造见 `it/action-mapping.md` §3）。
- Mock 对比是「评分相关投影」相等（report + agent 放置序列 + say 文本 + Mock 已知方块键），不比较完整世界差分。
- `it/debug-scene.ts` 是 L01 场景/寻路调试工具；其余一次性 debug 脚本已清理。
