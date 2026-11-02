# 57 · 对同学 Windows 接手提交的严格审核（2026-11-02）

> 状态：审核结论（BLOCK）｜负责人：Lead｜审核对象：`origin/main` = `85cc282`（`f03b79c` 扁平化提交 + `85cc282` 文档）｜上游：GitHub issue #1/#2/#3、`docs/49-round4-teaching-ux-and-textbook-plan.md`

## 0. 结论

**BLOCK：不能把当前 main 当作「全部验收完成」的交付。** 代码在 Linux 上能过大部分质量门（见 §2），但存在 1 个 issue 硬性要求未满足（C/Make/CMake，且文档互相矛盾并声称已完成）、1 个明确的打包污染、若干「证据/文档与事实不一致」与 1 个流程红线（修改 `qa/**` 未获 Lead 批准）。Windows 侧多数 GUI/打包证据只能由同学机器复现，仓库内没有可复跑的 Windows CI。

建议：保留 `backup/windows-takeover-2026-11-02`（已推送）；把 main 恢复到 `4b1d81c`；在分支上逐条修复 §4 的 blocker 与 §5 的 P1/P2；重跑 §2 全部门禁（Linux 原生 + Windows 同学机 + 真实 Paper e2e）后，按 issue 要求 squash 成一个可审阅提交，再合并 main。

## 1. 审核范围与基线

- 基线（上一个已验证 main）：`4b1d81c`（Round 3 字体/流程/注释/完整解）。
- 被审：`f03b79c`（140 files，+39,093/−568）、`85cc282`（docs/56）。
- 证据：本机 Linux（Fedora，Node 22.23、Java 25、Paper 26.1.2 build 74）与仓库内 Windows 证据文件；命令与日志在 `tmp/review-*.log`、`verify-reports/`、`evidence/`。

## 2. 质量门禁结果（Linux 原生实测）

| 门禁 | 命令 | 结果 | 备注 |
|---|---|---|---|
| 类型检查 | `npx tsc -p tsconfig.json --noEmit`；`-p apps/studio/tsconfig.json` | ✅ 0 | — |
| 单元测试 | `npm test` | ✅ 28 files / 251 tests | 原 25/235 + 新增 3/16 |
| 全量 verify | `bash scripts/verify.sh` | ✅ pass（lg 仅 tracked `G-FRESH-READER` fail） | 首次失败是缺少 `yaml` 依赖，`npm install` 后通过；lock 已更新，干净 clone 用 `npm ci` 可过 |
| content 测试 | l3 层 | ✅ 10 files / 162 tests | — |
| Studio e2e（真实引擎配置） | `npm --prefix apps/studio run test:e2e` | ✅ **37/37**（1.4min） | 新增 5 个 spec 全过 |
| Studio e2e（mock 配置） | `npm run test:e2e:local` | ✅ 4/4 | — |
| 教材校验 | `npm run check:textbook` | ✅ 10 章 / 76,429 字 / 0 error | 结构/生成一致性通过；代码块 67 个语法可解析 |
| 字体覆盖 | `node scripts/check-font-coverage.mjs` | ✅ 缺字 0；2 个 UI 符号走系统 fallback | — |
| 文案门禁 | `scripts/check-copy.mjs --pure-zh --strict` | ✅ 0 违规 | **但教材 md 不在扫描范围（见 P1）** |
| 打包（Linux） | `bash scripts/package-desktop.sh` | ✅ AppImage 435MB / RPM 生成 | 一条命令可出包 |
| 桌面壳 gate（Linux） | `node qa/desktop-smoke.mjs --gate desktop` | ✅ pass（7/7） | — |
| 真实 Paper e2e | `npx tsx it/l1-real.ts`（Linux） | ✅ RESULT PASS | 参考解 3 星；与 Windows 提交的 latest 证据不同（见 P1） |
| 引擎真实回归 | `npx tsx it/engine-paper-regressions.ts`（Linux，25565/8765） | ✅ RESULT PASS（全部 check PASS，含 L10 双 bot/重进/并发会话） | 修复在 Linux 也成立 |
| 冻结测试 guard | `node scripts/guard-tests.mjs --check` | ⚠️ DRIFT | **与基线 4b1d81c 完全相同**（Round 1 前既有基线漂移，不是本次引入）；新测试不在 guard 覆盖 |
| 严格 gates | `npx tsx qa/gates.mjs --strict` | ⚠️ pass 但 G-SCALE/G-UI-ALIGN warn、G-FRESH-READER tracked fail | 均为基线/已知；G-UI-ALIGN 的 UOS 真实渲染证据缺 |
| Windows 门禁 | `scripts/verify.ps1` / `G-DESKTOP-WIN` / `G-TOP-WIN` | ❓ 不可在 Linux 复跑 | 仓库内只有截图/JSON 证据，日志被 gitignore（见 P1） |

## 3. issue #1 任务逐条核对

1. **自动检测任务/自动结算**：✅ 代码 + 单元 + e2e（auto-beat/runtime-recovery）覆盖；`/api/session/:id/snapshot` 带 progress/allPassed；玩家节拍自动确认；手动按钮保留。
2. **剧情浮层左右留白一致**：✅ 重构为固定头/滚动内容/固定底，`narrative-layout.spec.ts` 22 项（4 个视口 × 5 类浮层）通过。
3. **所有代码统一 Maple Mono（不只编辑器）**：✅ 通过 typography e2e（编辑器/参考解/手册/织典/试符台/教材代码块）。
4. **长正文换统一可读中文字体**：✅ 随包 Noto Sans SC 子集（OFL），短标题/按钮仍像素字；与本轮 Lead 之前 Round 3 的「仅编辑器」策略不同，但**与本 issue #1 的要求一致**，不算回退错误。
5. **剧情长文自然滚动**：✅ narrative-layout 低频滚动/可达；L06「商队账本」等在 720×560 也通过。
6. **10 章配套教材 + 独立浮窗（拖动/缩放/置顶/记忆/首次自动打开/回看入口）**：✅ 功能与结构门禁通过；⚠️ 真人学习效果盲测未做（issue 目标是「真的不懂编程的人学会」，这需要人测，AI 不能替代）。
7. **运行鲁棒性（第一次失败后换参考解仍报错）**：✅ 修复为 run 前条件 reset + 语法预检 + SSE Last-Event-ID/runId 过滤 + 双击防重入 + 错误提示透传；有 3 条 runtime-recovery e2e。
8. **C 语言 + Make/CMake 构建流程（课程要求）**：❌ **未满足**。`f03b79c` 里 C icon-gen/CMake/Make 已被删除（`docs/56` §4.2 自述删除），仓库当前无任何 C/C++ 源码/CMake/Make；但 README、STATUS、HANDOFF、docs/49 仍声称「原生 C 模块 + CMake/Make（逐像素等价）」「C 等价 8/8」，HANDOFF 还引用不存在的 `docs/50-native-build-system.md`。**这是 issue 硬性要求未交付 + 文档虚假声明**（见 B3）。
9. **直接提交 main、不破坏现有质量/跨平台**：❌ main 被 force rewrite（issue #3 已说明）；Linux 门禁可过，但 QA 红线与文档/证据一致性不达标；Windows 侧质量门不可在仓库内复跑。

## 4. 阻断项（P0/BLOCK）

- **B1（红线）修改了 `qa/**` 冻结文件**：`qa/gates.mjs`、`qa/spec-check.mjs`、`qa/onboard-check.mjs`、`qa/repl-check.mjs`、`qa/ui-assert.mjs`、`qa/README.md`，新增 `qa/desktop-smoke-win.mjs`。AGENTS §2 规定 `qa/**` 受 hash 冻结；这些是合理的跨平台改造（yaml 替代 python3、npx.cmd、Chrome 探测、截图文件名修正），但**没有 Lead 书面批准**，且 `qa/ui-assert.mjs` 把证据文件名从 `03-workbench.png` 改为 `02-workbench.png` 属于改变 gate 输入，必须先批准并记录等价性证据。→ 修复方式：在分支上由 Lead 明确批准并补 ADR；或回退这些改动、改用不影响 gate 的跨平台适配。
- **B2（issue 硬性要求）C/CMake/Make 未交付**：当前仓库无 C 源码，issue #1 第 8 条未完成；README/STATUS/HANDOFF/docs/49 却声称已交付与「C 等价 8/8」。→ 必须恢复一个**小而有意义**的 C 模块（建议构建期图标生成器，见 §6），带 CMake/Make、JS fallback、逐像素等价测试，并删除所有不实声明。
- **B3（文档真实性）多处不实/失效声明**：README Round 4 写「原生 C 模块 + CMake/Make」；STATUS/HANDOFF 写「C 等价 8/8」；HANDOFF 引用不存在的 docs/50；README 把 Round 4 称为「已完成」而 issue #1 第 8 条未完成、已知 Windows GUI/`G-FRESH-READER` 未清零。违反 AGENTS「不编造事实」。→ 修复：按实际状态重写，未知/未验证标「未验证」。
- **B4（打包质量）shipped world 含测试玩家数据**：`apps/desktop/src-tauri/runtime/real/paper/world/players/{advancements,data,stats}` 内有大量测试 UUID 文件（打包产物 15MB world 含它们；`docs/55` 也已记录该问题未修）。→ 打包前清理 world（players/*、level.dat 备份、logs、world.bak）；加打包断言（players 目录为空/不存在）。
- **B5（构建可复现性）**：干净检出上跑 `npm run desktop:assets` 会修改已跟踪的 4 个图标 PNG（`apps/desktop/src-tauri/icons/*.png`），说明提交的图标与 JS 生成器输出不一致（很可能是已删除 C 版生成器的产物）。任何 build 后工作树变脏 = 可复现性 gate 失败。→ 用当前 JS 生成器重新生成并提交图标，或让生成器输出与已提交一致；加 gate：`desktop:assets` 后 `git diff --exit-code`。

## 5. 高风险项（P1/P2）

- **P1-1 Windows 证据不可在仓库内复跑**：`qa/desktop-smoke-win.mjs` 的 G-DESKTOP-WIN/G-TOP-WIN 依赖 `%LOCALAPPDATA%` 安装产物与本地 logs；`apps/desktop/EVIDENCE-WIN.md` 引用的 `evidence/desktop-win/logs/lifecycle.log`、`~/.loomcraft/logs/*` 被 .gitignore/不在仓库。建议加 Windows CI（或至少把关键 log 脱敏后入库）；否则只能标「同学机验证，仓库不可复现」。
- **P1-2 L01 真实 e2e 证据不一致**：Windows latest 证据里 `l1.starter.report-equals-mock` FAIL（real vs mock starter 报告不一致，hidden h1 差异），而 Linux 本次重跑 `it/l1-real.ts` PASS；STATUS 写「L01 PASS」。这是**平台/采样态差异**，对真实学生判星公平性有影响（docs/55 已自述 h1 采样边界）。必须复现并修 h1/采样，或将 Windows 证据标 tracked FAIL，不能只写 PASS。
- **P1-3 教材 76k 字不在文案门禁内**：`check-copy` 扫描 `ui/contentTs/contentMd`（13 个内容 md），不扫 `apps/studio/src/textbook/content/*.md`（10 章、76,429 字，纯用户可见）。本次人工抽样 L01/L02 未发现 AI 腔/过时 API，67 个代码块语法通过、API 名匹配；但门禁存在覆盖漏洞。建议把教材纳入 copy gate（或独立 `check-textbook-copy`）并加入术语/格式检查。
- **P1-4 新测试未纳入冻结 guard**：新增 `apps/engine/src/{regressions,snapshot-progress,studio-mock-runner}.test.ts`（16 tests）不在 `scripts/guard-tests.mjs` 覆盖范围（只覆盖 packages/content test）；新增测试本身是好事，但应扩大 guard 覆盖，防未来被随意改绿。
- **P1-5 字体策略变更需用户确认**：`docs/20` 把 Round 3「Maple 仅编辑器」改为 Round 4「代码全 Maple + 长文 Noto + 标题按钮像素」，与 issue #1 第 3/4 条一致；但 Lead 之前按用户第三轮口头要求做过回退。**以 issue #1 的文字为准可接受**，但需要用户确认，避免来回改。
- **P2-1** `apps/engine/EVIDENCE.md` 含开发者绝对路径 `/home/yqh0919/...`，应清理。
- **P2-2** L09 参考解/内容仍用旧写法 `place("air", chest)`（STATUS 已知），语义 API 一致性未收尾。
- **P2-3** Studio e2e 从 25s 涨到 1.4min（37 specs），CI 时间成本增加；可拆 smoke 子集。
- **P2-4** `docs/49` 编号/内容与新计划冲突（本分支另有 C++ 计划 docs/58）；文档编号需统一。

## 6. 关于「用 C 重写犄角旮旯」的判断（用户提问）

- 同学最初用 C 重写的是**构建期图标生成器**（PNG 生成，5 个图标），并加了 CMake/Make；`f03b79c` 又把它删了。
- **作为运行期性能构件：这是坏主意**——图标生成是构建期一次性、纯函数、毫秒级，C 不会带来用户/pipeline 性能收益。
- **作为课程要求（issue #1 第 8 条明确要求 C + Make/CMake 构建流程）：这是相对合理的最小切入**——自包含、不碰游戏运行时、输出可用像素等价测试证明、能展示 C/CMake/Make 构建链，且风险远低于把寻路/序列化等核心逻辑改 C。
- **建议：保留（恢复）这个小 C 模块**，但必须：① 作为构建期工具，不作为性能卖点；② JS 版本保留为 fallback，任何平台缺 C 工具链也能构建；③ CMake/Make + 逐像素等价测试 + 文档/证据；④ README 等只写真实状态。若用户认为「课程要求可以通过其它方式满足」，才可删除 C 并同步删掉所有声明；当前删除导致 issue 未完成，不能就这样合并。

## 7. 建议修复顺序

1. 保留备份（已 push `backup/windows-takeover-2026-11-02`）。
2. main 恢复 `4b1d81c`（force-with-lease）；在分支上处理以下内容，不要直接在 main 迭代。
3. 修复 P0：qa 批准/等价性、C 模块恢复、文档真实性、world 清理、图标可复现。
4. 修复 P1：Windows 证据/CI、L01 h1 采样、教材 copy gate、guard 扩围、字体策略用户确认。
5. 重跑 §2 全部门禁（Linux 原生 + 真实 Paper L01/L10/引擎回归 + Windows 同学机 + 安装包冒烟）。
6. squash 为一个 commit（保留 docs/55 说明）后合并；更新 README/STATUS/HANDOFF/docs/49/56 为同一事实。
