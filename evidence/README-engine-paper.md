# evidence/ — T3 Engine + PaperWorldPort 真实 MC 证据（task-49）
> 历史说明（2026-11-01 文档审计）：`it:engine-paper` 默认仍是 L01–L04 的 HTTP/SSE 冒烟；全关卡真实 e2e 见 `evidence/l*-real-latest.json` 与 `docs/46-playtest-fix-plan.md` §5。

> 最后更新：2026-10-31｜负责人：scout-minecraft
> 复现：`npm run it:engine-paper`（脚本会先 `scripts/mc-up.sh` 确保 Paper 在跑；证据写到本目录）

## 最终结果（2026-10-31）

| 项 | 结果 |
|---|---|
| `LOOM_WORLD=paper` 启动 Engine | ✅ 等插件 RPC + 织偶 bot 进服后 ready（中文错误路径另测） |
| `/api/health` | ✅ `port:"paper"`、`mc:{kind:"paper",connected:true,version:"26.1.2",pluginVersion:"0.1.0",tick,prepared,sessionId,epoch}`、`bot:{name:"Golem",connected:true}` |
| L01 HTTP 全流程 | ✅ session → run reference（SSE result）→ player-beat → **3 星 / passed / failures=[]** → reset（READY） |
| L02 / L03 / L04 HTTP 全流程 | ✅ 同上，四关全部 player-beat 后 3 星 |
| 失败路径 | ✅ `LOOM_WORLD=paper` 连不上 MC 时启动抛 `WorldUnavailableError`（中文「真实 MC 未就绪…」+ 排查 hint），`/api/health` 报 `ok:false, port:"paper"`，**不静默降级成 mock** |

关键数字：Engine paper 启动 ~1.8s（server 已就绪时）；L01 28.6s / L02 25.4s / L03 59.2s / L04 36.0s 全流程（含 prepare/参考解/player-beat/reset）。
参考解在 player-beat 前不是满分（L01 1 星、L03 1 星等，符合「第 4 盏灯/晨钟必须玩家亲手」的设计）；player-beat 后四关均 3 星。

## 文件

| 文件 | 内容 |
|---|---|
| `engine-paper-latest.json` | 最近一次完整证据：34 项 check、四关每关的 session/run/beat/reset 结果、health 快照、失败路径 |
| `engine-paper-<UTC>.json` | 同上，按运行时间归档 |
| `engine-paper-latest.log` | 最近一次运行的 stdout（含 CHECK/RESULT 行） |

## 备注

- 真实 MC 单世界/单 bot：paper 模式下 `POST /api/session` 会自动 dispose 旧会话，避免场景互相污染。
- `it:engine-paper` 用随机端口起 engine，不与 Studio/其它 engine 的 4317 冲突；`dev:engine:paper` 默认 4317，被占用时会报中文提示（可 `PORT=4318`）。
- 本证据只做协议/状态级验收；视觉观感仍需真 MC 客户端（Lead 集成阶段）。
