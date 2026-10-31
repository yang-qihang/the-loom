# L06 — 商队的账本（The Ledger of the Caravan）

> 状态：v3 设计规格（按 docs/20 §3c / docs/24 扩体量：参考解 ≥50 行、3 阶段、加练挑战、纯中文引导）｜负责人：smith-act2｜最后更新：2026-10-31
> 上游：`docs/05` §8 L6 + §7.4 D5-A8 裁决、`docs/06` §4/§6.1、`docs/12`（API 权威）、`docs/20 §3b/§3c`、`docs/23`、`docs/25`、`docs/14/14b` 评审｜下游：`L06.level.ts`、`L06.content.ts`（含 challenge）、`packages/grader`、Codex A7/A8
> 体量统计：参考解去注释 **56 行**（Act II 下限 50）｜starter 去注释 **23 行**（差 **33 行**，下限 25）｜阶段 **3**｜加练挑战 **1**（可跳过、不计星）｜隐藏变体 **2**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并即完整 spec。`task.phases`、`task.challenge`、`narrative.opening/worldState/whyYou` 是 docs/06 §6.1 #9/#15 的 **T2 设计期文档字段**：schema 与 `L06.content.ts` 在 T2 补入，本文件先用「§4 阶段与挑战」「§2 开场三句」两段文本承载。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L06
  title: { zh: 商队的账本, en: The Ledger of the Caravan }
  act: 2
  order: 6
  priority: P1
  prerequisites: [L05]
  estimatedMinutes: 20
  difficulty: 4
  abstractions: [A7, A8]
  objectives:
    - { id: o-record, learnerView: '把相关的几个数绑成一条记录：工具 = 编号 + 类别，不靠位置猜', evidence: '随机货单下 Tool 记录的 id/kind 始终对齐，工具全部进工具桶' }
    - { id: o-union, learnerView: '用 kind 区分互斥的两种情况（工具/补给），用 switch 各走一路', evidence: '工具与补给分别进对桶，食物与材料不混' }
    - { id: o-exhaustive, learnerView: '新增一种情况时，在已有 switch 里补 case，别用兜底把它藏起来', evidence: '验收注入 hoe 后，补 case 的程序把锄头分进工具桶；没补的掉进材料桶' }
  misconceptions: [string-compare-is-enough, default-is-handled, assertnever-is-runtime-only, record-is-more-work, food-is-not-a-kind]
  apiIntroduced: [world.containers, world.jobs, golem.giveTool, world.caravan]
  apiAllowlist: [golem.moveTo, golem.say, golem.collect, golem.deposit, world.container, world.containers, world.jobs, golem.giveTool, world.caravan]
  syntaxIntroduced: ['type 类型别名与记录', '可辨识联合（kind）', 'switch 分支', 'assertNever 穷举兜底']
  reward: { rune: A8, advancement: loomcraft/act2/caravan_ledger, codexPage: A8 }
  languageLevel: act2
```

## 1. 学习目标（学习者视角）

1. **记录（第一阶段）**：一条信息绑在一起——`Tool = { id, kind }`，读的人不会把「编号」当「类别」；分桶时用记录里的 `kind` 决定去处。
2. **两种互斥情况（第一阶段→第二阶段）**：`Cargo` 只有 `tool` / `supply` 两种，`switch (cargo.kind)` 各走一路；`default: return assertNever(cargo)` 是「我保证没有别的情况」的契约。
3. **遇到新情况（第三阶段）**：验收会送来一种没见过的工具（锄头）。**不要用兜底把它藏起来**——在已有 `switch` 里补一格，让账本与对账一起对上。
4. **三个阶段**：①记录建模（工具记录 + 编号到类别的翻译）②三桶分拣（补全选择、主循环、工作点配工具）③新工具注入 + 对账换织线。
5. **不教**：泛型、继承、模式匹配语法；`switch` 只做穷举，不教穿透技巧。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '清晨的旅商营地。羊驼驮着七零八落的货物，三只贴好标签的木桶排成一排：工具、材料、食物。旅商塔卡把一本卷角的账本推给你：「分错一件，这趟就白跑。」他指指桶边的木牌——符文：一句能让世界执行的短句；这本账上的每一行，都是要灰崽照着做的短句。'
  stakes: '商队日中就走。分错货，伐木工拿不到斧头、矿工拿不到镐；账不清，塔卡不收材料，也就换不到修复织机要的「织线」。'
  painBeat: '艾拉翻出去年的账本：全是「铁镐三件」「铁斧两件」这样的字句。旧符文逐条比对，把铁斧分给了矿工；新货「蜜脾」来了，账本不认，整箱倒在地上。她说：「它只认字，不认东西。」'
  resolution: '你把每件货写成带类别的记录，两种货、两种去处，一条一条分清楚；商队带来一种没见过的锄头，你在原来的选择里补了一格，锄头稳稳落进工具桶。塔卡核对账本，三只桶盖合上，用六块粗铁换给你一根织线——织者之印：活人手上才有的印记，最后这一笔，得你亲手和他点清。'
  coachTone: '温和、具体，一次只点一个概念；说「账本认错货」而不是「类型错误」。台词要点：①「字符串只记得字，不记得它是哪种东西。」②「兜底不是处理，是把问题藏起来。」③「结构，是第三根线。」'
```

**名词首现解释（docs/23 §8）**：符文、织者之印已在 setup/resolution 各解释一句；**织偶**＝织机织出来的无魂工匠，只会照字面做事；**散线**＝织机断线后散出的灰白线头，只让碰到的东西忘记自己该做什么；**加练**＝一关织完之后、织机额外吐出的更难的纹样，可跳过、不计星。

**开场三句（docs/25 §3，关开场必播，≤180 字）**：

1. **世界状态**：「商队的羊驼在营地边打转，三只木桶还空着。塔卡说日中就走——账再对不上，这趟货就留在原地了。」
2. **任务**：「让灰崽把混装货箱里的货一件件认清楚，分进工具、材料、食物三只桶，再把每份工作要用的家伙交到工作点。」
3. **为什么是你**：「账本上最后一笔要你和塔卡当面点清；织偶只认字，分不清「斧」和「镐」，得靠你写清楚。」

**世界状态变化（docs/24 §5）**：过关后三只木桶依次合盖、桶前物品展示框亮起、三个工作点同时开工；塔卡吹响羊角号，羊驼驮着空箱走出营地，营地账本翻到下一页。

## 3. 世界与场景（`world`）

营地扎在平原与村庄之间的土路边：帐篷、营火、两只拴着的羊驼、三只贴标签的木桶（工具/材料/食物）、一只混装货箱、三个工作点（伐木桩、矿脉、训练假人）。`world.containers()` 顺序固定在界面与 API 文档里：`0` 工具桶、`1` 材料桶、`2` 食物桶、`3` 混装货箱——位置每局随机，顺序不变。`seed = session`：货物数量、到货顺序、木桶位置随机。**三个阶段**：第一、二阶段为常规验收；第三阶段在「验收预检」里注入一种新工具，玩家补 case 后进入终验。工作点与交易是剧情步骤：插件检测玩家交易后触发结局演出，**不计分**（评分只读世界状态）。

```yaml
world:
  anchor: { kind: camp, id: caravan-camp }
  dimension: overworld
  time: 6000
  weather: clear
  region: { center: [0, 64, 0], radius: 40 }
  entities:
    - { type: golem, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
    - { type: villager, role: npc, name: 旅商塔卡, count: 1 }
    - { type: llama, role: mount, count: 2 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: camp, id: caravan-camp }
        - { op: buildProps, builder: caravanCamp, params: { barrels: 3, labels: [工具, 材料, 食物], cargoChest: 1, stations: [伐木桩, 矿脉, 训练假人], seed: '$session' } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$camp.entrance' }
        - { op: spawnEntity, type: villager, role: npc, name: 旅商塔卡, at: '$camp.tent' }
        - { op: spawnEntity, type: llama, role: mount, count: 2, at: '$camp.llamas' }
        - { op: objective, items: ['第一阶段：记录与三桶分拣', '第二阶段：给每份工作配好工具', '第三阶段：接住新工具并对账'] }
        - { op: dialog, speaker: eira, text: '这本账只认字，不认东西。今天它把斧头分给矿工了。' }
    - phase: tradeBeat
      steps:
        - { op: waitUntil, event: onInteract, target: trader, count: 1, timeout: 180 }
        - { op: buildProps, builder: villagerFamilies, params: { count: 3, from: '$camp.road' } }
    - phase: climax
      steps:
        - { op: animate, target: '$camp.barrels', animation: lidClose, params: { count: 3 } }
        - { op: particle, type: item, at: '$camp.barrels', count: 40 }
        - { op: sound, id: minecraft:item.goat_horn.sound, volume: 1 }
        - { op: animate, target: '$camp.caravan', animation: caravanLeaves }
        - { op: advancement, id: loomcraft/act2/caravan_ledger }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['旅商与羊驼（不可伤害）', '木桶与物品展示框', '帐篷与营火', '三只工作点']
```

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '第一阶段给工具写一条记录、把货分进三只桶；第二阶段接住验收送来的新工具，在原来的选择里补一格，再和塔卡对账。'
  makeTask: '点「预检」：织典会显示一种没见过的工具（锄头）。不要用兜底把它藏起来——在两个翻译环节里各补一个分支，再跑一次。'
  playerBeat: '第三阶段通过后，你从材料桶取出六块粗铁，右键塔卡打开交易界面，换到一根织线。'
  timeLimitSec: 240
  successCriteria:
    - { id: c-tools, text: '工具桶里的工具与账本一致，没有工具掉进材料/食物桶', check: "(g) => g.container('tools').itemsEqual(g.ledger.tools) && g.container('materials').count('minecraft:iron_axe') + g.container('food').count('minecraft:iron_axe') === 0" }
    - { id: c-supply, text: '材料桶与食物桶的内容与账本一致（食物标志正确）', check: "(g) => g.container('materials').itemsEqual(g.ledger.materials) && g.container('food').itemsEqual(g.ledger.food)" }
    - { id: c-ledger, text: '没有货物丢失、重复或进错桶', check: "(g) => g.container('cargo').count() === 0 && g.totalItems() === g.ledger.total && g.wrongBarrelItems().length === 0" }
  hiddenTests:
    - id: h-new-tool-kind
      name: 验收时商队带来新工具（换数据形状）
      setup: { variant: catalog-v2, inject: { toolId: iron_hoe, toolKind: hoe, kind: tool } }
      assertions:
        - { id: h1a, text: '锄头进了工具桶，没有掉进材料/食物桶', check: "(g) => g.container('tools').count('minecraft:iron_hoe') === 1 && g.container('materials').count('minecraft:iron_hoe') + g.container('food').count('minecraft:iron_hoe') === 0" }
        - { id: h1b, text: '新账本下三桶整体一致，无货物丢失', check: "(g) => g.containersMatchLedger(['tools', 'materials', 'food']) && g.totalItems() === g.ledger.total" }
    - id: h-random-cargo
      name: 随机货单与到货顺序（换规则组合）
      setup: { variant: cargo-shuffle, ledger: 'random', counts: 'random:1..4', order: 'random', barrelPositions: 'random' }
      assertions:
        - { id: h2a, text: '三只桶与账本逐项一致（数量/种类/顺序无关）', check: "(g) => g.containersMatchLedger(['tools', 'materials', 'food'])" }
        - { id: h2b, text: '无货物丢失、重复或错桶', check: "(g) => g.container('cargo').count() === 0 && g.totalItems() === g.ledger.total && g.wrongBarrelItems().length === 0" }
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: cargo-mix, note: '每种货物数量 1–4 随机、到货顺序随机、木桶位置随机' }
      - { id: ledger-version, note: '验收购使用织典 v2（编号/类别多一种），主界面只显示 v1' }
```

**阶段（3 段，docs/20 §3c / 文档级 `task.phases`）**：①记录建模——写出工具记录、把三个工具编号翻成类别，先让一件货能被正确地「说清楚」；②三桶分拣——补全两种货物去向的选择、写主循环把混装货箱逐件送到桶里，再按工作单给三个工作点配工具；③新工具注入——点「预检」，看到多出来的锄头，在两个翻译环节各补一个分支，重跑后与塔卡对账换织线。

**加练挑战（文档级 `task.challenge`，可跳过、不计星）**：**新增工具种类**——不点预检，直接接住第二种没预告的工具（剪刀），要求剪刀同样进工具桶、账本整体仍一致；判定见 `L06.content.ts` 的 `challenge`（独立验收、不影响星数；schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准）。

**隐藏变体（≥2，docs/20 §3c）**：①`h-new-tool-kind`：换数据形状——织典多一种编号与类别，验证「补一格」而不是兜底；②`h-random-cargo`：换规则组合——货物数量、到货顺序、桶位随机，验证程序吃数据不吃常量。

**多解**：用 if/else 还是 switch 补翻译、先处理哪种货，都不影响判定；判定只读三桶内容与事件流。**部分成功**：工具对了但食物进了材料桶 → 只亮工具一颗星；前两阶段全对但没接住新工具 → 预检面板标红并给方向提示。**注意**：第三阶段的分支报错由编辑器预检显示，**不计分**；评分只看世界状态。

## 5. 代码与 API（`code`）

| 本关新增（registry 名） | 签名（按 docs/12 §1.4 展开） | 读/写 | 教学作用 |
|---|---|---|---|
| `world.containers()` | `Container[]`（同步） | 读 | 四只容器快照：0 工具桶、1 材料桶、2 食物桶、3 混装货箱 |
| `world.jobs()` | `Job[]`（同步） | 读 | 工作单：`{ id, name, requires: ToolKind }`（第二阶段配工具用） |
| `golem.giveTool(jobId, tool)` | `Promise<void>` | 写 | 把工具交给对应工作（`tool` 是类别） |
| `world.caravan()` | `Caravan`（同步） | 读 | 商队信息 `{ traderPos, demand, offer }`（报账/交易） |

复用第二关：`golem.collect(item, x, z)`、`golem.deposit(x, z, item, count)`、`world.container(x, z)`；`golem.moveTo`、`golem.say`。**签名按 docs/12 §1.4 展开规则书写**：登记为位置参数的，学生面一律展开成 `(x, z)`，不写坐标对象。**本关织典 `.d.ts`（只读，关卡级收窄）**：`ToolId`、`ToolKind`、`LedgerItemId`、`Job`、`assertNever(value: never): never`；商队货箱的 `items()` 返回 `{ kind: LedgerItemId; count: number }[]`（见 §12）。`golem.giveTool` 的 `tool` 取类别，由引擎从工具桶取实物。

```yaml
code:
  expectedLoc: 64
  starterCode: |
    // 织典第六关（只读；验收升级后编号与类别各多一种）：
    // 工具编号 = 铁斧/铁镐/铁剑；工具类别 = 斧/镐/剑
    // 账本编号 = 工具编号 + 粗铁/煤/蜜脾/面包/胡萝卜
    // function assertNever(value: never): never
    type Tool = { readonly id: ToolId; readonly kind: ToolKind }
    type Cargo = { kind: "tool"; tool: Tool } | { kind: "supply"; item: string; food: boolean }
    function toolKindOf(id: ToolId): ToolKind {
      switch (id) {
        case "iron_axe": return "axe"
        case "iron_pickaxe": return "pickaxe"
        case "iron_sword": return "sword"
        default: return assertNever(id)
      }
    }
    function toCargo(id: LedgerItemId): Cargo {
      switch (id) {
        case "iron_axe": return { kind: "tool", tool: { id: id, kind: toolKindOf(id) } }
        default: return { kind: "supply", item: id, food: false }
      }
    }
    function barrelOf(cargo: Cargo): Container {
      switch (cargo.kind) {
        case "tool": return world.containers()[0]
        default: return world.containers()[1]
      }
    }
    const box = world.containers()[3]
  referenceSolution: |
    type Tool = { readonly id: ToolId; readonly kind: ToolKind }
    type Cargo = { kind: "tool"; tool: Tool } | { kind: "supply"; item: string; food: boolean }
    function toolKindOf(id: ToolId): ToolKind {
      switch (id) {
        case "iron_axe": return "axe"
        case "iron_pickaxe": return "pickaxe"
        case "iron_sword": return "sword"
        default: return assertNever(id)
      }
    }
    // 第一阶段：编号到记录的翻译（工具用类别；补给再看是不是食物）
    function toCargo(id: LedgerItemId): Cargo {
      switch (id) {
        case "iron_axe": return { kind: "tool", tool: { id: id, kind: toolKindOf(id) } }
        case "iron_pickaxe": return { kind: "tool", tool: { id: id, kind: toolKindOf(id) } }
        case "iron_sword": return { kind: "tool", tool: { id: id, kind: toolKindOf(id) } }
        case "raw_iron": return { kind: "supply", item: id, food: false }
        case "coal": return { kind: "supply", item: id, food: false }
        case "honeycomb": return { kind: "supply", item: id, food: false }
        case "bread": return { kind: "supply", item: id, food: true }
        case "carrot": return { kind: "supply", item: id, food: true }
        default: return assertNever(id)
      }
    }
    function barrelOf(cargo: Cargo): Container {
      switch (cargo.kind) {
        case "tool": return world.containers()[0]
        case "supply": return cargo.food ? world.containers()[2] : world.containers()[1]
        default: return assertNever(cargo)
      }
    }
    // 第二阶段：混装货箱逐件送进桶，再给每份工作配工具
    const box = world.containers()[3]
    const stacks = box.items()
    for (let i = 0; i < stacks.length; i = i + 1) {
      const cargo = toCargo(stacks[i].kind)
      const barrel = barrelOf(cargo)
      golem.collect(stacks[i].kind, box.pos.x, box.pos.z)
      golem.deposit(barrel.pos.x, barrel.pos.z, stacks[i].kind, stacks[i].count)
    }
    const jobs = world.jobs()
    for (let i = 0; i < jobs.length; i = i + 1) {
      golem.giveTool(jobs[i].id, jobs[i].requires)
    }
    // 第三阶段：逐桶对账，报给塔卡听
    function countAll(box: Container): number {
      const items = box.items()
      let total = 0
      for (let i = 0; i < items.length; i = i + 1) {
        total = total + items[i].count
      }
      return total
    }
    golem.say("工具桶里有" + countAll(world.containers()[0]) + "件货。")
    golem.say("材料桶里有" + countAll(world.containers()[1]) + "件货。")
    golem.say("食物桶里有" + countAll(world.containers()[2]) + "件货。")
    const caravan = world.caravan()
    golem.moveTo(caravan.traderPos.x, caravan.traderPos.z)
    golem.say("账清了，塔卡。")
```

**常见错误**：兜底把新工具当补给（锄头进材料桶）；补给的去向忘了看「是不是食物」（食物进材料桶）；记录里编号和类别错位（工具分桶错）；`giveTool` 传了工具实物而不是类别；把桶坐标写死（桶一换位置就错）。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '把「铁斧」和「铁镐」都写成字句靠逐条比对，最容易错在哪？', options: ['字句太长', '两把都带「铁」，改一个字就分错，机器也不会提醒', '字句不能比较'], answer: 1 }
    - { question: '选择语句最后用兜底处理所有没写的编号，新工具来了会怎样？', options: ['自动分对', '被兜底悄悄当成别的类别，账本错了也没人提醒', '代码报错，无法运行'], answer: 1 }
  investigate:
    brokenCode: |
      function toCargo(id: LedgerItemId): Cargo {
        switch (id) {
          case "iron_axe": return { kind: "tool", tool: { id: id, kind: toolKindOf(id) } }
          default: return { kind: "supply", item: id, food: false }
        }
      }
    expectedError: '类型不报错；世界反馈：除斧头外所有工具都进了材料桶；验收带来锄头时，锄头也悄悄进了材料桶。'
    explanation: '兜底不是「处理了所有情况」，是把没想过的情况藏起来。显式写完每种情况、最后用「不可能到这里」的检查，新情况才会被当场抓住。'
  beats:
    - { beat: painBeat, durationSec: 60, playerAction: '看艾拉的旧字句账本翻车：斧头分给矿工、蜜脾掉地', coachLine: '它只认字，不认东西。', uiChange: '旧账本逐行高亮，错桶出现红色感叹号', expectedOutput: '玩家说出「得给货物记类别」' }
    - { beat: predict, durationSec: 45, playerAction: '答两道预测题（不跑代码）', coachLine: '先猜：兜底那一条会把新工具怎样？', uiChange: '预测卡盖住编辑器', expectedOutput: '两道全对，否则重播 painBeat 三十秒' }
    - { beat: run, durationSec: 60, playerAction: '跑开场代码：只有斧头被认成工具，其余全进材料桶', coachLine: '跑起来了。可是桶里的东西对吗？', uiChange: '三只桶对比高亮：材料桶超载', expectedOutput: '看到「能跑不等于分对」' }
    - { beat: investigate, durationSec: 70, playerAction: '修兜底，理解「兜底会藏起新情况」', coachLine: '兜底不是处理，是把问题藏起来。', uiChange: '工具桶多出斧头；其它工具仍在材料桶', expectedOutput: '理解记录与穷举的动机' }
    - { beat: modify, durationSec: 200, playerAction: '第一阶段→第二阶段：补完两个选择、写主循环分桶、给工作点配工具', coachLine: '两种货，两种去处，一条一条写清楚。', uiChange: '三桶逐格出现正确货物，工作点亮起', expectedOutput: '三桶全对 + 工作点拿到工具' }
    - { beat: make, durationSec: 140, playerAction: '第三阶段：点预检看多出来的锄头，在两个翻译环节各补一个分支', coachLine: '新工具来了，在原来的选择里补一格。', uiChange: '预检面板由红转绿；锄头落进工具桶', expectedOutput: '新工具接住、三桶仍正确' }
    - { beat: wrap, durationSec: 40, playerAction: '和塔卡交易换织线；看桶盖合上、商队离开', coachLine: '账清了。结构，是第三根线。', uiChange: '桶盖合上、羊角号、商队离开、符文飞入织典', expectedOutput: '通关；能说出「兜底为什么危险」' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '一件货需要哪几个名字？它属于哪一类决定去哪个桶。', codeAnchor: 'type Cargo' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '每一类返回一件货物；补给再看是不是食物。', codeAnchor: 'function barrelOf' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '每个编号一行；多出来的那个编号，照抄一行改类别。', codeAnchor: 'function toCargo' }
  errorMap:
    - { tsCode: 2345, text: '选择语句里还有情况没写到：检查兜底之前那一格。' }
    - { tsCode: 2304, text: '账本不认识这个名字：类型写了吗？拼写对吗？' }
    - { tsCode: 2741, text: '记录还缺字段：编号、类别一个都不能少。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「一件货物需要哪几个名字？记录里的类别决定去哪个桶。」并高亮 `type Cargo`。
2. **technique（2 次失败后）**：点明记录与分支的用法——「每一类返回一件货物；补给分支看『是不是食物』选桶」；不贴完整函数。
3. **near-solution（3 次失败或 240 秒无进展）**：只给结构——「每个编号一行；预检里多出来的那个编号，照抄一行改类别」；若六十秒后仍无进展，自动填入三个工具与两个材料分支，保留食物与分桶函数给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '三只木桶依次「咔哒」合盖，桶口喷出货物图标的物品粒子；塔卡吹响羊角号、羊驼排队离开，账本浮出附魔光，成就「商队的账本」弹出，符文飞入织典'
    - '第三阶段通过时预检面板由红转绿，锄头「当」一声落进工具桶，三个工作点同时亮起'
  partial:
    - '工具对了但食物进了材料桶：食物桶闪红光「再想想『是不是食物』这个标志」；或前两阶段全对但新工具掉进材料桶：预检给方向提示'
  failure:
    - '兜底把新工具当补给：锄头进材料桶，目标面板材料桶标红'
    - '记录里编号和类别错位：工具被拆进不同桶；按 R 重置后重试'
  wowMoment: '玩家把织线插进护符盒的瞬间，三只桶盖同时合上、物品粒子从桶口升起、羊角号响起，旅商与两只羊驼沿土路走出画面；账本自动翻页浮出附魔光——「秩序」第一次在这个营地里被编出来。'
  ambience: '清晨驼铃、营火噼啪、羊驼喷气；高潮叠加羊角号与钟琴'
```

**截图位**：①营地全景：帐篷、羊驼、三只贴标签木桶 ②代码停在两种货物去向的选择处 + 三桶正确 ③第三阶段预检红转绿、锄头落进工具桶。

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 240 秒强杀；写操作预算三千次，超预算提示「灰崽搬货搬到手软了」，可无限重跑'
  infiniteLoop: 'for/while 循环预算四千次 tick；嵌套循环写错会终止并高亮最内层循环'
  disconnected: '断线暂停关卡，界面显示「世界连接中断，正在重连」；重连后按快照恢复桶内货物与阶段进度'
  resetPolicy: '按 R 或界面一键重置，两秒内完成：货物回货箱、桶清空、工作点复位、时间回清晨；不扣资源'
  cheatPolicy: '评分只读世界状态与事件流、不读代码文本；类型报错只由编辑器预检提示、不阻断运行、不计分；木桶只接受织偶存入；禁止直接调底层接口'
  isolation: '学生代码跑在隔离沙箱；织典新版本与隐藏测试只存在于验收购；场景数据与判定脚本不暴露给学生进程'
```

## 10. 隐藏测试与反硬编码

- **`h-new-tool-kind`（换数据形状，第三阶段）**：验收购把织典升级——工具编号增加铁锄、类别增加锄，货单里出现锄头。旧代码的兜底会把锄头当补给（进材料桶），预检面板同时提示漏一格；在两个翻译环节各补一个分支后，锄头落进工具桶。**评分只看世界状态**（锄在哪只桶）；分支报错只是界面提示、不计分。
- **`h-random-cargo`（换规则组合）**：数量一到四、到货顺序、木桶位置随机；写死编号顺序或桶坐标的程序失败，用容器快照与选择语句的程序一行不改。随机化只在验收侧出现（`hiddenOnly: true`）、种子写运行日志。
- **加练挑战的测试（不计星）**：`L06.content.ts` 的 `challenge` 注入第二种没预告的工具（剪刀），不给任何预检提示，要求剪刀同样进工具桶且账本一致；判定只看世界状态、不计星。schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准。
- **starter 未修改必失败**：starter 只有斧头被认成工具，其余货物全进材料桶，主判定不通过。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过（schema 必填键、文本预算、apiAllowlist ⊆ registry、hints 恰三级、隐藏测试 ≥2、randomization.hiddenOnly=true）'
    - 'referenceSolution（去注释 56 行，docs/20 §3c ≥50）在 MockWorld 与真实服务端上通过全部 successCriteria + hiddenTests（含新工具注入）；starter 去注释 23 行，与参考解差 33 行（下限 25）；三个阶段状态分别记录'
    - 'starterCode 编译通过且未修改时判定失败（只有斧头进工具桶）；加练挑战参考解单独通过、不计星；盲测 solver ≤20 分钟、≤2 级提示通关；1 名人类试玩 + 3 张固定机位截图'
  blindSolver: { criteria: '只读关卡界面文案、registry 的第六关 API 文档、织典类型面板与当前代码，不看本 spec；20 分钟内前三阶段通过，并能口头解释「兜底为什么危险」与「为什么记录要把编号和类别绑在一起」' }
  screenshots: ['开场：清晨营地，羊驼、帐篷、三只贴标签木桶', '中段：代码停在两种货物去向的选择处，三桶内容正确', '第三阶段：预检红转绿、锄头落进工具桶']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未包含 docs/06 §6.1 #9/#15 的 `narrative.opening/worldState/whyYou` 与 `task.phases/challenge` 字段；本文件先用「§2 开场三句」「§4 阶段/加练挑战」文本承载，T2 实现期把字段与 `L06.content.ts` 的 `challenge` 一起补进 schema/validator。'
  - '第三阶段需要「关卡级类型收窄 + 验收购换织典版本」（registry 的物品编号是跨关字符串简化）；成本高则降级为「运行时兜底报错 + 预检提示」，世界状态评分不变。加练挑战再注入第二种工具，判定同样只看世界状态。'
  - 'golem.giveTool(jobId, tool) 的第二个参数在 registry 未写类型：本 spec 取类别（引擎从工具桶取实物）；建议 registry 补类型并注明。'
  - '商队自定义交易（六块粗铁换一根织线）需要插件覆写旅商交易表；不可行则降级为「玩家递材料（右键）+ 交换演出」，交易事件只触发演出、不计分。'
  - '签名展开：collect/deposit 已按 docs/12 §1.4 写成 (物品, x, z) 与 (x, z, 物品, 数量)；若 registry 收回展开规则，需回改 §5 代码与隐藏测试。'
```
