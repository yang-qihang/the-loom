# qa/ — T1 质量保证（QA）命令与证据索引

> 负责人：scout-assurance｜更新：2026-10-31｜约束：全部只读产品代码，不改 packages/apps/content；不 git commit。

## 1. 一条命令

```bash
bash scripts/verify.sh                  # 默认 l0,l1,l2,l3；全绿时 exit 0
bash scripts/verify.sh --layers l0,l1   # 只跑某几层（排查用）
bash scripts/verify.sh --list           # 列出各层
bash scripts/verify.sh --strict-content # 内容线测试失败也判红（默认只告警，不阻塞 T1 绿）
```

产物：`verify-reports/<UTC>-<task>.log`、`verify-reports/latest.json`、`qa/evidence/qa-verify-latest.json`。

| 层 | 内容 | 命令（verify.sh 内） | 失败判据 |
|---|---|---|---|
| l0 静态 | typecheck + 文案检查（报告型） | `npm run typecheck`、`node scripts/check-copy.mjs --json qa/evidence/qa-copy.json` | typecheck 非 0；copy 命中只记录不阻塞（UI 未就绪） |
| l1 单测 | packages 全部 vitest | `npx vitest run` | 任一测试失败 |
| l2 契约 | 13 份 spec meta 校验 + WorldSnapshot/WorldEvent/评分报告 schema | `npx tsx qa/spec-check.mjs`、`npx tsx qa/contract-check.mjs` | meta/schema 失败 |
| l3 内容验收 | L01 MockWorld 全流程 + 已交付的 `content/levels/*.test.ts` | `npx tsx qa/content-check.mjs`、（有 tests 时）`npx vitest run --config qa/vitest.content.config.ts` | reference 非 3 星 / starter 通过 / 玩家节拍可绕过 |

## 2. 独立 QA 命令（不进 verify 绿门禁）

```bash
npx tsx qa/red-team.mjs      # 6 条红队攻击 → evidence/qa-red-team.json（记录 defended/gap）
npx tsx qa/blind-solver.mjs  # L01 规则盲测（只看玩家可见文本）→ evidence/qa-blind-l01.json
node scripts/check-copy.mjs --json qa/evidence/qa-copy.json [--strict]
```


## 2b. 纯中文 UI 文案 lint（docs/20 §3b）

```bash
npx tsx scripts/check-copy.mjs --pure-zh --json qa/evidence/qa-copy.json   # 报告
npx tsx scripts/check-copy.mjs --pure-zh --strict                          # 有违规 exit 1
npx tsx scripts/check-copy.mjs --self-test                                # 分类器 10 条固定用例
```

- 扫描源：`apps/studio/src/copy/*.json` + `content/levels/*.content.ts` 的 LevelDef 叙述字段 + `packages/level-spec` 的 L01 常量。
- 规则：叙述串里连续拉丁字母（≥2）→ FAIL；豁免：反引号代码引用、代码标识符/表达式、文件名/路径、行号、CLI 命令、模板占位符、按键名、品牌名（与「织界」并列）。
- 专有名词：`Minecraft` / `TypeScript` 必须带中文解释（`Minecraft（我的世界）`）才放行；UI 英文标签 `Run/Stop/Reset/Level/Objective/Coach/Result/Mock` 直接 FAIL。
- 已接入 `scripts/verify.sh` l0：默认**告警不阻塞**；`--strict-copy` 时违规判红。证据里的 `proofOnHead` 用 git HEAD 快照验证检测器（不参与门禁）。


### 2b.1 当前纯中文扫描结果（2026-10-31 13:24 快照）

- **当前工作区：0 条违规**；19 个含拉丁字母的叙述串全部判为合法（豁免 29 token：反引号 18、语言关键字/代码引用 6、行号 4、代码操作数 1）；另有 5 条 WARN（content L02–L04 的 learnerView 含裸 `const/let/if/for`，属世界设计层，建议内容线决定是否改世界观表述或用反引号）。
- **检测器有效性证明（`proofOnHead` 字段，不参与门禁）**：在 HEAD 前一个 commit `6fdcc87` 的 Studio copy 快照上复跑分类器 → **10 条违规 / 8 个字符串**：`Mock`×5、`Minecraft`×3、按键组合×2。Studio 线已在新 commit 的工作区修复；最小修法：
  | 违规 token | 位置（6fdcc87 的 catalog/levels json） | 修法 |
  |---|---|---|
  | `Mock` ×5 | `map.engineOffline`、`workbench.mockPlayerNote`、`workbench.mockTools`、`workbench.mockOnlyLine`、`mode.mock` | 改「模拟」 |
  | `Minecraft` ×3 | `workbench.mockPlayerNote`、`workbench.httpPlayerNote`、`mode.mock` | 改「我的世界」；确需英文时写「我的世界（Minecraft）」 |
  | `Ctrl + Enter` ×2 | `map.footKeys`、`levels.global.ui.keyRun` | 改「回车运行」 |
- 风险：若后续把 HEAD 回滚到清理前版本会重新命中；feature freeze 后应把 `--strict-copy` 升为门禁。

## 3. 证据索引（qa/evidence/）

| 文件 | 内容 |
|---|---|
| `qa/evidence/qa-verify-latest.json` | 最近一次 verify 的分层结果（pass/fail/耗时/log 路径） |
| `qa/evidence/qa-spec-check.json` | 13 份关卡 spec 的 meta 校验逐份结果 |
| `qa/evidence/qa-contract.json` | LevelMeta/WorldSnapshot/WorldEvent/评分报告契约 |
| `qa/evidence/qa-content-l01.json` | L01 内容验收（reference 3 星、starter 失败、缺玩家节拍失败、确定性） |
| `qa/evidence/qa-content-tests.json` | content/levels/*.test.ts 的 vitest JSON（内容线测试；默认告警、`--strict-content` 判红） |
| `qa/evidence/qa-red-team.json` | 6 条红队结果（defended/gap + 修复建议） |
| `qa/evidence/qa-blind-l01.json` | 盲测输入包、solver 程序、attempts/提示/耗时 |
| `qa/qa/evidence/qa-copy.json` | 文案禁用词命中（ui/content-ts FAIL、content-md WARN） |

## 4. 当前红队结论（2026-10-31，MockWorld/runner 层）

- **defended（2）**：RT-01 硬编码→距离校验拦下；RT-11 agent 冒充玩家→`actorType` 拦下。
- **gap（4，已记录待修）**：RT-02 宿主对象（process/eval）可见 → engine 需 worker/进程隔离；
  RT-03 `world.vars` 可被学生改写 → SDK deep-freeze/只读副本；
  RT-04 grade 无快照签名/epoch → engine 必须只喂插件快照并与 session 绑定；
  RT-06 断言/测试无 hash 冻结 → 落地 `scripts/guard-tests.mjs`。
- 这 4 条属于 engine/runner/冻结层，不是本任务写 scope；已写入 `qa/evidence/qa-red-team.json` 供 Lead 分派。

## 5. 已知限制

- l3 对 L02–L04 的覆盖依赖内容线交付 `content/levels/L0X.content.test.ts`；交付后自动纳入（默认只告警，Lead 可用 `--strict-content` 升为判红）。
- 证据统一写 `qa/evidence/`；根目录 `evidence/` 留给 MC e2e 与最终验收包（Lead 指定）。
- 盲测目前是规则 solver（不调 LLM）；LLM/fresh-agent 盲测在 Studio/Engine 就绪后补。
- copy 检查只做禁用词；docs/20 §3 的按钮/错误文案规则需复制评审（docs/22）。

## 6. 专项质量门总表（docs/28）

| Gate | 命令 | 通过判据 | 证据 | 当前状态 |
|---|---|---|---|---|
| G-SCALE | `npx tsx qa/gates.mjs`（内含 validateLevel） | 已实现 content 的 LOC/challenge/hidden 达标 | `qa/evidence/qa-gates.json` | warn（L01 challenge 未实现，docs/24 补强项；L02–L04 pass） |
| G-PURE-ZH | `npx tsx scripts/check-copy.mjs --pure-zh --strict` | 0 违规叙述 | `qa/evidence/qa-copy.json` | pass（T4 前 warn 模式） |
| G-UI-ALIGN | `npx tsx qa/ui-assert.mjs` | 标题 bbox≤2px/不换行/无横向滚动 + 3 屏截图 | `qa/evidence/qa-ui-align.json` | blocked（静态检查 pass；ms-playwright 浏览器未装，无法做真实渲染断言） |
| G-ONBOARD | `npx tsx qa/onboard-check.mjs` | 序章 8 屏/预算 + Studio copy 接线 + 盲读 5/5 | `qa/evidence/qa-onboard.json` | blocked（docs/22 预算 pass、盲读 5/5；Studio copy JSON 缺 prologue/acts/journal） |
| G-REPL | `npx tsx qa/repl-check.mjs` | REPL API+沙箱+超时全绿 | `qa/evidence/qa-repl.json` | blocked（task-35 未实现） |
| G-DESKTOP / G-TOP | `bash qa/desktop-smoke.sh --gate desktop\|top` | tauri build/Xvfb/清理/置顶 API | `qa/evidence/qa-desktop.json`、`qa-top.json` | blocked（桌面壳未接线） |
| G-UX-SIM | `npx tsx qa/ux-sim.mjs --suite all`（verify `--layers ux`） | U1–U6 全绿 | `qa/evidence/ux-*.json`、`ux-shots/` | **warn/fail 记录**：Studio v3 并发改动导致自带 mock-flow 与 UOS 均失败，待 Studio 修复后重跑 |
| G-REG | `npx tsx qa/gates.mjs` | 测试数不低于上次 | `qa/evidence/qa-regression.json` | pass（见文件内 current/baseline） |

**新增功能协议（FAP）检查**：`qa-gates.json.fap` 逐功能检查 spec 文档 + 测试 + 证据三者齐全；缺一律 blocked。新增功能不得降低 `qa-regression.json` 的测试数。

## 7. UOS（用户操作模拟）

- `bash scripts/verify.sh --layers l0,l1,l2,l3,lg,ux`（**默认不跑**；彩排前必跑）。
- `npx tsx qa/ux-sim.mjs --suite happy|error|fresh|desktop|all`；Playwright 配置在 `apps/studio/e2e/playwright.ux.config.ts`。
- 当前结论（2026-10-31 13:34）：Studio 自带 `mock-flow.spec.ts` 也失败 → 判定为 **Studio v3 产品回归**，不是选择器问题；修复建议见 `qa/evidence/ux-summary.json.fixList`。U5 桌面 blocked。
