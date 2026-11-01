# evidence/ — T2 MC 线（task-30）证据

> 历史说明（2026-11-01 文档审计）：本文件是 T2 阶段（L01–L04）的证据索引；当前真实 e2e 已覆盖 L01–L10，见 `it/README.md` 与 `evidence/l*-real-latest.json`。

> 最后更新：2026-10-31｜负责人：scout-minecraft
> 复现命令见 `it/README.md`；动作映射见 `it/action-mapping.md`；实现见 `packages/worldport/src/paper-port.ts`、`plugin/README.md`。

## 最终验收（2026-10-31，四条真实 e2e 全绿）

| 关卡 | latest 证据 | check | 结果 |
|---|---|---|---|
| L01 | `l1-real-latest.json` | **21/21** | reference 3 星、failures=[]；starter/无节拍对照均与 Mock 报告/digest 一致；reset 稳定 |
| L02 | `l2-real-latest.json` | **13/13** | 3 星；six-collected / hatch-intact / report-at-eira 与 Mock 一致；digest 一致；reset 稳定 |
| L03 | `l3-real-latest.json` | **13/13** | 3 星；剧本/守夜/晨钟与 Mock 一致；reset 稳定 |
| L04 | `l4-real-latest.json` | **13/13** | 3 星；124 次放置、水渠/防重复/只动田内与 Mock 一致；reset 稳定 |

共性检查：`plugin.health`、`scene-ready`（推导出的 arena/tracked/agent/npc）、`stale-session-rejected`（REQ-EPOCH）、
`epoch-incremented`、`passed/stars-3/failures-empty`、`report-equals-mock`、`digest-equals-mock`、
`reset-under-2s`、`reset-hash-stable`（REQ-RESET-01）、`reset-clears-events`。

关键数字：L01 reference 12.2s / 21 checks；L02 23.4s / 13；L03 57s / 13；L04 31s / 13。
prepare 1.5–2.9s；reset 1–40ms；sessionId/epoch 每次 prepare 递增且旧 sessionId 被拒。

## 文件

| 文件 | 内容 |
|---|---|
| `l1-real-latest.json` / `l1-real-<UTC>.json` | L01 主 + starter/无节拍对照的完整结构化证据 |
| `l2-real-latest.json` / `l3-real-latest.json` / `l4-real-latest.json` | 各关最近一次 PASS 的完整证据 |
| `l*-real-snapshot-<UTC>.json` | 真实服 `world.snapshot`（评分真值） |
| `l*-real-latest.log` | 最近一次 e2e stdout（含 CHECK 行） |
| `l1-scenario-starter-snapshot.json` / `l1-scenario-no-beat-snapshot.json` | L01 两个失败对照的真实快照 |
| `l1-real-plugin-build.log` / `l1-real-verify.log` | 插件 clean build / `npm run verify` 日志（T1 起的持续证据） |

> 调试期失败证据已清理（git 历史可找回）。`evidence/` 由各线共用，不要删除别人（如 `task-25-security.md`）的文件。
