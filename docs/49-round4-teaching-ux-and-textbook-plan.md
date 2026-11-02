# 49 — Round 4：教学体验、配套教材与跨平台工程化（已完成）

> 状态：已完成（2026-11-01，代码已推送 main）｜负责人：Lead｜最后更新：2026-11-01
> 上游：用户 2026-11-01 的 10 项反馈（自动结算 / 剧情排版 / 字体 / 长文滚动 / 配套教材 / 编辑器鲁棒性 / C 与构建系统 / 全量同类修复 / 质量门与提交规范）
> 结果：提交 `715b8e5`（剧情浮层+字体）、`31580e3`（自动结算+鲁棒性）、`1d87085`（教材窗口+内容+接入）、`c1ba514`（教材 L01–L05）、`4227b5d`（原生 C + CMake/Make）；最终数字见 §3/§5 与 `STATUS.md` 顶部。

## 0. 反馈 → 目标

| # | 用户反馈 | 本轮目标 |
|---|---|---|
| 1 | 玩家在 MC 完成最后一步后游戏内已有提示，但 Studio 目标不更新、要手动点「我已…」 | 引擎 snapshot 附带 progress，Studio 每秒自动同步目标；全部达成后自动 confirm 并自动结算（保留手动兜底） |
| 2 | 序章/幕开场多页剧情文本左右留白不对称 | overlay 重构：对称 padding + 不依赖 `scrollbar-gutter`（桌面壳 WebKitGTK 可能不支持） |
| 3 | 参考解等【代码】仍像素字体 | 所有代码渲染点统一嵌包 Maple Mono（`--font-code`） |
| 4 | 像素字体过度使用 | 长段正文换 Noto Sans SC（OFL，嵌包、跨平台一致）；短标题/按钮/标签保留像素字体 |
| 5 | 关卡开场长文（L06 商队的账本）被裁切、无滚动条 | header 固定 + 内容区自然滚动（悬浮滚动条、滚轮/键盘/拖拽/触屏），小视口不裁切 |
| 6 | 引导不够，需要 10 幕配套“教材” | 每关一章长文（≥2800 汉字，含代码示例，SICP 式从直觉到抽象），独立弹出窗口（拖动/缩放/置顶/随时回看） |
| 7 | 第一次失败后粘正确参考解仍报错 | runId 关联 + 旧/回放事件过滤 + 后端错误原因透传 + 错误后状态重置；e2e 回归 |
| 8 | 课程要求 C 代码 + Make/CMake 构建流程 | 图标生成器 C 重写（逐像素等价、可回退），CMake + 顶层 Makefile + 等价性脚本 + 文档 |
| 9 | 同类问题全量排查 | 每个 WP 内做同类扫描；overlay/长文滚动、代码渲染点、错误态路径都列清单修复 |
| 10 | 质量门、直接提 main、Windows 不破坏 Linux 基线 | tsc/npm test/e2e/verify/文案门禁；每 WP 提交后 push；Linux 打包流程零回归 |

## 1. 工作分解（任务板）

| WP | 任务板 | 负责人 | 主要写范围 | 验收 |
|---|---|---|---|---|
| WP1 剧情 overlay 布局/滚动 | task-1 | narrative-ui | onboarding.tsx、narrative.css、main.tsx(import)、playwright.config、e2e/narrative-layout.spec.ts、evidence/narrative-layout | tsc 0；三档视口 gap 对称 ≤1.5px、无裁切、可滚到底；既有 e2e 不回归 |
| WP2 字体系统 | task-2 | typography | styles.css、typography.css、public/fonts、src/assets/fonts、components 类名、e2e/typography.spec.ts、字体构建脚本 | 所有代码元素 Maple Mono；长文 Noto Sans SC；按钮/短标题仍像素；字体覆盖测试；包体积记录 |
| WP3 自动同步 + 运行鲁棒性 | task-3 | runtime-ui | Workbench.tsx、PositionHud.tsx、engine server、httpEngine、types、session、apps/engine/src/*.test.ts、e2e/auto-beat+runtime-recovery | 自动结算 e2e PASS；引擎 snapshot progress 契约测试 PASS；旧事件不回灌；错误原因可见 |
| WP4 教材内容 A | task-4 | textbook-writer-a | studio/src/textbook/content/L01–L05.md（原计划 chapters/*.ts，改为 Markdown 源） | 每章 ≥5500 汉字、4–8 代码块、术语/callout/错误清单齐全；构建校验 0 error |
| WP5 教材内容 B | task-5 | textbook-writer-b | content/L06–L10.md | 同上 |
| WP6 教材窗口 UI | task-6 | textbook-ui | components/textbook/**、e2e/textbook-window.spec.ts、evidence/textbook-window | tsc/build 0；拖动/缩放/置顶/持久化；代码 Maple、正文可读字体；e2e（Lead 接入后） |

**完成情况（2026-11-01）**：WP1–WP8 全部完成并合入；WP4/WP5 实际交付为 Markdown 源 + `scripts/build-textbook.ts` 生成 `library.generated.ts`（10 章合计 76,429 汉字）；WP6 由 Lead 接入 App（自动打开/已读/常驻入口）并重写集成 spec；WP8 的真机 e2e/文档/提交全部完成。
| WP8 接入与验证 | Lead | Lead | App/Workbench 教材入口、textbook index + 内容校验测试、e2e config 注册、真实 Paper e2e、verify、文档、提交 | 全部质量门绿 + 真机 e2e + 视觉验收 + 提交 push |

## 2. 设计决策

### 2.1 字体策略

- **代码**：一律 Maple Mono（已嵌包，`--font-code`）。覆盖 Monaco、SolutionViewer、GuidanceManual、CodexScreen、ReplScreen、CoachCard/ResultCard/错误条、RichText inline-code、教材代码块。
- **正文**：Noto Sans SC（OFL-1.1，嵌包、子集化 woff2、附 LICENSE；两权重）。覆盖剧情/开场/手记/教练卡长句/教材正文。
- **像素字体**：保留给 `h1–h3` 等短标题、`.btn` 按钮、chip/标签/小 caption 等「信息量少、可读性要求低」的元素。
- 原则：**代码 = 代码字体；长文 = 可读正文字体；短标题/按钮 = 风格字体**，三者不混用。

### 2.2 剧情 overlay 布局

- `narrative.css` 新文件；不动 `styles.css` 布局。
- 结构：overlay（固定）→ card（固定 header / 可滚动 body / 固定 footer actions）。
- 滚动：内容区 `overflow-y:auto` + 隐藏原生滚动条对布局的影响（`scrollbar-width:none` / `::-webkit-scrollbar{display:none}`），自绘悬浮滚动条（绝对定位，不占布局）；滚轮/PageUp/PageDown/方向键/拖拽/触屏；顶部底部渐隐。
- **左右留白恒对称**：不依赖 `scrollbar-gutter`（桌面壳 WebKitGTK 兼容性不确定）；自动化断言 `|gapLeft-gapRight| ≤ 1.5px`（1440×960 / 1280×840 / 896×603，含滚动出现档）。
- 根治小视口裁切：narrative-stage 不再被父级 flex 收缩（`flex: none`），内容高度随内容增长，由 body 滚动。

### 2.3 玩家节拍自动检测

- 真值：`evaluateProgress(def, snapshot)` 纯函数；`playerBeatReady` 只代表「玩家步骤之前的都完成」，**完成判定必须同时要求 progress 全 passed**。
- 引擎：`GET /api/session/:id/snapshot` 附带 `progress`（含 `player` 标志）、`playerBeatReady`、`allPassed`、`sessionEpoch`（顶层 + 嵌套 snapshot 都带，避免 `HttpEngine.snapshot` 取嵌套时丢字段；顶层 `epoch/sessionId` 会被插件值覆盖，不作去重依据）。
- Studio：PositionHud 轮询回调（1s，页面隐藏暂停）→ Workbench 按 id 实时同步 goals；当 `state==="READY" && allPassed && hasPlayer && !passed` 时一次性调用 `engine.playerBeat(sessionId)`（**不传 simulate**：paper 默认 confirm-only，mock 自动模拟）；inFlight + progress signature + reset 后抑制窗口防抖；手动「我已在游戏里完成」保留为兜底。
- 游戏内完成提示已由插件发出（`SceneManager.completeBeat` 的 title/subtitle），不重复添加。
- 测试：`apps/engine/src/snapshot-progress.test.ts`（fake paper runtime + MockWorldPort，验证 snapshot progress 与 confirm-only）；`apps/studio/e2e/auto-beat.spec.ts`（route 改写 snapshot 模拟世界侧 3/3，断言不点按钮自动 settle）；真实 Paper 侧在 `it/playtest-fix/after-acceptance.mjs` 补 snapshot progress 断言（Lead）。

### 2.4 运行状态鲁棒性（用户任务 7）

- `/api/run` 返回 runId；SSE error/result 带 runId；Studio 只接受当前活跃 run 的事件，旧事件/断线回放一律丢弃。
- `HttpEngine.request` 非 2xx 时解析后端 `{error:{message,hint}}`，错误卡展示真实原因（STALE_SESSION / 引擎离线 / 状态不允许运行 …），并给可操作建议（重置后重试）。
- 新 run 开始彻底清空上一轮 error/errorHold/log/hint；引擎侧 run-after-error 必须回到 READY（补测试）。
- 回归：引擎测试 + Studio e2e（错误→参考解→自动结算），见 WP3 验收。

### 2.5 配套教材

- 内容模型：`apps/studio/src/textbook/types.ts`（blocks：p/h2/h3/code/list/terms/callout/rule）。
- 写作规范与分章 brief：`apps/studio/src/textbook/README.md`。
- 内容：`chapters/L01.ts`…`L10.ts`（两 writer 并行），聚合 `textbook/index.ts`（Lead）。
- 校验（Lead 写 `content/textbook.test.ts`）：10 章齐全；块结构合法；代码块可被 esbuild 解析；代码示例 API 不越级（按 packages/sdk api-registry）；字数/代码块/术语下限；terms 中英文成对。
- UI：`components/textbook/TextbookWindow.tsx`（非模态 portal、拖动、缩放、置顶、关闭、章节导航、位置/尺寸/状态持久化）+ `TextbookContent.tsx`（正文可读字体、代码 Maple Mono + 复制、callout、terms）。
- 首次阅读流程（Lead 接入 App/Workbench）：进入关卡后若本章未读，自动打开教材窗口，窗口底部「开始写代码」关闭；之后可从工作台顶栏/手记入口随时回看；已读状态 localStorage（`loom.textbook.read.v1`）。
- 与剧情关系：教材可引用世界概念，但不复述剧情；按「直觉动机 → 定义 → 语法/示例 → 常见错误 → 与关卡任务的关系 → 小结练习」组织。

### 2.6 C 模块与构建系统（课程要求）

- 文档：`docs/50-native-build-system.md`（选型理由、构建流程、等价性证据、回退策略、Linux 基线说明）。

## 3. 质量门与验收矩阵（实际结果）

| 门 | 命令 | 实际结果 |
|---|---|---|
| 类型 | `node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit` | **exit 0** |
| 单测 | `node node_modules/vitest/vitest.mjs run` | **28 files / 251 tests 全绿**（新增引擎回归 16 条：snapshot-progress 6、regressions 7、studio-mock-runner 3） |
| 内容/教材 | `npx tsx scripts/build-textbook.ts --write` | **10 章 / 76,429 汉字 / 校验 0 error**（每章 6.5k–9.7k 字、5–8 代码块、10–12 术语） |
| Studio mock e2e | `npm --prefix apps/studio run test:e2e:local` | **4/4 PASS**（mock-flow 2 + typography 2） |
| Studio real e2e | `npm --prefix apps/studio run test:e2e` | **37/37 PASS**（含 narrative-layout 22、typography 2、textbook-window 1、auto-beat 2、runtime-recovery 3 + 既有 7） |
| 真实 Paper e2e | `it/l1-real.ts`、`it/l10-real.ts`（Windows Paper 25567） | **L10 PASS**；L01 主流程 PASS，唯一 FAIL 为已知 `l1.starter.report-equals-mock`（hidden h1 采样边界，见 §5） |
| 引擎 P0 回归 | `it/engine-paper-regressions.ts` | **PASS（全部检查通过）**：会话串行化/reentry 无 503、并发创建单会话、L10 双织偶在线 → 参考解等待玩家（playerBeatReady）→ 显式 simulate 3 星、离开后额外 bot 回收、主 bot 单次登录；证据 `evidence/engine-paper-regressions-latest.json` |
| 文案 | `node scripts/check-copy.mjs` | 0 banned/FAIL（教材写作时逐章复核） |
| 视觉验收 | Playwright 截图 + 模型视觉检查（overlay 边距/滚动、字体、教材窗口、工作台） | 已查看序章长文、教材窗口、工作台截图：留白对称、可读、代码字体正确 |

## 4. 提交与发布（实际执行）

- 用户要求「完成一个阶段就及时 commit + push」：本轮按 5 个提交推送 main —— `715b8e5`、`31580e3`、`1d87085`、`c1ba514`、`4227b5d`；每个提交附验收命令与数字。
- 发布：AppImage/RPM 仍由同学在原生 Linux 侧打包；本轮保证 **Linux 源码构建/测试基线不回归**（无新增 npm 依赖、未动版本锁、C 工具为可选路径且无 C 时自动回退 JS），Windows 侧只做跨平台增强（Playwright webServer env 写法）。

## 5. 风险与遗留（实际结论）

- **首次失败污染后续运行**：已在 mock 世界 + Studio 真 UI 稳定复现并定位为「同一 GameSession 内 run 之间不恢复场景」，修复为 session 层条件自动恢复 + 引擎回归；另加真语法检查、runId/SSE 过滤、错误透传、双击防重入。**残余风险**：paper 模式下自动恢复会把玩家位置/背包恢复到检查点（语义上等价「重置本关」，属预期代价；后续可优化为只还原 agent 改动）。
- **L01 hidden `h1` 采样边界**：`it/l1-real.ts` 负例仍 FAIL（Mock 判 h1 过、真实 Paper 偶发不过，差 1 星）——为本轮之前既有问题，不影响 L01 正常通关（主流程 3 星 PASS），列入下一轮优先级。
- **桌面壳 WebKitGTK 渲染差异**：字体（Noto 子集/Maple）与自绘滚动条已按不依赖 `scrollbar-gutter` 实现，但 Playwright 只覆盖 Chromium；需 Linux 侧重新打包后真机复验。
- **教材体量/文风**：10 章 76,429 字，结构/API/语法由脚本校验，文风与教学效果需真人/Fresh Reader 复读；`L09` 取金苹果仍是旧写法 `place("air", chest)`（教材已标注为旧写法），建议下一轮改 `collect`/`deposit` 语义 API。
- **C 图标工具**：无 zlib 的 Windows 本机构建用 stored-deflate（产物偏大，仅构建产物不入库）；Linux 打包侧装 zlib 则正常压缩。契约是「像素 + PNG 结构一致」，不是文件字节 hash。
- **SSE 帧格式的兼容性**：/api/events 现在按 SSE 标准发送 `id:` 帧（供断线续传）；仓库内两个手写 SSE 解析器（`it/engine-paper.ts`、`it/engine-paper-regressions.ts`）原先只接受以 `data:` 开头的帧，会静默丢事件（表现为「run 结果等不到」）。已修成「按行收集 data 行」的通用解析；**第三方自定义解析器若同样的假设需同样修**（浏览器 EventSource 不受影响）。
- **noto 子集覆盖**：7554 码点（GB2312 + 仓库扫描），新增生僻字需重跑 `scripts/build-font-subset.py`；`✗/✕` 两符号字库不含，走系统 fallback（清单已记录）。
- **测试与自动化**：默认 real-config e2e 已是 37 个用例，单 worker 约 2.5–3 分钟；Playwright 在本机需 `chrome` channel 与系统 Chrome（HANDOFF §1）。

