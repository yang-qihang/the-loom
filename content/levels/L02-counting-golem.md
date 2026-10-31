# L02 — 会数数的织偶（The Counting Golem）

> 状态：v2.1（sm11 外科修复：报数断言结构化、命名句柄 `world.vars`、eira 具名）｜负责人：smith-act1｜最后更新：2026-10-31 12:40
> 上游：`docs/05-curriculum.md` §8 L2（任务骨，不得改）、`docs/06-level-spec-system.md`（12 章格式与门禁）、`docs/12-sdk-api-registry.md`（API 唯一权威）、`content/levels/L01-first-light.md`（样板）
> 下游：`content/levels/L02.level.ts`（实现）、`packages/grader`（L2 判定）、Codex 页 A2
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L02
  title: { zh: 会数数的织偶, en: The Counting Golem }
  act: 1
  order: 2
  priority: P0
  prerequisites: [L01]
  estimatedMinutes: 12
  difficulty: 2
  abstractions: [A2]
  objectives:
    - { id: o-const, learnerView: '用 const 给不会变的值起名字：出生点偏移、木桶位置、今天要几枚', evidence: '隐藏变体把整个场景平移后，程序不改一行也能找对地方' }
    - { id: o-let, learnerView: '用 let 记住会变的东西：木桶里现在几枚，每倒一次就更新一次', evidence: '桶里恰好 6 枚，且织偶报出的数字等于桶里的枚数' }
    - { id: o-read, learnerView: '「这趟收了几枚」让世界回答（golem.count），不要自己数', evidence: 'Investigate 环节能指出「把数字写死」造成的报数错误' }
  misconceptions: [variable-is-not-a-counter, assign-vs-compare, const-can-be-reassigned, bag-has-no-limit, coords-are-absolute-only]
  apiIntroduced: [golem.count, golem.collect, golem.deposit, world.container]
  apiAllowlist: [golem.pos, golem.moveTo, golem.place, golem.say, golem.where, golem.count, golem.collect, golem.deposit, world.container]
  syntaxIntroduced: ['const 声明', 'let 声明', '赋值（=）', '数字相加 / 字符串拼接（+）']
  reward: { rune: A2, advancement: loomcraft/act1/counting_golem, codexPage: A2 }
  languageLevel: act1
```

## 1. 学习目标（学习者视角）

1. **绑定（`const`）**：给「不会变的值」起名字。场景围着织偶出生的位置搭，所以位置写成「出生点 + 偏移」；整体挪了地方，这些名字依然对。
2. **可变状态（`let`）**：给「会变的数」起名字——木桶里已经几枚是本局唯一在变的东西，每倒一次把新总数写回去；`banked = banked + carried1` 是「算右边、存回左边」，而「这趟收了几枚」由 `golem.count("egg")` 从背包读。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '清晨的灰岩村鸡舍。麦穗节要烤 6 个蛋糕，一个蛋糕要一枚蛋。艾拉把一只刚织好的织偶交给你——织偶：织机织出来的无魂工匠，不会猜你的意思，只会照你写下的字做事；它跑得快，就是没有记性。'
  stakes: '太阳升高前把 6 枚蛋放进木桶；孵蛋窝里的 3 枚是明年鸡群的全部指望，一枚都不能动。'
  painBeat: '艾拉放出去年的符文：收一枚，跑回桶边数一次，再跑回收下一枚。第 4 趟时母鸡全被吵醒，桶里只有 3 枚。她说：「它不是懒。它只是不记得自己刚做过什么。」'
  resolution: '你把「已经收了几枚」写进织偶的记性里。两趟之后桶里正好 6 枚，灰崽走到艾拉面前报出数字，孵蛋窝的玻璃罩一动没动。田埂外的散线退了一截——散线：织机断线后散出的灰白线头，不咬人，只让碰到的东西忘记自己该做什么。'
  coachTone: '温和、具体，一次只点一个概念；把「记性」当成世界里的实体来谈。台词要点：①「它没有记性，你得替它记住。」②「名字取对了，换个地方也不用重写。」③「记性，是第二根线。」最后一步由你亲手放蛋糕——织者之印：活人手上才有的印子，织偶替不了。'
```

## 3. 世界与场景（`world`）

鸡舍是村庄北侧的木栅栏圈（seed-first：定位村庄后 `buildProps` 围出 9 个干草窝）；谷仓用西口现成房子，门口放木桶。**整个场景以织偶出生点为原点摆放**（鸡窝一排、木桶、艾拉都用相对偏移），因为隐藏变体会把人和场景一起挪走——坐标必须从 `golem.pos` 算，不能抄死数。面板同时显示绝对坐标，给人看。

```yaml
world:
  anchor: { kind: village, id: graystone }
  dimension: overworld
  time: 1000
  weather: clear
  region: { center: [0, 64, 0], radius: 48 }
  entities:
    - { type: golem, role: agent, id: golem, name: 灰崽, count: 1 }
    - { type: villager, role: npc, id: eira, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 5 }
    - { type: chicken, role: prop, count: 7 }
  vars: { barrelPos: [], hatchNestPos: [], eiraPos: [], seedPerchCount: 0 }   # 运行时由 builder/spawn 写入绝对坐标，g.var 读取
  regions: { coopArea: { from: [-20, 60, 16], to: [24, 72, 28] }, barnArea: { from: [2, 60, -12], to: [10, 70, 0] } }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: village, id: graystone }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$village.northYard' }
        - { op: buildProps, builder: henhouse, params: { anchor: '$golem.pos', perches: 9, hatchNests: 3, eggs: 5, rowOffset: [2, 6], spacing: 2 } }
        - { op: buildProps, builder: barnBarrel, params: { barrel: 1, hayBales: 6, offset: [6, -4] } }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$golem.pos', offset: [2, 0, -8] }
        - { op: spawnEntity, type: chicken, role: prop, count: 7, at: '$henhouse' }
        - { op: dialog, speaker: eira, text: '麦穗节要做 6 个蛋糕，一个蛋糕一枚蛋。你先把 6 枚蛋收进木桶，蛋糕由艾拉来做。' }
        - { op: objective, items: ['让灰崽收 6 枚蛋进木桶', '别动 3 个带玻璃罩的窝', '回艾拉身边报数'] }
    - phase: feedBeat
      steps:
        - { op: giveItem, item: minecraft:wheat_seeds, count: 8 }
        - { op: waitUntil, event: onInteract, target: chicken, timeout: 120 }
        - { op: spawnEntity, type: item, role: prop, name: 鸡蛋, count: 1, at: '$henhouse.nest6' }
    - phase: climax
      steps:
        - { op: buildProps, builder: cakeTower, params: { cakes: 6 } }
        - { op: advancement, id: loomcraft/act1/counting_golem }
        - { op: dialog, speaker: eira, text: '你教会它记住一件事。记住，是一切的开始。' }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['孵蛋窝玻璃罩', '村庄原有床/工作台/门', '麦田作物']
```

**关键设计**：鸡舍 9 窝 = 6 个可收窝 + 3 个**孵蛋窝**（盖玻璃罩，`collect` 会被拒绝——「哪些蛋能拿」是世界内的答案，不靠台词）。你喂鸡后第 6 枚蛋落进空窝。织偶胸前小筐**最多装 4 枚**（第 5 次 `collect` 返回 0、头顶冒汗滴粒子）——6 > 4 是「分两趟」和「必须记账」的物理原因。**本关视野规则**：`world.container` 只在织偶走到 6 格内才读得到，否则抛 `WorldError`（所以「跑回去数」很痛，变量才划算）。**命名句柄**：场景随出生点平移，静态区域框表达不了位置，因此 `henhouse`/`barnBarrel` builder 在 staging 时把 `barrelPos`、`hatchNestPos`、`eiraPos`、`seedPerchCount` 写进 `world.vars`，判定用 `g.var(...)`；`regions` 里的 `coopArea/barnArea` 是基准帧框（golem 出生点 = (0,64,0)），运行期按实际 `golem.pos` 平移重绑定。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '麦穗节要做 6 个蛋糕，一个蛋糕一枚蛋。你先把 6 枚蛋收进木桶，蛋糕由艾拉来做。'
  makeTask: '第二间鸡舍：窝换了位置，你只改坐标，别动别的写法。'
  playerBeat: '你喂鸡催下最后一枚蛋，再把最后一只蛋糕放上蛋糕塔。'
  timeLimitSec: 180
  successCriteria:
    - { id: exactly-six, text: 木桶里恰好 6 枚鸡蛋, check: "(g) => g.container(g.var('barrelPos')).count('minecraft:egg') === 6" }
    - { id: hatch-nests-untouched, text: 3 个带玻璃罩的窝都还盖着玻璃罩（蛋就不可能被拿走）, check: "(g) => g.var('hatchNestPos').every(p => g.block(p).id === 'minecraft:glass')" }
    - id: report-matches
      text: 报数句里出现「桶里」且紧跟的数字恰好等于桶内枚数
      check: |
        (g) => {
          const n = g.container(g.var('barrelPos')).count('minecraft:egg');
          return g.events('say').some(e => {
            const m = String(e.text).match(/桶[里内][^0-9]{0,6}([0-9]+)/);
            return m !== null && Number(m[1]) === n;
          });
        }
    - { id: golem-home, text: 灰崽回到艾拉身边, check: "(g) => g.agentNear(g.var('eiraPos'), 4)" }
  hiddenTests:
    - id: h-shuffle
      name: 人连同鸡舍一起挪了 26 格
      setup: { variant: scene-shift, spawnShift: [26, 0, -18] }
      assertions:
        - { id: h1a, text: '桶里仍恰好 6 枚、孵蛋窝玻璃罩完好、灰崽回到艾拉身边', check: "(g) => g.container(g.var('barrelPos')).count('minecraft:egg') === 6 && g.var('hatchNestPos').every(p => g.block(p).id === 'minecraft:glass') && g.agentNear(g.var('eiraPos'), 4)" }
    - id: h-extra-perches
      name: 鸡舍多出 3 个收蛋窝
      setup: { variant: extra-perches, collectible: 9 }
      assertions:
        - { id: h2a, text: '不超收：桶里恰好 6 枚，鸡舍还剩 6 枚蛋', check: "(g) => g.container(g.var('barrelPos')).count('minecraft:egg') === 6 && g.entities({ type: 'item', item: 'minecraft:egg' }).length === 6" }
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: spawn-anchor, range: [[-20, 20], [22, 40]], note: '织偶出生点（=场景原点）在村北随机' }
      - { id: hatch-nest-slots, note: '9 个窝里哪 3 个是孵蛋窝随机；extra-perches 仅隐藏变体使用' }
```

**阶段（3 段）**：①第一趟收 4 枚、倒进木桶；②第二趟收 2 枚、倒进木桶；③逐个复查三个孵蛋窝的玻璃罩，回艾拉身边报数。
**挑战层（可跳过、不计星）**：一趟搬完——6 枚蛋一次收齐、只倒一次、不多拿一枚；参考解与判定见 `L02.content.ts` 的 `challenge`（独立验收，不影响星数）。
**多解**：判定只读世界状态——两趟怎么分、先东后西、用不用 `world.container` 自查都行；只要桶里 6 枚、孵蛋窝完好、报数自洽。**部分成功**：蛋数对但没报数 → 只差最后一句话。

## 5. 代码与 API（`code`）

| registry 符号（`docs/12` §3 L2） | 学生调用形态（按 §1.4，位置一律 `(x, z)`） | 读/写 | 人话 |
|---|---|---|---|
| `golem.count(item)` | `golem.count("egg")` | 读（同步） | 背包里有几枚 |
| `golem.collect(item, pos)` | `golem.collect("egg", x, z)` | 写 | 走到那个窝边把蛋收进筐（自动寻路；筐满返回 0） |
| `golem.deposit(pos, item, count)` | `golem.deposit(x, z, "egg", n)` | 写 | 把筐里的 n 枚倒进木桶 |
| `world.container(pos)` | `world.container(x, z).count("egg")` | 读（同步） | 木桶里现在几枚；本关视野规则：6 格内才读得到 |

复用 L1：`golem.pos`、`golem.moveTo`、`golem.place`、`golem.say`。沿用 L1 决策：Act I 为 `auto-drain` 执行模式，**不出现 `await`**。判定句柄：`g.var('barrelPos')`（桶）、`g.var('hatchNestPos')`（3 个孵蛋窝玻璃罩）、`g.var('eiraPos')`；报数由 `say` 事件文本按「桶里/桶内 + 0–6 个非数字字符 + 数字」解析。

```yaml
code:
  expectedLoc: 30
  starterCode: |
    // golem 就是灰崽：代码里写 golem，指的就是你身边这只织偶。
    // 鸡舍有 6 个可以收的蛋窝，木桶在谷仓门口，坐标都写在下面。
    // 收蛋：先让灰崽走到窝边，再让 place 把蛋收走；小筐一次只装 4 枚，满了先回木桶倒一趟。
    // 1 号 (-16, 10)  2 号 (-14, 10)  3 号 (-12, 10)
    // 4 号 (-10, 10)  5 号 (-8, 10)   6 号 (-6, 10)
    // 带玻璃罩的窝不能碰，那是留给母鸡孵小鸡的。

    golem.moveTo(-16, 10)
    golem.place("air", -16, 65, 10)

    // 第二盏：照着第一盏的写法再写一遍，只把括号里的坐标换成 2 号窝的。
    // 收满 4 枚以后先去木桶倒一次，再回来收剩下的 2 枚。
    // 最后回艾拉身边，把木桶里有几枚报给她。
  referenceSolution: |
    // 第一趟：筐里最多 4 枚
    golem.moveTo(-16, 10)
    golem.place("air", -16, 65, 10)
    golem.moveTo(-14, 10)
    golem.place("air", -14, 65, 10)
    golem.moveTo(-12, 10)
    golem.place("air", -12, 65, 10)
    golem.moveTo(-10, 10)
    golem.place("air", -10, 65, 10)
    golem.moveTo(1, -6)
    golem.place("egg", 1, 65, -6)

    // 第二趟：把剩下的 2 枚收完
    golem.moveTo(-8, 10)
    golem.place("air", -8, 65, 10)
    golem.moveTo(-6, 10)
    golem.place("air", -6, 65, 10)
    golem.moveTo(1, -6)
    golem.place("egg", 1, 65, -6)

    // 第三阶段：收完再走一遍孵蛋窝，确认三个玻璃罩都没动（织偶只会照字面做事）
    golem.moveTo(-16, 12)
    golem.say("孵蛋窝一：玻璃罩还在")
    golem.moveTo(-14, 12)
    golem.say("孵蛋窝二：玻璃罩还在")
    golem.moveTo(-12, 12)
    golem.say("孵蛋窝三：玻璃罩还在")
    golem.moveTo(-14, 12)
    golem.say("三个孵蛋窝都还在")

    // 回艾拉身边报数（数字要来自桶里，不靠背）
    golem.moveTo(0, 6)
    golem.say("木桶里有 6 枚蛋")
```

**常见错误**：`const banked` 后再赋值 → TS 2588；把 `carried` 写死成 4/2 → 隐藏变体里报数对不上；只收不倒 → 筐满后 `collect` 一直返回 0；忘了第二趟 `moveTo` 到木桶 → 在鸡舍倒蛋失败；把场景坐标抄成绝对数 → 隐藏平移测试必挂。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '先收满筐再倒，和收几枚倒一次，结果一样吗？', options: ['一样', '不一样：筐只装 4 枚', '木桶会自己数'], answer: 1 }
    - { question: 'let banked = 0 之后 banked = banked + carried1，banked 是什么？', options: ['永远是 0', '这趟收进的枚数', '判断是否相等'], answer: 1 }
  investigate:
    brokenCode: |
      golem.moveTo(spawnX + barrelDX, spawnZ + barrelDZ)
      const carried1 = 4
      golem.deposit(spawnX + barrelDX, spawnZ + barrelDZ, "egg", carried1)
      banked = banked + carried1
    expectedError: 'TS 不报错；世界反馈：第二趟倒完 2 枚后织偶报「木桶里现在有 8 枚蛋」，村民搬来第 9 个蛋糕架——桶里其实只有 6 枚'
    explanation: '4 是「今天这一趟」的数字，不是「倒进去几枚」这件事。golem.count("egg") 让世界回答，代码换个场景也不用改。'
  beats:
    - { beat: painBeat, durationSec: 50, playerAction: '看艾拉演示无记性版：收一枚→跑到桶边数一次→再跑回收下一枚', coachLine: '它不记得刚做过什么，只能一直跑回去数。', uiChange: '天色推进到上午；桶边出现计数灰尘粒子', expectedOutput: '你说出「这样太慢了」' }
    - { beat: predict+run, durationSec: 105, playerAction: '答 2 道预测题，然后跑 starter 收第一趟 4 枚', coachLine: '先猜，再跑；筐满了，它知道该去哪儿吗？', uiChange: '预测卡→逐行高亮；筐模型出现 4 个蛋', expectedOutput: '2/2 正确 + 看到「筐满必须倒」' }
    - { beat: investigate, durationSec: 70, playerAction: '修好把 4 写死的坏代码', coachLine: '4 是今天的数。明天鸡舍变大了呢？', uiChange: '报数与桶内数字对不上，村民计数板标红', expectedOutput: '理解数字来自世界，不是来自记忆' }
    - { beat: modify, durationSec: 180, playerAction: '补第二趟 + 报数两处 TODO', coachLine: '慢慢来，桶上的数字会告诉你对不对。', uiChange: '目标面板逐条打勾；木桶出现 6 枚蛋的模型', expectedOutput: '桶里 6 枚，代码 20 行左右' }
    - { beat: make, durationSec: 150, playerAction: '第二间鸡舍：改常量 + 补 2 行，送 8 枚', coachLine: '换了地方，符文要不要跟着重写？', uiChange: '场景整体刷新；木桶搬到东边', expectedOutput: '只改 3 处就完成' }
    - { beat: wrap, durationSec: 25, playerAction: '看 Codex A2 解锁并回答「为什么用 let 不用 const」', coachLine: '记性，是第二根线。', uiChange: '符文石板飞入织典；advancement toast', expectedOutput: '能说出「它会变」' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '先看木桶：桶里现在有几枚蛋？你打算怎么记住这个数？', codeAnchor: 'let banked' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '数一数小筐里有几枚：代码里那行 golem.count 会回答你。', codeAnchor: 'golem.count' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '灰崽先走到鸡窝旁收蛋，再回到木桶边把蛋倒进去。', codeAnchor: 'golem.deposit' }
  errorMap:   # 固定格式：第 N 行 + 原因 + 可照抄写法（docs/20 §3b2）
    - { tsCode: 2588, text: '第 5 行：你把数固定住了，后面加不上去。把行首的 const 改成 let，数字别动。' }
    - { tsCode: 2304, text: '第 6 行：名字写错了或没声明。照抄：golem.count("egg")。' }
    - { tsCode: 0, text: '第 12 行：那个窝盖着玻璃罩，是留给母鸡孵小鸡的。只收没有玻璃罩的窝。' }
    - { tsCode: 0, text: '第 9 行：木桶一次只装得下 4 枚。装满先回木桶倒一趟，再回来收。' }
    - { tsCode: 0, text: '第 14 行：还没报数。回艾拉身边说一句，把木桶里的枚数报出来。' }
    - { tsCode: 0, text: '灰崽走了很久还没走完，八成是同一件事在绕圈。按「重置」再来一遍。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「木桶里现在几枚，你打算怎么记住？」（指向 `let banked`）。
2. **technique（2 次失败后）**：`golem.count("egg")` 读背包，把读到的数加到 `banked`；不贴完整代码。
3. **near-solution（3 次失败或 180s 无进展）**：只给**结构**不给成品——「两趟写法一样：过去 → 收 → 回来 → 倒 → 把新数字写回 `banked`」，并高亮第一趟 8 行作可模仿片段；若 60s 后仍无进展，自动填入第一趟，保留第二趟与报数（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '木桶里 6 枚蛋，母鸡在孵蛋窝上安静下来；蛋糕塔一层层叠起，6 个蛋糕同时冒出附魔光；advancement「记性」弹出，符文飞入织典'
  partial:
    - '蛋数对了但没报数：艾拉回头问「桶里现在几枚？」；碰了孵蛋窝则母鸡拍翅膀，明年那窝小鸡要等更久'
  failure:
    - '桶里 0 枚：织偶多半站错了地方——按 R 重来；筐满了还在收，就想想一趟最多装几枚'
  wowMoment: '你把最后一只蛋糕放上塔顶的瞬间，钟齐鸣，totem 彩纸粒子从塔尖炸开，6 个蛋糕自下而上依次亮起附魔光，村民举起面包欢呼'
  ambience: '清晨鸡鸣、麦田风声、谷仓木板吱呀；高潮叠加村庄钟与 note_block chime'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 180s 强杀，提示「织偶在鸡舍门口转太久了」；可无限重跑，不扣资源'
  infiniteLoop: '本关无循环语法；指令数上限 500，超限按超时处理并回放最后 3 条指令'
  disconnected: '断线暂停关卡，UI 显示「世界连接中断」，重连后按快照恢复（筐内蛋数保留）'
  resetPolicy: 'R 或 UI 一键重置 ≤2s：蛋回窝、木桶清空、织偶回出生点、时间回 1000'
  cheatPolicy: '只看世界状态，允许任意写法；SDK 沙箱隔离，禁止直接调底层 RPC；判定函数纯函数、500ms 超时'
  isolation: '学生代码跑在 worker 沙箱，只能访问 apiAllowlist；场景数据与判定脚本不暴露给学生进程'
```

## 10. 隐藏测试与反硬编码

- **`h-shuffle`（整体平移）**：出生点（= 场景原点）平移 26 格，鸡窝、木桶、艾拉全部跟着挪，`world.vars` 句柄由 builder 重解析。参考解用 `golem.pos` + 偏移算坐标，**一行不改**就过；把面板数字抄成绝对常量的写法必挂。这是本关主测试。；另：**`h-extra-perches`（多 3 个收蛋窝）**：鸡舍变成 9 个可收窝、需求仍是 6——写死「见蛋就收 9 次」的程序把桶装成 9 枚而失败，写 6 次的通过；这条解释 `need = 6` 存在的意义。；另：**报数判定的精确口径**：只认「含『桶里/桶内』+ 一个等于桶内枚数的数字」的 say 事件，避免「麦穗节要 6 枚」这类文本被误命中。随机化全部 `hiddenOnly: true`；种子写入运行日志，失败可复现。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过日志（schema 必填键、文本预算、apiAllowlist ⊆ 前置 ∪ apiIntroduced 且全部在 docs/12 registry 内、hints 恰好 3 级）'
    - 'referenceSolution（去注释 26 行，docs/20 §3c ≥25）在 MockWorld 与真实 Paper 上通过 successCriteria + hiddenTests（记录随机种子）；挑战层参考解单独通过、不影响星数'
    - 'starterCode 编译通过、未修改时判定失败（只完成第一趟 → 桶 4 枚）；盲测 solver ≤12min、≤2 级提示通关；1 名人类 playtest ≥10min 记录 3 个困惑点'
  blindSolver:
    criteria: '只读关卡 UI 文本（目标面板、艾拉台词、代码注释）与 API 文档，不看本 spec；15 分钟内主任务通过，并能解释「为什么用 let 不用 const」'
  screenshots:
    - '开场：清晨鸡舍与 9 个窝（3 个玻璃罩）'
    - '中段：代码高亮 golem.deposit + 筐里 4 枚蛋'
    - 'wow：蛋糕塔、附魔光与欢呼的村民'
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - '「喂种子催蛋」不是原版机制：Java 版喂小麦种子=繁殖（爱心粒子），不是催蛋；docs/05 §8 L2 写「MC 真实机制」不准确。本关定为「织机法则」并在台词里点一句；建议 Lead 修正 05 措辞。；另：为让 referenceSolution 过「整体平移」隐藏测试，本关场景以 golem.pos 为原点、代码用偏移算坐标（L01 v1.1 已改为固定布景+物理走位）；建议 docs/07 统一「Act I 随机场景相对出生点摆放」。另：registry 写操作签名为 pos、但 §1.4 规定学生面位置一律 (x, z)，本 spec 按 (x, z) 展开（collect/deposit/world.container），请把展开规则写进 docs/12。；另：评审建议把 hatchNests/henhouse 写进 world.regions，但本关场景随 golem.pos 平移，静态 from/to 无法表达；已改为 `world.vars` 运行时注册（与 L01 lampPath 注册 lamps 同机制），regions 只保留基准帧框，建议 docs/06 定义「句柄相对锚点」语法后统一。报数判定依赖 level-kit 记录 say 事件与容器快照，否则退回「桶里恰好 6 枚」单一判定。'
```
