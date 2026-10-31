# L01 — 第一缕光（First Light）

> 状态：v1.1 样板（sm11 外科修复：学生 API 统一 `golem.*`、makeTask 第 5 盏改可选、lamps 句柄/断言按 registry 修正）｜负责人：Lead｜最后更新：2026-10-31 12:40
> 上游：`docs/05-curriculum.md` §8、`docs/06-level-spec-system.md`
> 本文件同时是「难度 ★、Act I 第 1 关、P0」的完整规格样板。

---

## 0. 元信息

```yaml
meta:
  id: L01
  title: { zh: 第一缕光, en: First Light }
  act: 1
  order: 1
  priority: P0
  prerequisites: []
  estimatedMinutes: 10
  difficulty: 1
  abstractions: [A0, A1]
  objectives:
    - id: o-sequence
      learnerView: 我写的每一条指令会严格按顺序执行
      evidence: 1→2→3 号灯按小径顺序由织偶点亮，第 4 盏由玩家点亮，整条路亮起
    - id: o-call
      learnerView: 函数调用就是「请织偶做一件事」，括号里的数字是位置
      evidence: 补齐 2、3 号灯的两行后，4 盏灯按 1→2→3 的顺序点亮（第 4 盏由玩家亲手点）
    - id: o-notional
      learnerView: 程序不是许愿，它只会照字面执行
      evidence: Predict 题 2/2 正确
  misconceptions: [program-will-infer-intent, order-does-not-matter, coordinates-vs-block-count]
  apiIntroduced: [golem.moveTo, golem.place, golem.say, golem.pos]
  apiAllowlist: [golem.moveTo, golem.place, golem.say, golem.pos]
  syntaxIntroduced: [函数调用, 数字/字符串字面量, 注释]
  reward: { rune: A1, advancement: loomcraft/act1/first_light, codexPage: A1 }
  languageLevel: act1
```

## 1. 学习目标（学习者视角）

1. **顺序**：世界按语句顺序变化；先写的先发生。→ 4 盏灯按「先路后桥」的顺序亮。
2. **函数调用/参数**：`golem.moveTo(x, z)` 的两个数字是「横着第几格、前后第几格」；`golem.place(block, x, y, z)` 的四个参数依次是「放什么、横着第几格、高多少格、前后第几格」。**第二个数字是高度（上下），第三个数字是前后**。→ 换坐标照做。
3. **notional machine**：织偶没有理解力，只有执行力；指令写错，它真的会做错（会卡住/绕路），这不是 bug 是特性。→ 预测题。
4. **不求甚解**：本关不解释「变量/循环/类型」，出现就说是「以后的事」，降低恐惧。

## 2. 叙事

- **setup**：黄昏的灰岩村口。艾拉把一枚温热的织偶种子放进你手里：「它叫灰崽。你写什么，它就做什么——一个字也不会多想。」
- **stakes**：天黑前 4 盏路灯要亮，晚归的村民才能看见路（否则演出：村民摔进沟，无惩罚、可重来）。
- **painBeat**：艾拉演示「自己跑去点灯」：跑到第 3 盏天就黑了，村民在黑暗里喊。她叹气：「一个人不够快。但写在符文上的字，跑得比我快。」
- **resolution**：玩家写完 4 组指令，灰崽沿小径依次点亮 4 盏灯；最后第 4 盏由玩家亲手点亮（艾拉：「这一盏，得由织者自己点。」），整条路亮起，晚归的村民沿光走回家。
- **coachTone**：简洁、具体、少形容词；不催不夸；第一关少用术语，每次出现英文 API 都配一句人话。

## 3. 世界与场景

| 项 | 内容 |
|---|---|
| anchor | `{kind: village, id: graystone}`；取 seed 世界最近的村庄；小径 = 村庄北侧自然小路，用 `buildProps` 补 4 个灯柱与石径 |
| dimension | overworld |
| time | 12000（黄昏），`doDaylightCycle: false`（本关剧情锁定黄昏；climax 再切夜晚） |
| weather | clear |
| region | 以村庄钟为中心，半径 48 的方形区域；`protectedBlocks: [村庄原有方块、门、床、工作台]` |
| 实体 | 织偶 ×1（`agent`，名字「灰崽」，外观 automaton）；村民 ×6（`npc`，黄昏后沿路回家）；艾拉 ×1（`npc`，站在村口）；羊 ×2（`prop`，路边） |
| 重置 | `rebuild_region`：恢复灯柱→熄灭全部灯；织偶回出生点；玩家传送回村口；时间回到 12000 |
| seed | fixed（L1 是教学样板：灯柱位置固定；坐标写在 starter 注释里，随机化从 L2 起） |

**灯光位置数据**：每盏灯柱 = 石砖柱 3 高 + 顶部灯笼位置。4 个灯笼坐标写在 starter 注释第一屏，灯柱底部用不同颜色羊毛/地毯标记 1–4。你在场景里能看见编号，代码里用坐标。**记法**：`place` 的第 2 个数是高度 14（灯柱顶），第 3 个数是前后；`moveTo` 只要横、前两个数。

**staging（YAML 摘录）**：

```yaml
staging:
  - phase: setup
    steps:
      - { op: locateAnchor, kind: village, id: graystone }
      - { op: buildProps, builder: lampPath, params: { lamps: 4, spacing: 9, seed: "$session" } }
      - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: "$village.plaza" }
      - { op: spawnEntity, type: villager, role: npc, count: 6, at: "$village.houses" }
      - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: "$village.gate" }
      - { op: time, value: 12000 }
      - { op: dialog, speaker: eira, text: "看到那几盏灭掉的灯了吗？写一句，灰崽做一句。" }
      - { op: objective, items: ["点亮 4 盏路灯（坐标在代码注释里）", "让灰崽回到艾拉身边"] }
  - phase: climax
    steps:
      - { op: wait, ticks: 10 }
      - { op: particle, type: end_rod, at: "$lamps", count: 30 }
      - { op: sound, id: block.enchantment_table.use, volume: 1 }
      - { op: time, value: 13000 }
      - { op: advancement, id: loomcraft/act1/first_light }
      - { op: dialog, speaker: eira, text: "这条路，从今晚起认得人了。" }
```

**评分句柄与命名声明**（设计期只强制 `meta` 机器块，docs/06 §2 裁决；world 其余字段实现期由 `defineLevel` 补齐）：

```yaml
world:
  vars:
    lamps: [[-12, 14, 10], [-12, 14, -2], [2, 14, -2], [2, 14, 16]]   # 1–4 号灯位，由 lampPath builder 注册
    optionalLamp: [[2, 14, 24]]                                       # makeTask 可选第 5 盏（桥另一侧）
  entities:
    - { type: golem, role: agent, id: golem, name: 灰崽 }
    - { type: villager, role: npc, id: eira, name: 艾拉 }
    - { type: villager, role: npc, count: 6 }
    - { type: sheep, role: prop, count: 2 }
```

`g.var("lamps")` 是 4 个灯位的坐标数组（`[[x,y,z],...]`），`g.var("optionalLamp")` 是可选第 5 盏；`g.npc("eira")` 由 `entities[].id: eira` 解析。

## 4. 任务与评分

**mainTask**：让灰崽把 1 到 3 号灯点亮，再走到 4 号灯下；最后一盏由你亲手点亮，做完回到艾拉身边。

**makeTask（可选）**：回程顺路把桥另一侧的第 5 盏小灯也点亮，这盏可以不做。它只影响第 3 颗星，不参与主任务判定。

**playerBeat**：4 号灯由你右键点亮（世界内提示：灯柱上浮现「织者之印」；其他 3 盏必须由灰崽点亮）。你点亮后触发 climax 演出。

**successCriteria**：

```yaml
successCriteria:
  - id: four-lamps-lit
    text: 4 盏路灯全部点亮
    check: |
      (g) => g.var("lamps").every(p => g.block(p).id === "minecraft:lantern")
  - id: golem-home
    text: 灰崽回到艾拉身边
    check: |
      (g) => g.agentNear(g.npc("eira").pos, 4)
  - id: player-lit-fourth
    text: 第 4 盏灯由你亲手点亮
    check: |
      (g) => {
        const p = g.var("lamps")[3];
        return g.events("block.place").some(e => e.actorType === "player" &&
          e.pos.x === p[0] && e.pos.y === p[1] && e.pos.z === p[2]);
      }
  - id: no-shortcut
    text: 1→2→3 号灯按顺序点亮，没有跳灯
    check: |
      (g) => {
        const L = g.var("lamps");
        const idx = p => L.findIndex(q => q[0] === p[0] && q[1] === p[1] && q[2] === p[2]);
        const seq = g.events("block.place")
          .map(e => idx([e.pos.x, e.pos.y, e.pos.z])).filter(i => i >= 0);
        return seq.indexOf(0) < seq.indexOf(1) && seq.indexOf(1) < seq.indexOf(2)
          && seq.indexOf(2) < seq.indexOf(3);
      }
```

**阶段（3 段）**：①点亮 1 到 3 号灯（按顺序）；②走到 4 号灯下，由你亲手点亮；③回到艾拉身边。
**挑战层（可跳过、不计星）**：一步不多走——灰崽只走四段路（1 号灯、2 号灯、3 号灯、艾拉身边），不回头、不重复；4 号灯由你自己走过去点亮。判定用事件顺序与坐标：四段走位必须依次落在 1、2、3 号灯与艾拉身边，三盏灯恰好各被灰崽点亮一次，第 4 盏由你亲手点亮；参考解与判定见 `L01.content.ts` 的 `challenge`（独立验收，不影响星数）。
**hiddenTests**（L1 不做坐标随机化：本关是教学样板、布景固定；随机化从 L2 起。这里只查「真的走过去做了」与「顺序对」，**不查新增方块总数**——makeTask 的第 5 盏是可选的，不能用总数卡人）：

```yaml
hiddenTests:
  - id: h-physical-walk
    name: 织偶真的走到每盏灯下才放置
    setup: {}
    assertions:
      - { id: h1, text: '每盏由织偶点亮的灯：放置前 2 格内出现过织偶，全程无传送', expect: { predicate: 'golemNearBeforePlace', maxDistance: 2, checkTeleports: true } }
  - id: h-no-extra
    name: 灯只落在灯位上、没有跳灯
    setup: {}
    assertions:
      - { id: h2, text: '所有 block.place 只落在 4 个灯位（或可选第 5 盏）上，且 1→2→3 顺序正确', expect: { predicate: 'placementsOnlyAt', handles: ['lamps', 'optionalLamp'], order: 'non-decreasing' } }
```

**时限**：单次运行 90s；关卡总时长目标 8–12 min；无限重试。

## 5. 代码与 API

**apiAllowlist**（`docs/12-sdk-api-registry.md` §3 L1）：`golem.moveTo(x, z) -> Promise<void>`、`golem.place(blockId, x, y, z) -> Promise<void>`、`golem.say(text) -> Promise<void>`、`golem.pos -> Vec3`（只读同步）。v1 的 `where()` 已废除、并入 `golem.pos`（不计教学符号）。写操作在学生代码里可直接调用（学生本关不写 `await`：Act I `runMode: auto-drain`，引擎按顺序排队执行；L9 起再显式 `await`）。

**starterCode**（学生看到的样子；全中文注释、没有 TODO，第一次出现 golem 就说明它是灰崽）：

```ts
// golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。
// 坐标怎么读：moveTo 后面两个数是横着第几格、前后第几格；
//   place 还要多一个高度——第二个数字是高度（上下），第三个数字是前后。
// 4 个灯位：1 号 (-12, 10)、2 号 (-12, -2)、3 号 (2, -2)、4 号 (2, 16)。

// 第一盏：让灰崽走到 1 号灯下，再把灯笼放到灯柱顶上（高 14）。
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)

// 第二盏：照着第一盏的写法再写一遍，只把括号里的坐标换成 2 号灯的。
// 第三盏：你来写。走完 1、2、3 号灯以后，再去 4 号灯下——最后那盏由你亲手点亮。
```

**referenceSolution**（约 8 行有效代码）：

```ts
// 第一盏
golem.moveTo(-12, 10)
golem.place("lantern", -12, 14, 10)
// 第二盏
golem.moveTo(-12, -2)
golem.place("lantern", -12, 14, -2)
// 第三盏
golem.moveTo(2, -2)
golem.place("lantern", 2, 14, -2)
// 第四盏：只走到灯下，最后一步由你亲手点亮
golem.moveTo(2, 16)
// 回艾拉身边
golem.moveTo(0, 6)
```

**expectedLoc**：8–14 行。

**常见错误**（固定格式：第 N 行 + 原因 + 可照抄写法；完整文案见 `L01.content.ts` 的 `L01_COPY.errors`）：

| 学生写法 | 第几行 | 原因 | 可照抄写法 |
|---|---|---|---|
| 括号没写完 | 第 1 行 | moveTo 后面要跟两个数字，程序还没写完 | `golem.moveTo(-12, 10)` |
| 高度和前后写反 | 第 2 行 | place 第二个数字是高度（上下），第三个数字是前后 | `golem.place("lantern", -12, 14, 10)` |
| 只走不放 | 第 1 行 | 只让灰崽走到了灯下，没让它放灯笼 | `golem.place("lantern", -12, 14, 10)` |
| 物品名漏引号 | 第 2 行 | lantern 要用英文双引号包起来 | `golem.place("lantern", -12, 14, 10)` |
| 跳过 2 号灯 | 第 5 行 | 小径有溪流，跳着点会掉进水里 | `golem.moveTo(-12, -2)` |
| 超时 | — | 灰崽走了很久还没走完，八成是同一件事在绕圈 | 先按「重置」，再看有没有哪一步被写了两遍 |

## 6. 教学节拍（PriMM 六拍）

| 节拍 | 时长 | 玩家动作 | 艾拉台词 | UI 变化 | 预期产出 |
|---|---|---|---|---|---|
| 0 painBeat | 40s | 看艾拉跑向 3 号灯、天黑、村民摔倒 | 「一个人不够快。写下来的字，跑得比我快。」 | 灯火熄灭，天色变暗 | 产生「我需要更快的方法」 |
| 1 Predict | 45s | 预测：「先写第 3 盏再写第 1 盏会怎样？」二选一 | 「灰崽不知道你想让它先点哪盏——它只知道你把它先写到哪。」 | 高亮第 1 行 | 2/2 预测正确（否则重播 painBeat） |
| 2 Run/See | 60s | 运行 starter code（已点亮第 1 盏），看世界变化 | 「看，它照做了。」 | 世界：第 1 盏亮；代码第 1 行高亮 | 「啊，代码真的驱动世界」 |
| 3 Investigate | 60s | 修一个坏代码：只改了 golem.moveTo 没改 golem.place 坐标，织偶走到灯下但没点亮 | 「走到和点亮，是两件事。」 | 错误世界状态 + 一行红字翻译 | 理解「函数 = 一个具体动作」 |
| 4 Modify | 3–4min | 补齐 2、3 盏灯的 4 行 | 不出声，仅在卡住时提示 | 目标面板打勾 | 3 盏灯亮 |
| 5 Make | 2–3min | 自己写第 4 盏 + 回到艾拉；玩家右键点亮第 4 盏 | 「这一盏，得由织者自己点。」 | climax 演出、advancement | 通关 + 预测题复盘 |
| 6 收尾 | 20s | 看 Codex 页 A1 解锁 | 「顺序，是一切魔法的第一根线。」 | 符文石板飞入织典 | 解锁顺序之符 |

**predict 题**：
1. 题：「先写第 3 盏再写第 1 盏，灰崽会？」选项：A 一样快 B 按写的顺序走 C 自己找最近的。答案 B。
2. 题：「`golem.place("lantern", -12, 14, 10)` 里的 14 是什么？」A 第 14 格 B 高度（上下） C 前后。答案 B。

**investigate**：
- brokenCode：`golem.moveTo(2, -2)` 之后接 `golem.place("lantern", 2, 16, 14)`（把高度和前后写反了：16 被当成高度，灯笼落到了灯柱外）
- expectedError：无 TS 报错，但世界状态不对（2 号灯柱空着，4 号灯位置出现幻觉方块，被系统拒绝 → 提示「这个位置没有灯柱」）
- explanation：「函数参数是一个整体：你告诉它放哪儿，它就去放哪儿；它不会猜『你想放在脚下』。」

## 7. 提示梯（恰好 3 级）

1. **nudge（1 次失败后）**：「先看小径：灰崽现在离哪一盏灯最近？它应该先去那盏。」
2. **technique（2 次失败后）**：「`golem.moveTo` 只负责走，`golem.place` 才负责放灯笼；每盏灯要写两句。」
3. **near-solution（3 次失败或 90s 无进展）**：「照着第一盏的写法再写一遍，只把括号里的坐标换成第二盏的；1 号是 (-12, 10)，2 号是 (-12, -2)。」**不给完整答案**；若 3 级提示后 60s 仍无进展，自动填入第 1–2 组，保留后两组给学生完成（防死局）。

## 8. 反馈与演出

- **成功**：4 盏灯同时爆出 end_rod 粒子；`block.enchantment_table.use` + 村庄铃；天色切夜，村民沿路走回家；advancement toast「第一缕光」；符文飞入织典；艾拉最终台词。
- **部分成功**（灯亮但没回艾拉身边）：「灯都亮了。现在让灰崽回来吧——它也会累的。」
- **失败**（超时/落水/坐标无效）：「灰崽迷路了。按 R 重置，我们再试一次。」无扣分。
- **wowMoment**：玩家右键第 4 盏灯的瞬间，整条小径从近到远依次爆亮粒子，远处村民的火把回应式点亮（预置 NPC 路径），音效叠加成「灯河」。
- **ambience**：黄昏鸟鸣、营火噼啪；climax 时村庄铃 + 柔和的 chime。
- **截图位**：①黄昏村落远景 ②代码面板 + 第 1 盏灯亮 ③灯河 + 村民回家。

## 9. 边界与失败处理

| 项 | 策略 |
|---|---|
| timeout | 单次运行 90s 强杀，提示「灰崽走了很久还没走完，八成是同一件事在绕圈。按「重置」再来一遍，看看有没有哪一步一直重复。」；本关无循环语法 |
| infiniteLoop | 本关不适用（语法级禁止循环）；观察器仍记录指令数上限 500 |
| disconnected | 引擎与 MC 断线：暂停关卡、UI 显示「世界连接中断，正在重连」，恢复后从检查点重放场景 |
| resetPolicy | 一键重置（R 或 UI）≤2s；任何失败都可无限重试；不扣任何资源 |
| cheatPolicy | 允许任意写法；只要世界状态达标即通过。禁止直接用 RPC 调底层 API（SDK 沙箱隔离），但玩家正常操作不受限 |
| isolation | 学生代码跑在 worker 沙箱；只能访问本关 `apiAllowlist`；AI 生成的关卡代码与场景数据均不可信，插件侧再校验 |

## 10. 验收证据（DoD）

- [ ] `level-kit validate-spec` 通过（schema/文本预算/API 子集/提示 3 级/隐藏测试 ≥1）
- [ ] starterCode 编译通过；**未修改 starter 时判定必须失败**（starter 只完成第 1 盏灯）
- [ ] referenceSolution 在 MockWorld 与真实 Paper 上均通过
- [ ] hiddenTests（物理走位 + 只落在灯位/顺序正确）通过；makeTask 第 5 盏为可选，不计入总方块数判定
- [ ] 挑战层「一步不多走」：挑战参考解通过、绕路/回头路/写死解失败；挑战不计星（绕路解主线仍 3 星）
- [ ] 盲测 solver：≤15 min、≤2 级提示通关（记录卡点）
- [ ] 1 名人类 playtest（≥10 min，记录 3 个困惑点）
- [ ] 3 张固定机位截图
- [ ] Codex 页 A0/A1 存在（跨语言对照：C 语句序列 / Lisp `begin` / Haskell `do`）

## 11. 开放问题

1. 坐标面板显示否？**已按 fresh reader 删掉「右侧面板」承诺**：坐标直接写在 starter 注释第一屏，忘了回来看。L2 起改为世界内标记 + 罗盘。
2. Act I 是否隐藏 `await`？**建议隐藏**：SDK 在 Act I–II 默认 `auto-drain` 执行模式，Act III（L9）显式引入 `await`/Promise，避免第一关就出现陌生关键字。风险：学生可能以为函数是同步的，L9 需要一次「认知重构」——这正是 L9 painBeat 的设计素材。
3. **v1.1 修复记录**：① 学生 API 全部改为 registry 名 `golem.*`，`where()` 废除并入 `golem.pos`；② makeTask 第 5 盏改为「回程顺路可选」，hiddenTests 不再查「新增方块恰为 4 个」，只查物理走位与 1→2→3 顺序；③ 原来没声明的 lamps 句柄改为 spec 里声明的 `world.vars.lamps`（+`optionalLamp`）；事件坐标比较不再用位置对象的相等方法，改为「数组下标 + 坐标逐项比较」；④ L01 是散文型 spec，设计期只强制 `meta`（docs/06 §2），第 3 节的 `world:` 块是机器节选，实现期由 `defineLevel` 补齐。
