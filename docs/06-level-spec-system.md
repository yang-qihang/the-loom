# 06 — Level Spec 体系（规格格式、评分模型、质量门禁）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 上游：`docs/05-curriculum.md`、`content/level-spec.schema.json`、`content/levels/L01-first-light.md`（样板）
> 下游：所有 `content/levels/*.md`、`packages/level-kit`、`packages/grader`
> 一句话：**Spec 是 AI 实现关卡的唯一输入。写不清的 spec = 做不出的关卡。**
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。
> 实现差异：2026-11-01 起关卡实现为 `content/levels/LXX.content.ts` 的 `defineLevel()`，目标进度真值新增 `LevelDef.progress`（本文件写作时尚无），见 docs/46 §1.1。

---

## 1. 为什么 spec 要这么重

4 天、几乎全 AI 开发，最大的风险不是「AI 不会写代码」，而是**关卡意图在传递中丢失**：实现 agent 不知道「这关到底要让玩家学会什么」「什么算成功」「失败怎么反馈」，于是做出来一个能跑但不好玩、不教学、不可验收的东西。

因此：
1. **Spec 必须先于实现**，且实现 agent 只允许读 spec（+ 架构文档），不允许读「口头意图」。
2. **Spec 的机器字段必须可执行**：starter code 能编译、reference solution 能通过评分、隐藏测试能跑、validator 能检查。
3. **Spec 的人读部分必须能通过「盲测评审」**：一个不知道设计意图的人只看玩家可见文本，也能说清这一关要干什么。

## 2. 表示形式（设计期 MD → 实现期 TS）

| 阶段 | 形式 | 位置 | 校验 |
|---|---|---|---|
| 设计期（现在） | Markdown + YAML 机器块 + 代码块 | `content/levels/LXX-*.md` | 人工评审 rubric + `level-kit validate-spec`（文本级检查） |
| 实现期（Day2 起） | TypeScript `defineLevel({...})` | `content/levels/LXX.level.ts` | zod schema + tsc + `level-kit validate`（编译级检查） |

转换是机械的：YAML 块里的字段 1:1 映射到 `defineLevel` 字段；prose 段落进入 `docs` 字段供 Codex/教练引用。**转换由实现 agent 在实现该关时完成，并由 validator 机器校验**，不做人工二次创作。

> **设计期格式放宽与 validator 双模式（2026-10-31 审计裁决）**：validator 分 `designTime`（只校验设计期 MD 的 `meta` 块 + 文本级规则）与 `implementation`（对 `*.level.ts` 全量校验）两种模式；`content/level-spec.schema.json` 的 9 个 required 顶层键只适用于 implementation 模式。设计期 MD 只强制要求 `meta` 机器块（`id/title/act/.../reward`），其余章节可以用散文 + 示例 YAML/代码块表达；不再要求每关把 9 个顶层字段都写成 YAML。原因是设计期读者是人类评审，散文更易读；机器可读的 canonical spec 在实现期由 `defineLevel()` 统一生成并由 zod/validator 校验。validator 对设计期 MD 只做「meta 块 schema + 文本级规则」检查；对实现期 TS 做全量检查。

> 为什么不直接用 JSON：设计期需要大量叙事、教学法说明、提示文案，JSON 不可读、评审会失焦。为什么不只用 MD：实现期需要类型检查、编辑器补全、编译期枚举校验。两阶段各取所需。

## 3. 文件夹结构

```
content/
├── level-spec.schema.json          # 机器 schema（设计期 YAML 块与实现期 defineLevel 的共同字段定义）
├── levels/
│   ├── L01-first-light.md          # 设计规格（本阶段交付）
│   ├── L02-counting-golem.md
│   ├── ...
│   ├── L10-two-weavers.md
│   ├── LAB-R-recursion-totem.md
│   └── LAB-T-prove-your-runes.md
└── codex/                          # 每枚符文的「跨语言对照」页面（A0-A14）
    └── A11-contract.md
```

## 4. Spec 文档固定章节（smith 必须按顺序写）

| # | 章节 | 必填 | 内容 |
|---|---|---|---|
| 0 | 元信息 YAML 块 | ✅ | id/title/act/优先级/时长/难度/抽象/prerequisites/奖励/API 增量 |
| 1 | 学习目标 | ✅ | 每目标：`id`、一句话学习者视角目标、可观察证据；`misconceptions[]` |
| 2 | 叙事 | ✅ | setup（<80 字）、stakes、painBeat（<90s 具体演出）、resolution、艾拉台词要点 |
| 3 | 世界与场景 | ✅ | anchor/POI、时间/天气、实体表、舞台搭建、区域、重置策略、seed 策略 |
| 4 | 任务与评分 | ✅ | 主任务、makeTask、successCriteria（每条含人话 + 机器判定）、trials、hiddenTests、时限 |
| 5 | 代码与 API | ✅ | starterCode（可编译）、referenceSolution（必须过）、apiAllowlist、参考行数、常见错误 |
| 6 | 教学节拍 | ✅ | PriMM 六拍表：每拍时长/玩家动作/艾拉台词/UI 变化/预期产出 |
| 7 | 提示梯 | ✅ | L1 nudge / L2 technique / L3 near-solution；触发条件；禁止直接给答案 |
| 8 | 反馈与演出 | ✅ | 成功/部分/失败的世界内反馈；wowMoment；playerBeat；音效/粒子/advancement/bossbar |
| 9 | 边界与失败处理 | ✅ | 超时、越界、死循环、掉线、重置、作弊、副作用隔离 |
| 10 | 隐藏测试与反硬编码 | ✅ | ≥1 组随机化输入；注入式测试（L8）；验收时才出现的场景 |
| 11 | 验收证据 | ✅ | validator 通过、referenceSolution 通过、盲测报告、3 张固定机位截图、playtest 1 人 |
| 12 | 开放问题 | 可选 | 实现 agent 需要 Lead 决策的点；默认给出「建议答案」 |

> **Lab 简化模板（豁免）**：`LAB-R/LAB-T` 允许裁剪章节为 0/2/4/5/6/8/9/11（等价内容仍需齐全），无需重排为 0–12。

## 5. 机器字段规范（YAML 块 / `defineLevel`）

### 5.1 meta

```yaml
id: L03                      # 主关卡 L01–L11；Lab 为 LAB-R/LAB-T/LAB-M/LAB-C（Lab 的 act 沿用所属 Act，order 用 21+）
title: { zh: 岔路与钟声, en: The Bell at Dusk }
act: 1
order: 3
priority: P0                 # P0|P1|P2|P3
prerequisites: [L02]
estimatedMinutes: 11         # 目标区间 [8,12]
difficulty: 2                # 1-5
abstractions: [A3]           # 见 docs/05 §3
objectives:
  - id: o-bool
    learnerView: 让织偶在“有僵尸”和“没僵尸”时做不同的事
    evidence: { kind: machine, ref: trial:zombie-night }
misconceptions: [cond-inverted, compare-eq-vs-assign]
apiIntroduced: [ringBell, world.scenario, world.countEntities, golem.placeTorch]
apiAllowlist: [L01 全部, L02 全部, world.scenario, world.countEntities, ringBell, placeTorch]
syntaxIntroduced: [if, else, ===, &&, ||]
reward: { rune: A3, advancement: loomcraft/act1/bell_at_dusk, codexPage: A3 }
```

> 命名约定：**L-Epilogue = L11 = 简称 EP**（三种写法指同一关；schema id 用 `L11`，文件名/课程显示名用 `L-Epilogue`）。

### 5.2 评分模型（本项目的核心机制）

评分只读**世界状态**与**运行日志**，不读学生代码文本。一个关卡有四类检查：

| 类型 | 何时跑 | 玩家可见 | 用途 |
|---|---|---|---|
| `successCriteria` | 每次「验收」 | 目标面板打勾 | 主任务判定 |
| `trials` | 点击「试炼」/验收时逐场景重跑程序 | 场景选择器 + 结果灯 | 强制泛化（L3 起） |
| `hiddenTests` | 只在验收时跑（不可见） | 失败只给方向 | 反硬编码、边界 |
| `reflection`（可选） | 关卡结尾 | 一个预测/解释题 | 形成性评估与报告数据 |

**successCriteria 条目结构**：

```yaml
- id: bell-only-when-threat
  text: 有威胁的夜里钟响了，安静的夜里没响
  check: |
    // 在 level-kit 沙箱里运行；g 是判定 API，只读
    (g) => g.trial("quiet").bellRang === false && g.trial("zombie").bellRang === true
```

判定 API（`g`）最小集合：`g.block(pos)`、`g.blocks(list)`、`g.region(name)`（关卡声明的命名区域）、`g.var(name)`（关卡声明的标量/数组变量，如 `deck`/`materialsLeft`）、`g.injected`（仅隐藏测试可见：注入的 mock 机器/场景集合）、`g.countBlocks(region, id)`、`g.container(nameOrPos)`、`g.itemCount(container)`、`g.containersEqual(a,b)`、`g.entities(selector)`、`g.agent(id)`、`g.agentNear(pos,radius)`、`g.npc(name)`、`g.withinRadius(a,b)`、`g.events(type)`、`g.trial(id)`、`g.time()`、`g.allOf/anyOf/not`。**命名句柄**：关卡可在 spec 的 `world.regions`/`world.vars`/`world.named` 中声明句柄（如 `g.lamps`、`g.shrine`、`g.npc('eira')`），level-kit 编译期注入并校验引用存在；关卡还可注册专用判定 helper（如 `g.countCrops(region)`）。事件对象统一为 `{seq, type, actor, actorType, byPlayer, pos, tick, data}`：`byPlayer` 是派生布尔值，仅真玩家操作为 true（bot 也是 player 实体，必须排除）。判定函数必须是纯函数（同一世界状态 → 同一结果），禁止网络/文件/时间依赖；超时 500ms 判失败。

**trials（场景试炼）**：每个 trial = `{id, name, setup, worldPatch, assertions}`。运行器对每个 trial：重置场景 → 注入 patch → 重跑学生程序（隔离沙箱，限时）→ 收集世界状态 → 跑 assertions。程序在 trial 之间不能泄漏状态（新的 SDK 会话）。

**hiddenTests**：与 trials 同构，但不在 UI 显示，且**允许注入只有 grader 才知道的变体**：随机坐标、随机尺寸、随机物品清单、随机材料预算、注入 mock 机器（L8）。assertions 失败时只给「方向性提示」（如「换一种大小的田试试」），不给具体输入。

**成功判定**：`all(successCriteria) && all(trials) && all(hiddenTests)`。**部分成功 = 0–3 星模型**：mainTask 全过 = 1 星；makeTask/所有可见目标全过 = +1 星；hiddenTests 全过 = +1 星；UI 显示星数与未完成目标，允许重复提交（与 docs/06b §3.6 一致）。

### 5.3 随机化与种子

```yaml
randomization:
  mode: session            # session（每个会话随机）| fixed（教学演示可复现）
  variants:
    - id: field-size
      range: [[4,6],[5,7]]   # rows, cols
    - id: water-holes
      count: 2
  hiddenOnly: true         # 主 UI 不展示具体数值，避免硬编码
```

- 每关默认 `mode: session`，种子 = `hash(levelId, sessionId, attempt)`，日志记录种子便于复现 bug。
- 演示/录屏用 `mode: fixed` + 固定种子，保证画面可复现。

### 5.4 SceneScript（演出/场景脚本）

世界准备与演出由**声明式脚本**驱动，插件提供通用 primitive。spec 中写 `stagingPhases[]`，每个 phase 是一个 primitive 数组：

```yaml
staging:
  - phase: setup
    steps:
      - { op: locateAnchor, kind: village, id: village }
      - { op: teleportPlayer, to: "$village.bell", offset: [0, 0, 4] }
      - { op: time, value: 12000 }                      # 黄昏
      - { op: weather, value: clear }
      - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: "$village.bell" }
      - { op: buildProps, builder: lampPath, params: { count: 4, spacing: 8 } }
      - { op: dialog, speaker: eira, text: "天要黑了。灯亮之前，村里没人敢走这条路。" }
      - { op: objective, items: ["点亮 4 盏灯笼", "让织偶回到艾拉身边"] }
  - phase: climax
    steps:
      - { op: freezeInput, value: true }
      - { op: wait, ticks: 20 }
      - { op: particle, type: end_rod, at: "$lanterns", count: 40 }
      - { op: sound, id: block.enchantment_table.use, volume: 1 }
      - { op: advancement, id: loomcraft/act1/first_light }
```

**primitive 白名单（v2，插件实现；按 docs/02b §6 修正，CP1 冻结）**：
- 场景/世界：`locateAnchor`、`loadScene`（仅允许构建期打包的 scene id）、`resetScene`、`setBlock`、`setBlockBatch`（稀疏方块批量写）、`fillRegion`、`buildProps`（参数化 builder，名单见 docs/07 §6）、`setChunkForceLoaded`、`gamerule`（`doMobSpawning/doDaylightCycle/randomTickSpeed` 等）、`time`（拆为 `setTime` 语义）、`weather`、`wait`（N ticks）、`waitUntil`（事件/条件）；
- 实体/演出：`spawnEntity`、`spawnAgent`、`spawnItem`、`removeEntity`、`clearEntities`、`animate`（**枚举**：`walk_path | bubble | nod | sink | custom_curve`，参数显式）、`display`（`item/block/text` + scale + interpolation）、`device`（可枚举状态机：`kind/at/states`）、`dialog`、`title`、`actionbar`、`objective`、`bossbar`、`sound`、`particle`、`advancement`（需 datapack 预置；无则降级 title+音效）、`giveItem`、`teleportPlayer`、`freezeInput`（实现=取消 `PlayerMoveEvent` + `setWalkSpeed(0)`，不是 spectator）、`unfreezeInput`、`grantRune`；
- 试炼/评分：`trialPatch`（按 trial 注入 time/weather/blocks/entities/scenario）、`beginTrial`/`endTrial`（由引擎驱动，非 spec 直接写）。

**删除**：`saveSnapshot`/`restoreSnapshot`（v1 不做区域 NBT 快照；reset 用「重建 staging + clearEntities」，≤2s 预算）。**没有** `runArbitraryJava` / `setPlayerCamera` 这类危险或做不到的 primitive。设计期 spec 允许写白名单外的 staging 步骤（散文意图），实现期必须映射回白名单 primitive 或由 Lead 批准新 primitive；`unlockHint` 不是 primitive——提示梯一律由引擎按 `afterFailures/afterSeconds` 触发。

**相对锚点语法（2026-10-31 补充）**：场景可以以「运行时对象」为原点声明相对坐标——`world.anchor: { kind: "agent", id: "golem", at: "spawn" }`，staging 在运行时把锚点解析为绝对坐标并写入 `world.vars`（如 `barrelPos`/`nestOrigin`）；spec 用相对偏移书写，评分用 `g.var` 读取。静态 `world.regions` 只用于不随锚点移动的区域（如田地边界/灯具位置）；随锚点移动的场景用 vars 句柄（L02 的模式）。

**事件（spec 声明、插件回调）**：`onInteract`（玩家右键方块/实体）、`onAgentArrive`、`onBlockPlaced`、`onItemPicked`、`onTrialEnd`、`onTimer`、`onWaveComplete`、`onChatCommand`（教师/演示用）、`device.on/off/report`、`bell.ring`、`potion.splash`、`entity.cured`。事件负载统一含 `actor`/`actorType`（player|agent）/`pos`/`tick`/`data`；「玩家亲手做」类判定必须用 `actorType === "player"`（bot 也是 player 实体）。

### 5.5 Coach 脚本

```yaml
coach:
  persona: 艾拉（Eira），最后的织者；语气：温和、具体、不居高临下；禁止说教
  dialogues:            # 主动台词，按 beat 触发
    - { beat: 0, text: "看到那盏灭掉的灯了吗？你写下的每个字，灰崽都会照做——一个字也不会多想。" }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: "先想清楚：织偶应该先去哪、再去哪？", codeAnchor: "moveTo" }
    - { level: 2, trigger: { afterFailures: 2 }, text: "moveTo 接受的是坐标；第 2 盏灯在第一个的北边 8 格。", codeAnchor: "moveTo" }
    - { level: 3, trigger: { afterFailures: 3 }, text: "第 2 盏灯的坐标可以照抄第 1 盏，只改 z。", codeAnchor: "moveTo" }
  errorMap:             # TS 错误码 → 世界内人话（全局默认表 + 关卡补充）
    - { tsCode: 2304, text: "织偶不认识这个名字——是不是漏了引号或者拼错了？" }
```

规则：**L3 提示也不给完整代码**，只给「可照抄的结构」；提示必须引用玩家当前代码位置（`codeAnchor`）。每关最多 3 级提示；3 级之后 60 秒仍无进展 → 自动把参考解的前一半填进编辑器（「艾拉替你写了前半段」），保留后半段让学生完成（防死局底线）。

## 6. 质量门禁（spec 阶段）

### 6.1 机器校验（`level-kit validate-spec`，CI 必跑）

1. YAML 块通过 JSON Schema（`content/level-spec.schema.json`）。
2. `prerequisites` 必须存在于课程顺序中且已解锁。
3. `abstractions` 必须来自 docs/05 的 A0–A14/X1/X2，且不超过 2 个。
4. `objectives` 每条有 `evidence`，且 `evidence.kind` 为 `machine`（对应 trial/hiddenTest/successCriterion）或 `reflection`（对应预测题/回顾题，须在 `pedagogy.predict` 或 `task.reflection` 中可查）。
5. `apiAllowlist` ⊆ 前置关卡 API 并集 ∪ `apiIntroduced`；**禁止使用未教过的符号**（防越级）。允许宏 `ALL_PRIOR`（展开为前置所有关卡 API 并集）与 `kind` 标注（`extension`/`harness`）。**计数口径**：`apiIntroduced` 只计「新教学符号」，≤5；同一对象的同族方法（如 `agent.tryReceive`/`agent.waitIdle`）与纯演出 harness（如 `world.runTablet`/`golem.writeRune`）不计入教学符号，但必须出现在 `apiAllowlist` 且标注 `kind: extension|harness`。
6. `syntaxIntroduced` 只允许出现在 05 §7.1 已排期的语法集合（例如 L2 之前不许出现 `for`）。
7. `starterCode` 与 `referenceSolution` 能被 tsc（按该关的 tsconfig 等级）编译；reference 必须通过该关所有评分（在 MockWorld 上）。
8. 隐藏测试 ≥1；随机化字段 ≥1 且 `hiddenOnly: true`（L1/L2 允许例外——但必须有「换个位置」的静态变体）。
9. 教练文本（按 docs/25 §5 修订）：单条 ≤60 字；对话 ≤14 条（含关开场 3 句）；提示恰好 3 级；UI 目标 ≤3 条；每关叙事 ≤600 字；序章/幕开场另计。**每关 `narrative` 必含 `worldState`（世界状态一句）、`opening`（3 句）、`whyYou`（为什么是你）**；缺一打回。
10. 每个 `playerBeat` 是可被插件检测的玩家动作（右键/给出物品/敲钟等）。
11. `wowMoment` 至少包含 1 个音效 + 1 个粒子/实体演出。
12. `advancement` id 全局唯一；`reward.rune` 与 docs/05 一致。
13. 所有英文标识符在 `apiAllowlist` 或语言关键字表内；所有中文术语在术语表内。
14. 字数预算：叙事 ≤400 字，任务说明 ≤120 字。
15. **体量与挑战下限（docs/20 §3c / docs/24）**：`referenceSolution` 有效行数 ≥ 该幕下限（Act I 25、Act II 50、Act III 60；L01 例外 ≥8）；`starterCode` 与 `referenceSolution` 有效行差 ≥ 下限的 1/2；`task.phases` ≥2（L01 允许 1）；`task.challenge` 必须存在且 `tested: true`；`hiddenTests` ≥2（L01 允许 1，但 challenge 必须另有测试）。不达标直接打回。

### 6.2 人工/agent 评审 rubric（每项 1–5 分，≥4 才通过）

| # | 维度 | 通过标准 |
|---|---|---|
| R1 | 教学对齐 | 新抽象与 `abstractions` 一致，旧抽象有复用，无越级 |
| R2 | 动机强度 | painBeat 具体、短、有情绪，不是干巴巴的说明 |
| R3 | 梯度 | 从 starter 到 reference 的代码增量 ≤2.5 倍；新符号 ≤5 |
| R4 | MC 地道 | 任务是 MC 玩家会做的事；没有「为教学硬编的小游戏」 |
| R5 | 可玩性 | 有明确的「啊哈」瞬间与玩家节拍；失败不挫败 |
| R6 | 可验收 | successCriteria 可机器判定、无歧义；隐藏测试真的反硬编码 |
| R7 | 提示质量 | 三级提示逐级加强但都不直接给答案；引用可见代码位置 |
| R8 | 视觉与演出 | wowMoment 有画面感，可在 Paper 现成能力内实现 |
| R9 | 文本 | 简短、无术语轰炸、艾拉口吻一致 |
| R10 | 可实现性 | 不依赖未实现的 primitive；坐标系/区域有明确定义；重置安全 |

### 6.3 常见反模式（见到直接打回）

- 只用 UI toast 反馈，世界没变化；
- 提示里直接贴完整代码；
- successCriteria 只查「程序运行无报错」；
- 没有隐藏测试，坐标写死也能过；
- 任务其实是「填空刷题」，与 MC 无关；
- 需要玩家手动做 10 步以上不相关的操作；
- 时长估计 <5 或 >30 分钟；
- 依赖 L8 才教的接口，或在 L3 用 `for` 循环。

> 与教学法规则的映射见 `research/pedagogy-notes.md` §5（LR-01…LR-28）；validator 落地其中可机器检查的约 12 条（提示 3 级、对话 ≤10、目标 ≤3、Predict 分级、隐藏测试 ≥1、随机化、starter 非答案、时长范围、playerBeat、wowMoment、术语表、文案长度）。

## 7. 验收证据（每关 DoD）

一关算「完成」必须同时提交：

1. `content/levels/LXX.level.ts`（实现期）+ validator 通过日志；
2. `referenceSolution` 通过主判定的 CI 记录（含截图 1 张：成功状态）；
3. `starterCode` 编译通过、且**故意不改代码时**判定失败（防止 starter 已经是答案）；
4. hiddenTests / trials 全过的日志（含随机种子）；
5. 盲测 solver 报告（通过/未通过 + 卡点 + 修改记录）；
6. 3 张固定机位截图（开场、任务中、wow 瞬间）；
7. 一次人类 playtest 记录（1 名，≥10 分钟，含 3 个困惑点）；
8. 该关的 Codex 页面（A 编号 → 跨语言样例）存在且通过文案评审。

## 8. Spec YAML 骨架（复制即用）

```yaml
meta: { id, title:{zh,en}, act, order, priority, prerequisites:[], estimatedMinutes, difficulty,
        abstractions:[], objectives:[{id, learnerView, evidence}], misconceptions:[],
        apiIntroduced:[], apiAllowlist:[], syntaxIntroduced:[], reward:{rune, advancement, codexPage} }
narrative: { setup, stakes, painBeat, resolution, coachTone }
world: { anchor:{kind,id}, dimension, time, weather, region, entities:[], staging:[], reset:{strategy},
         seed:{mode, value?}, protectedBlocks:[] }
task: { mainTask, makeTask, playerBeat, timeLimitSec,
        successCriteria:[{id,text,check}], trials:[], hiddenTests:[] }
code: { starterCode, referenceSolution, expectedLoc, languageLevel }
pedagogy: { predict:[], investigate:{brokenCode, expectedError, explanation},
            beats:[{beat,durationSec,playerAction,coachLine,uiChange,expectedOutput}],
            hints:[{level,trigger,text,codeAnchor}], errorMap:[] }
feedback: { success:[], partial:[], failure:[], wowMoment, ambience }
boundaries: { timeout, outOfBounds, infiniteLoop, disconnected, resetPolicy, cheatPolicy, isolation }
acceptance: { evidence:[], blindSolver:{criteria}, screenshots:[] }
openQuestions: []
```

## 9. 与其他文档的接口

- `docs/07-architecture.md`：primitive/事件/判定 API 的**运行语义**在 `packages/level-runtime` 与 Paper 插件中实现；spec 只引用白名单。
- `docs/08-ai-workflow.md`：spec 评审是 Gate-1，reference solution 是 Gate-2，盲测是 Gate-3。
- `docs/09-execution-plan.md`：spec 冻结时间 = Day 2 中午；之后只允许「缩小范围」，不允许「改教学意图」。
