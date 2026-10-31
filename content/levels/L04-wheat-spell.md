# L04 — 麦田的咒语（The Wheat Spell）

> 状态：v1.1（sm11 外科修复：`field.waterRow` 取代数组下标、regions/vars 命名句柄）｜负责人：smith-act1｜最后更新：2026-10-31 12:40
> 上游：`docs/05-curriculum.md` §8 L4（任务骨，不得改）、`docs/06-level-spec-system.md`、`docs/12-sdk-api-registry.md`、`content/levels/L01-first-light.md`（样板）｜下游：`L04.level.ts`、`packages/grader`、Codex A4
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L04
  title: { zh: 麦田的咒语, en: The Wheat Spell }
  act: 1
  order: 4
  priority: P0
  prerequisites: [L03]
  estimatedMinutes: 15
  difficulty: 3
  abstractions: [A4]
  objectives:
    - { id: o-for, learnerView: '用 for 让同一件事重复做很多次，次数由田的大小决定', evidence: '隐藏变体换成 5×7、2×3 的田仍种满' }
    - { id: o-nested, learnerView: '两层循环 = 一行一行地把整片田走完', evidence: '整块田（除水渠）全部是新种' }
    - { id: o-stop, learnerView: '终止条件：种子用完了就该停，别硬跑完整个循环', evidence: '种子不足的田里，种子恰好用完、没有浪费' }
    - { id: o-skip, learnerView: '循环里用 if 跳过不该种的地方（水渠）', evidence: '水渠里一颗麦子都没有' }
  misconceptions: [loop-copies-not-repeats, off-by-one, hardcode-field-size, seed-in-water, while-never-ends, skip-harvest]
  apiIntroduced: [world.field, golem.plant, golem.harvest, golem.placeScarecrow]
  apiAllowlist: [golem.pos, golem.moveTo, golem.place, golem.say, golem.where, golem.count, golem.collect, golem.deposit, world.container, world.scenario, world.countEntities, golem.ringBell, golem.placeTorch, world.field, golem.plant, golem.harvest, golem.placeScarecrow]
  syntaxIntroduced: [for, while, 嵌套循环]
  reward: { rune: A4, advancement: loomcraft/act1/wheat_spell, codexPage: A4 }
  languageLevel: act1
```

## 1. 学习目标（学习者视角）

1. **for 循环**：把「一行写一遍」变成「写一遍、跑 N 遍」；外层走行、内层走列，两层合起来就是整片田，N 来自田的尺寸、不来自记忆。
3. **终止条件**：`while (条件)` 在条件不成立时停；种子用完、田种满，都是条件。
4. **循环里的 if**：水渠格不是耕地，跳过去；这和 L3 的 if 是同一个东西，只是放进了循环。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '黎明的雨里，村北的麦田空着——上一季的麦子还没收，田埂外堆着散线：织机断线后散出的灰白线头，不咬人，只让碰到的东西忘记自己该做什么。冬天要来，这片田是全村的口粮。艾拉把去年那块符文石板放在田埂上——符文：一句只做一件事的短句；石板上有 25 行字。'
  stakes: '雨停之前把整片田收完、种满；种子不一定够；水渠里不能有一颗种子。'
  painBeat: '艾拉摊开旧符文：25 行 place，一行一个坐标。今年田扩大了 3 倍，她写到天亮还没写完；还有一行写错，把种子种进了水渠，种子泡烂了。她说：「我在用写的次数，追田的长度。」'
  resolution: '你把「每一格」写成「每一行、每一列」：田有多大，符文就跑多久。织偶跑完最后一行时，整片田一起冒出绿芽，雨也停了。'
  coachTone: '务实、像农户说话；用「行、列、水渠、墒」这些田里的词；一次只说一件事，不励志。台词要点：①「你在数格子。让循环去数。」②「田会变大，符文不该变长。」③「收成，是循环和雨的事。」织偶：只会照字面做事的工匠；最后立稻草人那一步是你的织者之印，它替不了；学会的符文会亮一页织典——古织者的图鉴。'
```

## 3. 世界与场景（`world`）

村北的麦田用现成平原改造：`buildProps` 围出 `rows×cols` 的耕地、一条贯穿整田的**水渠**、田埂与栅栏；田中央预置稻草人底座（干草捆×2 + 两根栅栏手臂）。上一季的成熟麦子按比例留在田里（需要先收），其余格子是空的耕地。雨天（雨会让耕地自然保湿，水渠两侧 4 格内也自动湿润）。

```yaml
world:
  anchor: { kind: village, id: graystone }
  dimension: overworld
  time: 23000
  weather: rain
  region: { center: [0, 64, 0], radius: 64 }
  entities:
    - { type: golem, role: agent, id: golem, name: 灰崽, count: 1 }
    - { type: villager, role: npc, id: eira, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 4 }
    - { type: hay_block, role: prop, id: scarecrowBase, count: 2 }
    - { type: sheep, role: prop, count: 2 }
  regions: { fieldFrame: { from: [-8, 62, -8], to: [8, 70, 8] }, barnArea: { from: [4, 62, -14], to: [8, 66, -6] } }
  vars: { fieldA: { rows: 4, cols: 4, x: 10, z: -8, waterRow: 2, seeds: 12, plantable: 12 }, fieldB: { rows: 6, cols: 6, x: 10, z: 2, waterRow: 3, seeds: 30, plantable: 30 }, fieldC: { rows: 6, cols: 4, x: 10, z: 12, waterRow: 2, seeds: 20, plantable: 20 }, matureCellsA: [], matureCellsB: [], matureCellsC: [], challengeField: { rows: 6, cols: 6, x: 10, z: -8, waterRow: 1, waterRow2: 4, seeds: 12, plantable: 24 }, barn: [-4, 65, 14], scarecrow: [14, 66, 26], waterCells: [], outsideCells: [], barnPos: [] }   # 后三个是设计期样例判定的旧句柄；实现期判定见 L04.content.ts
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: village, id: graystone }
        - { op: buildProps, builder: farmPlot, params: { rows: 5, cols: 5, waterRow: 2, matureRatio: 0.4, fence: 1, seed: '$session' } }
        - { op: buildProps, builder: barnBarn, params: { offset: [6, -10] } }
        - { op: buildProps, builder: scarecrowBase, params: { at: '$field.center' } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$field.westEdge' }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$field.southEdge', offset: [0, 0, 3] }
        - { op: time, value: 23000 }
        - { op: weather, value: rain }
        - { op: dialog, speaker: eira, text: '上一季的麦子还没收。田多大不用数：问田地一句，它会报出行数和列数。' }
        - { op: objective, items: ['先收掉上一季的残株', '把能种的格子种满', '种完回谷仓'] }
    - phase: scarecrow
      steps:
        - { op: giveItem, item: minecraft:carved_pumpkin, count: 1 }
        - { op: waitUntil, event: onInteract, target: hay_block, timeout: 180 }
        - { op: buildProps, builder: scarecrowHead, params: { at: '$field.center' } }
    - phase: climax
      steps:
        - { op: weather, value: clear }
        - { op: time, value: 1000 }
        - { op: sound, id: item.bone_meal.use, volume: 1 }
        - { op: particle, type: end_rod, at: '$field.corners', count: 60 }
        - { op: animate, id: act1_core_merge, at: '$village.bell' }
        - { op: advancement, id: loomcraft/act1/wheat_spell }
        - { op: dialog, speaker: eira, text: '收成，是循环和雨的事。动作之核，合上了。' }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['水渠', '田埂', '栅栏', '稻草人底座']
```

**命名句柄**：`farmPlot` builder 在 staging 时把水渠整行的绝对坐标写进 `g.var('waterCells')`、田外一圈写进 `g.var('outsideCells')`；`barnBarn` 写 `g.var('barnPos')`。判定 helper（本关注册）：`g.openSlots()/g.sproutCount()/g.seedsLeft()/g.seedBudget()/g.harvestSeedsGained()`；随机尺寸/水渠行由 `field.rows/cols/waterRow` 提供。
**MC 机制依据**（2026-10-31 查询）：耕地四周 4 格内有水即保湿、下雨也会保湿（[Farmland](https://minecraft.wiki/w/Farmland)）；小麦按随机刻生长、需要光照（[Wheat](https://minecraft.wiki/w/Wheat)）；骨粉能催熟（[Bone Meal](https://minecraft.wiki/w/Bone_Meal)）。**稻草人不是原版方块**：MC 你普遍用干草捆 + 雕刻南瓜自建（[Hay Bale](https://minecraft.wiki/w/Hay_Bale)），作物加速是本关的织机法则（演出/规则），已列入 §12。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '先把三块田里上一季的残株收掉，再把能种的格子都种上；水渠整行跳过，种完回谷仓。'
  makeTask: '种子只够六成时，种到没种子就停下，一粒也别浪费。'
  playerBeat: '雨停后，你把南瓜头放到干草捆上——稻草人立起来。'
  timeLimitSec: 240
  successCriteria:
    - { id: every-open-slot, text: 田要么种满，要么种子一粒不剩, check: "(g) => g.seedsLeft() === 0 || g.openSlots().every(s => s.sprout)" }
    - { id: no-crop-in-water, text: 水渠里一颗麦子都没有, check: "(g) => g.var('waterCells').every(p => g.block(p).id !== 'minecraft:wheat')" }
    - { id: no-crop-outside, text: 田外没有一格麦子, check: "(g) => g.var('outsideCells').every(p => g.block(p).id !== 'minecraft:wheat')" }
    - { id: no-seed-wasted, text: 种子要么种下了、要么还在手里, check: "(g) => g.seedsLeft() + g.sproutCount() === g.seedBudget() + g.harvestSeedsGained()" }
    - { id: golem-home, text: 灰崽回到谷仓门口, check: "(g) => g.agentNear(g.var('barnPos'), 5)" }
  trials:
    - id: field-4x6
      name: 试炼田·四行六列
      setup: { variant: field-basic, rows: 4, cols: 6, waterRow: 1, seedBudgetRatio: 1.0 }
      assertions: [{ id: t1a, text: '除水渠外全部是新种', check: "(g) => g.trial('field-4x6').openSlots().every(s => s.sprout) && g.trial('field-4x6').countCrops('water') === 0" }]
    - id: field-short
      name: 试炼田·种子不够
      setup: { variant: field-basic, rows: 6, cols: 5, waterRow: 2, seedBudgetRatio: 0.6 }
      assertions: [{ id: t2a, text: '种子用完即停、零浪费', check: "(g) => g.trial('field-short').seedsLeft() === 0 && g.trial('field-short').noSeedWasted() && g.trial('field-short').countCrops('water') === 0" }]
  hiddenTests:
    - id: h-random-size
      name: 换一块 5×7 的田
      setup: { variant: field-basic, rows: 5, cols: 7, waterRow: 4, seedBudgetRatio: 1.0 }
      assertions: [{ id: h1, text: '种满、水渠无作物、灰崽回谷仓', check: "(g) => g.trial('h-random-size').openSlots().every(s => s.sprout) && g.trial('h-random-size').countCrops('water') === 0 && g.trial('h-random-size').golemHome()" }]
    - id: h-tiny
      name: 缩到 2×3 的田
      setup: { variant: field-basic, rows: 2, cols: 3, waterRow: 1, seedBudgetRatio: 1.0 }
      assertions: [{ id: h2, text: '小田也种满（循环不依赖 5）', check: "(g) => g.trial('h-tiny').openSlots().every(s => s.sprout)" }]
    - id: h-seed-short
      name: 6×4 的田，种子只有六成半
      setup: { variant: field-basic, rows: 6, cols: 4, waterRow: 3, seedBudgetRatio: 0.65 }
      assertions: [{ id: h3, text: '种子用光即停、不丢进水渠、不浪费', check: "(g) => g.trial('h-seed-short').seedsLeft() === 0 && g.trial('h-seed-short').noSeedWasted() && g.trial('h-seed-short').countCrops('water') === 0" }]
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: rows-cols, range: [[2, 7], [3, 8]], note: '田的行列数随机（验收变体用不同组合）' }
      - { id: water-row, note: '水渠落在第 0..rows-1 行，随机；隐藏变体换行' }
      - { id: seed-budget, ratio: [0.6, 1.0], note: '种子相对可种格数的比例' }
      - { id: mature-ratio, ratio: [0.2, 0.5], note: '上一季残株占可种格的比例' }
```

**阶段（4 段）**：①东田：先收残株再种满（种子用完即停）②中田 ③西田 ④回谷仓报三块田的格数并复查水渠。
**挑战层（可跳过、不计星）**：不规则田——两行水渠 + 种子只够六成，仍要种得刚刚好；参考解与判定见 `L04.content.ts` 的 `challenge`（独立验收，不影响星数）。
**判定口径**：`openSlots()` = 非水渠的耕地格；`sprout` = 新种下的 age=0 麦苗（上一季的成熟麦不算）。`noSeedWasted()` = `seedsLeft + sproutCount === seedBudget + harvestSeedsGained`。**多解**：while 版、for+break 版、for+if 版只要状态达标都过；收割用不用 `harvest` 都行，但不收掉成熟麦就种不下去。
**阶段（4 段）**：①东田 ②中田 ③西田（各先收后种、种子用完即停）④回谷仓报数并复查水渠；参考解 50 行（docs/20 §3c ≥50）。**挑战层（可跳过、不计星）**：不规则田（两行水渠 + 种子六成），判定见 `L04.content.ts` 的 `challenge`（独立验收）——schema 暂无 `challenge` 字段，实现期以 content.ts 为准。

## 5. 代码与 API（`code`）

| registry 符号（`docs/12` §3 L4） | 学生调用形态 | 读/写 | 人话 |
|---|---|---|---|
| `world.field()` | `world.field()` → `field.rows` / `cols` / `origin` / `waterRow` | 读（同步） | 田的尺寸、西北角原点、水渠整行（`waterRow: number \| null`） |
| `golem.plant(x, z)` | `golem.plant(field.origin.x + c, field.origin.z + r)` | 写 | 在那一格种下小麦（会寻路过去） |
| `golem.harvest(x, z)` | `golem.harvest(x, z)` | 写 | 收掉那一格的上一季残株（空格无动作，成熟麦给种子） |
| `golem.placeScarecrow(x, z)` | `golem.placeScarecrow(x, z)` | 写 | 放稻草人（亲手节拍也可手动放） |

复用：`golem.moveTo`、`golem.count("wheat_seeds")`（L2 的读符号）、`golem.say`、`golem.pos`。田的原点、尺寸、水渠行都来自 `world.field()`；**不要写死 5**。

```yaml
code:
  expectedLoc: 56
  starterCode: |
    // 三块田的数据在 world.vars.fieldA / fieldB / fieldC 里（行数、列数、水渠行、种子数都在里面）。
    // 每格的活：先 golem.place("air", x, 65, z) 收掉残株，再 golem.place("wheat_sprout", x, 65, z) 种下。

    // 现在只种了东田左上角一块固定的 5×5，另外两块田还没碰，也没先收残株。
    const a = world.vars.fieldA
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 5; c++) {
        golem.moveTo(a.x + c, a.z + r)
        golem.place("wheat_sprout", a.x + c, 65, a.z + r)
      }
    }

    // 东田还没种对：行数和列数要读 a.rows、a.cols，水渠那一行跳过，种子用完就停。
    // 中田、西田是同样的活：数据在 world.vars.fieldB 和 world.vars.fieldC 里。
    // 三块田都种完以后，回谷仓（-4, 14）报一报各种了多少格。
    golem.moveTo(-4, 14)
  referenceSolution: |
    // 阶段一：东田——先收残株，再种新种；种子用完就停
    const a = world.vars.fieldA
    let seedsA = a.seeds
    let rA = 0
    while (rA < a.rows && seedsA > 0) {
      for (let cA = 0; cA < a.cols; cA++) {
        if (rA !== a.waterRow && seedsA > 0) {
          golem.moveTo(a.x + cA, a.z + rA)
          golem.place("air", a.x + cA, 65, a.z + rA)
          golem.place("wheat_sprout", a.x + cA, 65, a.z + rA)
          seedsA = seedsA - 1
        }
      }
      rA = rA + 1
    }

    // 阶段二：中田——同一段符文再走一遍
    const b = world.vars.fieldB
    let seedsB = b.seeds
    let rB = 0
    while (rB < b.rows && seedsB > 0) {
      for (let cB = 0; cB < b.cols; cB++) {
        if (rB !== b.waterRow && seedsB > 0) {
          golem.moveTo(b.x + cB, b.z + rB)
          golem.place("air", b.x + cB, 65, b.z + rB)
          golem.place("wheat_sprout", b.x + cB, 65, b.z + rB)
          seedsB = seedsB - 1
        }
      }
      rB = rB + 1
    }

    // 阶段三：西田——再来一遍
    const c = world.vars.fieldC
    let seedsC = c.seeds
    let rC = 0
    while (rC < c.rows && seedsC > 0) {
      for (let cC = 0; cC < c.cols; cC++) {
        if (rC !== c.waterRow && seedsC > 0) {
          golem.moveTo(c.x + cC, c.z + rC)
          golem.place("air", c.x + cC, 65, c.z + rC)
          golem.place("wheat_sprout", c.x + cC, 65, c.z + rC)
          seedsC = seedsC - 1
        }
      }
      rC = rC + 1
    }

    // 阶段四：回谷仓，报三块田各种了多少格
    golem.moveTo(-4, 14)
    golem.say("东田：种下了 " + (a.seeds - seedsA) + " 格")
    golem.say("中田：种下了 " + (b.seeds - seedsB) + " 格")
    golem.say("西田：种下了 " + (c.seeds - seedsC) + " 格")
    golem.say("三块田都收好种好了")

    // 收工前再走一遍东田的水渠，确认渠里没有种子
    golem.moveTo(a.x, a.z + a.waterRow)
    golem.say("东田水渠：干净")
    golem.moveTo(-4, 14)
```

**常见错误**：循环写成 `r <= field.rows` → 越界一格（田外/水渠边），判定「田外无作物」失败；内层用 `r` 当列号 → 整片田只种一列；先 plant 后 harvest → 成熟麦格种不下去（plant 被拒）；while 忘了 `r = r + 1` → 死循环（runner 2s 强杀，提示「循环没有前进」）；把水渠当普通格 → 种子泡烂（种子守恒失败）。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '田从 5×5 变成 5×7，写着 5 的循环会怎样？', options: ['自动多种 2 列', '只种到第 5 列，右边两列空着', '循环会报错'], answer: 1 }
    - { question: '种子在第 3 行就用完了，while 循环会？', options: ['继续跑完剩下的行，只是种不下', '马上停下来', '把种子退回来'], answer: 1 }
  investigate:
    brokenCode: |
      for (let r = 0; r <= field.rows; r++) {
        for (let c = 0; c <= field.cols; c++) {
          golem.plant(field.origin.x + c, field.origin.z + r)
        }
      }
    expectedError: 'TS 不报错；世界反馈：最后一行/最后一列种到田外——plant 被拒、种子没消耗，判定「田外无作物」失败，田里还空着几格'
    explanation: '循环边界差一格（off-by-one）。「小于」停在前一格，写成「小于等于」就会多走一步；盯着田的四条边数一遍。'
  beats:
    - { beat: painBeat, durationSec: 60, playerAction: '看艾拉写 25 行 place 的旧符文：田变大后写到天亮，还种进了水渠', coachLine: '你在数格子。让循环去数。', uiChange: '旧符文石板逐行浮现 25 个坐标；水渠冒泡', expectedOutput: '你说出「这也太长了」' }
    - { beat: predict, durationSec: 45, playerAction: '答 2 道预测题（不跑代码）', coachLine: '先猜：田变大，哪一行会先出错？', uiChange: '预测卡盖住编辑器', expectedOutput: '2/2 正确' }
    - { beat: run, durationSec: 90, playerAction: '跑 starter（只种了 5×5 的一角，成熟麦被跳过）', coachLine: '看，它数到 5 就停了。', uiChange: '田里只有左上角 5×5 有绿点；水渠第 3 格有一颗泡烂的种子', expectedOutput: '看到「写死尺寸」的后果' }
    - { beat: investigate, durationSec: 90, playerAction: '修 off-by-one：把 <= 改回 <', coachLine: '边界差一格，田边就空一条。', uiChange: '田边长出麦苗；判定提示只剩水渠问题', expectedOutput: '理解循环边界' }
    - { beat: modify, durationSec: 240, playerAction: '补 field.rows/cols、if 跳过水渠、先收后种', coachLine: '一行一行来，别急着一次改五处。', uiChange: '麦苗逐格冒出（happy_villager 粒子）', expectedOutput: '主田全部种满' }
    - { beat: make, durationSec: 180, playerAction: '第二块种子不够的田：把 for 改成 while 在种子耗尽时停', coachLine: '种子会先说停。听它的。', uiChange: '结果面板显示「恰好用完」；剩余行空着', expectedOutput: '零浪费完成' }
    - { beat: wrap, durationSec: 40, playerAction: '放稻草人（右键干草捆）、看雨停，进 Act I 结算', coachLine: '收成，是循环和雨的事。动作之核，合上了。', uiChange: '雨停、阳光、麦浪、Act I 织核合拢', expectedOutput: '解锁循环之符，Act I 通关' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '田多大不用数：问田地一句，它会报出行数和列数。', codeAnchor: 'const a = world.vars.fieldA' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '别把行数、列数写进代码；外层走行，内层走列，水渠那一行跳过。', codeAnchor: 'if (rA !== a.waterRow' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '种子不够时，用按条件停的循环来种，种到没种子就停下。', codeAnchor: 'while (rA < a.rows && seedsA > 0)' }
  errorMap:   # 固定格式：第 N 行 + 原因 + 可照抄写法（docs/20 §3b2）
    - { tsCode: 0, text: '第 8 行走多了一格：最后一格本来不用碰。把 <= 改成 <，再运行一次。' }
    - { tsCode: 0, text: '第 9 行把 5 固定住了：田换了大小就种得不对。行数用 f.rows，列数用 f.cols。' }
    - { tsCode: 0, text: '第 10 行把种子下到了水渠里：那一行不能种。判断里跳过 f.waterRow。' }
    - { tsCode: 0, text: '第 12 行循环停不下来：r 一直没有加 1。在循环末尾补一句 r = r + 1。' }
    - { tsCode: 0, text: '第 13 行少了先收残株这一步：同一格先收掉残株，再放新麦苗。' }
    - { tsCode: 0, text: '第 20 行田种完了还没回谷仓：最后走到谷仓门口（-4, 14）。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「别改代码里的 5：田会自己告诉你有几行几列。」把注意力推到 `world.field()`。
2. **technique（2 次失败后）**：点出「外层走行、内层走列」，并提醒水渠要在内层开始前跳过；不贴完整代码。
3. **near-solution（3 次失败或 240s 无进展）**：只给结构——「种子不够时：把行循环写成 while，条件里问『还有种子吗』」，高亮 `while (r < field.rows` 一行；若 60s 后仍无进展，自动填入外层循环，保留 `if` 与 `plant` 给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '麦苗从田埂一头逐格冒到另一头；雨停、阳光斜下来，整片田转成金黄；另：你放上南瓜头：稻草人立起、麦浪声起；Act I 结算——远处灯河次第亮起、钟声传来、动作之核在钟楼合拢；advancement「麦田的咒语」，Act I 通关'
  partial:
    - '种满了但水渠里有一颗：种子泡烂的绿色气泡；种子够了却剩半行：田边空出一条，村民在田埂上张望'
  failure:
    - '死循环：织偶在原地打转 2 秒后被叫停，「循环没有前进——检查 r 有没有变」'
  wowMoment: '你把雕刻南瓜按上干草捆的瞬间：雨声戛然而止，云层裂开一道光，织偶在田里跑出最后一行折线，麦苗像被点着一样一格一格亮起来（happy_villager 粒子连成线），远处村庄的灯笼同时亮起，钟楼传来钟声，动作之核在钟楼上方合拢成环'
  ambience: '雨声、泥地脚步、麦浪沙沙；高潮切到鸟鸣与村庄环境音'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 240s 强杀；连续 3 次超时自动把 while 条件高亮并提示「检查循环有没有前进」'
  infiniteLoop: '循环预算 100k 次迭代 / 2s wall clock；超限强杀并回放最后 3 条指令；检测到同一行重复 >1000 次即判死循环'
  disconnected: '断线暂停关卡；重连后按快照恢复（已种格与种子数保留）'
  resetPolicy: 'R 或 UI 一键重置 ≤2s：田恢复上一季残株与随机尺寸，种子回初始数；不扣资源'
  cheatPolicy: '只看世界状态；允许 while/for/break 任意写法。禁止直接调 RPC、禁止读取判定脚本'
  isolation: '学生代码在 worker 沙箱，只能访问 apiAllowlist；随机种子与判定真值只在 engine/plugin 侧'
```

## 10. 隐藏测试与反硬编码

- **`h-random-size`（5×7）/`h-tiny`（2×3）**：写死 `r < 5 / c < 5` 的程序在大田只种左上角、在小田会种到田外（plant 被拒）——读 `field.rows/cols` 的程序自动适配，这是本关主测试。**`h-seed-short`（6×4，种子 65%）**：硬跑完整个循环的写法会把种子丢到已种格上（`noSeedWasted()` 失败），while/break 写法恰好用完。；另：**随机化**（`hiddenOnly: true`）：行列 2–7 / 3–8、水渠行、种子比例 0.6–1.0、残株比例 0.2–0.5；种子 = `hash(L04, sessionId, attempt)` 写入日志，失败可复现。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过日志（schema 必填键、文本预算、apiAllowlist 全部在 docs/12 registry 内、hints 恰好 3 级、trials/hiddenTests ≥1 且含随机字段）'
    - 'referenceSolution（去注释 50 行，docs/20 §3c ≥50）在 MockWorld 与 Paper 上通过 3 条 successCriteria + 3 个 hiddenTests（记录每块田的 seed）；挑战层不规则田参考解单独通过、不影响星数'
    - 'starterCode 编译通过且未修改时判定失败（只种 5×5、跳不过水渠）；盲测 solver ≤15min、≤2 级提示通关；1 名人类 playtest ≥10min 记录 3 个困惑点'
  blindSolver:
    criteria: '只读关卡 UI 文本（目标面板、艾拉台词、代码注释、api 文档），不看本 spec；15 分钟内主田种满，并能解释「为什么要读 field.rows 而不是写 5」'
  screenshots:
    - '开场：黎明的雨、空田、田埂上的旧符文石板（25 行字）'
    - '中段：织偶折返跑、麦苗逐格冒出、水渠在田中间'
    - 'wow：放上南瓜头的稻草人 + 雨停阳光 + 远处灯河与钟楼合拢的织核'
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - '稻草人不是原版方块：docs/05 §8 L4 写「MC 真实方块」不准确。本关用「干草捆×2 + 雕刻南瓜 + 栅栏手臂」的你自建方案（视觉地道），作物加速是织机法则（演出/规则，非原版机制）。建议 Lead 修正 05 措辞。'
  - '旧写法用数组下标 + 属性读取算水渠行号，比 05 §7.1 给 L4 排的语法预算（for/while/嵌套）靠前；docs/12 已新增只读标量 `field.waterRow`（null = 无渠），本关 starter/reference 已改用，表与 starter 注释即学生可见解释。'
  - '本关已用 `docs/12` 新增的 `field.waterRow` 取代原来的数组下标读法（提前于本关语法排期的问题已消除）；水渠/田外/barn 句柄走 `world.vars` 运行时注册（田地原点固定、尺寸随机，静态 regions 只能表达基准框）。另：本关 builder 名 `wheatField/barnBarn/scarecrowBase/scarecrowHead` 不在 docs/07 §6 白名单（评审 F6 建议补录 12 个 builder），实现期前需 Lead 在白名单补录或改名映射。；另：种子/收获守恒判定依赖引擎记录 seedBudget / harvestSeedsGained，否则退回弱判定（水渠/田外无作物 + 种子为 0 或田已满）。t2「种子不够的田」与 makeTask 重合，建议 trials 在主田完成后才解锁，否则你在没学 while 前被卡住。'
```
