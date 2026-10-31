# L07 — 信风与织线（The Trade Winds）

> 状态：v3 设计规格（按 docs/20 §3c / docs/24 扩体量：参考解 ≥50 行、3 阶段、加练挑战、纯中文引导）｜负责人：smith-act2｜最后更新：2026-10-31
> 上游：`docs/05` §8 L7、`docs/06` §4/§6.1、`docs/12`（API 权威）、`docs/20 §3b/§3c`、`docs/23`、`docs/25`、`docs/14/14b` 评审｜下游：`L07.level.ts`、`L07.content.ts`（含 challenge）、`packages/grader`、Codex A9/A10
> 体量统计：参考解去注释 **53 行**（Act II 下限 50）｜starter 去注释 **18 行**（差 **35 行**，下限 25）｜阶段 **3**｜加练挑战 **1**（可跳过、不计星）｜隐藏变体 **2**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并即完整 spec。`task.phases`、`task.challenge`、`narrative.opening/worldState/whyYou` 是 docs/06 §6.1 #9/#15 的 **T2 设计期文档字段**：schema 与 `L07.content.ts` 在 T2 补入，本文件先用「§4 阶段与挑战」「§2 开场三句」两段文本承载。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L07
  title: { zh: 信风与织线, en: The Trade Winds }
  act: 2
  order: 7
  priority: P1
  prerequisites: [L06]
  estimatedMinutes: 20
  difficulty: 4
  abstractions: [A9, A10]
  objectives:
    - { id: o-fn-value, learnerView: '把「一条规矩」写成做法交给悦灵，让它自己判断每一件货', evidence: '三只悦灵按规矩把货堆分进三只箱子，玩家不再逐件下命令' }
    - { id: o-closure, learnerView: '做法会记住它被创建时身边的变量（闭包）', evidence: 'giveTo(box) 返回的做法用自己的箱子坐标把货送进去，三只箱子各自正确' }
    - { id: o-pipeline, learnerView: '用流水线把「筛哪些 → 交给谁」串起来，行为与逐件循环一致', evidence: '复核箱由流水线清空、错货归位；对照面板的逐件版结果一致' }
  misconceptions: [call-vs-reference, closure-copies-value, filter-vs-map, pipeline-order]
  apiIntroduced: [allay, allay.assign, allay.patrol, world.give]
  apiAllowlist: [golem.moveTo, golem.say, golem.pos, world.containers, world.container, allay, allay.assign, allay.patrol, world.give, pipe, map, filter, take]
  syntaxIntroduced: ['箭头函数（做法作为值）', '闭包', 'map/filter（流水线零件）', 'pipe 流水线']
  reward: { rune: A10, advancement: loomcraft/act2/trade_winds, codexPage: A10 }
  languageLevel: act2
```

## 1. 学习目标（学习者视角）

1. **做法作为值 + 闭包（A9，第一阶段）**：规矩不是一个句子、不是一次命令，而是一个能吃货物、吐「是/不是」的做法；把它交给悦灵，悦灵就对每一件货自己判断。`giveTo(box)` 返回的做法还记着自己的箱子（闭包）。
2. **流水线 vs 逐件循环（A10，第二阶段）**：逐件循环把「筛什么」和「送哪里」焊在一起；`pipe(复核箱清单, filter(isOre), giveTo(oreBox))` 把零件单独拿出来串起来读——行为一样，维护成本不同。
3. **三个阶段**：①规矩交给悦灵（三条分辨规矩 + 先清点货堆）②流水线（送法 + 三条流水线把复核箱错货送回原处）③对账（逐箱点数、清点没认过的货、报给艾拉听）。
4. **加练（不计星）**：无限巡逻与惰性预算——生成器写一条无限路线，只取前五站。
5. **不教**：Promise/await（第九关）、接口（第八关）；生成器只在加练与织典页出现，不进主线。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '信风谷的清晨。商队的旧货被散线缠住，堆在营地中央；三只悦灵关在铁笼里，笼门上的木牌写着它们各自最熟悉的气味：矿石、木料、食物。艾拉说：「悦灵：信风谷里替人搬东西的小风灵，认规矩不认命令。它们不是笨，是只听得懂规矩，听不懂清单。」'
  stakes: '信风季最后一天：日落前货物必须各归各箱；悦灵若学不会规矩，就只能继续被关着，散线会把货堆整个缠走。'
  painBeat: '艾拉放出去年的符文：一个循环里套三层判断，把「哪些要」和「送到哪」焊在一起。今年货单多了一种云杉木，她改到第六行就改错了——矿石被送进食物箱。她叹气：「我每加一条规矩，就得拆一次循环。」'
  resolution: '你把三条规矩写成三个小小的做法交给悦灵，它们像信风一样飞出去，只捡自己认识的货；复核箱里的错货被三条流水线重新分开。你逐箱点清数目，报给艾拉听。织者之印：活人手上才有的印记——最后开笼那一下，得你亲手来。'
  coachTone: '轻、快、有画面感；用「规矩/风/巢」这些世界里的词，不说「高阶函数」。台词要点：①「给它们一条规矩，不是一串命令。」②「同一件事，换一种写法。」③「风会替你把线吹直。」'
```

**名词首现解释（docs/23 §8）**：**悦灵**＝信风谷里替人搬东西的小风灵，认规矩不认命令（docs/23 名词表尚未收录，见 §12）；**散线**＝织机断线后散出的灰白线头，只让碰到的东西忘记自己该做什么；**织者之印**＝活人手上才有的印记；**加练**＝一关织完之后、织机额外吐出的更难的纹样，可跳过、不计星。

**开场三句（docs/25 §3，关开场必播，≤180 字）**：

1. **世界状态**：「信风谷的三只笼子还锁着，散线把货堆缠在营地中间。今天的信风一过，这些货就归散线了。」
2. **任务**：「给三只悦灵各一条分辨货物的规矩，让它们把货堆搬进三只箱子；再用一条流水线把复核箱里的错货送回原处。」
3. **为什么是你**：「笼门只有你的手能开；悦灵认的是你给的规矩，不是一声命令。」

**世界状态变化（docs/24 §5）**：过关后三只笼门同时弹开、悦灵拖着光轨把货送进箱子、箱盖依次亮起；信风谷的风铃响成一片，散线从货堆上松开，营地中央第一次露出完整的石板地。

## 3. 世界与场景（`world`）

信风谷营地：三只铁笼（橡木活板门朝向玩家）、三只贴标签的箱子（矿石/木料/食物）、一只货堆箱（混合到货）、一只复核箱（被放错的货）。**每只笼子紧挨它负责的箱子**（小风→矿石箱、小北→木料箱、小谷→食物箱，笼门木牌写着标签），悦灵被放出后只捡自己规矩命中、并搬回自己箱子的货。本关货物编号固定六种：矿石两种、木料两种、食物两种。`world.containers()` 顺序固定：`0` 矿石箱、`1` 木料箱、`2` 食物箱、`3` 货堆、`4` 复核箱——位置每局随机。`seed = session`：货物种类/数量、箱子位置随机。

```yaml
world:
  anchor: { kind: meadow, id: wind-vale }
  dimension: overworld
  time: 7000
  weather: clear
  region: { center: [0, 64, 0], radius: 56 }
  entities:
    - { type: golem, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: meadow, id: wind-vale }
        - { op: buildProps, builder: allayRoost, params: { cages: 3, boxes: 3, cargoChests: 2, names: [小风, 小北, 小谷], labels: [矿石, 木料, 食物], seed: '$session' } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$roost.center' }
        - { op: objective, items: ['第一阶段：三条规矩分拣货堆', '第二阶段：流水线送回复核箱的错货', '第三阶段：逐箱对账并释放悦灵'] }
        - { op: dialog, speaker: eira, text: '悦灵不是笨，是只听得懂规矩，听不懂清单。' }
    - phase: releaseBeat
      steps:
        - { op: waitUntil, event: onInteract, target: cage-trapdoor, count: 3, timeout: 180 }
        - { op: particle, type: end_rod, at: '$roost.cages', count: 30 }
        - { op: sound, id: minecraft:entity.allay.item_thrown, volume: 1 }
    - phase: climax
      steps:
        - { op: animate, target: '$roost.allays', animation: allaysFlyToBoxes }
        - { op: particle, type: end_rod, at: '$roost.boxes', count: 60 }
        - { op: sound, id: minecraft:block.note_block.chime, volume: 1 }
        - { op: advancement, id: loomcraft/act2/trade_winds }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['三只铁笼与活板门', '三只箱子与标签', '营火与帐篷', '营地中央被散线缠住的货堆']
```

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '给三只悦灵各写一条分辨货物的规矩，让它们把货堆分进三只箱子；再用一条流水线把复核箱的错货送回原处，最后逐箱对账报数。'
  makeTask: '验收会换一批货物、换箱子位置：程序不许写死坐标；换一批只含两类货的清单也要能跑。'
  playerBeat: '代码通过预检后按「运行」：程序替悦灵装好规矩；你右键三只笼门的活板门放出它们，悦灵按规矩分拣并把货送进箱子。'
  timeLimitSec: 240
  successCriteria:
    - { id: c-main, text: '货堆按三条规矩分进三只箱子，无遗漏、无错箱', check: "(g) => g.boxesMatchRules(['ore', 'wood', 'food']) && g.container('cargo').count() === 0" }
    - { id: c-recheck, text: '复核箱清空，错货按同一套规矩归位', check: "(g) => g.container('recheck').count() === 0 && g.groundItems().length === 0" }
    - { id: c-cages, text: '三只笼门都是玩家亲手打开的', check: "(g) => new Set(g.events('player.interact').filter(e => e.actorType === 'player' && e.target === 'cage-trapdoor').map(e => e.pos.key)).size === 3" }
    - { id: c-no-manual, text: '所有货物都是由悦灵或流水线搬运的', check: "(g) => g.events('item.move').every(e => e.actor !== 'player')" }
  hiddenTests:
    - id: h-random-cargo
      name: 换一批货与箱子位置（换规则组合）
      setup: { variant: cargo-shuffle, itemKinds: 'random', counts: 'random:1..4', boxPositions: 'random' }
      assertions:
        - { id: h1a, text: '三箱内容与规矩一致（种类/数量/顺序无关）', check: "(g) => g.boxesMatchRules(['ore', 'wood', 'food'])" }
        - { id: h1b, text: '货堆与复核箱清空、无货落地', check: "(g) => g.container('cargo').count() === 0 && g.container('recheck').count() === 0 && g.groundItems().length === 0" }
    - id: h-sparse-cargo
      name: 这一批没有食物（换数据形状）
      setup: { variant: sparse-cargo, kinds: [ore, wood] }
      assertions:
        - { id: h2a, text: '两类货各自归位，食物箱保持空', check: "(g) => g.container('food').count() === 0 && g.container('cargo').count() === 0" }
        - { id: h2b, text: '矿石箱与木料箱内容与清单一致，没有报错', check: "(g) => g.boxesMatchRules(['ore', 'wood']) && g.container('recheck').count() === 0" }
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: cargo-mix, note: '固定六种货物的数量 1–4 随机、到货顺序随机；箱子位置随机' }
      - { id: sparse-cargo, note: '只含两类货的稀疏清单，仅隐藏变体使用' }
```

**阶段（3 段，docs/20 §3c / 文档级 `task.phases`）**：①规矩交给悦灵——写一个「任何两种货物都能用」的规矩工厂、造出三条分辨规矩、交给三只悦灵，并先清点货堆；②流水线——写一个「送法」小做法（记住自己的箱子），用三条流水线把复核箱里的错货按规矩送回原处；③对账——逐箱点数、清点货堆里没被任何规矩认过的货，把数目报给艾拉听，然后开笼收工。

**加练挑战（文档级 `task.challenge`，可跳过、不计星）**：**无限巡逻与惰性预算**——用生成器写一条无限巡逻路线，让三只悦灵绕家飞一圈：只取前五站、第五站回到家里；判定要求恰好五站、终点在家、三十秒内完成、迭代预算不超过四百次（先把无限路线整个算完的写法必然失败）。判定见 `L07.content.ts` 的 `challenge`（独立验收、不影响星数；schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准）。生成器只在加练与织典页出现，不占主线语法预算。

**隐藏变体（≥2，docs/20 §3c）**：①`h-random-cargo`：换规则组合——货物种类/数量/到货顺序/箱位随机；②`h-sparse-cargo`：换数据形状——只来两类货，食物箱必须保持空，验证程序不假设「三类都有」。

**多解**：逐件循环与流水线都算通过（docs/05 允许循环实现，界面只做对照）；判定只看箱内容与事件流。**部分成功**：货堆分对了但复核箱没动 → 复核箱闪黄光；有悦灵没回来 → 提示开笼节拍。

## 5. 代码与 API（`code`）

| 本关新增（registry 名） | 签名（按 docs/12 §1.4 展开） | 读/写 | 教学作用 |
|---|---|---|---|
| `allay` | 全局对象 | — | 悦灵群控制对象（本关） |
| `allay.assign(name, strategy)` | `Promise<void>` | 写 | 给某只悦灵一条规矩 `(货物) => 是/不是`（第一阶段核心） |
| `world.give(x, z, item, count)` | `Promise<void>` | 写 | **语义已冻结**：把 count 件 item 放进 (x,z) 容器；物品从「本关发货容器（复核箱）」转出，引擎做容器间转移（流水线末端用） |
| `allay.patrol(route)` | `Promise<void>` | 写（extension） | 路线是若干站点或一条生成器；**加练挑战**用它，不计星 |

**流水线零件（第七关起全局可用，语义已冻结）**：`pipe(值, ...零件)` 依次把上一环结果喂给下一环；`filter(判断) `与`map(变换) `返回「流水线零件」；`take(n)` 返回零件——`take(n)(可迭代物)` 只取前 n 个（惰性，可接无限生成器，供加练挑战）。复用第六关：`world.containers()`；第二关：`world.container(x, z).items()`；`golem.pos`。签名按 docs/12 §1.4 展开为 `(x, z)`，不写坐标对象。

```yaml
code:
  expectedLoc: 80
  starterCode: |
    // 信风谷：三只笼子、三只箱子、一只货堆箱、一只复核箱（界面右侧有箱子标签）
    const boxes = world.containers()
    const oreBox = boxes[0]
    const woodBox = boxes[1]
    const foodBox = boxes[2]
    const cargoBox = boxes[3]
    const recheckBox = boxes[4]
    const cargoItems = () => world.container(cargoBox.pos.x, cargoBox.pos.z).items()
    const recheckItems = () => world.container(recheckBox.pos.x, recheckBox.pos.z).items()
    // 第一阶段 TODO：三只悦灵各要一条「分辨货物」的规矩
    const isOre = (item: ItemStack) => item.kind === "raw_iron"
    const isWood = (item: ItemStack) => item.kind === "oak_log"
    const isFood = (item: ItemStack) => item.kind === "bread"
    allay.assign("小风", isOre)
    allay.assign("小北", isWood)
    allay.assign("小谷", isFood)
    // 第二阶段 TODO：流水线把复核箱的错货送回原处
    const giveTo = (box: Container) => {
      return (items: ItemStack[]) => {
      }
    }
  referenceSolution: |
    const boxes = world.containers()
    const oreBox = boxes[0]
    const woodBox = boxes[1]
    const foodBox = boxes[2]
    const cargoBox = boxes[3]
    const recheckBox = boxes[4]
    const cargoItems = () => world.container(cargoBox.pos.x, cargoBox.pos.z).items()
    const recheckItems = () => world.container(recheckBox.pos.x, recheckBox.pos.z).items()
    // 第一阶段：规矩工厂——记住两种货物编号，交给悦灵
    const anyOf = (first: string, second: string) => {
      return (item: ItemStack) => item.kind === first || item.kind === second
    }
    const isOre = anyOf("raw_iron", "coal")
    const isWood = anyOf("oak_log", "spruce_log")
    const isFood = anyOf("bread", "carrot")
    allay.assign("小风", isOre)
    allay.assign("小北", isWood)
    allay.assign("小谷", isFood)
    const cargoList = cargoItems()
    let oreNeed = 0
    let woodNeed = 0
    let foodNeed = 0
    for (let i = 0; i < cargoList.length; i = i + 1) {
      if (isOre(cargoList[i])) { oreNeed = oreNeed + cargoList[i].count }
      if (isWood(cargoList[i])) { woodNeed = woodNeed + cargoList[i].count }
      if (isFood(cargoList[i])) { foodNeed = foodNeed + cargoList[i].count }
    }
    golem.say("货堆清点：矿石" + oreNeed + "件，木料" + woodNeed + "件，食物" + foodNeed + "件。")
    // 第二阶段：送法记住自己的箱子，三条流水线各管一类
    const giveTo = (box: Container) => {
      return (items: ItemStack[]) => {
        for (let i = 0; i < items.length; i = i + 1) {
          world.give(box.pos.x, box.pos.z, items[i].kind, items[i].count)
        }
      }
    }
    pipe(recheckItems(), filter(isOre), giveTo(oreBox))
    pipe(recheckItems(), filter(isWood), giveTo(woodBox))
    pipe(recheckItems(), filter(isFood), giveTo(foodBox))
    // 第三阶段：逐箱点数，再清点没认过的货
    function countAll(box: Container): number {
      const items = box.items()
      let total = 0
      for (let i = 0; i < items.length; i = i + 1) {
        total = total + items[i].count
      }
      return total
    }
    const gotOre = countAll(oreBox)
    const gotWood = countAll(woodBox)
    const gotFood = countAll(foodBox)
    golem.say("矿石箱里有" + gotOre + "件货，木料箱里有" + gotWood + "件，食物箱里有" + gotFood + "件。")
    if (gotOre === oreNeed && gotWood === woodNeed && gotFood === foodNeed) {
      golem.say("对上了：三只箱子的数目和清点的一样。")
    }
    golem.say("三只笼门打开后，风会替我们把线吹直。")
```

**逐件循环版对照（界面右侧并排展示，行为与流水线版相同）**——「筛什么」和「送哪里」焊在一起，加一类货要改三处；流水线版每个零件只做一件事：

```ts
const items = recheckItems()
for (let i = 0; i < items.length; i = i + 1) {
  if (isOre(items[i])) { world.give(oreBox.pos.x, oreBox.pos.z, items[i].kind, items[i].count) }
  if (isWood(items[i])) { world.give(woodBox.pos.x, woodBox.pos.z, items[i].kind, items[i].count) }
  if (isFood(items[i])) { world.give(foodBox.pos.x, foodBox.pos.z, items[i].kind, items[i].count) }
}
```

**加练挑战参考解（不计入主线行数，织典页有同款示例）**：

```ts
const home = golem.pos
function* patrol() {
  while (true) {
    yield { x: home.x - 8, z: home.z - 8 }
    yield { x: home.x + 8, z: home.z - 8 }
    yield { x: home.x + 8, z: home.z + 8 }
    yield { x: home.x - 8, z: home.z + 8 }
    yield { x: home.x, z: home.z }
  }
}
allay.patrol(take(5)(patrol()))
```

**常见错误**：把做法「调用」了再交（`allay.assign("小风", isOre(某件货))`）→ 交出的是「是/不是」，悦灵听不懂；`filter(isOre)` 写成 `filter(isOre())`；`giveTo(box)` 漏了「交回一个做法」；`pipe` 顺序写反（先送再筛）；加练里把无限路线先装进口袋（先算完再取）→ 预算超限。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '把一条规矩交给悦灵，和每次给它下一道命令，最大的区别是？', options: ['没区别，做法也是命令', '规矩交一次，它自己判断每一件；命令要你替每一件写一条', '做法跑得更快'], answer: 1 }
    - { question: '流水线（先取货、再筛、再送）是按什么顺序做事的？', options: ['先送，再筛', '先取物品，再筛选，再交给箱子', '同时发生'], answer: 1 }
  investigate:
    brokenCode: |
      const isOre = (item: ItemStack) => item.kind === "raw_iron" || item.kind === "coal"
      allay.assign("小风", isOre("raw_iron"))
    expectedError: '运行时世界拒绝：悦灵听不懂——它要的是「一条规矩」，拿到的是「一次判断的结果」；三只悦灵原地不动。'
    explanation: '名字后面加括号就是「现在算一次」；不加括号才是把这条规矩本身交出去。规矩是数据，可以交给别人反复使用。'
  beats:
    - { beat: painBeat, durationSec: 60, playerAction: '看艾拉的旧符文：加一种云杉木就改错六行，矿石进了食物箱', coachLine: '每加一条规矩，就得拆一次循环。', uiChange: '旧代码滚动，错行标红；食物箱里出现矿石', expectedOutput: '玩家说出「规矩应该单独拿出来」' }
    - { beat: predict, durationSec: 45, playerAction: '答两道预测题（不跑代码）', coachLine: '先猜：把做法交出去，和下一次命令差在哪？', uiChange: '预测卡盖住编辑器', expectedOutput: '两道全对，否则重播 painBeat 三十秒' }
    - { beat: run, durationSec: 60, playerAction: '跑开场代码：悦灵只认一种矿石、一种木、一种食物', coachLine: '规矩不全，它们就只捡认识的那些。', uiChange: '三只悦灵只搬走一小部分货', expectedOutput: '看到「规矩决定悦灵的行为」' }
    - { beat: investigate, durationSec: 70, playerAction: '修「把判断结果交给悦灵」的坏代码', coachLine: '给的是规矩，不是这一次的判断。', uiChange: '悦灵原地不动；修好后开始搬货', expectedOutput: '理解做法作为值' }
    - { beat: modify, durationSec: 180, playerAction: '第一阶段：写规矩工厂、造三条规矩、清点货堆', coachLine: '给它们一条规矩，不是一串命令。', uiChange: '三只悦灵飞向各自箱子，货堆清空', expectedOutput: '货堆分拣完成、清点数字对上' }
    - { beat: make, durationSec: 160, playerAction: '第二阶段：写送法、三条流水线送回复核箱的错货', coachLine: '同一件事，换一种写法。', uiChange: '对照面板左右并排：逐件版四行，流水线版三行', expectedOutput: '复核箱清空、错货归位' }
    - { beat: wrap, durationSec: 45, playerAction: '第三阶段：逐箱点数、清点没认过的货；开笼放悦灵', coachLine: '风会替你把线吹直。', uiChange: '笼门弹开、end_rod 光轨、箱盖亮起、符文飞入织典', expectedOutput: '通关；能说出「为什么给规矩比给命令强」' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '悦灵只认规矩：给它一个能对货物说「是」或「不是」的做法。', codeAnchor: 'allay.assign' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '流水线每个零件只做一件事：先挑，再送。', codeAnchor: 'pipe' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '写送法的那段要交回一个做法，它记得自己的箱子。', codeAnchor: 'const giveTo' }
  errorMap:
    - { tsCode: 2345, text: '参数类型不对：这里要的是「做法」，不是做法执行一次的结果。' }
    - { tsCode: 2554, text: '送法要一个箱子；挑选要一个判断——数一数括号。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「悦灵只认规矩：它需要知道什么，才能对一件货说『这是我的』？」并高亮 `allay.assign`。
2. **technique（2 次失败后）**：点明流水线的顺序——「每个零件只做一件事：先挑，再送」；不贴完整代码。
3. **near-solution（3 次失败或 240 秒无进展）**：只给结构——「送法交回一个做法，它记得箱子的坐标；三条流水线各管一类」；若六十秒后仍无进展，自动填好送法与两条流水线，保留第三条与规矩补全给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '三只悦灵拖出光轨飞过信风谷；物品像被风卷起，沿弧线落进各自箱子；箱盖亮起，钟琴奏出旋律，成就「信风与织线」弹出，符文飞入织典'
    - '对账的数目报出，艾拉点头；开笼后三只悦灵绕巢飞一圈，落在箱子上'
  partial:
    - '货堆分对但复核箱没动（闪黄光「还有一箱错的」）；或有悦灵没回来（提示开笼节拍）；或对账数字报错了（提示再数一遍）'
  failure:
    - '规矩写成「一次判断的结果」：悦灵原地不动，提示「它要的是规矩，不是一次判断」；或流水线顺序写反：箱子没收到货'
  wowMoment: '三扇笼门同时弹开，悦灵拖着光轨冲进信风；货物被气流卷成三条弧线分别落进矿石箱、木料箱、食物箱，箱盖依次亮起，钟琴的旋律从营地这头滚到那头——风第一次被编成了规矩。'
  ambience: '信风呼啸、悦灵铃音、钟琴；高潮叠加箱盖合鸣与风铃'
```

**截图位**：①笼中三只悦灵与三个贴标签箱子 ②代码停在三行流水线、对照面板左右并排 ③悦灵光轨入箱、箱盖亮起。

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 240 秒强杀；写操作预算三千次，超预算提示「信风把悦灵吹累了」，可无限重跑'
  infiniteLoop: 'for/while 循环预算四千次；加练挑战里消费无限生成器超过四百次迭代立即中止（只取前五站是正解）；主线不要求生成器'
  disconnected: '断线暂停关卡，界面显示「世界连接中断，正在重连」；重连后按快照恢复箱子内容与悦灵状态'
  resetPolicy: '按 R 或界面一键重置，两秒内完成：货物回货堆/复核箱、箱子清空、悦灵回笼、时间回清晨；不扣资源'
  cheatPolicy: '判定只读世界状态与事件流（玩家手动搬货不算）、不读代码文本；允许逐件循环或流水线实现；禁止直接调底层接口'
  isolation: '学生代码跑在隔离沙箱；场景数据、隐藏测试与判定脚本不暴露给学生进程；玩家节拍（开笼）由插件校验'
```

## 10. 隐藏测试与反硬编码

- **`h-random-cargo`（换规则组合）**：货物种类/数量、箱子位置全部随机重排后重跑。写死坐标或写死某几种货物的程序失败；用容器快照与规矩做法的程序一行不改——程序要吃数据，不吃常量。
- **`h-sparse-cargo`（换数据形状）**：只来两类货（没有食物），食物箱必须保持空；程序若假设「三类都有」或把兜底当处理就会错。这条与上一条一起覆盖「换规则组合 / 换数据形状」两种隐藏变体口径。
- **加练挑战的测试（不计星）**：`L07.content.ts` 的 `challenge` 独立跑无限巡逻——恰好五站、终点在家、三十秒内完成、迭代预算四百次；判定只看悦灵轨迹与运行预算，不计星。schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准。
- **反硬编码**：随机化只在验收侧出现（`hiddenOnly: true`）；主界面只显示箱子标签，不显示隐藏坐标；种子写运行日志。**starter 未修改必失败**：规矩只覆盖一种货、复核箱未清。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过（schema 必填键、文本预算、apiAllowlist ⊆ registry、hints 恰三级、隐藏测试 ≥2、randomization.hiddenOnly=true）'
    - 'referenceSolution（去注释 53 行，docs/20 §3c ≥50）在 MockWorld 与真实服务端上通过全部 successCriteria + hiddenTests；starter 去注释 18 行，与参考解差 35 行（下限 25）；逐件循环版对照样例行为一致'
    - 'starterCode 编译通过且未修改时判定失败；加练挑战参考解单独通过（五站/回家/三十秒/预算）、不计星；盲测 solver ≤20 分钟、≤2 级提示通关；1 名人类试玩 + 3 张固定机位截图'
  blindSolver: { criteria: '只读关卡界面文案、registry 的第七关 API 与流水线零件文档、织典面板与当前代码，不看本 spec；20 分钟内主任务通过，并能口头解释「为什么给规矩比给命令强」与「流水线的执行顺序」' }
  screenshots: ['开场：信风谷营地，三只铁笼与三只贴标签箱子', '中段：代码停在三行流水线，对照面板显示逐件版 vs 流水线版', 'wow：悦灵光轨入箱、箱盖亮起']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未包含 docs/06 §6.1 #9/#15 的 `narrative.opening/worldState/whyYou` 与 `task.phases/challenge` 字段；本文件先用「§2 开场三句」「§4 阶段/加练挑战」文本承载，T2 实现期把字段与 `L07.content.ts` 的 `challenge` 一起补进 schema/validator。'
  - '悦灵没有写进 docs/23 的名词表；本文件在 setup 与「名词首现解释」里给了世界内解释（「信风谷里替人搬东西的小风灵，认规矩不认命令」）。建议 Lead 把「悦灵」「信风谷」补进 docs/23 §2，否则叙事一致性评审会打回。'
  - '已冻结：`take(n)` 返回流水线零件（`take(n)(可迭代物)` 只取前 n 个，可接生成器）；`world.give(x, z, item, count)` 把货放进 (x,z) 容器，源为「本关发货容器（复核箱）」、引擎做容器间转移。生成器与 `allay.patrol` 只在加练挑战与织典页出现，不计星、不占主线语法预算。'
  - '玩家节拍为单次执行模型：程序运行时悦灵「听规矩」，关卡在运行后等待玩家开笼（延时等待），悦灵随即执行；若运行器不支持运行后等待，降级为「先开笼再跑程序」（叙事略弱，判定不变）。'
  - '悦灵「按规矩分拣进箱子」不是原版机制（原版悦灵搬给玩家或音符盒）；本关走世界逻辑通道，视觉上给悦灵加「头顶显示携带物」的展示实体，避免货凭空消失——请确认演出成本与性能。'
```
