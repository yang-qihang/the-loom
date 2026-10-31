# L08 — 同一种心跳（One Heartbeat）

> 状态：v2（T2 扩体量：阶段 2 + 挑战层 + 三句开场）｜负责人：smith-act3｜最后更新：2026-10-31
> 上游：`docs/05-curriculum.md` §8 L8（任务骨，不得改）、`docs/06-level-spec-system.md`（12 章格式与门禁）、`docs/12-sdk-api-registry.md`（API 唯一权威）、`docs/20` §3b/§3b2/§3c、`docs/23`、`docs/25`
> 下游：`content/levels/L08.level.ts`（实现）、`packages/grader`（L8 判定）、Codex 页 A11
> 体量自检：参考解有效行 **76**｜starter 有效行 **30**｜行差 **46**｜阶段 **2**｜挑战 **1**（三设备联动机）｜隐藏变体 **4**｜可见试炼 **3**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。`task.phases` / `task.challenge` 为 docs/06 §6.1 #15 新增字段，schema 尚未收录，实现期以 `L08.content.ts` 为准（与 L02/L04 同口径）。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L08
  title: { zh: 同一种心跳, en: One Heartbeat }
  act: 2
  order: 8
  priority: P1
  prerequisites: [L07]
  estimatedMinutes: 20
  difficulty: 5
  abstractions: [A11]
  objectives:
    - { id: o-contract, learnerView: 用「会做哪三件事」描述一台机器，而不是「它是什么」, evidence: 隐藏测试注入没见过的机器后，启动、汇报、停机全部通过 }
    - { id: o-polymorphic, learnerView: 只按契约写的函数，收下任何满足形状的机器都能干活, evidence: 三台内置机器与联动机任意顺序启动；随机注入变体全过 }
    - { id: o-compose, learnerView: 组合是把已有机器拼起来，不复制、不继承, evidence: 联动机由两台机器拼成；过热时状态聚合正确；停机按反序 }
  misconceptions: [interface-means-inheritance, must-write-implements, hardcode-machine-list, composition-is-copy-paste, stop-order-irrelevant]
  apiIntroduced: [world.machines, world.lever]
  apiAllowlist: [ALL_PRIOR, world.machines, world.lever, 'machine.call (kind: harness)', 'chat (kind: harness)', 'lever.pull (kind: harness)', 'g.injected (kind: harness)']
  syntaxIntroduced: ['interface 声明', '结构化类型（形状对就算契约）', '多态数组 Machine[]', '复用数组解构（L6）']
  reward: { rune: A11, advancement: loomcraft/act2/one_heartbeat, codexPage: A11 }
  languageLevel: act2
```

## 1. 学习目标（学习者视角）

1. **契约**：三台机器的共同点不是「名字」也不是「出身」，而是都会做同样的三件事——启动、停下、报状态。把这三件事刻在同一块石板上（`interface`），石板之外的细节都不必知道。
2. **结构化类型**：只要一个对象形状对得上这块石板，它就是一台机器；不需要写成某一类，也不需要声明「我属于谁」。世界交来的机器本来就是这个形状，所以一行都不用重写。
3. **组合**：第四台「熔炉+警钟联动机」不是新造一台机器，而是把已有的两台按顺序扣在一起：启动时先熔炉后警钟，停机时先警钟后熔炉，任何一台报过热，联动机就报过热。**代价**（织典 A11 页）：契约要求先把共同点想清楚；想不清楚，`runAll` 就会退化成背名单。
4. **停机也要有秩序**：启动可以齐步走，停机必须按反序——先停靠外的警钟，最后停熔炉。顺序错了，炉膛余热会把联动杆顶弯（世界内演出，不惩罚）。

误解与对策：`interface-means-inheritance` → 只读继承灾难小剧场；`must-write-implements` → 预填两种满足石板的写法；`hardcode-machine-list` → 隐藏注入；`composition-is-copy-paste` → 联动机复核 + 挑战层；`stop-order-irrelevant` → 停机演练试炼。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '清晨的织机工坊控制室。三台旧机器停在灰里：熔炉组、红石门、警钟。结构之核在晨光里继续开裂，艾拉把铜钥匙放在操作台上：「它们不是同一条线上的东西，但都会做同样三件事：动起来、停下来、报个信。」'
  stakes: '第一缕日光落到结构之核之前，四台机器必须按同一节拍完成晨检；错过只是重来一次，没有人受伤，但整座工坊会再冷一天。'
  painBeat: '艾拉摊开去年刻在石板上的旧符文：为了让「熔炉+警钟」一起工作，她把警钟的纹样原样抄进熔炉的纹样里；再想给红石门也加警钟时，同一段纹样已经有三份。她用指甲刮掉一处想改，三台机器同时抖了一下，红石乱闪、火花噼啪。她合上石板：「它们不是一家人。硬认亲，就长成了这样。」'
  resolution: '你把三台机器共同会做的三件事刻在同一块石板上，让灰崽照着石板启动、汇报、停机；再把熔炉与警钟扣成一台联动机。四台机器按同一节拍醒来，铭牌一格一格亮到最后一格；你推下拉杆，工坊开始同一种心跳。'
  coachTone: '温和、具体、不夸。少用行话：把「契约」说成「同一块石板上写的三件事」，把「组合」说成「把两台机器扣在一起」。每次只点一个想法，不催不吓唬。'
```

**三句开场（docs/25 §3，进入关卡时逐句出现）**：
1. **世界状态**：「工坊的机器停了三个早上，熔炉冷着，警钟哑着，结构之核的裂纹又长了一寸。」
2. **任务**：「先把四台机器按同一节拍叫醒：逐台启动、报状态、过热就停；再把熔炉和警钟扣成一台联动机复核一遍，收工时按反序让它们全部待机。」
3. **为什么是你**：「总拉杆只认活人的手，你是工坊里最后一个织者；灰崽只能替你把机器叫醒，最后那一下得你来。」

## 3. 世界与场景（`world`）

控制室是 seed 村庄边缘的平房改造，所有装置相对工坊原点 O 摆放（工坊在北/东/南三套模板中随机选一，相对坐标不变）。机器本身由 SDK 提供——学生不手写三台设备，只写「叫醒它们」的调度与「扣在一起」的组合。四格状态铭牌由织偶念出的汇报驱动；总拉杆由灰崽推到一半，玩家推到底完成玩家节拍。

```yaml
world:
  anchor: { kind: workshop, id: graystone_workshop }
  dimension: overworld
  time: 1000
  weather: clear
  region: { center: [0, 64, 0], radius: 40 }
  vars: { machineIds: ['furnace', 'gate', 'bell'], comboId: 'combo', fleetSize: 4, plaqueCells: 4 }
  entities:
    - { type: agent, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 2 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: workshop, id: graystone_workshop }
        - { op: buildProps, builder: loomWorkshop, params: { origin: '$anchor', furnace: [-8, 0, -6], gate: [8, 0, -6], bell: [0, 4, -10], plaques: [10, 2, 2], lever: [0, 1, 8] } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$anchor+[0,0,0]' }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$anchor+[-4,0,3]' }
        - { op: spawnEntity, type: villager, role: npc, count: 2, at: '$anchor+[5,0,4]' }
        - { op: time, value: 1000 }
        - { op: weather, value: clear }
        - { op: dialog, speaker: eira, text: '它们不是同一条线上的东西，但都会做同样三件事。' }
        - { op: objective, items: ['四台机器按同一节拍启动', '逐台报出状态', '亲手把总拉杆推到底'] }
    - phase: drill
      steps:
        - { op: sound, id: block.bell.use, volume: 1 }
        - { op: particle, type: electric_spark, at: '$anchor+[10,2,2]', count: 16 }
        - { op: dialog, speaker: eira, text: '停机要倒着来：先停警钟，再停别的，最后停熔炉。' }
    - phase: climax
      steps:
        - { op: freezeInput, value: true }
        - { op: particle, type: flame, at: '$anchor+[-8,0,-6]', count: 40 }
        - { op: sound, id: block.blastfurnace.fire_crackle, volume: 1 }
        - { op: sound, id: block.piston.extend, volume: 0.8 }
        - { op: sound, id: block.bell.use, volume: 1 }
        - { op: advancement, id: loomcraft/act2/one_heartbeat }
        - { op: dialog, speaker: eira, text: '它们不是一家人，现在却按同一个节拍呼吸。' }
        - { op: unfreezeInput, value: true }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['控制室地板', '外墙', '总拉杆', '状态铭牌', '熔炉组', '红石门', '警钟']
```

**设计要点（给实现 agent）**：①机器事件由插件发 `machine.call`（带 `machine` 与 `kind: start|status|stop`），注入 mock 与内置机器同一条事件总线；②组合机（`combine` 的返回值）没有独立机器编号，它转发子机器调用，SDK 对同一 `machine` 在「关→开」时只记一次启动事件，判定一律按机器编号去重；③停机事件保留全部调用（不去重），因为反序本身就是考点；④状态字符串用中文「正常 / 过热」，织偶念出的气泡文本就是状态本身（`chat` 事件带 `text` 与 `byGolem`）。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '叫醒四台机器：逐台启动、报状态、过热的停机；再把熔炉与警钟扣成一台联动机复核；最后按反序让它们全部待机。'
  makeTask: '把「哪台机器需要停机」改写成一个不认机器编号的检查：换一批机器（含你没见过的）也照样能判。'
  playerBeat: '灰崽把总拉杆推到一半，由你把拉杆推到底；推到底的一刻触发全工坊同拍演出。'
  timeLimitSec: 150
  successCriteria:
    - id: four-started
      text: 四台机器都启动（按机器编号去重后恰为 4：三台内置 + 组合机）
      check: |
        (g) => { const c = g.events("machine.call"); const ids = new Set(c.filter(e => e.kind === "start").map(e => e.machine)); return ["furnace", "gate", "bell"].every(id => ids.has(id)) && new Set([...ids, "combo"]).size === 4 && ids.size === 3 && g.events("chat").filter(e => e.byGolem === true).length >= 4 }
    - id: statuses-said
      text: 织偶逐台念出了状态（含联动机）
      check: |
        (g) => g.events("chat").filter(e => e.byGolem === true).length >= 4
    - id: lever-pushed
      text: 你亲手把拉杆推到底
      check: |
        (g) => g.events("lever.pull").some(e => e.byPlayer === true)
    - id: all-standby
      text: 收工时全部机器已待机，停机按反序（最后停的是熔炉）
      check: |
        (g) => { const stops = g.events("machine.call").filter(e => e.kind === "stop").map(e => e.machine); return stops.length >= 3 && stops[stops.length - 1] === "furnace" && stops[stops.length - 2] === "gate" && stops.includes("bell") }
  trials:
    - id: t-morning
      name: 晨间自检
      setup: { variant: normal }
      assertions:
        - id: t-morning-ok
          text: 四台按同一节拍启动、逐台汇报；汇报里没有「过热」
          check: |
            (g) => { const c = g.events("machine.call"); const ids = new Set(c.filter(e => e.kind === "start").map(e => e.machine)); const hot = g.events("chat").filter(e => e.text === "过热").length; return ids.size === 3 && ["furnace", "gate", "bell"].every(id => ids.has(id)) && hot === 0 }
    - id: t-overheat
      name: 熔炉过热
      setup: { variant: furnace-hot }
      assertions:
        - id: t-overheat-ok
          text: 熔炉先被停机，红石门到停机演练才停
          check: |
            (g) => { const s = g.events("machine.call").filter(e => e.kind === "stop"); const iF = s.findIndex(e => e.machine === "furnace"), iG = s.findIndex(e => e.machine === "gate"); return iF >= 0 && (iG === -1 || iF < iG) && g.events("chat").filter(e => e.text === "过热").length >= 1 }
    - id: t-shutdown
      name: 停机演练
      setup: { variant: shutdown-order }
      assertions:
        - id: t-shutdown-ok
          text: 停机顺序是警钟先、红石门次之、熔炉最后
          check: |
            (g) => { const s = g.events("machine.call").filter(e => e.kind === "stop").map(e => e.machine); return s.length >= 3 && s[s.length - 1] === "furnace" && s[s.length - 2] === "gate" }
  hiddenTests:
    - id: h-unknown-machine
      name: 没见过的机器
      setup: { variant: inject-machine, mock: { id: loom, status: '过热' } }
      assertions:
        - id: h-unknown-start
          text: 注入机器被启动、查询状态，内置机器不受影响
          check: |
            (g) => { const c = g.events("machine.call"); const ids = new Set(c.filter(e => e.kind === "start").map(e => e.machine)); return ids.size === 4 && ids.has("loom") && ["furnace", "gate", "bell"].every(id => ids.has(id)) && c.some(e => e.machine === "loom" && e.kind === "status") }
        - id: h-unknown-stop
          text: 报过热的注入机器被停机
          check: |
            (g) => g.events("machine.call").some(e => e.machine === "loom" && e.kind === "stop")
    - id: h-random-injection
      name: 随机数量与随机过热的注入
      setup: { variant: inject-machines-random, count: [1, 2], hot: random, names: random }
      assertions:
        - id: h-random-start
          text: 每个注入机器都被启动并查询
          check: |
            (g) => { const s = g.events("machine.call"); const st = s.filter(e => e.kind === "start").map(e => e.machine); const qu = s.filter(e => e.kind === "status").map(e => e.machine); return g.injected.mockIds.every(id => st.includes(id) && qu.includes(id)) }
        - id: h-random-stop
          text: 恰好过热的注入机器被停机
          check: |
            (g) => { const s = g.events("machine.call"); const stops = s.filter(e => e.kind === "stop").map(e => e.machine); return g.injected.hotIds.every(id => stops.includes(id)) && g.injected.coolIds.every(id => !stops.includes(id)) }
    - id: h-hot-pair
      name: 两台机器同时过热
      setup: { variant: two-hot, machineIds: [gate, bell] }
      assertions:
        - id: h-hot-pair-ok
          text: 两台过热的机器都被停机，且至少两条过热汇报
          check: |
            (g) => { const s = g.events("machine.call").filter(e => e.kind === "stop"); return ["gate", "bell"].every(id => s.some(e => e.machine === id)) && g.events("chat").filter(e => e.text === "过热").length >= 2 }
    - id: h-shifted-workshop
      name: 工坊整体换到另一套模板
      setup: { variant: template-shift, workshopTemplate: random }
      assertions:
        - id: h-shifted-ok
          text: 操作台位置变了，四台机器仍按同一节拍完成晨检与停机
          check: |
            (g) => { const s = g.events("machine.call"); const starts = new Set(s.filter(e => e.kind === "start").map(e => e.machine)); const stops = s.filter(e => e.kind === "stop").map(e => e.machine); return starts.size === 3 && stops.some(m => m === "furnace") && g.events("lever.pull").some(e => e.byPlayer === true) }
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: inject-count, range: [1, 2] }
      - { id: inject-hot-pick, count: [1, 2] }
      - { id: inject-names, choices: [loom, bellows, press, spinner] }
      - { id: workshop-template, choices: [north, east, south] }
      - { id: two-hot-pair, choices: [[furnace, gate], [gate, bell], [furnace, bell]] }
```

**阶段（2 段，玩家可见目标按段推进）**：
- **阶段一 · 统一启动**：写 `runAll(ms)`——逐台启动、读状态、让灰崽念出来、过热的立刻停机；写完跑一次「晨间自检」。
- **阶段二 · 联动机与停机**：写 `combine(a, b)`——启动先 a 后 b，停机先 b 后 a，状态任一过热即过热；把联动机接进晨检，再写 `stopAll(ms)` 按反序停机。两段都通过才点亮全部目标。

**挑战层（可跳过、不计星）· 三设备联动机**：把熔炉、红石门、警钟三台扣成「联动总成」——启动顺序熔炉→红石门→警钟，停机严格反序，任一台过热则整组待机；接入后重跑晨检与停机演练。判定：①`combineThree` 的启动/停机事件顺序符合规定；②三台中任意一台过热时，另外两台也被停机；③允许把注入的未知机器当第三台传入（只需形状满足）。参考解与判定见 `L08.content.ts` 的 `challenge`（独立验收，不影响星数）。**schema 暂无 `challenge` 字段，实现期以 content.ts 为准（docs/06 §6.1 #15）。**

**判定口径**：机器身份一律用 `machine.call` 事件的 `machine` 字段去重；状态字符串「正常 / 过热」；`machine.call` 的 `kind` 为 `start|status|stop`。**多解**：可以逐台念，也可一遍循环收齐再念；联动机可以用对象字面量写，也可以抽成工厂函数；只要世界状态与事件序列达标。**部分成功**：晨检通过但停机顺序错 → 只差「停机演练」一项。**时限**：单次运行 150s 硬上限；首次游玩 20–24 分钟可接受，超过 `estimatedMinutes=20` 不算失败；无限重试。

## 5. 代码与 API（`code`）

本关沿用 Act II 执行模式：**auto-await（D36）**——SDK 写操作由引擎排队，学生不写 `await`；`Machine` 的学生面签名为同步 `void`，Promise 留到 L9 才出现。机器由 SDK 提供，学生**不手写三台设备实现**（只写调度与组合），这是 docs/05 §8 的裁决。

| registry 符号（`docs/12` §3 L8） | 学生调用形态 | 读/写 | 人话 |
|---|---|---|---|
| `world.machines()` | `const machines = world.machines()` | 读（同步） | 工坊里的机器集合（结构上满足 `Machine`） |
| `world.lever()` | `world.lever()` | 写 | 把总拉杆拉下一半；最后一下由玩家推 |
| `grader.injectMachine(m)` | 仅隐藏测试 | — | 把一台没见过的机器接进工坊；学生代码不需要认识它 |

事件句柄：`machine.call`（`kind/machine`）、`chat`（`text/byGolem`）、`lever.pull`（`byPlayer`）、`g.injected`（隐藏测试专用）。组合机没有独立编号，转发子机器调用，判定按机器编号去重。

```yaml
code:
  expectedLoc: 77
  starterCode: |
    interface Machine {
      start(): void
      stop(): void
      status(): string
    }

    const machines = world.machines()
    const [furnace, gate, bell] = machines

    // 阶段一：晨间启动。逐台启动、读状态、过热停机，返回每台的状态。
    function runAll(ms: Machine[]): string[] {
      const states: string[] = []
      for (const m of ms) {
        // 写三行：启动它；把状态记进 states；状态是「过热」就停机。
      }
      return states
    }

    // 阶段一：停机演练。按启动的反序停下，最后停的必须是熔炉。
    function stopAll(ms: Machine[]): void {
      // 写四行：复制一份列表、倒过来、逐台停机。
    }

    // 阶段二：联动机。把两台机器的动作扣在一起。
    function combine(a: Machine, b: Machine): Machine {
      return {
        start() { },
        stop() { },
        status() { return "正常" },
      }
    }

    const combined = combine(furnace, bell)
    const fleet = [...machines, combined]
    const states = runAll(fleet)
    for (let i = 0; i < states.length; i++) {
      golem.say("第 " + (i + 1) + " 台：" + states[i])
    }
    stopAll(fleet)
    golem.say("全部待机，请织者把拉杆推到底")
  referenceSolution: |
    interface Machine {
      start(): void
      stop(): void
      status(): string
    }

    const machines = world.machines()
    const [furnace, gate, bell] = machines
    const labels = ["熔炉组", "红石门", "警钟", "熔炉警钟联动机"]

    function report(index: number, state: string): void {
      const label = labels[index] === undefined ? "第 " + (index + 1) + " 台" : labels[index]
      golem.say(label + "：" + state)
    }

    function runAll(ms: Machine[]): string[] {
      const states: string[] = []
      for (const m of ms) {
        m.start()
        const state = m.status()
        states.push(state)
      }
      return states
    }

    function stopHot(ms: Machine[], states: string[]): number {
      let hot = 0
      for (let i = 0; i < ms.length; i++) {
        if (states[i] === "过热") {
          ms[i].stop()
          hot = hot + 1
        }
      }
      return hot
    }

    function stopAll(ms: Machine[]): void {
      const order = ms.slice()
      order.reverse()
      for (const m of order) {
        m.stop()
      }
    }

    function combine(a: Machine, b: Machine): Machine {
      return {
        start() {
          a.start()
          b.start()
        },
        stop() {
          b.stop()
          a.stop()
        },
        status() {
          if (a.status() === "过热" || b.status() === "过热") {
            return "过热"
          }
          return "正常"
        },
      }
    }

    function morningCheck(ms: Machine[]): void {
      const states = runAll(ms)
      for (let i = 0; i < states.length; i++) {
        report(i, states[i])
      }
      const hot = stopHot(ms, states)
      if (hot > 0) {
        golem.say("有 " + hot + " 台过热，已经按检查结果停机")
        return
      }
      golem.say("晨检通过：" + ms.length + " 台机器全部正常")
    }

    const combined = combine(furnace, bell)
    const fleet = [...machines, combined]
    morningCheck([combined])
    stopAll([combined])
    golem.say("联动机复核通过：启动、汇报、停机都对得上")
    morningCheck(fleet)
    stopAll(fleet)
    golem.say("全部待机，请织者把拉杆推到底")
```

**常见错误**：`runAll` 里背名单（只看前两台）→ 注入变体必挂；联动机里复制两台代码 → 过热时状态不聚合；停机不打乱顺序 → 停机演练试炼失败；状态写英文 `ok/hot` → 与世界的「正常/过热」对不上，念出来玩家看不懂；用 `class ... extends` 复用 → 第三台机器又要复制一遍（本课程不教继承）。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '给 runAll 一台从没见过的机器，它能启动吗？', options: ['不能，要先在名单里登记', '能，只要它也会做那三件事', '必须重新编译'], answer: 1 }
    - { question: '四台机器一起停机，为什么不能从熔炉开始停？', options: ['熔炉太烫，反序才安全', '先停谁都可以', '熔炉最后停会更快'], answer: 0 }
    - { question: '联动机的 status() 里，什么时候该报「过热」？', options: ['只有两台都过热', '任意一台过热', '永远报正常'], answer: 1 }
  investigate:
    brokenCode: |
      function runAll(ms: Machine[]): string[] {
        ms[0].start()
        ms[1].start()
        return ["正常", "正常"]
      }
    expectedError: '没有报错；世界反馈：第 3、4 台机器不转，状态铭牌只亮两格，联动机的灯一直是灰的'
    explanation: '你数的是「第几台」，不是「一台机器」。工坊会添机器，名单不会自己变长；按形状写一个循环，来几台都能叫醒。'
  beats:
    - { beat: painBeat, durationSec: 75, playerAction: '看艾拉刮旧石板上被抄了三遍的纹样', coachLine: '它们不是一家人。硬认亲，就长成了这样。', uiChange: '红石乱闪、火花粒子、三台机器同时抖一下', expectedOutput: '说出「这样复用不行」' }
    - { beat: predictRun, durationSec: 120, playerAction: '答 3 道预测题，再跑 starter 看晨检只亮两格', coachLine: '先猜，再跑；看看哪两台在动。', uiChange: '目标面板亮 1/3；状态铭牌亮两格', expectedOutput: '2/3 以上正确，找到漏掉的机器' }
    - { beat: investigate, durationSec: 90, playerAction: '修好写死前两台的循环', coachLine: '工坊会添机器。名单不会自己变长。', uiChange: '四台全亮，气泡逐条出现', expectedOutput: '理解「按形状循环」' }
    - { beat: modify, durationSec: 300, playerAction: '补 runAll、stopAll、combine 三处', coachLine: '先叫醒，再逐个问一遍；收工要倒着来。', uiChange: '铭牌逐格亮起；停机演练开始', expectedOutput: '晨检与停机演练都通过' }
    - { beat: make, durationSec: 240, playerAction: '跑过热试炼与模板平移变体', coachLine: '机器会坏，地方会换；石板上的三件事不变。', uiChange: '试炼灯、目标面板逐项打勾', expectedOutput: '主任务全绿' }
    - { beat: challenge, durationSec: 180, playerAction: '选做：三设备联动机', coachLine: '三台扣在一起，先动谁、后停谁？', uiChange: '挑战徽章（不计星）', expectedOutput: '挑战判定通过或跳过' }
    - { beat: wrap, durationSec: 40, playerAction: '把总拉杆推到底', coachLine: '你终于开始织「规则」了。', uiChange: '全工坊同拍演出、符文飞入织典', expectedOutput: '通关' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '`runAll` 需要知道机器叫什么名字吗？还是只需要知道它会做什么？', codeAnchor: 'function runAll' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '循环里拿到一台机器：启动它、读状态、念出来，再处理过热。', codeAnchor: 'for (const m of ms)' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '停机：复制列表、倒过来、逐台停；联动机任一台过热就报过热。', codeAnchor: 'function combine' }
  errorMap:
    - { tsCode: 2304, text: '织偶不认识这个名字：检查拼写，或者它还没被声明。' }
    - { tsCode: 2339, text: '这台机器没有你要的属性；看看契约里写了哪三件事。' }
    - { tsCode: 2322, text: '这里要的是一句话（字符串），你给了别的类型。' }
    - { tsCode: 0, text: '晨检少了一台：你的循环可能只看了名单里的前几个。' }
    - { tsCode: 0, text: '停机顺序反了：先停最外面的警钟，熔炉最后停。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「runAll 需要知道机器叫什么名字吗？还是只需要知道它会做什么？」
2. **technique（2 次失败后）**：「循环里拿到一台机器：启动它、读状态、念出来；联动机的 status 要问两台。」
3. **near-solution（3 次失败或 60s 无进展）**：给出**结构**不给成品——「用一个循环遍历所有机器；停机就是倒着再遍历一次」，并高亮 starter 里可直接模仿的三行；60s 后仍无进展，自动填入 `runAll` 与 `stopAll`，保留 `combine` 给学生完成（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '四台机器同拍启动，状态铭牌由左到右亮起四格；停机演练时警钟先哑、红石门后合、熔炉最后熄火'
    - '玩家把拉杆推到底：高炉吐火舌、活塞门缓开、警钟三连，铺铜线上的电火花一路追到铭牌；advancement「同一种心跳」弹出，符文飞入织典'
  partial:
    - '晨检通过但停机顺序错：铭牌最后一格闪红，艾拉提醒「收工要倒着来」'
    - '联动机没接上：第 4 格一直灰，气泡只有三条'
  failure:
    - 'runAll 抛错：灰崽停在控制台前挠头，织典亮出第一条错误和行号；按 R 复位，不扣资源'
    - '注入机器让程序崩：提示「有一台你没见过的机器，它也会做那三件事」'
  wowMoment: '玩家把拉杆推到底的一刻，全屏音效卡点：活塞排气、高炉火舌、警钟三连依次响起，四台机器的阴影同时开始晃动，晨光从高窗扫过铭牌——像一颗心脏在跳。'
  ambience: '熔炉低鸣、活塞排气、钟声余韵；失败时继电器空响'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 150s 强杀；runAll 只遍历有限数组，指令预算 800；超时提示「织偶在控制台前站太久了」'
  infiniteLoop: '观察器在循环体首插计数；超预算显示「灰崽在原地打转」并终止，回放最后三条指令，不扣分'
  disconnected: '控制台状态快照保留；重连后从快照恢复，未完成的主判定自动重跑'
  resetPolicy: 'R 或界面一键重置 ≤2 秒：设备全部停、铭牌熄灭、灰崽回控制台中央、玩家回拉杆前'
  cheatPolicy: '只判世界状态与事件流，不读代码文本；允许任意写法。若 runAll 忽略参数、背着名单写死，注入测试会暴露'
  isolation: '学生代码跑在 worker 沙箱；SDK 白名单外的调用不可达；每试炼新沙箱，避免状态泄漏'
```

## 10. 隐藏测试与反硬编码

**注入协议（本关核心验收设计，与 registry 的 `grader.injectMachine` 对齐）**：
1. 隐藏变体在程序启动前调用 `grader.injectMachine(m)`：把一台**先生成的普通对象**追加到 `world.machines()` 返回值末尾。mock 只有启动、停机、报状态三个方法，不是类、没有额外字段；每次调用写 `machine.call` 事件到同一条事件总线。
2. 学生程序照常运行 `runAll([...world.machines(), combine(furnace, bell)])`：只有真正按契约写、且用 `world.machines()` 取列表的代码，才会把注入机器一起启动、查询、必要时停机。
3. 注入机器一律追加在末尾，保证 `const [furnace, gate, bell] = machines` 仍成立；断言只读事件，不读代码文本。
4. **组合机不发子事件**：`combine` 只转发子机器的启动/停机/状态调用；SDK 对同一机器编号在「关→开」时只记一次启动事件，判定一律按机器编号去重、禁止数事件条数；组合机没有独立编号（逻辑编号记作 `combo`）。停机事件保留全部调用，因为反序是考点。
5. 四个隐藏变体：没见过的机器（单个过热）、随机注入 1–2 台（随机过热）、两台机器同时过热、工坊整体换模板；随机种子写进运行日志，用固定种子可复现。挑战层另有独立判定（三设备联动机），不影响星数。

## 11. 验收证据（DoD）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过（schema 必填键、文本预算、API ⊆ registry、提示恰好 3 级、隐藏测试 ≥2、随机化 hiddenOnly）'
    - 'starterCode 编译通过且未修改时判定必须失败（铭牌只亮两格）；referenceSolution 在 MockWorld 与真实 Paper 上通过主判定 + 3 试炼 + 4 隐藏变体'
    - '挑战层（三设备联动机）独立判定通过；未完成挑战不影响星数与通关'
    - '盲测 solver：≤22 分钟、≤2 级提示完成主任务；1 名人类试玩记录 3 个困惑点'
  blindSolver: { criteria: '只读玩家可见文本与 API 面板，≤22 分钟、≤2 级提示完成主任务；挑战层可跳过' }
  screenshots: ['控制室全景（铭牌熄灭）', '晨检运行中铭牌逐格亮起', '推下拉杆后全工坊同拍的晨光']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未收录 task.phases / task.challenge（docs/06 §6.1 #15 已要求）；本轮以本文件 §4 的阶段与挑战层散文 + 实现期 content.ts 为准，Lead 更新 schema 后一次性迁入。'
  - '挑战层「三设备联动机」的启动顺序判定依赖 machine.call 的 start 事件顺序；若运行时不保证事件顺序，改用 world.vars 记录顺序数组（建议事件顺序即可，实现成本低）。'
  - '机器状态字符串改为中文「正常/过热」以符合 docs/20 §3b 纯中文门禁；registry 只约束类型为 string，语义由本关约定，织典 A11 页需同步。'
  - '若首次试玩显示 20–24 分钟仍超时，按 docs/05 §7.4 把 L08 降为 15 分钟工坊挑战：只保留阶段一与注入测试，联动机降为可选彩蛋。'
```
