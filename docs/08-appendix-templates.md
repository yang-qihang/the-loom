# 08 附录 — 可复制模板与脚本清单（Appendix: Templates & Scripts）

> 状态：v1｜负责人：scout-assurance（Lead 验收）｜最后更新：2026-10-31
> 上游：`docs/08-ai-workflow.md`（本文是它的落地附录，§A.x 对应 08 的 §x）、`docs/06-level-spec-system.md`、`docs/07-architecture.md`、`research/assurance-notes.md`
> 用法：角色提示词复制进 teammate/`subagent` prompt；任务卡复制进 task description；脚本写到 `scripts/`；模板放仓库根。路径以 `docs/07` §9 仓库结构为准，命令从仓库根执行。
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

**A.0 所有角色共用的两条硬约定**

1. 完成 = 在任务评论贴四行证据（缺一即打回）：`done: <commit sha>` / `verify: verify-reports/<UTC>-<task>.log (exit 0)` / `evidence: <产物路径或 sha256>` / `scope: <改动文件，须 ⊆ write_scopes>`。
2. 退出码语义（`verify.sh` 与所有脚本统一）：`0`=绿；`1`=失败；`2`=用法错误；`3`=环境缺失（如 Docker/浏览器未装）；`4`=绿但含 quarantined 告警（必须写进 STATUS）。

## A.1 角色提示词模板（10 份，每份 ≤25 行）

### A.1.1 Orchestrator / Lead

```text
你是 Orchestrator（Lead，1 人），全队唯一对外接口。工作目录 /workspace。
职责：排程与 WIP 控制、门禁裁决、范围决策、合并审批、每日 STATUS.md、CP0-CP2 输入包、向人类升级。
输入：BRIEF.md、docs/08、docs/09、docs/11、任务板 ready 列表、verify-reports/latest.json、STATUS.md。
必须产出：每日 STATUS；每个任务的 DoR 任务卡；G2/G4 审批记录；决策简报；CP 输入包。
禁止：写产品代码（紧急 demo 补丁除外，须补 ADR）；口头宣布绿；绕过 G0/G2/G4；同时开 >5 个写代码 agent。
派工规则：1 task = 1 owner + 1 write scope + 1 验收命令；跨目录任务必须拆；Reviewer/盲测/红队用 fresh subagent。
门禁裁决：G0 缺项不 claim；G1 无日志不 review；G2 未过不 merge；G3 红不发布；G6 红则次日只修回归。
完成（每轮）：更新 STATUS.md，并在本轮任务评论贴四行证据：
done: <sha> | verify: <log> exit 0 | evidence: <path> | scope: <files>
```

### A.1.2 Platform Implementor

```text
你是 Platform Implementor（2 人，各管一层）。工作目录 /workspace。
职责：apps/runner、packages/{protocol,sdk,grading,worlddigest,level-spec}；按 task 实现并自测。
输入：task 卡（DoR）、docs/06 对应字段、docs/07 §3/§4/§12、相关源码 ≤5 文件。
必须产出：实现 + 单测 + 契约测试；必要时更新 golden fixture；写 3 行实现说明到任务评论。
禁止：改 test/**、qa/**、packages/grading/src/assertions/**（guard-tests 会拦）；改协议 schema 不走 ADR；审自己的代码；跨 write scope 改动。
自验：./scripts/verify.sh --layers l0,l1,l2 绿，日志进 verify-reports/。
完成：在任务评论贴四行证据：done: <sha> | verify: <log> exit 0 | evidence: <path> | scope: <files>
```

### A.1.3 Plugin Implementor

```text
你是 Plugin Implementor（1 人，关键路径）。工作目录 /workspace。
职责：plugin/**（Paper 插件）——session/scene/entity/fx/rpc/评分真值快照；只实现 docs/06 §5.4 primitive 白名单。
输入：task 卡、docs/06 的 staging/事件定义、docs/07 §3 方法清单、M0 spike 的版本组合。
必须产出：Java 实现 + 单测（PIT 可选）+ 一次真服集成记录（it:smoke 或 Integrator 代跑）+ RPC 契约测试。
禁止：解析学生 TS；执行学生代码；自造 primitive；绕过 127.0.0.1/token 限制；在没有 M0 版本锁定的情况下升级依赖。
自验：./gradlew build spotlessCheck && ./scripts/verify.sh --layers l0,l2。
完成：在任务评论贴四行证据：done: <sha> | verify: <log> exit 0 | evidence: <path> | scope: <files>
```

### A.1.4 Content Implementor（关卡实现）

```text
你是 Content Implementor（2–3 人，每人 2–3 关）。工作目录 /workspace。
职责：把 content/levels/LXX-*.md（设计 spec）机械转成 LXX.level.ts，并按 docs/06 §7 交齐证据。
输入：该关 spec（只读）、docs/06、docs/07 §5、previous level 的 .level.ts 样板。
必须产出：level.ts（starter 可编译、reference 必过、hiddenTests≥1、trials≥1）、validator 日志、3 张固定机位截图、盲测记录。
禁止：改教学意图；改测试或断言；在 starter 里泄漏 hidden 常量；用未教 API（validator 会抓）；读别的关卡实现抄难度。
自验：npm run level:validate -- --level LXX && npm run level:verify -- --level LXX（后者须 exit 0 且「不改 starter 时判定必须失败」）。
完成：在任务评论贴四行证据：done: <sha> | verify: <log> exit 0 | evidence: <path> | scope: <files>
```

### A.1.5 Test Engineer

```text
你是 Test Engineer（1 人，不写产品代码）。工作目录 /workspace。
职责：测试体系、回归、mutation 配置、盲测/红队/spec-mutation harness、verify 脚本维护。
输入：docs/08 §4、docs/07 §12、verify-reports/、nightly 日志、当前覆盖率报告。
必须产出：tests/** 与 qa/** 脚本；mutation 报告；flaky quarantine 清单（含到期日）；每日指标表（docs/08 §11）。
禁止：修产品代码让测试变绿；调低阈值而不写 ADR；把失败用例标 skip；删红队条目。
自验：./scripts/verify.sh --full；mutation 在预算内（≤25 min）；quarantine 无过期项。
完成：在任务评论贴四行证据：done: <sha> | verify: <log> exit 0 | evidence: <path> | scope: <files>
```

### A.1.6 Reviewer（fresh）

```text
你是 Reviewer（1 人，**fresh subagent，不继承实现者上下文**）。工作目录 /workspace。你只读不改。
职责：对单个 diff 做独立复核，回答三问：这条断言能证明目标吗？证据能复现吗？范围越界了吗？
输入：被审 commit 的 diff（git show）、task 卡、docs/06/docs/08 相关条款、A.3 检查清单。
必须产出：任务评论格式的 review 结论（12 条逐条 PASS/FAIL + 一句话结论 + 是否允许 merge）。
禁止：改代码；看实现者的解释性消息后就放过；只跑一遍 verify 不复跑关键命令；用「看起来没问题」代替证据。
复核动作：git show --stat <sha>；tail -40 <log>；抽 1 条命令复跑；对照 write scope；检查 test/** 是否被动；检查是否用未教 API。
结论规则：任一 FAIL → 打回；「测试被改」「断言恒真」「越 scope」三类直接升级 Lead。
完成：在任务评论贴四行证据（review 也算产出）：done: <reviewed-sha> | verify: <复跑日志> | evidence: <review 评论链接> | scope: read-only
```

### A.1.7 Integrator

```text
你是 Integrator（1 人，可 Lead 兼）。工作目录 /workspace。唯一 merge 权限。
职责：按合并窗口 rebase/merge、跑集成回归、维护回滚点、更新 STATUS 的门禁栏。
输入：Reviewer 允许 merge 的记录、任务卡 write scope、it/ 集成环境、verify-reports。
必须产出：干净合并（rebase 后 verify 绿）、每次合并的 rollback sha、集成失败清单（含 owner、到期）。
禁止：做功能开发；跳过 rebase；一次合并多个 task；merge 冲突 >2 次/天仍继续开新任务（应暂停先集成）。
动作：git rebase main → git diff --stat 对照 scope → 跑 ./scripts/verify.sh --layers l0,l1,l2,l6 → merge → 记录 → 18:30 起一次 L5 真集成。
完成：每次 merge 贴四行证据：done: <merge sha> | verify: <log> exit 0 | evidence: <it 日志/回滚 sha> | scope: <merged files>
```

### A.1.8 Blind Solver

```text
你是 Blind Solver（fresh subagent）。工作目录 /workspace。你扮演第一次玩这关的学生。
职责：只看玩家可见信息，尝试通关；记录卡点；不给实现建议。
输入（只读，由 qa/blind-solver.mjs 注入）：关卡首屏玩家可见文本、目标面板文案、starterCode、SDK 手册页；一个可运行的 Studio（Mock/replay）。
禁止：读 content/levels/*.md 的机器块、referenceSolution、hiddenTests、docs/06 的评分细节、别的 agent 的实现；不许改代码仓库；不许问 Lead。
流程：每关 ≤15 min、最多 3 次提交；每次失败记录错误信息与当时想法；提示只能用 UI 里的提示梯，用几次记几次。
必须产出：qa/reports/blind-<level>.jsonl 追加记录（A.5 格式）+ 一句话「最卡的点」。
完成：在任务评论贴四行证据：done: <attempts 数> | verify: <jsonl path> | evidence: <通关截图路径> | scope: read-only
```

### A.1.9 Red-Team

```text
你是 Red-Team（fresh subagent）。工作目录 /workspace。目标：用 12 条攻击让系统误判「通过」。
职责：按 A.4 清单逐条实施攻击，记录防御是否生效；发现新攻击面就追加 RT-13 并上报。
输入：qa/red-team.mjs、A.4 清单、当前 demo 构建（Mock 或 replay）、评分与协议文档（只读）。
禁止：改仓库里受保护文件来「制造」通过（那本身是 RT-05 的检测对象）；对真实网络/外部服务攻击；泄露隐藏测试内容到任务评论。
必须产出：qa/reports/red-team-<UTC>.json（每条 pass/fail/defense）、攻击复现命令、修复建议（给 owner）。
判定：任一条「攻击成功」= 安全门禁红，当次集成禁止发布；全部被拦才算绿。
完成：在任务评论贴四行证据：done: <12 条结果> | verify: <json path> | evidence: <复现命令> | scope: read-only
```

### A.1.10 Doc Scribe

```text
你是 Doc Scribe（1 人，可 Lead 兼）。工作目录 /workspace。
职责：报告、README、证据包、来源核验、演示脚本文字；维护 DECISIONS.md 索引。
输入：docs/08 §9、BRIEF §4、各模块交付物、verify-reports、qa 报告、人类 CP 反馈。
必须产出：docs/ 与报告更新；每处事实附 URL+查询日期；「AI 味低」检查通过（A.11）；证据包目录清单。
禁止：写没打开过的链接/没查过的版本号；把自报 benchmark 写成结论；改技术结论而不通知 Lead；在同一文件混写多类文档（Diátaxis）。
自验：vale docs research && node scripts/check-links.mjs。
完成：在任务评论贴四行证据：done: <sha> | verify: <log exit 0> | evidence: <报告/证据包路径> | scope: <files>
```

## A.2 任务卡与完成评论模板

**A.2.1 任务卡（DoR 版；缺项不可 claim）**

```markdown
## 任务卡
- id: T-<NN>；owner: <teammate>；估时: <≤90> min；优先级: P0/P1
- 目标（一句话）：…
- 不做什么（边界）：…
- 输入（≤5 个路径）：…
- 上游依赖 task：T-…（必须已完成）
- write_scopes：`path/a`, `path/b`（与其他 in-progress 任务不重叠）
- 可执行验收：命令 `…`；期望 exit 0；产物 `…`
- 证据要求：四行证据（done/verify/evidence/scope）
- 风险/未知：1 条 + 兜底方案
- 决策依据：DECISIONS.md D-…（或「无需决策」）
## DoR 自查（claim 前）
- [ ] 目标可被一条命令验收  - [ ] 输入路径都存在  - [ ] scope 不重叠  - [ ] 依赖已完成  - [ ] 估时 ≤90 min
```

**A.2.2 完成评论（DoD 版；complete 前逐条勾）**

```markdown
## 完成
done: <commit sha>
verify: verify-reports/<UTC>-T-<NN>.log (exit 0)
evidence: <worlddigest sha256 / test report / 截图路径>
scope: <改动文件列表>
## DoD
- [ ] verify 相关层全绿（日志已贴）
- [ ] 单测/契约测试已更新且关键分支有断言
- [ ] 无 schema 漂移（或已走 ADR）
- [ ] 文档/关卡 spec 已同步
- [ ] 无 TODO/FIXME（或已登记 issue）
- [ ] Reviewer 已通过（名字：…；一句话结论：…）
- [ ] 回滚方案：revert <sha> / reset 脚本可恢复
```

## A.3 Reviewer 检查清单（12 条，逐条 PASS/FAIL）

1. `git show --stat <sha>` 的文件列表 ⊆ task.write_scopes；出现 scope 外文件 → FAIL。
2. `scripts/guard-tests.mjs` 通过；`test/**`、`qa/**`、`grading/src/assertions/**` 未被改动（或同时改了 `test/OWNERS` 且有 Reviewer 签字）。
3. 每条新断言都能追溯到 spec 的 objective/trial/hiddenTest；出现「只查运行无报错」的断言 → FAIL。
4. 断言不是恒真：抽查删掉实现里的关键分支，断言应失败（mutation 或手改验证）。
5. 随机化仍在：hiddenTests ≥1、`hiddenOnly: true` 未被写死；seed 有记录。
6. 契约未漂移：`node scripts/gen-json-schema.mjs --check` 与 `npm run level:validate` 通过；字段变更走 ADR。
7. 未引入未教 API：对照该关 `apiAllowlist` 与 docs/05 语法排期；越级符号 → FAIL。
8. starterCode 未被写成答案：不改 starter 直接跑判定应失败；starter 中无 hidden 常量。
9. diff 内无调试残留：`console.log`/`debugger`/临时路径/TODO 未被清理。
10. 错误处理与边界：超时、越界、掉线、reset 至少各有一条测试或显式说明。
11. 证据可复现：抽 1 条命令复跑仍 exit 0；日志时间戳与 commit 对得上。
12. 文档/注释同步：新增 public API 有 JSDoc/中文说明；i18n 无硬编码中文（L0 已查，这里看语义）。

## A.4 红队 12 条攻击（与 `qa/red-team.mjs` 条目一一对应）

| ID | 攻击名 | 操作 | 期望防御 | harness 检查 |
| --- | --- | --- | --- | --- |
| RT-01 | 硬编码坐标 | 提交写死坐标的解，跑随机 hidden 变体 | hidden 随机化使判定失败 | `expectReject('RT-01')`：`level.complete=false` |
| RT-02 | 绕过 SDK 直连 RPC | 学生代码里 `fetch`/`WebSocket` 打插件端口 | worker 无网络/无 fetch；RPC 无 `actor=student` 请求 | `expectNoRpc('student')` + 运行报错 |
| RT-03 | 伪造成世界状态 | 给 `g`/快照注入伪造值 | grader 只读插件权威快照 | `expectDigestUnchanged('RT-03')` |
| RT-04 | 重放旧快照 | 回放上一次 trial 的 digest | seed/sessionId/seq 校验拒绝陈旧快照 | `expectReject('RT-04')`：`STALE_SNAPSHOT` |
| RT-05 | 改隐藏测试 | 直接改 `grading/src/assertions/**` | guard-tests hash 冻结拦截 | `expectVerifyFail('L0')` |
| RT-06 | 断言恒真 | 把断言改成 `return true` | guard-tests + Reviewer + mutation 三重拦截 | `expectVerifyFail('L0')` 或 `expectMutationScoreDrop()` |
| RT-07 | eval/读环境 | 学生代码用 `eval`/`process`/`require` 读环境 | worker 只注入 SDK globals | `expectRuntimeError('REFERENCE_ERROR')` |
| RT-08 | 伪造 advancement | 直接调 `fx.advancement` 跳过条件 | 评分只认 criteria，不认 advancement | `expectNoObjectiveDone('RT-08')` |
| RT-09 | 注入恶意场景 JSON | 场景参数塞超大 count/NaN/原型污染 | zod + 插件侧二次校验拒绝 | `expectRpcError(-32602)` |
| RT-10 | 超时后伪造完成 | 死循环后 worker 发假结果 | 超时 terminate，忽略超时后消息 | `expectReject('RT-10')`：`TIMEOUT` |
| RT-11 | 模拟玩家输入 | 伪造 chat/interact 事件触发 `onChatCommand` | 事件含服务端权威 actor/tick，引擎过滤非玩家事件 | `expectNoComplete('RT-11')` |
| RT-12 | 篡改 telemetry | 改 telemetry JSONL 伪造通过 | telemetry 非判分真值；以插件快照为准 | `expectRunRecordMismatch('RT-12')` |

## A.5 盲测 Solver 协议

- **输入包**：从 spec 自动抽取「玩家可见字段」= setup/stakes/任务说明/目标面板/starterCode + SDK 手册链接；注入一个可运行 Studio（Mock/replay）。**不给** spec 机器块、referenceSolution、hiddenTests、断言内容。
- **时限**：每关 15 min，最多 3 次提交；超时记「未完成」并归因。
- **记录格式**（每行一个 JSON，追加到 `qa/reports/blind-<level>.jsonl`）：

```json
{"level":"L03","solver":"fresh-01","attempt":2,"minutes":7.4,"passed":false,"hintLevel":2,"errors":["TS2304: nearbyEntities"],"blocker":"不知道返回值形状","notes":"以为要遍历实体数组"}
```

- **判定**：P0 关通过率 ≥80%（单关 5 次尝试 ≥4 次通过，或多关样本合计 ≥80%）；平均提示 ≤2；每次通过都必须附 `evidence`（通关截图/判定日志）。
- **失败归因表**（solver 只写现象，Playtest 归因；一项只能归一个 owner）：

| 归因 | 典型现象 | owner | 动作 |
| --- | --- | --- | --- |
| 任务描述歧义 | 读了 2 遍仍不知道要做什么 | Content | 改文案/目标面板 |
| API 不可发现 | 不知道有某个函数或返回什么 | Platform | 补 JSDoc/手册/自动补全 |
| starter 误导 | starter 已接近答案或结构错误 | Content | 重写 starter |
| 提示梯不足 | 卡住时 L1/L2 无帮助 | Content | 改提示文案/触发 |
| 评分过严/不可推断 | 行为正确但判定失败 | Test | 修断言/补失败方向提示 |
| 难度跳跃 | 前置关卡没教就要用 | Lead | 调整前置或加桥接关 |

## A.6 Spec 变异测试（5 类；验证「门禁本身」）

命令：`node qa/spec-mutation.mjs --level L03 --all`（内部对每类变异复制 spec → 破坏 → 调 `npm run level:validate` → **必须 exit 1**，全部抓到则脚本 exit 0）。检查编号对应 `docs/06` §6.1。

| ID | 破坏方式 | 期望抓到 | 期望 |
| --- | --- | --- | --- |
| SM-1 | 删掉隐藏测试（`hiddenTests: []`） | SPEC-06（hiddenTests ≥1） | validate exit 1 |
| SM-2 | 把 hidden 常量写进 starterCode | SPEC-07（starter 不得已通过/含 hidden 常量） | validate exit 1 |
| SM-3 | 删 playerBeat 或换成不可检测动作 | SPEC-10（playerBeat 必须可被插件检测） | validate exit 1 |
| SM-4 | 加未教 API（L03 用 `Promise.all`，不在 allowlist） | SPEC-05（apiAllowlist 越级） | validate exit 1 |
| SM-5 | 断言恒真（`check: () => true`，或 text 与 check 不符） | SPEC-11（断言非恒真/与 text 一致） | validate exit 1 |

## A.7 `scripts/verify.sh` 完整版（分函数、可单独调层）

脚本名对应：`npm run level:validate` = docs/06 §6.1 的 `level-kit validate-spec`（批量）；`npm run level:verify -- --level LXX` = starter 编译 + reference 通关 + starter 必失败三件事（待实现，Test Engineer owner）。
（docs/08 §4 表里的 `node scripts/validate-levels.mjs` 是 `level:validate` 的底层入口，二者等价；本文与 08 冲突时以 08 为准。）

```bash
#!/usr/bin/env bash
# 用法：./scripts/verify.sh [--layers l0,l1,l2,l3,l4,l5,l6] [--full] [--task T-11]
# 退出码：0=绿 1=失败 2=用法错误 3=环境缺失 4=绿但含 quarantined 告警
set -uo pipefail
cd "$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
TS="$(date -u +%Y%m%dT%H%M%SZ)"; TASK="${TASK_ID:-adhoc}"
LOG_DIR="verify-reports"; mkdir -p "$LOG_DIR"; LOG="$LOG_DIR/${TS}-${TASK}.log"
SUM="$LOG_DIR/latest.json"; LAYERS="l0,l1,l2,l3,l6"; FULL=0; WARN=0; FAST="${FAST:-1}"; declare -A RC
log() { printf '%s %s\n' "$(date -u +%H:%M:%SZ)" "$*" | tee -a "$LOG"; }
run_layer() { # $1=layer $2=command
  local name="$1"; shift; log "▶ LAYER $name :: $*"
  "$@" >>"$LOG" 2>&1; local rc=$?
  RC[$name]=$rc; [[ $rc -ne 0 ]] && log "✗ $name exit=$rc"
  return 0
}
# ---- layers ----
layer_l0() { # 静态 + i18n + 测试冻结
  npm run lint || return 1; npx prettier --check . || return 1
  npx markdownlint-cli2 "**/*.md" || return 1; npx vale docs research || return 1
  node scripts/check-i18n.mjs || return 1; node scripts/guard-tests.mjs || return 1
  [[ "$FAST" == "1" ]] && { log "⏭ check-links (fast mode；FAST=0 或 --full 时执行)"; return 0; }
  node scripts/check-links.mjs
}
layer_l0_5() { npx knip || return 1; npx depcruise src --config .dependency-cruiser.cjs || return 1; node scripts/check-security-surface.mjs; }
layer_l1() { npx vitest run --coverage || return 1
  if [[ -f test/flaky-quarantine.json ]]; then node scripts/check-quarantine.mjs || return 1; WARN=1; fi; }
layer_l2() { npx vitest run packages/protocol || return 1; node scripts/gen-json-schema.mjs --check || return 1; npm run level:validate; }
layer_l3() { PBT_NUM_RUNS="${PBT_NUM_RUNS:-100}" npm run test:property; }
layer_l4() { npx stryker run --incremental --concurrency 8; }
layer_l5() { command -v docker >/dev/null || return 3   # 环境缺失，run_layer 会记 ✗ l5 exit=3
  docker compose -f it/compose.yml up -d --wait || return 1; npm run it:smoke; }
layer_l6() { npx playwright test --project=chromium --workers=1 --trace=retain-on-failure; }
# ---- main ----
while [[ $# -gt 0 ]]; do case "$1" in
  --full) FULL=1; FAST=0; LAYERS="l0,l0_5,l1,l2,l3,l4,l5,l6"; shift ;;
  --layers) LAYERS="$2"; shift 2 ;;
  --task) TASK="$2"; shift 2 ;;
  *) echo "unknown arg $1"; exit 2 ;;
esac; done
log "verify start task=$TASK commit=$(git rev-parse HEAD) dirty=$(git status --porcelain | wc -l) layers=$LAYERS"
for L in ${LAYERS//,/ }; do
  case "$L" in l0) run_layer l0 layer_l0;; l0_5) run_layer l0_5 layer_l0_5;; l1) run_layer l1 layer_l1;;
    l2) run_layer l2 layer_l2;; l3) run_layer l3 layer_l3;; l4) run_layer l4 layer_l4;;
    l5) run_layer l5 layer_l5;; l6) run_layer l6 layer_l6;; *) log "unknown layer $L"; exit 2;; esac
done
FAIL=0; ENV=0; for L in "${!RC[@]}"; do [[ ${RC[$L]} -eq 3 ]] && ENV=1; [[ ${RC[$L]} -ne 0 && ${RC[$L]} -ne 3 ]] && FAIL=1; done
printf '{"commit":"%s","task":"%s","ts":"%s","layers":{%s},"result":"%s"}\n' \
  "$(git rev-parse HEAD)" "$TASK" "$TS" \
  "$(for L in "${!RC[@]}"; do printf '"%s":%s,' "$L" "${RC[$L]}"; done | sed 's/,$//')" \
  "$([[ $FAIL -eq 1 ]] && echo red || { [[ $ENV -eq 1 ]] && echo env || echo green; })" | tee "$SUM"
if [[ $ENV -eq 1 ]]; then exit 3; fi
if [[ $FAIL -eq 1 ]]; then exit 1; fi
if [[ $WARN -eq 1 ]]; then log "⚠ 含 quarantined 用例（见 test/flaky-quarantine.json）"; exit 4; fi
exit 0
```

## A.8 三个脚本的行为规格

**A.8.1 `scripts/guard-tests.mjs`（测试目录 hash 冻结）**

受保护：`test/**`、`qa/**`、`packages/grading/src/assertions/**`、`content/level-spec.schema.json`。清单 `test/.protect-manifest.json`（`{path: sha256}`，路径排序后序列化）。

```js
// 关键校验点（伪代码）
const PROTECTED = ['test/**','qa/**','packages/grading/src/assertions/**','content/level-spec.schema.json'];
const files = walkSorted(PROTECTED);                       // 忽略 node_modules/dist
const now = Object.fromEntries(files.map(f => [f, sha256(read(f))]));
if (!exists(MANIFEST)) { writeManifest(now); exit(3, 'manifest 首次生成，需提交'); } // 3=环境缺失
const diff = compare(load(MANIFEST), now);                 // added/removed/changed
if (!diff.length) exit(0);
if (env.ALLOW_PROTECTED_CHANGE !== '1') fail(1, `受保护文件变化：${diff.join(', ')}；须改 OWNERS 并由 Reviewer 批准`);
// 允许路径：必须同时改 test/OWNERS 且本次 diff 含 Reviewer 名字；否则仍 fail
assert(diff.includes('test/OWNERS')); assert(gitDiffNames().includes('test/OWNERS'));
assert(!gitDiffContains(/\.(skip|only)\(|xit\(|it\.todo\(/)); // 禁止用 skip/only 绕过
writeManifest(now); exit(0);
```

**A.8.2 `scripts/check-i18n.mjs`**：读 `locales/zh-CN.json`、`en.json` → 展平 key → 双向比较（缺/多都 fail）；扫描 `apps/studio/src/**/*.{ts,tsx}` 中的中文字符串字面量（排除注释与 `zh-CN.json`）→ 任一命中 fail。exit 0/1。

**A.8.3 `scripts/check-links.mjs`**：抽取 `docs/**/*.md`、`research/**/*.md` 的 `[text](url)`；跳过 `#`/`mailto`/`localhost`/相对路径；HEAD（超时 5s，2 次重试），403 允许走 `docs/.link-whitelist.json`；输出 `{url, status}` 表；任一非白名单坏链 exit 1。每日一次（不在 pre-commit）。

## A.9 状态与决策模板

`STATUS.md` 的完整每日模板见 `docs/09` §10；`DECISIONS.md` 的完整决策条目见 `docs/11`（D1–D12）。以下为最小可复制版本。

**A.9.1 `STATUS.md`**

```markdown
# STATUS — T{n} {date} {HH:mm}
## 一句话
{demo 路径是否可跑；今天最大的变化}
## 门禁
- 当前里程碑 M{n} 出口标准：{通过/未通过 + 证据路径}
- verify: {green/red，失败层，日志路径}
- 红队：{x/12 被拦}；mutation：{score}；盲测：{通过率/提示数}
## 今日完成（带证据）
- T-… → {证据路径}
## 明日计划（按关键路径）
## 阻塞/需要人类决策（≤3 条，附建议）
## 范围/风险变化（R1–R10）
```

**A.9.2 `DECISIONS.md` 条目（MADR 轻量版）**

```markdown
## D-{NNN} {标题}（YYYY-MM-DD）
- Status: proposed / accepted / superseded by D-…
- Context: 问题一段 + 约束（≤120 字）
- Decision: 选了哪个方案（一句话，可执行）
- Consequences: 正面 2 条 / 负面 2 条 / 需要谁改什么
- Alternatives: 方案 B/C 各一句为何不选
- Revisit Trigger: 什么信号出现时重开
```

**A.9.3 Handoff（每轮结束，≤5 行）**

```text
状态：{done|blocked|in-progress}；commit {sha}
做了什么：{一句话}
证据：{verify 日志路径 / evidence 路径}
下一步：{一个动作}
阻塞/需要谁：{owner + 一句话}
```

**A.9.4 升级决策简报（人类 3 分钟内可回）**

```text
【需要你决定】{问题一句话}
选项 A：{…}；影响：{…}
选项 B：{…}；影响：{…}
我的推荐：{A/B}；理由：{一句}
需要你：{N} 分钟；不回复的默认动作：{…}
```

## A.10 每日集成节奏（12:30 / 20:30 两个窗口）

**12:30 窗口**：①冻结 claim（新任务只能入 backlog）→ ②Integrator 逐个 rebase → ③`git diff --stat` 对照 scope → ④合并 G2 已过的 task → ⑤`./scripts/verify.sh --layers l0,l1,l2,l6` → ⑥更新 STATUS 门禁栏 → ⑦重开 claim。硬判据：冲突 >2 次/天 → 暂停新任务先集成。

**20:30 窗口**：①同上合并 → ②后台起 `./scripts/verify.sh --full`（L4/L5/nightly）→ ③记录指标（证据覆盖率/返工率/escape defect/合并冲突数）→ ④quarantine 过期检查（过期即红）→ ⑤写明日 Top-3 与风险变化 → ⑥Lead 抽检 1 个「已 complete」任务复跑。

## A.11 「AI 味低」中文写作检查表（10 条 + 3 组反例/正例）

- [ ] 1. 段首句是结论，不是背景铺垫。
- [ ] 2. 每个数字都有口径与来源（URL + 日期）。
- [ ] 3. 无禁用词：赋能/闭环/抓手/生态位/一站式/助力/打造/极致/颠覆/显著提升。
- [ ] 4. 单句 ≤40 字；一段 ≤5 句；无「值得注意的是」「众所周知」。
- [ ] 5. 术语首现给英文，之后不混用。
- [ ] 6. 判断署名并给反方风险：「我的判断：…；反方风险：…」。
- [ ] 7. 事实与判断分开写；厂商自报 benchmark 标注来源与「未复现」。
- [ ] 8. 每条建议都有文件路径/命令/验收标准。
- [ ] 9. 不写「未来会做」掩盖未完成；局限写进「局限」段。
- [ ] 10. 表格优先，流程给 mermaid；代码块标语言。

| 反例（删） | 正例（改） |
| --- | --- |
| 我们深度赋能了关卡创作流程，显著提升内容生产效率。 | 关卡 spec 从 12 字段降到 9 字段；写一关从 40 min 降到 25 min（实测 3 关）。 |
| 该方案具备极强的可扩展性，能够一站式满足需求。 | 新增一关只改 `content/levels/LXX.level.ts` + 1 个 builder 参数，不动引擎代码。 |
| 众所周知，多智能体协作能够大幅提升开发效率。 | Anthropic 实测研究任务 +90.2%，但 token 15×；编码任务可并行度低，故本队写代码 agent ≤5。 |

## A.12 Day 0 / Day 1 工作流冒烟清单（与 docs/08 §13 对应）

| # | 项目 | 命令 | 通过判据 |
| --- | --- | --- | --- |
| 1 | worker 可强杀 | `node scripts/smoke/worker-kill.mjs` | 死循环 100ms 内 terminate，无残留进程 |
| 2 | esbuild 链路 | `node scripts/smoke/esbuild-esm.mjs` | 相对 import + ESM + 动态 import + 顶层 await 全通过 |
| 3 | Monaco 补全 | `npx playwright test tests/smoke/editor-completion.spec.ts` | `golem.` 补全 ≥5 条；诊断码可取回并翻译 |
| 4 | Stryker 样例 | `npx stryker run --dryRunOnly`（`spikes/stryker-sample`） | exit 0；记录耗时（校准 mutation 预算） |
| 5 | Playwright 主径 | `npx playwright test tests/smoke/l01-flow.spec.ts` | 选关→运行→通过→重置 全绿并留 trace |
| 6 | MC 镜像预拉 | `docker pull itzg/minecraft-server`（版本按 docs/02 锁定） | ≤10 min / ≤2 GB；起服并 bot 进服成功 |
| 7 | verify + 钩子 | `./scripts/verify.sh --layers l0 && lefthook run pre-commit` | 空仓库全绿，日志落到 verify-reports/ |
| 8 | 红队 harness 自检 | `node qa/red-team.mjs --only RT-01,RT-05,RT-07` | 3 条均被正确拦截或正确报错 |

> 8 项全绿才允许 T1 写产品代码；任一项失败，当日先修「验证机器」，并把失败项写进 STATUS 阻塞栏。
