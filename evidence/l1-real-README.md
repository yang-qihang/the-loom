# evidence/ — MC 线（task-19）证据

> 最后更新：2026-10-31｜负责人：scout-minecraft
> 复现命令见 `it/README.md`；实现见 `plugin/README.md`、`bot/README.md`。

## 最终验收结果（两次连续 PASS，2026-10-31）

| 检查 | 结果 |
|---|---|
| 插件构建（clean build） | ✅ `BUILD SUCCESSFUL`（`l1-real-plugin-build.log`） |
| `npm run verify`（l0–l3） | ✅ VERIFY OK（`l1-real-verify.log`） |
| 真实 L01 reference：passed / 3 星 / failures=[] | ✅ 与 MockWorld 报告逐字段一致 |
| 真实 L01 starter 对照：not passed + failures | ✅ 与 MockWorld 一致（2 星） |
| 真实 L01 无玩家节拍对照：not passed、`player-lit-fourth=false` | ✅ 与 MockWorld 一致（1 星） |
| REQ-RESET-01：两次 reset 插件 hash 相同 | ✅ `sha256:77fd1f81…fe02`，3–7ms/次 |
| 连续两次完整 e2e | ✅ PASS, PASS（无重复登录） |

关键数字（`l1-real-latest.json`，最终一次 `2026-10-31T05-24-03Z` 起跑）：prepare 1.25–2.4s（含建场景+传实体，重启后首测偏慢）；reference 全流程约 11.8–12.1s（3 次寻路+3 次放置+回程+玩家节拍）；reset 4–8ms，checkpoint hash 稳定为 `sha256:218eb05d…3f0c`（hash 只覆盖场景定义，不随 bot 在线/离线变化，`mc-reset.sh` 与 e2e 内两次 reset 一致）。bot 名每次唯一（`Golem<pid后4位>`）避免共用 dev server 时 "logged in from another location" 踢线。

## 文件

| 文件 | 内容 |
|---|---|
| `l1-real-latest.json` | 最近一次 PASS 的完整结构化证据（21 项 check、三份 report、reset hash、动作时间线） |
| `l1-real-<UTC>.json` | 每次运行的完整证据（保留最近两次 PASS） |
| `l1-real-snapshot-<UTC>.json` | 真实服 `world.snapshot` 原始快照（评分真值输入；保留最近两次 PASS） |
| `l1-real-run1.log` / `l1-real-run2.log` / `l1-real-run3.log` | 三次完整 PASS e2e 的 stdout（含 CHECK 行；run3 与 `l1-real-latest.log` 同内容） |
| `l1-real-plugin-build.log` | `./gradlew clean build` 日志 |
| `l1-real-verify.log` | `npm run verify` 日志 |

> 说明：调试期间的失败运行证据已清理；如需要可从 Lead 的提交历史找回。证据文件由各线共用 `evidence/`，不要删除别人（如 `task-25-security.md`）的文件。
