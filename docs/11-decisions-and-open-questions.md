# 11 — 决策记录（DECISIONS）与待用户确认事项

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 格式：轻量 ADR（Status / Context / Decision / Consequences / Alternatives / Revisit Trigger）
> 规则：任何 agent 不得静默改变这里的决定；要改必须写新 ADR 并由 Lead 记录。人类只需看 §13 的待确认清单。
> 历史说明（2026-11-01 文档审计）：本文件是设计期决策记录（D1–D43），**保留原决策不改**；2026-11-01 的接口/进度/节拍变更以 `docs/46-playtest-fix-plan.md` §2 的新契约为准。
> 上游：BRIEF.md、docs/09-execution-plan.md、docs/18-comparison-other-plan.md

---

## D1 学生语言 = 收窄的 TypeScript（LoomTS）

- **Status**：Accepted（2026-10-31，证据见 `docs/03-language-decision.md`）
- **Context**：用户要一门真实、现代、能 hide noise 的语言；MC 生态在 JS；4 天 AI 交付；需要承载 ADT/接口/异步/并发教学。
- **Decision**：学生写 TypeScript 子集。锁定 typescript@6.0.3（语言服务/类型 API）、esbuild 0.28.2（剥类型/打包）、Monaco 0.57.0（编辑器）；不教宏；类型后置（L1–L4 无注解，L5–L7 渐进，L8+ strict 但类型错误不阻断运行）；学生不写 import（SDK 通过 globalThis 注入）；语法白名单/黑名单见 03 §3.1。
- **Consequences**：4 天风险最低；AI 代码质量最高；代价是「宏/语言设计」只能作为 Codex/Lab 彩蛋，且要严格控制类型噪音。
- **Alternatives**：自造语言（拒：parser+运行时+工具链成本）；Racket（拒：MC bridge + UI 全在 JS + AI 速度）；Python（拒：MC bot 生态弱）。
- **Revisit**：若 Day1 证明 TS 类型噪音会显著劝退（盲测失败率 >40%），放宽为「Act I 完全无类型诊断」。

## D2 MC 集成 = 单逻辑 API（WorldPort）+ 双物理通道

- **Status**：Accepted（M0 实证通过 2026-10-31：双通道 7/7，版本锁见下，详见 `docs/02-minecraft-stack.md`）
- **Context**：Mineflayer 是「玩家客户端」——能控 bot（移动/挖掘/放置/背包/寻路），不能控其它实体；世界/entity/NPC/过场/评分真值需要服务端权威 → 需要 Paper 插件。
- **Decision**：学生只看到统一的 `golem`/`world` SDK。引擎把操作路由到两条物理通道：
  - **玩家能力通道**：Mineflayer bot（外观做成「织偶 automaton」）→ 移动/挖掘/放置/背包/多 bot；
  - **世界逻辑通道**：Paper 插件（WebSocket JSON-RPC）→ 场景搭建、实体/NPC、过场、粒子/音效/advancement/bossbar、评分真值、玩家传送。
  - 再补一个 **record/replay fake WorldPort**（QA 用，无 MC 也能跑验收）——来自 assurance 研究的建议。
- **Consequences**：架构复杂度 +1 个进程，但获得「MC 原生 + 世界逻辑 + 评分可信」；两条通道的一致性是关键风险（契约测试 + WorldDigest golden）。**不可协商**：MC/Paper 26.1.2 build 74 + Java 25 + mineflayer 4.39.0，禁止升级（mineflayer #4189）；世界真值只信插件，bot 状态仅表示意图/预测；重置/传送/开门用插件，不依赖 bot 走位。
- **Alternatives**：只用 Mineflayer（拒：控不了实体/拿不到权威真值）；op-bot 命令通道（保留为降级方案 A：`/setblock`、`/summon`、`/particle`、datapack 辅助）；Fabric mod（拒：构建/客户端同步风险，4 天不划算）；Carpet fake player（拒：需要 Fabric 服务端，与 Paper 插件不共存）。
- **Revisit**：M0 spike 失败 → 降级方案 A（命令通道）或方案 B（Mock 世界 + 预录 MC 画面）。

## D3 内容即数据：SceneScript + 断言 + 教练脚本

- **Status**：Accepted
- **Decision**：关卡 = 声明式场景/演出脚本（primitive 白名单 29 个（另 docs/02b 建议增补 8 个、删 2 个，CP1 冻结前定稿））+ 机器可判定断言（successCriteria/trials/hiddenTests）+ 教练脚本（对话/提示/错误映射）。AI 关卡作者不写 Java；插件提供通用 primitive；实现期 spec = `defineLevel()` TS 配置（zod 校验）。
- **Consequences**：内容生产可并行、可校验、可被 AI 批量生成；代价是 primitive 设计要先于关卡冻结（CP1 后接口冻结）。
- **Alternatives**：每关写自定义插件代码（拒：不可维护、AI 易出错）。
- **Revisit**：若某关需要 white-list 之外的 primitive，先加 primitive 再写关卡，不允许关卡私有代码。

## D4 世界美术 = seed-first（原生世界当舞台）

- **Status**：Accepted
- **Context**：4 天无法手工搭出好看的 MC 场景；AI 也不擅长逐方块造景。
- **Decision**：用固定 seed 的原生世界生成（村庄/峡谷/矿洞/平原/要塞）作为舞台；插件只做「参数化道具」（灯柱、房子模块、桥段、仪式圈）+ setBlock 局部修改 + 实体/演出。seed 在 M0 选定并锁死；演示用 fixed seed。**M0 细化**：Act I（L1–L4）优先「自然村庄 + 局部平整短路径 + 和平难度」保证 pathfinder 稳定；Act II 起扩展自然地形；结构/村庄坐标 Day1 用 `locateNearestStructure` 预存 spec，运行时只传送（不在运行时碰运气）。
- **Consequences**：MC 原生质感最好、成本最低；代价是场景受地形约束，关卡坐标要按实际地形校准（用 anchor 定位 + 运行时读取）。
- **Alternatives**：手工搭建/结构文件（慢且 AI 不会造景）；超平坦（失去 MC 味道）。
- **Revisit**：若某关地形不满足（如峡谷桥），用参数化 builder 在自然地形上补，不整体重造。

## D5 课程 = 3 Act / 10 关 + 4 Labs，P0–P3 分级

- **Status**：Accepted
- **Decision**：L1–L10 + Epilogue + Lab-R/Lab-T（P2）/Lab-M/Lab-C（P3）；每关 10–25 分钟，含 2–3 子任务；抽象顺序见 `docs/05-curriculum.md` §3；优先级：P0 = L1–L5（垂直切片与地基），P1 = L6–L9（全貌），P2 = L10/EP/Labs，P3 = 彩蛋。
- **Consequences**：总时长 2.5–3.5h，与短关卡合集学习时间同量级；若进度落后按 09 §6 降级。
- **Revisit**：Day3 12:00 DP2（Act II 可玩关 <2 → 砍 L8、L10 变预录）。

## D6 叙事主题（working title）：**织界 / THE LOOM**

- **Status**：Accepted as working title（允许创意团队微调）
- **Decision**：Minecraft 村庄「灰岩村」的古老织机 = 世界法则；符文 = 编程抽象；标准银河字母 = 符文；关卡选择 = 制图台/地图墙；魔像「织偶」= 玩家程序驱动；「散线」= 磨损（非暴力反派）。玩家与 NPC 艾拉（最后的织者）修复三枚织核。
- **Consequences**：所有 UI/文案/关卡叙事统一；美术资产需求低（MC 原生方块+粒子+标准银河字母）；可做地图画/成就图标。
- **Alternatives**：太空/魔法学院/赛博朋克——都更贵且不 MC 地道。
- **Revisit**：CP1 玩家反馈「设定看不懂/不喜欢」→ 只改文本不改结构。

## D7 验收 = Blind-First（文本/状态真值优先）

- **Status**：Accepted
- **Decision**：机器验收只依赖服务端世界状态 + 事件流 + WorldDigest（JSON/ASCII）；截图/录屏只作人类审美证据；盲测 solver 用「玩家可见信息」验收关卡；不依赖模型视觉做正确性判断。
- **Consequences**：AI 无视觉也能闭环；审美验收必须有人类 checkpoint；WorldDigest 成为核心基础设施。
- **Revisit**：无（这是质量底线）。

## D8 平台与版本锁定

- **Status**：Accepted（M0 锁定：MC/Paper 26.1.2 build 74 / Java 25 / mineflayer 4.39.0 / minecraft-protocol 1.68.0 / Fill API v3；详见 docs/02）
- **Decision**：Minecraft Java Edition + Paper 服务端（版本以 M0 实证锁定）；Mineflayer 锁定与 Paper 兼容版本；Node 22.23.1；JDK 25（插件 target 按 Paper 要求）；Docker（itzg/minecraft-server）跑集成测试；UI = Vite + React + Monaco（浏览器），MC Java 客户端是舞台画面。
- **Consequences**：不做跨版本兼容；升级视为新项目。
- **Revisit**：M0 若发现版本不可用 → 锁低一档稳定组合；绝不追最新快照。

## D9 UI 形态：双窗口（MC 客户端 + 浏览器工作室）

- **Status**：Accepted
- **Decision**：Studio（浏览器）= 关卡选择（制图台/地图墙）/编辑器/教练面板/Codex/WorldDigest 调试视图；MC Java 客户端 = 世界画面与玩家操作。demo 用双窗口并排（投影/录屏）；prismarine-viewer 作为「无客户端」兜底（P2，视 M0 结论）。
- **Consequences**：真实 MC 观感最好；代价是切换窗口/双屏需求；录屏需画中画合成。
- **Revisit**：演示机不适合跑 MC 客户端 → 启用浏览器内 3D 或预录。

## D10 AI 工作流 = 证据优先的多智能体 + 8 层质量门

- **Status**：Accepted（详见 `docs/08-ai-workflow.md`）
- **Decision**：Role/RACI + G0–G6 门禁 + 四行证据协议 + 测试 hash 冻结 + 独立 Reviewer（fresh）+ 红队 + 盲测 + mutation 只打 grading/protocol/worlddigest + 人类 3 个 checkpoint，总人类投入 ≤4h。
- **Consequences**：多花约 15–20% 时间在验证上，换取「AI 幻觉不进入主分支」；报告可把工作流本身作为方法贡献。
- **Revisit**：若 Day2 出现连续 4h 无法绿色 verify → 降级为「两人一任务 + 更频繁集成」。

## D11 范围分层与砍单顺序

- **Status**：Accepted
- **Decision**：P0 L1–L5（必须完美）→ P1 L6–L9（全貌）→ P2 L10/EP/Labs → P3 彩蛋。砍单顺序：P3 → P2 → Lab → L8（降 Lab）→ L10（预录）→ L9（只留演示片段）→ L6 深水区。**永不砍**：L1 垂直切片、L1–L4 闭环、错误翻译、提示梯、重置、一键启动、录屏、报告的局限页。
- **Revisit**：DP1/DP2/DP3/DP4（09 §6）。

## D12 项目定位：课程汇报 + 可继续演进的原型

- **Status**：Accepted
- **Decision**：4 天交付「可演示的教学游戏垂直切片 + 完整设计/工作流」；不追求发行级完成度；报告诚实写局限；代码/文档结构化以便后续学期继续做（Act III、更多关卡、Racket 版实验）。
- **Consequences**：避免过度工程；但架构不能是一次性 demo（WorldPort 抽象、场景数据化、关卡 spec 体系都要能演进）。

---

## 13. 待用户确认（最多 8 项，按影响排序）

| # | 问题 | 为什么需要 | 默认假设（未回复时采用） |
|---|---|---|---|
| Q1 | 演示机是否装了 Minecraft Java 客户端？能否双窗口（MC + 浏览器）？ | 决定 demo 形态与 Day0 是否要装客户端 | 假设能装；否则用 prismarine-viewer/预录 |
| Q2 | 4 天是否包含今天？人类每天可介入的时间窗口？ | 决定 checkpoint 时间与 agent 排班 | 假设 T1 从明天 09:00 开始；人类 3 个 45min 窗口 |
| Q3 | 汇报时长/形式/受众 PL 背景？ | 决定 demo 深挖到 L9/L10 还是只讲基础 | 假设 7–10 分钟 demo + 5 分钟 Q&A；受众含 1–2 位懂 PL 的老师 |
| Q4 | 是否允许联网下载依赖（Paper jar / npm / Docker 镜像）？ | M0 spike 与构建 | 假设允许（本机已确认可用） |
| Q5 | 报告页数/格式/是否需要 PPT？ | 决定 docs/10 的产出 | 假设 10 页内 + 可选 PPT |
| Q6 | 项目是否公开（GitHub/展示）？ | 影响 MC 资产/皮肤/资源包许可处理 | 假设仅课程内部演示，不分发 MC 资产 |
| Q7 | 你能投入多少「非技术」帮助（演示操作、美术意见、找 4–6 位试玩同学）？ | 影响 CP1 试玩与评估样本 | 假设能找 4 位同学试玩 25 分钟 |
| Q8 | 是否有既定课程主题/必须回答的问题（例如必须对比某语言）？ | 影响报告叙事 | 假设无强约束，按 05/10 叙事 |

## 14. 审计后的补充裁决（2026-10-31，回应 docs/00）

- **D13 L8 属 Act II**（接口/组合 = 结构之核）。执行计划中「Act III 候选 L8」的说法一律以 Act II 收尾处理。
- **D14 L1 不做坐标随机化**：L1 是教学样板、布景固定，隐藏测试只查「真的走过去/没乱放」；随机化从 L2 起。参考解必须能过隐藏测试。
- **D15 import 从 L5 开放**：L1–L4 禁用 import，SDK 全局注入；L5 起学生写 `import { buildHut } from "./blueprints"`（模块教学），esbuild 自动打包，学生仍看不到构建配置。
- **D16 评分契约单一来源**：`g` 判定 API 以 `docs/06` §5.2 为准；`byPlayer` 语义用 `actorType`（真玩家 vs 织偶），事件表以 `docs/07` §3.3 为准。
- **D17 符号计数口径**：`apiIntroduced` 教学符号 ≤5/关；同族方法（tryReceive/waitIdle）与纯演出 harness（runTablet/writeRune）不计入，但必须在 `apiAllowlist` 标 `kind`。
- **D18 primitive 白名单**以 `docs/02b` §6 的修正版为准（增 gamerule/clearEntities/spawnItem/setBlockBatch/trialPatch/device/display/setChunkForceLoaded，删 saveSnapshot/restoreSnapshot），CP1 冻结前定稿；`unlockHint` 不是 primitive，提示由引擎触发。
- **D19 L8 机器由 SDK 提供**：学生不手写三台设备实现，只写 `runAll` + `combine` 调度/组合逻辑（docs/05 L8 已同步改）。理由：降低类型语法负担、保证一关一抽象。
- **D20 L9 运行模式**：L9 切 `runMode: "explicit"` + 按关卡 `timeLimitSec+10s` 覆盖 worker 默认 3s 超时（否则顺序/并发对比不成立）。

## 15. Level-Kit 契约裁决（回应 docs/06b §8，2026-10-31）

- **D21 契约单一来源 = docs/06b §3**：判定以结构化 `expect` DSL 为主，`check` JS 字符串为逃生舱（acorn AST 白名单 + grader-worker + 2s 超时）；部分成功用 **0–3 星**模型；快照坐标用数组，`g` 入口接受 `PosLike` 归一化；`g.agent(id)` + `g.agentNear(pos,radius)`（旧重载 deprecated）。
- **D22 zod 是 canonical spec 的唯一源**：实现期由 zod 生成 JSON Schema（draft-7），`content/level-spec.schema.json` 降级为设计期兼容产物；primitive 参数用 per-op `oneOf` 在 zod 侧定义。
- **D23 `wowMoment` 增加机器可检查字段**：`feedback.wow = { sound, particle }`（schema v2）；设计期 prose 保留给人读。
- **D24 `languageLevel` 归属**：实现期只在 `code.languageLevel`；设计期 MD 的 `meta.languageLevel` 兼容保留。
- **D25 evidence 类型**：`kind: machine | reflection | predict`；machine 对应断言/trial 为 error，reflection/predict 对应题面为 warn（不阻塞）。
- **D26 validator 分层**：`level:validate` 只对 `*.level.ts` 严格（error）；设计期 MD 用 `level:lint`（warn，不阻塞）。与 docs/06 §2 的设计期放宽一致。

## 16. 尾声/Lab 的补充裁决（回应 scout-language，2026-10-31）

- **D27 尾声关 id**：`L11 = L-Epilogue = EP`（schema id 用 `L11`；文件名/显示名用 `L-Epilogue`；文档简称 EP）。
- **D28 `world.runTablet(fn)` 为回调 harness**：学生定义 `run(program)`，最后一行 `world.runTablet(run)`；harness 用测试表 + 史诗表调用并记录图案。不要求模块 export 约定。
- **D29 `agent.send` 方向**：`agent(name).send(msg)` 发到该 name 的邮箱；接收方 `agent(name).receive()` 取。L10 spec 代码需加一行注释说明方向。
- **D30 Lab-T 解锁于 L7 后**（`assert` 是 L7 prelude）；Lab-R 仍在 L5 后。docs/05 依赖图已改。
- **D31 L10 消息日志/死锁检测 runtime**：约 1–2 agent-day 实现；作为 P2 的硬依赖，若 Day3 12:00 未开工则按 docs/05 §7.4 降级为 L9 彩蛋 + Lab-C（预录）。

## 17. L10 铺桥实证后的补充裁决（2026-10-31）

- **D32 L10 桥段采用路线 A**：插件预铺 80% 桥面（deck），缺口 4–6 格由两个织偶逐格铺；bot 铺前必须预检（站到参考方块中心 + look + 目标 air + reach≤4.5），插件 teleport 仅作安全网（实测 0 次触发）。材料箱只放缺口块数，保留「左 ceil / 右 floor」分配教学点。
- **D33 桥宽**：推荐 3 格宽（掉落零容忍）；1 格宽作为降级。Day-2 用同一 harness 复跑 30 分钟确认真实参数。
- **D34 兜底**：路线 B（插件逐 tick fill + ItemDisplay 演出）作为 fallback 与 demo 预录保险；两 bot 真并行 place 未测，Day-2 复跑。

## 18. Foundation 备选：Luanti（2026-10-31 用户提出）

- **D35 维持 Minecraft + TypeScript，不切换 Luanti**。理由：Luanti 的真正优势（单进程透明 Lua、无版本锁、无 EULA、实体逻辑全在一处）只有在「学生语言 = Lua」时才完全兑现，而 Lua 会砍掉 A7/A8/A11/A12 的「用到型」教学；保留 TS 则仍需 bridge 且要重做 13 关场景/文档（≈2.5–3.5 agent-days），4 天预算不成立。详见 `docs/16-foundation-luanti-adr.md`。
- **重新考虑的条件**：一学期版；定位改为「教 Lua/modding」；公开发布为硬需求；MC 演示环境不可用；接受抽象重排。

## 19. 对照方案评审后的补充裁决（2026-10-31）

- **D36 顺序语义改为 auto-await AST 变换**（替代「隐藏 drain」）：Act I–II 在 esbuild 前自动给 SDK 调用插入 `await`，`const n = await golem.collect(...)` 成立；L9 关闭变换教显式 await。T1 第 0 小时冒烟验证，失败则退回 QuickJS/Asyncify 方案。详见 `docs/18` M1。
- **D37 采用会话/权限不变量**：REQ-EPOCH/RUN/CMD/STOP/ITEM/DONE/RESET/REGION（docs/07 §3.5）+ 独立 model-based session 测试。
- **D38 参考解与 starter 必须 `tsc --noEmit` 全绿**（13 关全量），产出 `evidence/specs-typecheck.json`。
- **D39 增加单页 HTML 报告交付物**（`report/index.html`，由文档/图/证据生成），对齐对照方案的包装质量。
- **D40 维持 Minecraft + TS 母本，不切换/不合并对方方案**；只吸收其 4 项工程强项；对方 1.21.4/JDK21 基线不采纳。详见 `docs/18-comparison-other-plan.md`。

## 20. 美术方向裁决（回应「哪个设定更美观」，2026-10-31）

- **D41 保留「织界」三幕设定，采用「单主地图 + 三场所密度 + 固定机位 + 调色/光照脚本」的美术纪律**：不换成单一村庄小地图（会牺牲抽象宽度与高光），也不放任 10 个场景各自为战。Act I–II 的 8 个场景收缩到村庄半径 300 格内；Act III 用村庄北侧峡谷 + 村下遗迹（同一世界不换图）。每关必须定义 1 主观察位 + 3 截图机位、每 Act 一套 palette、每关 ≥8 个非功能装饰点、手工摆放预算 ≤2h。详见 `docs/19-art-direction.md`。
- 吸收对照方案的**扁平插画地图**作为关卡选择/报告封面素材（成本低、观感强）。

## 20b. 桌面封装裁决（2026-10-31）

- **D43 最终交付 = Tauri 2 桌面应用**（AppImage/rpm），用户不使用浏览器；开发期可用 Vite。Electron 为兜底（WebKitGTK 若不能稳定渲染 Monaco/SSE）。工具链已实测可用。详见 `docs/26-desktop-packaging.md`。

## 21. 命名澄清：织典（Loom Codex）≠ OpenAI Codex（2026-10-31）

- **D42 命名统一**：「Codex」在本项目里指游戏内**跨语言对照图鉴**（取自 codex = 古籍/手抄本），不是 OpenAI Codex 编程模型/Agent。UI 中文名只用「**织典**」；英文对外写 **Loom Codex**；内部代码/文件名可继续用 `codex`（如 `content/codex/`），但演示 PPT/报告首次出现必须写「织典（Loom Codex）」。
- 织典的定位：每枚符文（抽象）解锁一页，固定四段「问题 → 机制 → 代价 → 跨语言对照（≥4 门语言）」；共 17 页（A0–A14 + X1/X2）。它是「PL 全貌」叙事的具象化产物（docs/13），也是 demo 里 30 秒讲清"这些思想在所有语言里都在"的最便宜方式。
- 如果觉得名字太文/易混淆：可改 UI 名为「语言图鉴 / 符文图鉴」，英文 **Rune Atlas**；但**不要**叫 Codex。改动只影响 UI 文案与 docs/13 标题，不影响内容与工期。

## 22. 已接受的风险（不再讨论，只监控）

- 9–10 关比 HRM 类游戏少：以「每关 2–3 子任务 + 10–25 分钟 + Labs」补偿，报告用学习时长对照表说明。
- 无宏/无自定义语言：用声明式行为 API + 去糖 Lab 补偿；Codex 说明取舍。
- 评估样本小：只报描述统计与质性证据，不宣称统计显著。
- 4 天内 Act III 可能不完整：已设计 DP2 降级与预录兜底。

## 23. 字体与行内代码契约（2026-11-02，用户当面修正）

- **D44 字体三轨道（替代此前多轮反复）**：
  - **代码**：所有渲染代码的位置（Monaco、参考解、手册签名/示例、织典代码、试符台输入/历史、日志代码、`inline-code`、教材代码块）只用 **Maple Mono**；**禁止像素字体**，也禁止正文 MiSans。
  - **非像素正文/普通 UI**：序章/幕/关开场叙述、手记、教练长句、结算说明、手册说明、织典正文、教材正文、伴玩/向导正文等，用 **MiSans VF**（Noto Sans SC 只作 fallback）。
  - **像素装饰字**：仅用于短、低信息量的装饰部分——章节/关卡标题、按钮、chip/标签、kicker、角色名（如「艾拉」）、HUD 短标签、键帽、地图墙/开场标题、教材标题/按钮；**不得用于代码或长段阅读文本**。
  - 依据/验收：`docs/61-typography-and-inline-code-style-guide.md`、`npm run check:style`、`apps/studio/e2e/typography.spec.ts`、`apps/studio/e2e/style-policy.spec.ts`。2026-11-02 曾短暂把所有装饰字改成 MiSans，用户当场修正为「像素装饰保留，MiSans 用于非像素正文」。
- **D45 行内代码必须渲染，不得裸显示反引号**：所有用户可见文本里的 `` `...` `` 一律通过 `RichText` 输出行内 `<code class="inline-code">`（Maple，行内，不另起段落）；标题、列表项、目标、结算、教材 h2/h3/目标、codex 正文、HUD/手册/试符台提示等都不例外。占位符/`aria-label`/`title` 等非富文本属性去掉反引号。自动化：`style-policy.spec.ts` 扫描页面可见文本；`scripts/check-style-policy.mjs` 静态检查已知富文本字段。
- **D46 防回归门禁**：`check:style` 接入 `verify.sh` l0（Windows `verify.ps1` 同步），`style-policy.spec.ts` 接入真实/mock Playwright 配置；任何前端 agent 改字体/文案前必须读 `docs/61` 并跑这两条。
