# qa/ — 质量保证（QA）命令与证据索引

> 负责人：scout-assurance｜更新：2026-11-01｜约束：全部只读产品代码，不改 packages/apps/content；不 git commit。
> 当前门禁快照（`qa/evidence/qa-gates.json`，2026-11-01）：**7 pass / 2 warn（G-SCALE、G-UI-ALIGN）/ 1 tracked fail（G-FRESH-READER Round 4 未清零）**；`bash scripts/verify.sh` exit 0（lg warn）。

## 1. 一条命令

```bash
bash scripts/verify.sh                  # 默认 l0,l1,l2,l3,lg；全绿时 exit 0（lg 有 tracked warn 时仍 exit 0）
bash scripts/verify.sh --layers l0,l1   # 只跑某几层（排查用）
bash scripts/verify.sh --list           # 列出各层
bash scripts/verify.sh --strict-content # 内容线测试失败也判红（默认只告警，不阻塞 T1 绿）
```

产物：`verify-reports/<UTC>-<task>.log`、`verify-reports/latest.json`、`qa/evidence/qa-verify-latest.json`。

| 层 | 内容 | 命令（verify.sh 内） | 失败判据 |
|---|---|---|---|
| l0 静态 | typecheck + 文案 gate（自然中文 + 术语白名单）+ 测试 hash 冻结 | `npm run typecheck`、`scripts/check-copy.mjs --pure-zh`、`scripts/guard-tests.mjs --check --warn` | typecheck 非 0；copy 默认告警，`--strict-copy` 判红 |
| l1 单测 | `packages/**` vitest（content 测试归 l3） | `npx vitest run packages` | 任一测试失败 |
| l2 契约 | 关卡 meta + WorldSnapshot/WorldEvent/评分报告 schema | `npx tsx qa/spec-check.mjs`、`npx tsx qa/contract-check.mjs` | meta/schema 失败 |
| l3 内容验收 | L01 MockWorld 全流程 + `content/levels/*.test.ts` | `npx tsx qa/content-check.mjs`、（有 tests 时）`npx vitest run --config qa/vitest.content.config.ts` | reference 非 3 星 / starter 通过（content 测试默认告警，`--strict-content` 判红） |
| lg 专项门禁 | docs/28 的 10 个 Gate 汇总 | `npx tsx qa/gates.mjs` | blocked/tracked fail 时 warn（不判红） |

## 2. 独立 QA 命令（不进 verify 绿门禁）

```bash
npx tsx qa/red-team.mjs      # 6 条红队攻击 → evidence/qa-red-team.json（记录 defended/gap）
npx tsx qa/blind-solver.mjs  # L01 规则盲测（只看玩家可见文本）→ evidence/qa-blind-l01.json
node scripts/check-copy.mjs --json qa/evidence/qa-copy.json [--strict]
```


## 2b. UI 文案 lint：自然中文 + 必要英文术语（docs/20 §3b，2026-11-01 更新）

```bash
npx tsx scripts/check-copy.mjs --pure-zh --json qa/evidence/qa-copy.json   # 报告
npx tsx scripts/check-copy.mjs --pure-zh --strict                          # 有违规 exit 1
npx tsx scripts/check-copy.mjs --self-test                                # 分类器 10 条固定用例
```

- 扫描源：`apps/studio/src/copy/*.json` + `content/levels/*.content.ts` 的 LevelDef 叙述字段 + `packages/level-spec` 的 L01 常量。
- 规则（2026-11-01 放宽）：叙述串里连续拉丁字母（≥2）→ 检查是否属于：反引号代码引用、代码标识符/表达式、文件名/路径、行号、CLI 命令、模板占位符、按键名、品牌名、**计算机术语白名单 `TECHNICAL_TERMS`（`for`/`let`/`Promise.all`/`async`/`closure`/`higher-order`/`interface` 等）**、**「中文名（English term）」中英并列**；否则 FAIL。UI 英文标签仍 FAIL。自测 `node scripts/check-copy.mjs --self-test` = 14/14。
- 专有名词：`Minecraft` / `TypeScript` 必须带中文解释（`Minecraft（我的世界）`）才放行；UI 英文标签 `Run/Stop/Reset/Level/Objective/Coach/Result/Mock` 直接 FAIL。
- 已接入 `scripts/verify.sh` l0：默认**告警不阻塞**；`--strict-copy` 时违规判红。证据里的 `proofOnHead` 用 git HEAD 快照验证检测器（不参与门禁）。


### 2b.1 文案扫描结果（2026-10-31 13:24 快照，保留作历史）

> 最新：`qa/evidence/qa-copy.json` 当前 **0 违规**（0 FAIL / 0 WARN），G-PURE-ZH pass。以下为当时快照，勿当现状引用。

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

## 4. 红队结论（2026-10-31 报告，后续已修）

- **defended（2）**：RT-01 硬编码→距离校验拦下；RT-11 agent 冒充玩家→`actorType` 拦下。
- **原 gap（4）处置**：RT-02 宿主对象 → `packages/runner/src/sandbox.ts` worker_threads+vm 沙箱；RT-03 `world.vars` 改写 → `packages/mockworld/src/index.ts` deepFreeze/只读副本；RT-04 grade 未绑快照 → session/epoch 校验；RT-06 测试无 hash 冻结 → `scripts/guard-tests.mjs`（已接入 verify l0，warn）。
- 结论以 `qa/evidence/qa-red-team.json` + 对应测试为准；本表保留原始红队记录。

## 5. 已知限制

- content 测试（`content/levels/*.test.ts`）默认只告警，Lead 可用 `--strict-content` 升为判红。
- G-FRESH-READER 仍是 tracked fail（Round 1 证据 `qa/evidence/fresh-reader-round1.json`），Round 4 复读未清零前不得写「完成」。
- 证据统一写 `qa/evidence/`；根目录 `evidence/` 留给 MC e2e 与最终验收包（Lead 指定）。
- 盲测目前是规则 solver（不调 LLM）；LLM/fresh-agent 盲测在 Studio/Engine 就绪后补。
- copy 检查只做禁用词；docs/20 §3 的按钮/错误文案规则需复制评审（docs/22）。

## 6. 专项质量门总表（docs/28）

| Gate | 命令 | 通过判据 | 证据 | 当前状态 |
|---|---|---|---|---|
| G-SCALE | `npx tsx qa/gates.mjs`（内含 validateLevel） | 已实现 content 的 LOC/challenge/hidden 达标 | `qa/evidence/qa-gates.json` | warn（L01 参考解 8 行触底、L02–L04 已达标；docs/24 补强项仍开放） |
| G-PURE-ZH | `npx tsx scripts/check-copy.mjs --pure-zh --strict` | 0 违规叙述 | `qa/evidence/qa-copy.json` | pass（T4 前 warn 模式） |
| G-UI-ALIGN | `npx tsx qa/ui-assert.mjs` | 标题 bbox≤2px/不换行/无横向滚动 + 3 屏截图 | `qa/evidence/qa-ui-align.json` | warn（系统 Chrome 下 9 pass / 1 warn，无 blocked） |
| G-ONBOARD | `npx tsx qa/onboard-check.mjs` | 序章 8 屏/预算 + Studio copy 接线 + 盲读 5/5 | `qa/evidence/qa-onboard.json` | pass（10/10） |
| G-REPL | `npx tsx qa/repl-check.mjs` | REPL API+沙箱+超时全绿 | `qa/evidence/qa-repl.json` | pass |
| G-DESKTOP / G-TOP | `node qa/desktop-smoke.mjs --gate desktop\|top` | tauri build/Xvfb/清理/置顶 API | `qa/evidence/qa-desktop.json`、`qa-top.json` | pass |
| G-UX-SIM | `npx tsx qa/ux-sim.mjs --suite all`（verify `--layers ux`） | U1–U6 全绿 | `qa/evidence/ux-*.json`、`ux-shots/` | pass（UOS 4/4） |
| G-REG | `npx tsx qa/gates.mjs` | 测试数不低于上次 | `qa/evidence/qa-regression.json` | pass（packages 62 + content 162 = 224 用例，当前=baseline） |

**新增功能协议（FAP）检查**：`qa-gates.json.fap` 逐功能检查 spec 文档 + 测试 + 证据三者齐全；缺一律 blocked。新增功能不得降低 `qa-regression.json` 的测试数。

## 7. UOS（用户操作模拟）

- `bash scripts/verify.sh --layers l0,l1,l2,l3,lg,ux`（**默认不跑**；彩排前必跑）。
- `npx tsx qa/ux-sim.mjs --suite happy|error|fresh|desktop|all`；Playwright 配置在 `apps/studio/e2e/playwright.ux.config.ts`。
- 当前结论（2026-11-01）：UOS 4/4、Studio 主 e2e 6/6、local e2e 2/2 通过；G-UX-SIM pass。历史失败记录（2026-10-31 13:34）保留在 `qa/evidence/ux-summary.json`。
