# L05 — 一百座房子（A Hundred Houses）

> 状态：v3 设计规格（按 docs/20 §3c / docs/24 扩体量：参考解 ≥50 行、3 阶段、加练挑战、纯中文引导）｜负责人：smith-act2｜最后更新：2026-10-31
> 上游：`docs/05` §8 L5（任务骨）、`docs/06` §4/§6.1、`docs/12`（API 权威）、`docs/20 §3b/§3c`、`docs/23`、`docs/25`｜下游：`L05.level.ts`、`L05.content.ts`（含 challenge）、`packages/grader`、Codex A5/A6
> 体量统计：参考解去注释 **57 行**（Act II 下限 50）｜starter 去注释 **13 行**（差 **44 行**，下限 25）｜阶段 **3**｜加练挑战 **1**（可跳过、不计星）｜隐藏变体 **2**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并即完整 spec。`task.phases`、`task.challenge`、`narrative.opening/worldState/whyYou` 是 docs/06 §6.1 #9/#15 的 **T2 设计期文档字段**：schema 与 `L05.content.ts` 在 T2 补入，本文件先用「§4 阶段与挑战」「§2 开场三句」两段文本承载。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L05
  title: { zh: 一百座房子, en: A Hundred Houses }
  act: 2
  order: 5
  priority: P0
  prerequisites: [L04]
  estimatedMinutes: 15
  difficulty: 4
  abstractions: [A5, A6]
  objectives:
    - { id: o-reuse, learnerView: '同一栋房子的动作只写一次，用参数换位置、换风格', evidence: '隐藏变体在随机地块用随机风格调用 buildHut，仍造出完整房子' }
    - { id: o-param, learnerView: '参数是「每次不一样的地方」，函数体是「每次都一样的过程」', evidence: '五块地共享同一个函数，参数不同结果不同' }
    - { id: o-return, learnerView: '函数可以带回一个结果，调用的人不用知道里面怎么算', evidence: '门牌被放在 buildHut 返回的门口坐标上' }
    - { id: o-module, learnerView: '把造房术搬进另一个文件，主文件只剩「造哪几栋」', evidence: 'blueprints.ts 存在且被主文件 import' }
  misconceptions: [copy-paste-is-reuse, params-are-global, return-means-print, function-must-be-copied, style-is-a-position]
  apiIntroduced: [world.plot, golem.fill, golem.placeSign]
  apiAllowlist: [golem.place, golem.say, golem.where, world.plot, golem.fill, golem.placeSign, golem.clear]
  syntaxIntroduced: ['function 声明与返回', '参数', '类型注解（number/string）', 'export/import（D15）']
  reward: { rune: A5, advancement: loomcraft/act2/hundred_houses, codexPage: A5 }
  languageLevel: act2
```

## 1. 学习目标（学习者视角）

1. **函数 = 给一串动作起名字**：手抄本十五行只能造一栋；装进 `buildHut` 后，五个地块只多五行调用。**参数**是这次的差异（`x, z` 地块西北角，`style` 屋顶风格），**返回**把门口的位置带回给调用处。
2. **分解 = 一页只写一段**：造房拆成「地基、墙、屋顶、门、窗、家具」六个小步骤，各自有名字；`buildHut` 只负责按顺序叫它们。改窗户时，只动那一小段。
3. **模块 = 分页的织典**：造房术搬进 `blueprints.ts`，主文件只剩「读地块、调用、挂门牌」；验收时读的是同一份函数。
4. **三个阶段**：①三栋橡木房 ②第四栋换屋顶的变体 ③验收随机出现的第五块地——每段都要求同一份函数，不许复制粘贴。
5. **不教**：对象字面量、三元表达式、泛型、接口；坐标参数一律按 registry §1.4 展开成数字（如 `golem.fill(方块, x1, y1, z1, x2, y2, z2)`），不出现坐标对象。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '平原新地块的午后。灰岩村要扩建，三户村民和一对新婚夫妇拖着行李站在土路边。艾拉把一本卷边的旧手抄本拍在你手里：里面写着造一栋房子的每一步。她说：「织偶：织机织出来的无魂工匠，不会猜你的意思，只会照你写下的字做事。你写一栋，它就立一栋。」'
  stakes: '入夜前五栋房子要能住人；入不了户，村民只能睡在井边。第四户还特别叮嘱：屋顶要和别人不一样。'
  painBeat: '艾拉翻开手抄本：去年她就这么造房子——四十行方块指令写一栋。第二户换位置，全改；第三户换屋顶，全改。她指指远处：「我写到天亮。有一行写错，把门封死了。」散线从田埂那头漫过来——散线：织机断线后散出的灰白线头，不咬人，只让碰到的东西忘记自己该做什么。'
  resolution: '你把写死的数字收进一个名字里，又把造房拆成六个小步骤；同一个函数立起五栋房子，第五块地是验收时才出现的，你也只多写了一行调用。艾拉看着村口亮起来的五盏门灯，把最后一页符文按进织典——织典：古织者的图鉴，学会一枚符文，它就亮一页。远处散线退了一截。'
  coachTone: '温和、具体、不催；先说「哪里痛」，再给工具。台词要点：①「一样的留给那一页，不一样的变成数字。」②「它会告诉你的：门在哪。」③「五栋是今天。一百栋，是明天。」'
```

**名词首现解释（docs/23 §8）**：织偶、散线、织典已在 setup/resolution 里各解释一句；**符文**＝一句能让世界执行的短句；**织者之印**＝活人手上才有的印记，有些最后一步织偶替不了；**加练**＝一关织完之后、织机额外吐出的更难的纹样，可跳过、不计星。

**开场三句（docs/25 §3，关开场必播，≤180 字）**：

1. **世界状态**：「村东的地空了一整天，三户人家和一对新婚夫妇的行李还堆在土路边。入夜前房子不立起来，今晚又有人要睡在井边。」
2. **任务**：「让灰崽用同一份造房纹样，先立三栋橡木房，再立第四栋换过屋顶的变体，最后立第五栋——位置和风格要到验收当天才定；每栋门口挂一块空白门牌。」
3. **为什么是你**：「屋梁的最后一块、门牌上的名字，得你亲手来——活人的手，织偶替不了。」

**世界状态变化（docs/24 §5）**：过关后村东五栋房子亮灯、烟囱冒烟，村民沿土路搬入；远景地平线上又起了一排更远的小房子（艾拉用同一页造的第一百栋的起头）。

## 3. 世界与场景（`world`）

土路旁五块 9×9 空地：1–4 号地在主线里固定排布（1 号地西北角 (0,0)，方便先手抄一栋），第 5 块地是后加的，主线同样出现，**它的位置与风格要到验收当天才定**。地块中心有木桩+羊毛色块与风格牌（`oak`/`spruce`/`brick`）。土路中段一口水井（保护）。不显示坐标面板：坐标只从 `world.plot` 读，避免抄数字。**房子结构**：5×5 地基（y63）+ 四面墙（y64–66）+ 平屋顶（y67）+ 南墙中央门洞（两格门，`place` 一次按门物品逻辑补全上下格）+ 东墙窗 + 床两格（脚/头各一次）+ 门口火把；门牌位置 = `(doorX, 64, origin.z + 5)`。

```yaml
world:
  anchor: { kind: meadow, id: graystone-plains }
  dimension: overworld
  time: 11600
  weather: clear
  region: { center: [0, 64, 0], radius: 56 }
  entities:
    - { type: golem, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 5 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: meadow, id: graystone-plains }
        - { op: buildProps, builder: plotRow, params: { plots: 5, spacing: 10, size: 5, origin: [0, 0], seed: 20261031 } }
        - { op: buildProps, builder: villageWell, params: { at: [15, 0], radius: 3 } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$row.origin' }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$row.origin', offset: [0, 0, 3] }
        - { op: spawnEntity, type: villager, role: npc, count: 5, at: '$row.road' }
        - { op: objective, items: ['第一阶段：立起三栋橡木房', '第二阶段：第四栋换屋顶的变体', '第三阶段：第五块地 + 五块门牌'] }
        - { op: dialog, speaker: eira, text: '四块地。你愿意把四十行抄四遍，我不拦你。' }
    - phase: climax
      steps:
        - { op: waitUntil, event: onInteract, target: sign, count: 5, timeout: 180 }
        - { op: buildProps, builder: villagerFamilies, params: { count: 5, from: '$row.road' } }
        - { op: freezeInput, value: true }
        - { op: animate, target: '$row.plots', animation: doorsOpen, params: { count: 5 } }
        - { op: particle, type: end_rod, at: '$row.roofs', count: 60 }
        - { op: sound, id: minecraft:block.note_block.chime, volume: 1 }
        - { op: animate, target: '$row.farField', animation: miniVillage, params: { count: 8 } }
        - { op: time, value: 13000 }
        - { op: advancement, id: loomcraft/act2/hundred_houses }
        - { op: dialog, speaker: eira, text: '五栋是今天。一百栋，是明天。' }
  reset: { strategy: rebuild_region }
  seed: { mode: fixed, value: 20261031 }
  protectedBlocks: ['水井与井台', '土路', '地块界标（木桩+羊毛）', '地块上的原有树木']
```

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '用同一份造房纹样造出五栋房子：先三栋橡木房，再第四栋换屋顶的变体，最后是位置与风格当天才定的第五栋；每栋门口挂一块空白门牌。'
  makeTask: '把造房术搬进 blueprints.ts，主文件只引用并调用；再把造房拆成六个有名字的小步骤（地基/墙/屋顶/门/窗/家具）。'
  playerBeat: '五块门牌由织偶放好；你依次右键门牌，在界面里确认或微调预填的户名（累计不超过九十秒），第五户写完触发入夜演出。'
  timeLimitSec: 240
  successCriteria:
    - { id: c-houses, text: '五块地各有一栋能住人的房子（宽松区间）', check: "(g) => g.plots.every(p => { const wall = g.countBlocks(p.house, 'minecraft:oak_planks') + g.countBlocks(p.house, 'minecraft:spruce_planks') + g.countBlocks(p.house, 'minecraft:bricks'); const roof = g.countBlocks(p.house, 'minecraft:oak_slab') + g.countBlocks(p.house, 'minecraft:spruce_slab') + g.countBlocks(p.house, 'minecraft:stone_brick_slab'); return wall >= 20 && roof >= 15 && g.countBlocks(p.house, 'minecraft:oak_door') >= 1 && g.countBlocks(p.house, 'minecraft:red_bed') >= 1 && g.countBlocks(p.house, 'minecraft:glass_pane') >= 1 })" }
    - { id: c-budget, text: '剩余材料 ≥ 0，用掉的方块不超总预算', check: "(g) => g.remainingMaterials() >= 0 && g.blocksUsed() <= g.materialBudget" }
    - { id: c-styles, text: '每栋房子的墙材料跟随该地块要求的风格', check: "(g) => g.plots.every(p => { const wall = p.style === 'oak' ? 'oak_planks' : p.style === 'spruce' ? 'spruce_planks' : 'bricks'; return g.countBlocks(p.house, 'minecraft:' + wall) >= 20 })" }
    - { id: c-names, text: '五块门牌都有玩家亲手写下的户名（每块至少一行）', check: "(g) => new Set(g.events('sign.edit').filter(e => e.actorType === 'player' && e.text.trim().length > 0).map(e => e.pos.key)).size === 5" }
    - { id: c-module, text: '造房术在另一个文件里，被主文件引用', check: "(g) => g.submission.hasFile('blueprints.ts') && g.submission.imports('main.ts', './blueprints')" }
    - { id: c-protected, text: '水井、土路、地块界标没有被破坏', check: "(g) => g.events('block.break').every(e => !e.inProtected)" }
  hiddenTests:
    - id: h-random-plots
      name: 五块地与风格重新洗牌
      setup: { variant: plots-shuffled, originShift: 'random:-24..24', stylePermutation: 'random', styles: [oak, spruce, brick] }
      assertions:
        - { id: h1a, text: '五栋房子仍建在新地块上，墙材料跟随新风格，门牌仍在门口', check: "(g) => g.plots.every(p => { const wall = p.style === 'oak' ? 'oak_planks' : p.style === 'spruce' ? 'spruce_planks' : 'bricks'; return g.countBlocks(p.house, 'minecraft:' + wall) >= 20 && g.block(p.signPos).id === 'minecraft:oak_sign' })" }
        - { id: h1b, text: '第五块地的房子也合格', check: "(g) => g.countBlocks(g.plots[4].house, 'minecraft:oak_door') >= 1 && g.countBlocks(g.plots[4].house, 'minecraft:red_bed') >= 1" }
    - id: h-random-call
      name: 函数在任意位置、任意风格下都成立
      setup: { variant: fifth-plot, plotCleared: true, call: { module: 'blueprints.ts', fn: 'buildHut', args: { x: 'random:-40..40', z: 'random:-40..40', style: 'random:oak|spruce|brick' } } }
      assertions:
        - { id: h2a, text: '任意位置、任意风格都能造出完整房子', check: "(g) => g.call.result.hasWalls && g.call.result.hasRoof && g.call.result.hasDoor && g.call.result.hasBed" }
        - { id: h2b, text: '返回值等于门实际横坐标；没有在 9×9 地块之外摆方块', check: "(g) => g.call.return === g.call.result.doorX && g.call.outsidePlotBlocks === 0" }
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: plots-origin, note: '五块地沿土路整体平移 -24..24 格；风格在五块地间随机重排' }
      - { id: call-args, note: 'h-random-call 的地块坐标与风格随机；第五块地的位置与风格同样随机' }
```

**阶段（3 段，docs/20 §3c / 文档级 `task.phases`）**：①三栋橡木房——把开场代码的手抄本抽成 `buildHut(x, z)`，读 1–3 号地各造一栋；②第四栋变体——给函数加屋顶风格参数，第四户换屋顶，并把造房术搬进 `blueprints.ts`、拆成六个小步骤；③第五块地——验收随机出现的第 5 块地，用同一个函数造出来并挂门牌（只用一行调用）。每段结束目标面板亮一格，第一段结束前 `blueprints.ts` 可以还是空的。

**加练挑战（文档级 `task.challenge`，可跳过、不计星）**：**不复制粘贴**——验收把五块地的位置与风格全部随机化（含手抄本里没出现的云杉、砖组合），要求主程序里第五栋也只写一次 `buildHut(...)` 调用；写死风格、复制整段、或为第五栋另写一份的程序失败。判定见 `L05.content.ts` 的 `challenge`（独立验收、不影响星数；schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准）。

**隐藏变体（≥2，docs/20 §3c）**：①`h-random-plots`：换数据形状——地块整体平移、三种风格随机重排，验证「读世界数据、不抄坐标」；②`h-random-call`：换情形——在任意空地、任意风格直接调用 `buildHut`，验证函数本来就能泛化（第五块地验收就是它的正式版本）。

**多解**：函数内部怎么摆（先墙先屋顶、`fill` 还是逐块 `place`、拆成几步）不影响判定——判定只查宽松区间与材料预算，不查精确方块数。**部分成功**：房子立起来了但门牌没挂 → 只亮前两颗星；门牌挂了但名字没写 → 提示右键门牌；第四栋风格没变 → 第二段不亮。

## 5. 代码与 API（`code`）

| 本关新增（registry 名） | 签名（按 docs/12 §1.4 展开） | 读/写 | 教学作用 |
|---|---|---|---|
| `world.plot(id)` | `Plot`（同步） | 读 | 从世界读地块西北角/风格，不抄坐标 |
| `golem.fill(block, x1, y1, z1, x2, y2, z2)` | `Promise<void>` | 写 | 一次填一片：地基/墙/屋顶不再逐块写 |
| `golem.placeSign(x, z, lines)` | `Promise<void>` | 写 | 放门牌并写最多四行；`lines` 留给玩家节拍（本关传 `[]`，引擎自动贴地） |
| `golem.clear(x1, y1, z1, x2, y2, z2)` | `Promise<void>` | 写（extension） | 开门洞/窗洞；不计入新教学符号（registry §4 的 `+clear`） |

复用：`golem.place`（门/床/玻璃/火把）、`golem.say`、`golem.where`。`Plot = { id, origin: Vec2, size, style: "oak"|"spruce"|"brick", hasDoor }`；本关 `size` 恒五、`hasDoor` 恒真，不参与判定。学生不写 `await`（Act II 顺序模式，runner 自动 drain 写队列）。判定句柄（`g.plots`、`g.countBlocks`、`g.submission`）以 docs/06 §5.2 与 `L05.content.ts` 为准；`g.submission` 属提交级检查（kind: submission），与 P7 的张力见 §12。

```yaml
code:
  expectedLoc: 76
  starterCode: |
    // 艾拉的手抄本：只会造「一号地」这一栋，数字全是写死的。
    // 目标：抽成一个有名字的函数，再读地块数据造五栋（第三阶段那块地验收才出现）。
    golem.fill("cobblestone", 0, 63, 0, 4, 63, 4)
    golem.fill("oak_planks", 0, 64, 0, 4, 66, 0)
    golem.fill("oak_planks", 0, 64, 4, 4, 66, 4)
    golem.fill("oak_planks", 0, 64, 1, 0, 66, 3)
    golem.fill("oak_planks", 4, 64, 1, 4, 66, 3)
    golem.fill("oak_slab", 0, 67, 0, 4, 67, 4)
    golem.clear(2, 64, 4, 2, 65, 4)
    golem.place("oak_door", 2, 64, 4)
    golem.clear(4, 65, 2, 4, 65, 2)
    golem.place("glass_pane", 4, 65, 2)
    golem.place("red_bed", 1, 64, 1)
    golem.place("red_bed", 1, 64, 2)
    golem.place("torch", 3, 64, 5)
  referenceSolution: |
    // ===== blueprints.ts：造房拆成六小步，最后只写一遍顺序 =====
    export function buildFloor(base: string, x: number, z: number) {
      golem.fill(base, x, 63, z, x + 4, 63, z + 4)
    }
    export function buildWalls(wall: string, x: number, z: number) {
      golem.fill(wall, x, 64, z, x + 4, 66, z)
      golem.fill(wall, x, 64, z + 4, x + 4, 66, z + 4)
      golem.fill(wall, x, 64, z + 1, x, 66, z + 3)
      golem.fill(wall, x + 4, 64, z + 1, x + 4, 66, z + 3)
    }
    export function buildRoof(roof: string, x: number, z: number) {
      golem.fill(roof, x, 67, z, x + 4, 67, z + 4)
    }
    export function buildDoor(doorX: number, z: number) {
      golem.clear(doorX, 64, z + 4, doorX, 65, z + 4)
      golem.place("oak_door", doorX, 64, z + 4)
    }
    export function buildWindow(x: number, z: number) {
      golem.clear(x + 4, 65, z + 2, x + 4, 65, z + 2)
      golem.place("glass_pane", x + 4, 65, z + 2)
    }
    export function furnish(x: number, z: number, doorX: number) {
      golem.place("red_bed", x + 1, 64, z + 1)
      golem.place("red_bed", x + 1, 64, z + 2)
      golem.place("torch", doorX + 1, 64, z + 5)
    }
    export function buildHut(x: number, z: number, style: string): number {
      let wall = "oak_planks"
      let roof = "oak_slab"
      let base = "cobblestone"
      if (style === "spruce") { wall = "spruce_planks"; roof = "spruce_slab" }
      if (style === "brick") { wall = "bricks"; roof = "stone_brick_slab"; base = "stone_bricks" }
      const doorX = x + 2
      buildFloor(base, x, z)
      buildWalls(wall, x, z)
      buildRoof(roof, x, z)
      buildDoor(doorX, z)
      buildWindow(x, z)
      furnish(x, z, doorX)
      return doorX
    }
    // ===== main.ts：三个阶段，主文件只写调用 =====
    import { buildHut } from "./blueprints"
    // 第一阶段：三栋橡木房
    const plot1 = world.plot(1)
    const door1 = buildHut(plot1.origin.x, plot1.origin.z, plot1.style)
    golem.placeSign(door1, plot1.origin.z + 5, [])
    const plot2 = world.plot(2)
    const door2 = buildHut(plot2.origin.x, plot2.origin.z, plot2.style)
    golem.placeSign(door2, plot2.origin.z + 5, [])
    const plot3 = world.plot(3)
    const door3 = buildHut(plot3.origin.x, plot3.origin.z, plot3.style)
    golem.placeSign(door3, plot3.origin.z + 5, [])
    // 第二阶段：第四栋换屋顶的变体
    const plot4 = world.plot(4)
    const door4 = buildHut(plot4.origin.x, plot4.origin.z, plot4.style)
    golem.placeSign(door4, plot4.origin.z + 5, [])
    // 第三阶段：验收随机的第五块地，只多这一行调用
    const plot5 = world.plot(5)
    const door5 = buildHut(plot5.origin.x, plot5.origin.z, plot5.style)
    golem.placeSign(door5, plot5.origin.z + 5, [])
    golem.say("五栋房子都立起来了，门牌也挂好了。")
```

**常见错误**：函数里写死 `0` 不换成参数 → 五栋叠在一起；忘记交回门口位置 → 门牌收到空值（界面提示「门牌坐标里没有数字」）；分解时少叫一步（比如只叫了墙没叫屋顶）→ 目标面板提示「屋顶还漏着」；第五块地出现时才想起复制第二段 → 加练挑战直接判失败。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '同一个函数造两栋房子，哪些地方一样、哪些地方不一样？', options: ['完全一样，连位置也一样', '形状和材料一样，只是位置差了一段路', '材料会自己变'], answer: 1 }
    - { question: '函数最后一行的「交回门口的位置」，是在做什么？', options: ['把房子拆掉', '把门的位置交回给调用它的人', '在屏幕上打印一行字'], answer: 1 }
  investigate:
    brokenCode: |
      function buildHut(x: number, z: number) {
        golem.fill("oak_planks", x, 64, z, x + 4, 66, z)
        golem.place("oak_door", x + 2, 64, z + 4)
      }
      const door1 = buildHut(0, 0)
      golem.placeSign(door1, 5, [])
    expectedError: '类型不报错；运行时世界拒绝：门牌坐标里没有数字——函数没有交回门口的位置，调用处拿到空值。'
    explanation: '函数造完了房子，却没有把「门在哪」说出口。交回结果不是打印、不是装饰，它是函数留给外面唯一的那句话。'
  beats:
    - { beat: painBeat, durationSec: 50, playerAction: '看艾拉翻手抄本：四十行造一栋，第二户全改、第三户再全改', coachLine: '抄一遍我不拦你。抄一百遍呢？', uiChange: '旧手抄本逐行滚动，重复行高亮成红色', expectedOutput: '玩家说出「太蠢了，要能复用」' }
    - { beat: predict, durationSec: 45, playerAction: '答两道预测题（不跑代码）', coachLine: '先猜：两栋房子哪里一样，哪里不一样？', uiChange: '预测卡盖住编辑器，悬停高亮选项', expectedOutput: '两道全对，否则重播动机演示三十秒' }
    - { beat: run, durationSec: 60, playerAction: '跑开场代码：手抄本造出第一栋', coachLine: '它照做了。第二户还站在空地上。', uiChange: '代码前五行逐行高亮；一号地出现房子', expectedOutput: '看到「一栋就是一整段重复动作」' }
    - { beat: investigate, durationSec: 70, playerAction: '修没有交回结果的坏函数', coachLine: '房子立起来了，门牌却不知道该挂哪儿。', uiChange: '门牌落在错位置，提示「门牌要挂在门正前方」', expectedOutput: '理解函数要把结果交回给调用处' }
    - { beat: modify, durationSec: 200, playerAction: '第一阶段：抽出 buildHut(x, z)，造 1–3 号地并挂门牌', coachLine: '一样的留在那一页里，不一样的变成数字。', uiChange: '目标面板第一格亮；三栋房依次出现', expectedOutput: '三栋房子 + 三块门牌' }
    - { beat: make, durationSec: 200, playerAction: '第二阶段：加屋顶风格、拆六小步、搬进另一个文件，造第四栋变体', coachLine: '第四户要换屋顶。给那一页再多一个数字。', uiChange: '第四栋换材质；编辑器出现新文件标签页', expectedOutput: '第四栋变体 + 主文件只剩调用' }
    - { beat: wrap, durationSec: 45, playerAction: '第三阶段：读第五块地、一行调用造出来；逐块右键门牌题名', coachLine: '五栋是今天。一百栋，是明天。', uiChange: '五栋齐亮、村民搬入、远景小房子浮现', expectedOutput: '通关；能说出「参数换位置、交回结果带回了什么」' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '第二栋和第一栋，哪些数字变了？哪些没变？', codeAnchor: 'golem.fill' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '把会变的三个数字提成函数的入参，函数体里的零换成它们。', codeAnchor: 'function buildHut' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '函数结尾要交回门口的位置；主程序照着调用五遍。', codeAnchor: 'return doorX' }
  errorMap:
    - { tsCode: 2554, text: '这个函数需要几个数字？数一数括号里的逗号。' }
    - { tsCode: 2307, text: '找不到 blueprints.ts：两个文件要在同一关，名字和路径拼对。' }
    - { tsCode: 2741, text: '这个形状还缺字段：把地基、墙、屋顶的名字都对上。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「第二栋和第一栋，哪些数字变了？」并高亮 `golem.fill` 一行，把注意力推回代码里写死的数字。
2. **technique（2 次失败后）**：点明「参数化」的动作——「把会变的三个数字提成函数的入参，函数体里的零换成它们」；不贴完整函数。
3. **near-solution（3 次失败或 240 秒无进展）**：只给结构——「函数结尾交回门口的位置；主程序照着调用五遍」；若六十秒后仍无进展，自动填入前两栋调用，保留后三栋与交回结果给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '五扇门同时打开；村民拎行李沿土路走进各自的家，五根烟囱同时冒出暖烟，晚霞把五座屋顶点亮'
    - '远景里艾拉用同一页纹样造出的八栋小房子逐栋浮现，成就「一百座房子」弹出，符文飞入织典'
  partial:
    - '房子立起来了但门牌没挂：艾拉指指门口「它会告诉你的：门在哪」；门牌挂了但名字没写：村民站在门口等'
    - '第四栋风格没变：第四户皱眉「我们说过屋顶要和别人不一样」'
  failure:
    - '五栋叠在同一块地：目标面板「地块空着」标红；按 R 重置重试'
    - '函数没有交回结果：世界提示「门牌坐标里没有数字」，提示梯第二级指向交回结果'
  wowMoment: '玩家写完第五块门牌的瞬间，五扇门同时打开，光柱粒子从五座屋顶冲天而起、营火烟从烟囱升起；远景八栋小房子在钟琴音效里逐栋浮现——「一百座房子」的可能性第一次出现在地平线上。'
  ambience: '午后平原风声、麦田沙沙、村庄铃与钟琴；入夜后蟋蟀与营火噼啪'
```

**截图位**：①手抄本与五块空地的午后全景 ②五栋房子 + 门牌，代码停在「交回门口位置」那行 ③入夜、五扇门同开、远景小房子浮现。

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 240 秒强杀；方块写操作预算三千次，超预算提示「灰崽摆方块摆到手软了」，可无限重跑'
  infiniteLoop: '本关可能写出死循环（第四关已教 for/while）；循环预算四千次 tick，超限即终止并高亮循环行'
  disconnected: '断线暂停关卡，界面显示「世界连接中断，正在重连」；重连后按快照恢复已建成的房子，不从头再来'
  resetPolicy: '按 R 或界面一键重置，两秒内完成：恢复五块空地、清门牌、清村民、时间回午后；不扣资源'
  cheatPolicy: '判定只读世界状态 + 提交结构（文件/引用），不读代码文本；允许任意写法；禁止直接调底层接口，沙箱只暴露本关可用符号'
  isolation: '学生代码跑在隔离沙箱；场景数据、隐藏测试与判定脚本不暴露给学生进程；地图模板与判定脚本由服务端再校验'
```

## 10. 隐藏测试与反硬编码

- **`h-random-plots`（换数据形状）**：五块地整体平移、三种风格随机重排后重跑主程序。写死坐标或写死材料的程序建错位置；读 `world.plot` 并用风格参数的程序一行不改。这条同时验证第三阶段的第五块地：它就长在这个随机变体里（主线里也是这五块地，只是第五块的位置与风格当天才定）。
- **`h-random-call`（换情形）**：判定脚本直接引用 `buildHut`，在任意空地传随机位置与随机风格调用一次，检查结构、返回值等于门的横坐标、没有摆出九乘九地块之外。写死零的函数必挂；这条也证明函数真的被导出（模块的验收证据），也是第五块地随机位置的函数级版本。
- **加练挑战的测试（不计星）**：`L05.content.ts` 的 `challenge` 独立跑一次「五块地位置+风格全随机」的验收，且要求主程序里第五栋只有一行调用；判定只看世界状态与提交结构，不弹提示、不计星。schema 暂无 `challenge` 字段，T2 实现期以 content.ts 为准。
- **反硬编码**：随机化全部只在验收侧出现（`hiddenOnly: true`）；主界面只显示每块地的风格，不显示隐藏坐标；种子 = `hash(L05, sessionId, attempt)` 写入运行日志，失败可复现。**starter 未修改必失败**：starter 只造出第一栋（无门牌、无其余四栋）。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过：schema 必填键齐全、文本预算、apiAllowlist ⊆ registry、hints 恰好三级、隐藏测试 ≥2、randomization.hiddenOnly=true'
    - 'referenceSolution（去注释 57 行，docs/20 §3c ≥50）在 MockWorld 与真实服务端上通过全部 successCriteria + hiddenTests，随机种子记录在 CI 日志；starter 去注释 13 行，与参考解差 44 行（下限 25）'
    - 'starterCode 编译通过、未修改时判定失败（只建成第一栋）；加练挑战的参考解单独通过、不计星；盲测 solver ≤20 分钟、≤2 级提示通关（记录卡点）；1 名人类试玩 ≥10 分钟、记录 3 个困惑点；3 张固定机位截图'
  blindSolver:
    criteria: '只读关卡界面文案（开场三句/目标面板/艾拉台词/代码注释）、registry 的第五关 API 文档与当前代码，不看本 spec；20 分钟内通过主任务，并能口头解释「为什么把零换成参数」与「函数交回了什么」'
  screenshots: ['开场：午后平原，五块空地 + 手抄本', '中段：五栋房子 + 五块门牌，代码停在交回门口位置那行', 'wow：入夜，五扇门打开、远景八栋小房子浮现']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未包含 docs/06 §6.1 #9/#15 的 `narrative.opening/worldState/whyYou` 与 `task.phases/challenge` 字段；本文件先用「§2 开场三句」「§4 阶段/加练挑战」文本承载，T2 实现期把字段与 `L05.content.ts` 的 `challenge` 一起补进 schema/validator。'
  - '按 docs/12 §1.4 展开规则，fill/clear 用六个数字参数、placeSign 用 (x, z, lines)；若 registry 后续冻结成坐标对象形式需回改代码。golem.clear 是第五关 extension，已在 allowlist 标注、不计入新教学符号。'
  - 'A6 的判定是提交级检查（文件存在 + 被引用），与「评分只读世界状态」有张力；本 spec 用 `g.submission` 实现模块判定，建议 docs/06 §5.2 明确「kind: submission」为合法类别（14b F5 同源）。'
  - '五个地块与三种风格的随机化只在验收侧出现；主线固定布局是为了让手抄本的第一栋落在预期位置。若试玩显示空间记忆负担偏重，可把主线也改为随机布局并去掉坐标面板（判定不变）；第五块地在主线里就存在，只是位置与风格当天才定。'
  - '加练挑战「不复制粘贴」的判定依赖提交结构（主程序里第五栋只有一行调用）；若课程坚持 P7「只读世界状态」，可降级为「五块地位置+风格全随机仍通过」的世界状态判定。'
```
