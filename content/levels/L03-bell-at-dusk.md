# L03 — 岔路与钟声（The Bell at Dusk）

> 状态：v1.1（sm11 外科修复：primitive v2 的 `trialPatch`/`resetScene`、scenario UI 契约、regions/events 声明）｜负责人：smith-act1｜最后更新：2026-10-31 12:40
> 上游：`docs/05-curriculum.md` §8 L3（任务骨）、`docs/06-level-spec-system.md`、`docs/12-sdk-api-registry.md`、`content/levels/L01-first-light.md`｜下游：`L03.level.ts`、`packages/grader`、Codex A3
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L03
  title: { zh: 岔路与钟声, en: The Bell at Dusk }
  act: 1
  order: 3
  priority: P0
  prerequisites: [L02]
  estimatedMinutes: 12
  difficulty: 2
  abstractions: [A3]
  objectives:
    - { id: o-scenario, learnerView: '先读今晚的情况（world.scenario），再决定做什么', evidence: '三夜试炼里三种夜晚各自的判定全过' }
    - { id: o-if, learnerView: '用 if / else if / else 让同一个程序在不同夜晚做不同的事', evidence: '安静夜钟不响、威胁夜钟响（同一份代码）' }
    - { id: o-priority, learnerView: '危险同时来时要分优先级：先敲钟、再救人、最后堵门', evidence: '第 4 夜组合场景（验收时才出现）零伤亡' }
  misconceptions: [fixed-action-every-night, condition-inverted, string-needs-quotes, bell-is-ritual, else-branch-never-fires]
  apiIntroduced: [world.scenario, world.countEntities, golem.ringBell, golem.placeTorch]
  apiAllowlist: [golem.pos, golem.moveTo, golem.place, golem.say, golem.where, golem.count, golem.collect, golem.deposit, world.container, world.scenario, world.countEntities, golem.ringBell, golem.placeTorch, golem.patrol]
  syntaxIntroduced: ['if / else if / else', '比较运算（> 与 ===）', '逻辑与（&&）']
  reward: { rune: A3, advancement: loomcraft/act1/bell_at_dusk, codexPage: A3 }
```

## 1. 学习目标（学习者视角）

1. **读状态**：`world.scenario` 是今晚的剧本（有没有威胁、有没有人受伤、北门开没开），只读。
2. **分支**：`if / else if / else` 让同一份符文在三种夜晚做三件不同的事——不是每晚贴一遍新符文。
3. **比较与泛化**：`===` 比较文字、`>` 比较数量；程序要过**没见过的夜**（三夜试炼之后还有第四夜组合）。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '暮色里的灰岩村口。散线变浓——散线：织机断线后散出的灰白线头，不咬人，只让碰到的东西忘记自己该做什么。艾拉把守夜符文交给你——符文：一句只做一件事的短句；她说：「钟不是仪式，它是给某种夜晚用的。」'
  stakes: '三夜试炼：写一个程序，连过三个不一样的夜晚，村民一个都不能少。失败不惩罚，可无限重来。'
  painBeat: '艾拉放出去年的符文：每晚都先敲钟、再点灯、最后巡逻。第一夜很安静，钟把全村吵醒，婴儿哭到天亮；第二夜北门来了 3 只僵尸，钟响了，可织偶正在村东点灯——等它跑到北门，一个村民已经被抓伤。她没说话，只是把符文折起来。'
  resolution: '你写的程序先看清今晚是什么夜：有人被困就敲钟并把人带回家，只有僵尸就守北门，什么都没就点亮两个暗角。三夜全过，第四夜也没出事。'
  coachTone: '简短、有纪律感，像夜班守则；只讲事实和后果，不吓人、不责备。台词要点：①「先看，再动。」②「钟是给僵尸的，不是给所有麻烦的。」③「天亮了，你亲手敲钟。」织偶：只会照字面做事的无魂工匠；天亮那一步是你的织者之印——活人手上才有的印子，它替不了。'
```

## 3. 世界与场景（`world`）

村口是现成村庄的北侧（钟楼 + 2 根灯柱 + 北门 + 井边 + 3 扇屋门）；这一关**村子几何固定**，试炼只改「今晚的剧本」（威胁数量/方向、是否有人被困、门是否被撞开）。你站在门楼旁旁观，铁傀儡在钟楼旁待命。

```yaml
world:
  anchor: { kind: village, id: graystone }
  dimension: overworld
  time: 13000
  weather: clear
  region: { center: [0, 64, 0], radius: 56 }
  entities:
    - { type: golem, role: agent, id: golem, name: 灰崽, count: 1 }
    - { type: villager, role: npc, id: eira, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 6 }
    - { type: iron_golem, role: npc, id: ironGolem, count: 1 }
    - { type: zombie, role: hazard, count: 3 }
  regions: { northGate: { from: [12, 68, -8], to: [16, 74, -4] }, well: { from: [-6, 60, 16], to: [-2, 66, 20] }, door: { from: [4, 68, 20], to: [8, 74, 24] }, darkA: { from: [-9, 60, 1], to: [-7, 64, 3] }, darkB: { from: [7, 60, 1], to: [9, 64, 3] } }
  vars: { scenarioIndex: 1, scenario: { night: 2, threat: 3, trapped: false, gateOpen: false }, bell: [0, 65, 0], gate: [14, 65, -6], well: [-4, 65, 18], door: [6, 65, 22], eastWall: [22, 65, 2], lamps: [[-8, 65, 2], [8, 65, 2], [-14, 65, -2], [14, 65, 2], [-6, 65, 10], [6, 65, 10], [-12, 65, -8], [12, 65, -8]], houses: [[-1, 65, 4], [5, 65, 12], [-6, 65, 8], [10, 65, 14]], eira: [0, 65, 6] }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: village, id: graystone }
        - { op: buildProps, builder: nightWatch, params: { bell: 1, lampPosts: 2, northGate: 1, well: 1, doors: 3 } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$village.gate' }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$village.gate', offset: [2, 0, 2] }
        - { op: spawnEntity, type: villager, role: npc, count: 6, at: '$village.houses' }
        - { op: spawnEntity, type: iron_golem, role: npc, count: 1, at: '$village.bell', offset: [3, 0, 0] }
        - { op: dialog, speaker: eira, text: '上面三张卡就是今晚的剧本：安静夜、北门有僵尸、井边有人被困。先看，再动。' }
        - { op: objective, items: ['先看上面三张剧本卡', '一个程序连过三夜', '天亮后你亲手敲钟'] }
    - phase: trial
      steps:
        - { op: resetScene }                                          # 重建 staging + clearEntities（v2：无区域快照）
        - { op: trialPatch, trial: '$trial' }                         # 注入 time/weather/entities/scenario（来自 task.trials[].setup）
        - { op: bossbar, text: '第 $trial.night 夜 · 守夜', color: red }
        - { op: waitUntil, event: onTrialEnd, timeout: 420 }
    - phase: climax
      steps:
        - { op: time, value: 23000 }
        - { op: time, value: 24000 }
        - { op: particle, type: end_rod, at: '$village.bell', count: 30 }
        - { op: sound, id: block.bell.resonate, volume: 1 }
        - { op: particle, type: happy_villager, at: '$ironGolem', count: 20 }
        - { op: spawnEntity, type: item, role: prop, name: 虞美人, count: 1, at: '$golem.pos' }
        - { op: advancement, id: loomcraft/act1/bell_at_dusk }
        - { op: dialog, speaker: eira, text: '夜里的规则，你写对了。天亮了，钟该你敲。' }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['村庄建筑', '床', '门', '钟']
```

**「今晚剧本」UI 契约**：每夜开始时，UI 顶部显示三张小卡——①威胁（`world.scenario.threat` + `threatCount` 只数）；②被困（`villagerHurt` 红/绿）；③北门（`northGateOpen` 开/关）。学生**不需要自己推断**今晚是什么夜；`world.scenario` 只读、与本卡同源（引擎缓存）。
**事件与句柄**：`bell.ring`（`actorType` 区分织偶敲 vs 你敲，`playerBeat` 只认 `actorType==="player"`）、`trial.start`/`trial.end`（引擎驱动）、`player.interact`（你右键钟）、`entity.arrive`（村民进门）；区域句柄见 `world.regions`（northGate/well/door/darkA/darkB），每夜计数见 `world.vars`（trialNight/bellRangBy/villagersHurt/hostileLeft）。
**MC 机制依据**（2026-10-31 查询）：敲钟会让附近敌对生物发光、村民往家跑（[Bell](https://minecraft.wiki/w/Bell)）；铁傀儡守村并向村民递虞美人（[Iron Golem](https://minecraft.wiki/w/Iron_Golem)）；僵尸在日光下燃烧（[Zombie](https://minecraft.wiki/w/Zombie)）；火把光照阻止附近刷怪（[Light](https://minecraft.wiki/w/Light)）。数值以实测为准（§12）。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '先看上面三张剧本卡，按剧本守一夜：有威胁就敲钟，有人被困先救人，再把八根灯柱和四户人家的门口点亮，最后回艾拉身边报平安。'
  makeTask: '第四夜三件事一起来：先敲钟，再救人，最后把北门堵上。'
  playerBeat: '天亮后你亲手敲钟；灰崽敲的不算守夜钟声。'
  timeLimitSec: 300
  successCriteria:
    - { id: quiet-no-bell, text: 安静的夜里钟一次没响, check: "(g) => g.trial('night1-quiet').bellRang === false" }
    - { id: threat-nights-bell, text: 两个有僵尸的夜晚钟都响了, check: "(g) => g.trial('night2-zombie').bellRang === true && g.trial('night3-injured').bellRang === true" }
    - { id: no-casualties, text: 三夜零伤亡、安静夜两个暗角都点上火把, check: "(g) => g.trials().every(t => t.villagersHurt === 0) && g.trial('night1-quiet').torchesAt(['darkA', 'darkB']) === 2" }
  trials:
    - id: night1-quiet
      name: 第一夜·安静
      setup: { night: 1, time: 14000, threat: none, threatCount: 0, villagerHurt: false, northGateOpen: false }
      assertions: [{ id: n1a, text: '钟没响（敲钟会吵醒全村）', check: "(g) => g.trial('night1-quiet').bellRang === false" }, { id: n1b, text: '两个暗角都插上火把、零伤亡', check: "(g) => g.trial('night1-quiet').torchesAt(['darkA', 'darkB']) === 2 && g.trial('night1-quiet').villagersHurt === 0" }]
    - id: night2-zombie
      name: 第二夜·北门
      setup: { night: 2, time: 14000, threat: zombie, threatCount: 3, threatSide: north, villagerHurt: false, northGateOpen: false }
      assertions: [{ id: n2a, text: '钟响过（僵尸发光，铁傀儡才找得到）', check: "(g) => g.trial('night2-zombie').bellRang === true" }, { id: n2b, text: '天亮时僵尸清空、零伤亡、织偶守在北门', check: "(g) => g.trial('night2-zombie').hostilesLeft === 0 && g.trial('night2-zombie').villagersHurt === 0 && g.trial('night2-zombie').golemNear('northGate', 8)" }]
    - id: night3-injured
      name: 第三夜·井边
      setup: { night: 3, time: 14000, threat: zombie, threatCount: 2, threatSide: west, villagerHurt: true, northGateOpen: false }
      assertions: [{ id: n3a, text: '钟响过', check: "(g) => g.trial('night3-injured').bellRang === true" }, { id: n3b, text: '受伤村民被带回门内、零死亡', check: "(g) => g.trial('night3-injured').villagerAtDoor === true && g.trial('night3-injured').deaths === 0" }]
  hiddenTests:
    - id: h-night4-combo
      name: 第四夜·三件事一起来
      setup: { night: 4, time: 14000, threat: zombie, threatCount: 2, threatSide: north, villagerHurt: true, northGateOpen: true }
      assertions: [{ id: h4a, text: '钟响、村民被救回、北门被堵上、零伤亡', check: "(g) => g.trial('night4-combo').bellRang && g.trial('night4-combo').villagerAtDoor && g.trial('night4-combo').gateSealed && g.trial('night4-combo').villagersHurt === 0" }]
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: zombie-count, range: [2, 4], note: '威胁夜的僵尸数量随机' }
      - { id: threat-side, values: [north, east, west], note: '僵尸从哪边来随机（北门判定只在北侧时触发）' }
      - { id: hurt-villager-spot, count: 2, note: '被困村民在井边或东墙根，二选一；第四夜组合只在验收时注入' }
```

**阶段（4 段）**：①守夜（读剧本处理威胁与被困）②点亮村口八根灯柱 ③逐户给四户人家送火把 ④堵北门、巡查井边/北门/钟楼，回艾拉身边报平安。
**挑战层（可跳过、不计星）**：第五夜——两处威胁同时来，先把人救回来、钟才响；参考解与判定见 `L03.content.ts` 的 `challenge`（独立验收，不影响星数）。
**试炼机制**：点「三夜试炼」→ 每个 trial：重置场景 → 注入今晚 patch（威胁/村民/门状态）→ **新 SDK 会话**重跑程序（变量不跨夜）→ 收集世界快照 → 跑断言；三夜全过才通关，天亮一格结果灯亮。**多解**：只读世界状态，先守门后救人只要零伤亡也算过。
**阶段（4 段）**：①守夜（读剧本处理威胁与被困）②点亮八根灯柱 ③逐户送火把 ④堵北门、巡查三处后回艾拉身边；参考解 52 行（docs/20 §3c ≥50）。**挑战层（可跳过、不计星）**：第五夜两处威胁先救人，判定见 `L03.content.ts` 的 `challenge`（独立验收）——schema 暂无 `challenge` 字段，实现期以 content.ts 为准。

## 5. 代码与 API（`code`）

| registry 符号（`docs/12` §3 L3） | 学生调用形态 | 读/写 | 人话 |
|---|---|---|---|
| `world.scenario` | `world.scenario.villagerHurt` / `.northGateOpen` / `.threat` | 读（同步） | 今晚的剧本：有人被困吗？北门开了吗？ |
| `world.countEntities(kind, radius)` | `world.countEntities("zombie", 32)` | 读（同步） | 32 格内有几只僵尸 |
| `golem.ringBell()` | `golem.ringBell()` | 写 | 敲响最近的村庄钟（僵尸发光、村民归家） |
| `golem.placeTorch(x, z)` | `golem.placeTorch(darkAX, darkAZ)` | 写 | 在指定地面位置插火把 |

复用：`golem.moveTo`、`golem.place`（堵门用圆石）、`golem.say`、`golem.pos`。`golem.patrol` 出现在 allowlist（registry 有），但本关先用两次 `moveTo` 代替——`patrol(...points)` 的学生调用形态未定，见 §12。

```yaml
code:
  expectedLoc: 58
  starterCode: |
    // 上面三张卡就是今晚的剧本：安静夜、北门有僵尸、井边有人被困。
    // 程序读到的，就是这三张卡写的事。
    // 铁傀儡不是灰崽：它是村里的守卫；灰崽是你写符文驱动的织偶。
    // 这张卡说的三件事，就是下面三个分支。
    const s = world.vars.scenario

    // 今晚有威胁：先敲钟，再去北门守着
    if (s.threat > 0) {
      golem.place("bell", 0, 65, 0)
      golem.moveTo(14, -6)
    }

    // 剩下两段你来补。
    // 有人被困的夜里，灰崽要先到井边，再把人带回门口。
    // 一个威胁都没有的夜里，把暗处的灯点亮，八根灯柱补齐。
    // 最后从北门绕到井边、钟楼看一圈，回艾拉身边报平安。
  referenceSolution: |
    const s = world.vars.scenario

    // 阶段一：守夜——先看今晚是什么夜
    if (s.trapped) {
      golem.moveTo(-4, 18)
      golem.moveTo(6, 22)
      if (s.threat > 0) {
        golem.moveTo(0, 0)
        golem.place("bell", 0, 65, 0)
      }
    } else if (s.threat > 0) {
      golem.place("bell", 0, 65, 0)
      golem.moveTo(14, -6)
    }

    // 阶段二：把村口八根灯柱全部点亮
    golem.moveTo(-8, 2)
    golem.place("torch", -8, 65, 2)
    golem.moveTo(8, 2)
    golem.place("torch", 8, 65, 2)
    golem.moveTo(-14, -2)
    golem.place("torch", -14, 65, -2)
    golem.moveTo(14, 2)
    golem.place("torch", 14, 65, 2)
    golem.moveTo(-6, 10)
    golem.place("torch", -6, 65, 10)
    golem.moveTo(6, 10)
    golem.place("torch", 6, 65, 10)
    golem.moveTo(-12, -8)
    golem.place("torch", -12, 65, -8)
    golem.moveTo(12, -8)
    golem.place("torch", 12, 65, -8)

    // 阶段三：逐户送火把（散线重的地方，人家门口不敢熄灯）
    golem.moveTo(-1, 4)
    golem.place("torch", -1, 65, 4)
    golem.say("第一家：门口有光了")
    golem.moveTo(5, 12)
    golem.place("torch", 5, 65, 12)
    golem.say("第二家：门口有光了")
    golem.moveTo(-6, 8)
    golem.place("torch", -6, 65, 8)
    golem.say("第三家：门口有光了")
    golem.moveTo(10, 14)
    golem.place("torch", 10, 65, 14)
    golem.say("第四家：门口有光了")

    // 阶段四：北门被撞开就堵上，然后巡查三处
    if (s.gateOpen) {
      golem.moveTo(14, -6)
      golem.place("cobblestone", 14, 65, -6)
    }
    golem.moveTo(-4, 18)
    golem.say("井边：平安")
    golem.moveTo(14, -6)
    golem.say("北门：平安")
    golem.moveTo(0, 0)
    golem.say("钟楼：平安")

    // 收岗：回艾拉身边
    golem.moveTo(0, 6)
    golem.say("三夜平安，天亮收岗")
```

**常见错误**：`world.scenario.threat === zombie` 少引号 → TS 2304（「织偶不认识 zombie 这个名字——剧本里写的是字符串」）；把条件写反（`if (zombies === 0)` 时敲钟）→ 安静夜失败；每晚都敲钟 → 第一夜失败；忘了 `else` 分支 → 安静夜什么都不做、灯没点；救援只走一步 `moveTo(doorX, doorZ)` → 村民没跟上（必须先去井边）。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '第一夜很安静，但程序每晚都敲钟。村庄里会发生什么？', options: ['没事，钟响只是好看', '全村被吵醒，村民整夜睡不好', '僵尸会被吓跑'], answer: 1 }
    - { question: '同样是 3 只僵尸：有没有人被困，程序该不该做一样的事？', options: ['一样，都是僵尸', '不一样：先救人，再守门', '一样，先点灯'], answer: 1 }
  investigate:
    brokenCode: |
      if (zombies === 0) {
        golem.ringBell()
      }
    expectedError: 'TS 不报错；世界反馈：第一夜钟响了（村民被吵醒，判定失败），第二夜钟没响（铁傀儡找不到发光的僵尸，村民被抓伤）'
    explanation: '条件写反了。「有僵尸」才敲钟，所以问题是 zombies > 0；写代码前先用一句话把条件说出来。'
  beats:
    - { beat: painBeat, durationSec: 60, playerAction: '看艾拉演示「每晚都敲钟」的旧符文：两夜各失败一次', coachLine: '钟不是仪式。它是给某种夜晚用的。', uiChange: '第一夜村民被吵醒的抱怨气泡；第二夜村民被抓伤', expectedOutput: '你说出「不能每晚做一样的事」' }
    - { beat: predict, durationSec: 45, playerAction: '答 2 道预测题', coachLine: '先读今晚，再写动作。', uiChange: '预测卡盖住编辑器；三张夜景卡摊开', expectedOutput: '2/2 正确' }
    - { beat: run, durationSec: 90, playerAction: '跑 starter（骨架能跑、条件没填），再修好写反的条件重跑', coachLine: '把条件先读成一句人话，再写符号。', uiChange: '第一夜失败、第二夜钟响、僵尸发光', expectedOutput: '第一格结果灯亮' }
    - { beat: modify, durationSec: 240, playerAction: '补完三个分支 + 堵门，连跑三夜', coachLine: '顺序就是优先级：先救急的。', uiChange: '三格结果灯依次亮起；bossbar 显示进度', expectedOutput: '三夜全过' }
    - { beat: make, durationSec: 180, playerAction: '进「第四夜」组合场景（隐藏变体验收）', coachLine: '三种麻烦一起来，你排的顺序还站得住吗？', uiChange: '第四夜徽章出现；失败只给方向提示', expectedOutput: '第 4 夜零伤亡' }
    - { beat: wrap, durationSec: 30, playerAction: '天亮右键钟敲晨钟，看 Codex A3 解锁', coachLine: '天亮了。这一钟，你敲。', uiChange: '日出、铁傀儡递虞美人、村民举火把', expectedOutput: '解锁抉择之符' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '先看上面三张卡：哪一夜有威胁？哪一夜有人被困？北门开着吗？', codeAnchor: 'const s = world.vars.scenario' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '三种夜对应三个分支：有人被困、有僵尸、什么都没有。', codeAnchor: 'else if (s.threat > 0)' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '救人的分支里，先问有没有僵尸，再去井边，最后把人带回门口。', codeAnchor: 'golem.moveTo(-4, 18)' }
  errorMap:   # 固定格式：第 N 行 + 原因 + 可照抄写法（docs/20 §3b2）
    - { tsCode: 0, text: '第 8 行：没先看剧本。安静的夜敲钟会把全村吵醒。' }
    - { tsCode: 0, text: '第 9 行：条件写反了。有僵尸才敲钟，没有僵尸不该敲。' }
    - { tsCode: 2304, text: '第 11 行：文字要带引号，不然织偶不认识。照抄："zombie"。' }
    - { tsCode: 0, text: '第 14 行：少了一段「不是这样就……」——代码里就是 else；安静的夜也要点灯。' }
    - { tsCode: 0, text: '第 18 行：有人被困时先去井边，再把人带回门口。照抄：golem.moveTo(-4, 18)。' }
    - { tsCode: 0, text: '第 22 行：顺序反了。先救人，再敲钟，最后堵门。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「今晚的第一件事是什么？」——把注意力推回 `world.scenario`，不给条件。
2. **technique（2 次失败后）**：点出三种夜对应三个分支，`else if` 是「否则如果」而非两个独立 `if`；不贴完整代码。
3. **near-solution（3 次失败或 240s 无进展）**：只给结构——「救人分支里：先问有没有僵尸再决定敲不敲钟，然后井边 → 门口」，并高亮 `if (zombies > 0)` 一行；若 60s 后仍无进展，自动填入第一分支，保留另两个分支（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '三格结果灯依次亮起；日出时僵尸在晨光里燃烧，铁傀儡走过来把一朵虞美人放在织偶脚边，村民举火把排成一条灯龙；另：你敲晨钟 → advancement「岔路与钟声」，符文飞入织典'
  partial:
    - '过了两夜、第三夜失败：结果灯只亮两格；零伤亡但钟敲多了则村民白天打哈欠：「昨晚的钟，吵到他们了。」'
  failure:
    - '有人受伤：不弹失败弹窗，只在结算里多一盏熄灭的灯；按 R 重来'
  wowMoment: '第四夜成功的一瞬间，三夜画面快进叠化，天光从东墙翻过来：僵尸在阳光里起火，铁傀儡踏着钟声走到你面前放下一朵虞美人，6 个村民举火把从屋里出来，火把连成一条火龙涌向钟楼，晨钟由你亲手敲响'
  ambience: '夜虫与风、钟声余韵、铁傀儡沉重的脚步声；天亮时加入鸟鸣与村庄环境音'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单夜运行 120s 强杀（含夜间时间加速 3×）；三夜总预算 6 min；不惩罚、可无限重试'
  infiniteLoop: '本关无循环语法；单次运行指令上限 800，超限按超时处理并回放最后 3 条指令'
  disconnected: '断线暂停试炼，重连后从当前夜重跑（已过夜的记录保留）'
  resetPolicy: 'R 或 UI「重置这一夜」≤2s；重置整关恢复 three-night 进度为 0；不扣资源'
  cheatPolicy: '只看世界状态；允许任意写法（含先守门后救人）。禁止直接调 RPC、禁止把判定真值暴露给学生进程'
  isolation: '每个 trial 用新 SDK 会话（变量/背包/世界补丁不跨夜）；学生代码在 worker 沙箱，只能访问 apiAllowlist'
```

## 10. 隐藏测试与反硬编码

- **`h-night4-combo`（第四夜组合）**：僵尸 + 村民被困 + 北门被撞开三件事同时来。只处理了「三种夜各一个动作」的程序会在第四夜漏掉堵门或救人；把 `if / else if / else` 写死的程序也会在这里露馅。这条只在验收时跑，UI 不显示。；另：**随机化**（`hiddenOnly: true`）：僵尸数量 2–4、来向（北/东/西）、被困村民位置二选一——写死数量或写死「僵尸总在北门」的程序在试炼里就会失败。**`trials` 之间必须隔离**（每个 trial 新 SDK 会话），否则「每晚做同样的事」会假通过；种子 `hash(L03, sessionId, attempt, night)` 写入日志。

## 11. 验收证据（`acceptance`）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过日志（schema 必填键、文本预算、apiAllowlist 全部在 docs/12 registry 内、hints 恰好 3 级、trials ≥1）'
    - 'referenceSolution（去注释 52 行，docs/20 §3c ≥50）在 MockWorld 与 Paper 上通过 trials + hiddenTests（记录每夜种子）；挑战层第五夜参考解单独通过、不影响星数'
    - 'starterCode 编译通过且未修改时三夜全败；盲测 solver ≤15min、≤2 级提示通关；1 名人类 playtest ≥10min 记录 3 个困惑点（重点：else if 直觉）'
  blindSolver:
    criteria: '只读关卡 UI 文本（三张夜景卡、目标面板、艾拉台词、代码注释）与 API 文档，不看本 spec；15 分钟内过三夜，并能说出「为什么安静夜不能敲钟」'
  screenshots:
    - '开场：暮色村口与钟楼（两盏灯柱未点亮）'
    - '中段：第二夜钟响、僵尸发光、铁傀儡冲向北门'
    - 'wow：日出、燃烧的僵尸、虞美人、村民火把长龙'
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'D4 规定 Act I 优先「和平难度」，但 L3 必须有僵尸威胁。二选一：(a) 本关单独把难度切 normal；或 (b) 僵尸由插件以「不造成伤害的演出实体」呈现、判定只看状态。建议 (a)，请 Lead 记进 docs/11。'
  - '钟的发光半径/时长、铁傀儡清场时间以 minecraft.wiki 与实测为准；若难判定「僵尸发光」，trials 改为「钟响 + 铁傀儡清场 + 零伤亡」。村民「跟随织偶回家」是关卡规则（原版村民只往家跑、不跟你）；若不允许，救援改为「清掉周围僵尸 + 村民自己跑回家」。另：`golem.patrol(...points)` 学生调用形态未定（可变参数可能是 Vec2 数组、学生不能写对象字面量），本关先用两次 moveTo，请 Lead 在 docs/12 明确签名。本关已按 primitive v2 去掉区域快照类 op、改用 resetScene+trialPatch；但 `waitUntil` 仍不在 docs/06 §5.4 v2 白名单（docs/07 §6 却写了支持 wait/waitUntil）——建议补回，否则 6 份 spec 的 validator 会红。另：本关 builder `nightWatch` 不在 docs/07 §6 白名单（评审 F6），需补录或改名。'
```
