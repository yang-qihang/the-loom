# apps/engine — Loomcraft Engine

Node 22 HTTP + SSE 服务，桥接 Studio/桌面 App 与 `WorldPort`。两种世界端口由 `LOOM_WORLD` 选择：

- `mock`（默认）：`MockWorldPort`，无 MC 也能全流程验收（CI/日更门禁用这个）。
- `paper`（已接入真实 Paper 26.1.2）：`PaperWorldPort` + `GolemBot`，在真实 Paper 里跑 L01–L10（Studio 选关→运行→3 星→重置）；全关卡真实 e2e 见 `it/l1-real.ts`…`it/l10-real.ts`。
  实现：`apps/engine/src/world.ts`（端口工厂/就绪等待/中文错误）+ `packages/worldport/src/paper-port.ts`（MC 线提供）。

## 命令

```bash
npm run dev:engine          # mock 模式，启动 127.0.0.1:4317
PORT=4400 npm run dev:engine  # 换端口（HOST 可覆盖绑定地址）

npm run dev:engine:paper     # 真实 MC 模式：自动 mc-up → 等插件 RPC → 起 engine（LOOM_WORLD=paper）
npm run it:engine-paper      # 真实 MC 集成测试：HTTP/SSE 默认跑 L01–L04（LOOM_LEVELS 可覆盖），输出 evidence/engine-paper-latest.json
PORT=4318 npm run dev:engine:paper   # 4317 已被其它 engine/Studio 占用时换端口
npm test                     # 单测 + 本服务的 HTTP/SSE 集成测试（mock，不依赖 MC）
curl 127.0.0.1:4317/api/health
```

## 真实 MC 模式（`LOOM_WORLD=paper`）

启动链路：`scripts/engine-paper.sh` → `scripts/mc-up.sh`（幂等，Paper 拉起/复用）→ 等插件服务通道
`ws://127.0.0.1:8765` 健康 → `LOOM_WORLD=paper` 起 engine。engine 启动时还会：等 RPC → 让织偶 bot 进服；
任一步失败都会抛**中文错误并退出**（不静默降级成 mock）。

| 环境变量 | 默认 | 说明 |
|---|---|---|
| `LOOM_WORLD` | `mock` | `mock` / `paper`；其他值直接报中文错误 |
| `LOOM_RPC_URL` | `ws://127.0.0.1:8765` | 插件服务通道 |
| `LOOM_MC_HOST` / `LOOM_MC_PORT` | `127.0.0.1` / `25565` | 织偶 bot 连的 MC 地址 |
| `LOOM_BOT_NAME` | `Golem` | 织偶玩家名（offline 模式） |
| `LOOM_MC_WAIT_MS` | `30000` | 启动时最多等 MC 就绪多久 |
| `LOOM_RUN_TIMEOUT_MS` | `240000` | paper 模式下学生程序运行超时（参考解 L03 约 60s；mock 仍为 3000ms） |
| `PORT` / `HOST` | `4317` / `127.0.0.1` | HTTP/SSE 绑定 |

**`/api/health`（paper）** 返回：
`{ ok, port:"paper", mc:{kind:"paper",connected,version:"26.1.2",pluginVersion,tick,prepared,sessionId,epoch}, bot:{name,connected}, sessions, uptimeSec, version }`；
连不上 MC 时 `ok:false` + 中文 `error`/`hint`（仍报 `port:"paper"`，不会伪装成 mock）。

**会话约束**：真实 MC 同一时间只有一个世界/一只织偶——`POST /api/session` 在 paper 模式下会先释放旧会话
（自动 `dispose`），避免两个场景互相污染；`/api/player-beat` 用插件 testMode 模拟玩家节拍（`actorType=player`），
Studio/桌面 App 无需真客户端即可验收；真人演示时同一端点可由真人右键替代。

**失败排查**（错误消息里带同样提示）：① `npm run mc:up` 并确认 `it/.mc-server/console.log` 出现 `Done (`、
`LoomCraft ... RPC listening on ws://127.0.0.1:8765`；② 端口被旧进程占用先 `npm run mc:down`；
③ bot 进不了服检查 Paper 的 `online-mode=false` + `enforce-secure-profile=false` 与同名 bot 残留。

## API（docs/21 §3）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | `{ ok, port, mc, bot?, version, sessions, uptimeSec }`；`port` = `mock` / `paper`（paper 附带插件与 bot 状态） |
| GET | `/api/levels` | `{ levels: [{ id, title, act, order, priority }] }` |
| GET | `/api/levels/:id` | `{ def, starterCode, progress: [{id,text,player}] }`（progress 是目标的唯一真值，见 docs/46 §2.3） |
| POST | `/api/session` | `{ levelId }` → `{ sessionId, state, epoch, port, snapshot }` |
| POST | `/api/run` | `{ sessionId, source, commandId? }` → `{ runId, state }`（202，结果走 SSE） |
| POST | `/api/stop` | `{ sessionId }` → `{ ok, state }`（撤销 capability，之后必须 reset） |
| POST | `/api/reset` | `{ sessionId }` → `{ ok, state, epoch, snapshot }` |
| POST | `/api/player-beat` | `{ sessionId, simulate? }` → `{ ok, simulate, state, result }`。默认 `simulate` 由运行时决定：`mock` 自动模拟玩家节拍，`paper` 为 confirm-only（只按真实世界状态评分，不代玩家落块）。等待门控见 `result.playerBeatReady` |
| POST | `/api/repl` | `{ sessionId, line }` → `{ ok, kind, display, log, error?, line? }`；一次一行、自动 await（docs/27） |
| GET | `/api/repl/history?sessionId=` | `{ entries: [{ line, kind, display, at }] }`（执行顺序；仅内存） |
| POST | `/api/repl/reset` | `{ sessionId }` → `{ ok, state, epoch, snapshot }`（重建 L01 场景，不评分） |
| GET | `/api/events?sessionId=` | SSE（默认 message 事件，data 为 JSON）：`state` / `log` / `objective` / `result` / `hint` / `error` |

## 试符台（REPL，docs/27 §3b）

创建会话时传 `mode:"repl"`：`POST /api/session {"levelId":"L01","mode":"repl"}`
→ `{ sessionId, state, epoch, port, mode:"repl", snapshot }`。repl 会话 prepare L01 场景但**不进入评分状态机**，
`POST /api/run` 会被拒绝（`INVALID_STATE`）；世界在同一 repl 会话内持久，`/api/repl/reset` 重建场景。

`POST /api/repl` 语义：单行表达式求值并返回 JSON 安全值（如 `golem.pos` → `[2,65,6]`）；
单行语句 / 裸异步 SDK 调用自动 await 执行（如 `golem.moveTo(2, 6)`）；超时 3s、死循环被沙箱终止；
错误翻译成中文（不暴露堆栈/RPC）。响应 `kind` 为 `value` / `action` / `error`：

```bash
SID=$(curl -s -X POST 127.0.0.1:4317/api/session -H 'content-type: application/json'   -d '{"levelId":"L01","mode":"repl"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["sessionId"])')
curl -s -X POST 127.0.0.1:4317/api/repl -H 'content-type: application/json'   -d "{\"sessionId\":\"$SID\",\"line\":\"golem.pos\"}"
curl -s "127.0.0.1:4317/api/repl/history?sessionId=$SID"
curl -s -X POST 127.0.0.1:4317/api/repl/reset -H 'content-type: application/json' -d "{\"sessionId\":\"$SID\"}"
```

## T1 验收流程（Mock）

```bash
SID=$(curl -s -X POST 127.0.0.1:4317/api/session -H 'content-type: application/json' -d '{"levelId":"L01"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["sessionId"])')
curl -s -N "127.0.0.1:4317/api/events?sessionId=$SID" &   # 订阅 SSE
curl -s -X POST 127.0.0.1:4317/api/run -H 'content-type: application/json' \
  -d "{\"sessionId\":\"$SID\",\"source\":$(python3 -c 'import json;from pathlib import Path;print(json.dumps(""))' 2>/dev/null || echo '\"\"')}"
# 参考解/ starter 的源码由 GET /api/levels/L01 返回；运行参考解后调用：
curl -s -X POST 127.0.0.1:4317/api/player-beat -H 'content-type: application/json' -d "{\"sessionId\":\"$SID\"}"
```

自动化证据见 `npm test` 的 `packages/session/src/session.test.ts` 与 `packages/session/src/engine-http.test.ts`。

## 与 Studio 的兼容层

`apps/studio/src/engine/httpEngine.ts` 用 `EventSource.onmessage` 收事件，因此 SSE 发送**默认 message 事件**（不带 `event:` 名）；
`state` 事件同时带 `phase`（Studio 的 `SessionPhase`：loading/ready/running/graded/error），`result` 事件同时带嵌套 `result` 对象（Studio `StudioEvent` 形状），
并保留 docs/21 §3 的 `state/passed/stars/criteria/hidden/failures` 扁平字段。`result` 还带 `progress: [{id,text,passed}]` 与 `playerBeatReady: boolean`；每次 verify 都按 `LevelDef.progress` 的 id 发 `objective` 事件（docs/46 §1.1）。

## 状态机（docs/07 §3.5 子集）

`DISCONNECTED → CONNECTING → PREPARING → READY → COMPILING → RUNNING → VERIFYING → PASSED`；
`stop` → `STOPPED`（旧运行结果作废，必须 `reset` 才能再运行）；
`reset` 递增 epoch 并重建检查点，旧 epoch 的迟到结果被丢弃。
每次 Run 注入 capability，Stop 后所有晚到 `golem.*` 调用抛 `RUN_CANCELLED`（REQ-RUN-01 / REQ-STOP-01）；
`commandId` 幂等（REQ-CMD-01）；result 附 `observedTick` + 快照 `digest`（REQ-DONE-01）。

## 未完成 / 剩余风险

- 真实 MC 模式全关卡已验收：`it/l1-real.ts`–`l10-real.ts`（证据 `evidence/l*-real-latest.json`）；`it:engine-paper` 默认仍只跑 L01–L04 的 HTTP/SSE 冒烟（`LOOM_LEVELS` 可指定）。
- 真实 MC 单世界/单 bot：paper 模式一次只支持一个会话；并行关卡需要多服/多进程（L10 是一只 engine 驱动两只 bot，不是两个会话）。
- paper 模式的玩家节拍是 confirm-only：引擎不会替玩家完成，必须由插件 `playerBeat.activate` 后的真实右键/交互产生玩家事件。
- 无 MC 客户端时只做协议/状态级验收；视觉观感仍需真 MC 客户端（Lead 集成阶段）。
- 试符台历史仅存内存（进程重启丢失）；v1 不跨行保留变量（docs/27 §2/§6）；repl 不订阅 SSE（按契约不需要，Studio 走 HTTP 轮询式返回）。
- Stop 只能撤销 Mock 层能力；真实 bot/插件侧 capability/epoch 由 MC 线实现（REQ-EPOCH-01 等）。
- 无鉴权：仅绑定 127.0.0.1 供本地 Studio 使用。
