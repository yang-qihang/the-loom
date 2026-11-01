# task-25 证据 — T1 安全/一致性加固（RT-02/03/04/06）

> 负责人：scout-language｜任务：task-25｜日期：2026-10-31｜环境：Node 22.23.1 / TS 6.0.3 / vitest 5.0.5
> 上游：`qa/evidence/qa-red-team.json`（4 gap）、`docs/07` §3.5/§13、`docs/21` §3

## 1. 改动文件（均在 write scope 内）

| 文件 | 内容 |
|---|---|
| `packages/runner/src/sandbox.ts`（新增） | RT-02：worker_threads + `vm.createContext` 沙箱执行器（`runStudentSandboxed`）；只注入 golem/world/console；无 process/require/globalThis/Buffer/fetch/eval；`codeGeneration: {strings:false,wasm:false}`；主线程 RPC 执行 WorldPort；超时 `worker.terminate()`；学生行号映射 |
| `packages/runner/src/sandbox.test.ts`（新增） | 7 项：探针全 undefined、构造器逃逸/eval 被禁、world.vars 只读、死循环 300ms 终止、行号映射、console 路由、参考解通过 |
| `packages/mockworld/src/index.ts` | RT-03：`deepFreeze`/`frozenClone`；`vars` 为 deep-frozen 副本，`world`/`snapshot` 共享只读值 |
| `packages/mockworld/src/readonly.test.ts`（新增） | 4 项：顶层/嵌套冻结、篡改不污染快照、入参隔离、冻结工具 |
| `packages/session/src/session.ts` | 改用 `runStudentSandboxed`（旧 `runStudentProgram` 保留给测试）；RT-04：`ResultEvent` 带 `epoch/runId/snapshotDigest`；`gradeWithBinding` 只接受本会话已发布 runId+epoch+digest，否则 `StaleSnapshotError`（`STALE_SNAPSHOT`）；reset 清空已发布绑定 |
| `packages/session/src/state.ts` | 错误码新增 `STALE_SNAPSHOT` |
| `packages/session/src/index.ts` | 导出 `StaleSnapshotError` / `SnapshotBinding` |
| `packages/session/src/binding.test.ts`（新增） | 6 项：result 绑定字段、当前快照重评分、reset 后旧快照 STALE、伪造同 runId 快照 STALE、沙箱探针不可见、沙箱内篡改 vars 不影响 3 星 |
| `scripts/guard-tests.mjs`（新增） | RT-06：对 `packages/**/*.test.ts`、`content/**/*.test.ts`、`qa/red-team.mjs` 生成 sha256 manifest（`test/guard-manifest.json`）；`--check` diff+exit 1；`--warn` 只告警 exit 0；`--root/--manifest/--json` |
| `test/guard-manifest.json`（新增） | 当前 13 个受保护文件 |

## 2. RT-02 沙箱探针（测试断言）

```
golem.say("probe|" + typeof process + "|" + typeof require + "|" + typeof globalThis + "|" + typeof Buffer + "|" + typeof fetch + "|" + typeof eval)
→ probe|undefined|undefined|undefined|undefined|undefined|undefined
```

- `while (true) {}` + `timeoutMs: 300` → `RunTimeoutError`，实际 304ms 内 terminate（测试上限 1200ms）。
- `throw new Error("boom")` 在第 2 行 → `StudentCodeError.line === 2`（映射回学生行号）。
- `({}).constructor.constructor("return typeof process")()` / `eval("1+1")` → 被 vm `codeGeneration:false` 拒绝。
- session 全链路已改走沙箱；HTTP/SSE 集成测试仍通过。

## 3. RT-03 只读快照

- `Object.isFrozen(world.vars)`、嵌套数组/对象均冻结；严格模式赋值/push 抛 `TypeError`，非严格（vm 内）静默失效。
- 学生执行 `world.vars.lamps = []` 后再跑参考解 → 仍 3 星（评分快照来自主线程 MockWorld，未被污染）。

## 4. RT-04 快照绑定

- result：`{ runId, epoch, passed, stars, criteria, hidden, failures, observedTick, digest, snapshotDigest, source }`。
- `session.gradeWithBinding(snapshot, {runId, epoch, digest})`：
  - 未登记 runId → `STALE_SNAPSHOT`；
  - epoch 非当前 → `STALE_SNAPSHOT`（reset 后旧 epoch 拒绝）；
  - digest 与登记值或快照实际内容不一致 → `STALE_SNAPSHOT`（伪造/重放拒绝）。

## 5. RT-06 guard-tests（命令与输出）

```bash
node scripts/guard-tests.mjs
# GUARD_TESTS UPDATED test/guard-manifest.json (13 files)
node scripts/guard-tests.mjs --check
# GUARD_TESTS OK (13 files)  exit=0

# 漂移演示（临时 fixture，不改仓库测试）
node scripts/guard-tests.mjs --root /tmp/guard-demo            # UPDATED (2 files)
node scripts/guard-tests.mjs --root /tmp/guard-demo --check    # exit=0
echo '// changed' >> /tmp/guard-demo/packages/x/a.test.ts
node scripts/guard-tests.mjs --root /tmp/guard-demo --check
# GUARD_TESTS DRIFT：…
#   ~ packages/x/a.test.ts（内容被修改）   exit=1
node scripts/guard-tests.mjs --root /tmp/guard-demo --check --warn
# GUARD_TESTS WARN：… exit=0（不阻塞）
```

`scripts/verify.sh` 的 l0 尚未接入（verify.sh 归 QA，本任务 write scope 不含它）。建议 QA 在 l0 增加：
`node scripts/guard-tests.mjs --check --warn || true`（feature freeze 后去掉 `--warn || true` 改为判红）。

## 6. 验收

```bash
npm run typecheck   # exit 0
npm test            # 12 files / 70 tests 全绿（本任务新增 20 项）
bash scripts/verify.sh
# VERIFY OK (10178ms) layers=l0,l1,l2,l3
# JSON: {"result":"pass","layers":{"l0":"pass","l1":"pass","l2":"pass","l3":"pass"}}
```

## 7. 剩余风险

1. `packages/grading` 的 `grade()` 仍是「信任调用方」的纯函数；T1 的 session/engine 路径已强制绑定，但直接调用 `grade()` 的第三方代码仍可传任意快照。改 signature 属 grading 包 owner/Lead 范围（本次 write scope 不含）。
2. `scripts/verify.sh` l0 接入 guard-tests 未完成（不属 write scope）；当前靠本任务测试与手动命令保证。
3. 沙箱按 docs/07 §13 的威胁模型（好奇学生）设计：隔离 host 全局、禁用 eval/Function、SDK 在 vm realm 内定义；不承诺对抗资源级恶意代码（内存/CPU 由超时+进程边界兜底）。
4. 默认运行超时 3s（`runStudentSandboxed` 默认），L9 显式模式如需更长应通过 session 选项放宽（后续任务）。
5. `console.log` 通过 RPC 转发到 session log 事件，最多 3 类方法；无其他 console 能力。
