# Engine T1 证据（2026-10-31）

> 历史证据（T1，2026-10-31）：文中测试数/覆盖范围（70 tests、L01）为当时快照；当前证据见 `apps/engine/README.md`、`evidence/l*-real-latest.json`、`evidence/engine-paper-latest.json`。

> 负责人：scout-language｜任务：task-20｜环境：Node 22.23.1 / TypeScript 6.0.3 / vitest 5.0.5
> 所有命令在本仓库根目录执行；用户不参与测试，以下均为自动化证据。

## 1. 类型检查 + 全量测试

```bash
npm run typecheck   # exit 0
npm test            # exit 0
```

```
 RUN  v5.0.5 /home/yqh0919/Documents/deepseek-harness/default-workspace

 ✓ packages/worldport/src/mock-port.test.ts (1 test)
 ✓ packages/runner/src/transform.test.ts (3 tests)
 ✓ packages/runner/src/l01.e2e.test.ts (4 tests)
 ✓ content/levels/L02.content.test.ts (6 tests)   # 内容线并行新增
 ✓ packages/session/src/session.test.ts (9 tests)
 ✓ packages/session/src/engine-http.test.ts (8 tests)

 Test Files  6 passed (6)
      Tests  31 passed (31)
```

新增测试覆盖（Engine 侧 17 项）：健康检查、关卡列表/详情、建会话、参考解运行→result、starter 失败、stop 后 run 被拒（409）、reset 后重跑、player-beat 生效、SSE 收到 state/log/objective/result/hint/error、epoch 作废旧运行、commandId 幂等、reset 快照 digest 相同；并校验 SSE 的 Studio 兼容字段（`state.phase="graded"`、嵌套 `result.stars=3`）。

## 1b. Studio 兼容层（与 apps/studio/src/engine/httpEngine.ts 对齐）

Studio 用 `EventSource.onmessage`，因此 SSE 发送默认 message 事件（data 为 JSON，不带 `event:` 名）；
`state` 事件附 `phase`（loading/ready/running/graded/error），`result` 事件附嵌套 `result`（Studio `StudioEvent` 形状），
同时保留 docs/21 §3 的扁平字段。

## 2. 真实进程 + curl（`npm run dev:engine`，127.0.0.1:4317）

```bash
npm run dev:engine
curl -s 127.0.0.1:4317/api/health
# {"ok":true,"port":"mock","mc":{"kind":"mock","connected":true},"version":"1.0.0-t1","sessions":0,"uptimeSec":3}

curl -s 127.0.0.1:4317/api/levels
# {"levels":[{"id":"L01","title":"第一缕光","act":1,"order":1,"priority":"P0"}]}

curl -s 127.0.0.1:4317/api/levels/L01   # 返回 { def, starterCode }
```

## 3. 全流程 HTTP/SSE 证据（脚本输出摘要）

流程：`POST /api/session` → 订阅 `/api/events` → `POST /api/run`（参考解）→ `POST /api/player-beat` → 3 星；
再验证 starter 失败、stop 后 409、reset 生效。

```json
{
  "health": { "ok": true, "port": "mock", "version": "1.0.0-t1" },
  "liveHealth": { "ok": true, "port": "mock", "mc": { "kind": "mock" }, "version": "1.0.0-t1" },
  "levels": ["L01"],
  "session": { "stateAfterCreate": "READY" },
  "run1": { "httpStatus": 202, "runId": "run-1" },
  "firstResult": {
    "passed": false,
    "stars": 1,
    "failures": ["4 盏路灯全部点亮", "第 4 盏灯由玩家亲手点亮"]
  },
  "beat": { "httpStatus": 200, "state": "PASSED" },
  "finalResult": { "passed": true, "stars": 3 },
  "sseStates": ["CONNECTING", "PREPARING", "READY", "COMPILING", "RUNNING", "VERIFYING", "PASSED"],
  "sseEvents": 29,
  "logLines": ["golem.moveTo(-12, 10)", "golem.place(\"lantern\", -12, 14, 10)", "golem.moveTo(-12, -2)"],
  "starter": { "passed": false, "stars": 1 },
  "stopThenRun": { "stopStatus": 200, "state": "STOPPED", "reRunStatus": 409, "reRunCode": "INVALID_STATE" },
  "reset": { "status": 200, "state": "READY", "epoch": 1 }
}
```

## 4. 交付文件

- `packages/session/src/state.ts` — 状态机（含失败/停止/重置路径）
- `packages/session/src/session.ts` — GameSession：run/stop/reset/playerBeat、capability、epoch、事件订阅、0–3 星评分
- `packages/session/src/index.ts`
- `packages/session/src/session.test.ts` — 会话层 9 项测试
- `packages/session/src/engine-http.test.ts` — HTTP/SSE 集成 8 项测试
- `apps/engine/src/server.ts` — node:http + SSE，默认 127.0.0.1:4317
- `apps/engine/src/catalog.ts` — 关卡目录（T1 = L01）
- `apps/engine/README.md` — 命令/API/风险
- 根 `package.json` 新增一行 `"dev:engine": "tsx apps/engine/src/server.ts"`（唯一目录外改动，已向 Lead 报告）

## 5. 剩余风险（详见 apps/engine/README.md §未完成）

- `paper+bot` WorldPort 适配器未接（health 显示 `port: "mock"`），联调时替换注入点。
- 关卡目录静态注册 L01；L02–L04 由内容线交付后追加。
- Stop 只在会话层撤销 Mock capability；真实 bot/插件的 epoch/capability 由 MC 线实现。

## 6. 试符台 REPL（docs/27 / docs/21 §3b，task-35）

实现：`packages/runner/src/repl.ts`（单行表达式/语句求值）、`packages/session/src/session.ts`（mode:"repl" + repl/history/reset）、
`apps/engine/src/server.ts`（`/api/repl`、`/api/repl/history`、`/api/repl/reset`）、`packages/session/src/repl.test.ts`（7 项测试）。

语义（v1，docs/27 §2）：
- 单行表达式求值并返回 JSON 安全值（`golem.pos` → `[2,65,6]`，字符串带引号，undefined → 「空值」）；
- 单行语句 / 裸异步 SDK 调用自动 await 执行（`golem.say`/`golem.moveTo`/`golem.place` → 「灰崽照做了」）；
- 表达式/语句判定用 TS AST（复用 `transform.isAsyncSdkCall`）；多行/多条语句拒绝：`一次试一句：只写一条语句或一个表达式。`；
- 沙箱复用：同一 worker+vm（只注入 golem/world/console）、超时终止；死循环 300ms 测试超时内返回中文「这一句跑太久…」；
- 错误中文翻译（不暴露堆栈/RPC/JSON），世界层中文错误原样透出（如「织偶离目标太远（…格）」）；
- repl 会话 prepare L01、不评分、无 result 事件、不影响关卡会话；`/api/repl/reset` 重建场景（epoch+1，history 保留）。

证据（`npx vitest run packages/session packages/runner`，2026-10-31 13:59）：
```
packages/session/src/repl.test.ts   (7 tests) ✓
  ✓ 4 条示例：say/moveTo/place 是动作，pos 返回值
  ✓ 错误是中文人话，且失败后还能继续试
  ✓ 死循环在超时内终止，且不会污染后续试符
  ✓ 重置试符台回到初始场景（history 保留）
  ✓ history 按执行顺序记录
  ✓ 不影响关卡会话：不评分、不产生 result、关卡照常运行
  ✓ 创建 repl 会话 → 4 条示例 → history → reset → 错误中文（HTTP）
```
全量：`npm test` 19 files / 157 tests 全绿；`npx tsc -p tsconfig.json --noEmit` exit 0。

## 7. Act III 显式 await 运行模式（task-51，docs/12 §1.1）

实现：
- `packages/runner/src/explicit.ts`：TS AST 静态分析 `findUnawaitedSdkCalls` / `assertExplicitAwait`（2588 中文提示、行号）；
- `packages/runner/src/sandbox.ts`：`runStudentSandboxed(..., { mode:"explicit" })` 先静态检查再执行（不自动插 await）；
- `packages/runner/src/run.ts`：`runStudentProgram(..., { autoAwait:false })` 新入口（兼容旧 mode 字符串）；
- `packages/session/src/session.ts`：`levelRunMode` 读取 `LevelDef.runMode`（兼容 `meta.runMode`，缺省 sequential）；`#executeRun` 按关卡选择
  `auto-await`/`explicit`；显式模式错误带行号进 `error` 事件（`line`）。

语义：显式 await / 存变量后 await / `Promise.all/allSettled/race/any` / `return` 均合法；漏 await 的运行前被拦下（不执行世界动作）；
`Promise.all` 真正并行；L01–L08 仍走顺序模式，行为不变。

证据（2026-10-31 14:06）：
```
packages/runner/src/explicit.test.ts   (5 tests) ✓
  ✓ 不再自动插 await，但保留 TS 类型剥离（显式 await 正常执行）
  ✓ 漏 await 被拦下：2588 中文提示 + 行号，且不会执行世界动作
  ✓ 显式 await / 存变量后 await / Promise.all 元素 / return 都算合法
  ✓ Promise.all 并行完成（用时接近单个调用，而不是串行两倍）
  ✓ autoAwait:true 与旧 mode 字符串保持兼容（回归）
packages/session/src/explicit.test.ts   (5 tests) ✓
  ✓ 显式 await 参考解通过，玩家节拍拿到 3 星
  ✓ LevelDef 顶层 runMode（L09 当前写法）同样被识别
  ✓ 漏 await：中文提示 + 行号进 error 事件与 result.failures，世界不动
  ✓ Promise.all 并行完成（40ms 端口：两次移动重叠，串行会相隔 40ms）
  ✓ 自动 await 模式回归：L01–L08 仍是 sequential，L01 参考解照常 3 星
```
`npx vitest run packages/session packages/runner`：10 files / 57 tests 绿（含既有回归）。
