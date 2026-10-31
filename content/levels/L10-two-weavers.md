# L10 — 双织者（The Two Weavers）

> 状态：v2（T2 扩体量：阶段 2 + 挑战层 + 三句开场 + 双织偶并发）｜负责人：smith-act3｜最后更新：2026-10-31
> 上游：`docs/05-curriculum.md` §8 L10（任务骨，不得改）、`docs/06-level-spec-system.md`（12 章格式与门禁）、`docs/12-sdk-api-registry.md`（API 唯一权威）、`docs/02c`（finale spike 参数）、`docs/20` §3b/§3b2/§3c、`docs/23`、`docs/25`
> 下游：`content/levels/L10.level.ts`（实现）、`packages/grader`（L10 判定）、Codex 页 A13
> 体量自检：参考解有效行 **67**｜starter 有效行 **17**｜行差 **50**｜阶段 **2**｜挑战 **1**（更紧预算 + 禁用「完工」消息）｜隐藏变体 **4**｜`runMode` **explicit（显式 await）**｜**多 agent（两只织偶同时在线，消息通信）**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。`task.phases` / `task.challenge` 为 docs/06 §6.1 #15 新增字段，schema 尚未收录，实现期以 `L10.content.ts` 为准（与 L02/L04 同口径）。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L10
  title: { zh: 双织者, en: The Two Weavers }
  act: 3
  order: 10
  priority: P2
  prerequisites: [L09]
  estimatedMinutes: 24
  difficulty: 5
  abstractions: [A13]
  objectives:
    - { id: o-protocol, learnerView: 用消息约定两只织偶谁先动、谁后动, evidence: 随机延迟与随机预算的隐藏变体都能无死锁完成 }
    - { id: o-budget, learnerView: 把共享材料按约定分给两个执行者，一块不超、一块不丢, evidence: 桥面无缺口、材料箱归零、放置数等于预算 }
    - { id: o-deadlock, learnerView: 能解释「先发后等」为什么能避免死锁, evidence: 修好死锁坏代码，预测题 2/2 }
  misconceptions: [wait-before-send, take-ceil-for-both, keystone-can-preplace, message-order-free, more-agents-means-faster]
  apiIntroduced: [agent, agent.send, agent.receive, world.supply]
  apiAllowlist: [ALL_PRIOR, agent, agent.pos, agent.send, agent.receive, world.supply, 'agent.tryReceive (kind: extension)', 'agent.waitIdle (kind: extension)', 'world.keystone (kind: extension)']
  syntaxIntroduced: [多 agent, 消息收发, Promise.all 复用]
  reward: { rune: A13, advancement: loomcraft/act3/two_weavers, codexPage: A13 }
  languageLevel: act3
```

## 1. 学习目标（学习者视角）

1. **并发不是更快，是更难（A13）**：两个执行者同时改世界，先协调再谈速度。证据：随机延迟变体下无死锁。
2. **消息是显式的**：`agent.send` 说一句，`agent.receive` 等一句；顺序写反就会卡死。证据：修好死锁坏代码，两只织偶恢复对话。
3. **共享资源要预分配**：材料箱里只有缺口那么多块，动手前先约定各取多少。证据：放置数等于初始材料数、材料箱归零、桥面无缝。
**不教**：线程、锁、信号量、死锁恢复算法（只教「先发后等」一条协议直觉）。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '断裂峡谷。对岸的大织机沉默着，最后一幅「合龙纹」要从两岸同时织起。艾拉把最后两枚织机碎片按在两只织偶的胸口：「一只织偶来不及；两只，得先学会说话。」'
  stakes: '天亮前桥必须合龙，六名村民要过桥回家；散线已经爬到大织机的底座，再拖一夜，它就再也转不起来。'
  painBeat: '先跑单织偶版：灰崽从左岸一路铺到一半，回程要绕整条峡谷，日出倒计时归零，桥断在中间。再跑「两只但不会说话」版：两只织偶同时停在原地等对方开口，头顶各浮出一个「…」，织线日志停在「左织 等待 右织 / 右织 等待 左织」，时间冻结，天光变紫。艾拉合上石板：「它们不是不听话。是没人先开口。」'
  resolution: '你把「先发后等」的握手写进两只织偶的符文里：各自先报份额，再取料、再铺；铺完互相报数，最后一块合龙石留给你。桥从两岸同时长向中间，只剩一格缺口时，你放上合龙石，整座桥亮到对岸。'
  coachTone: '温和、具体；把并发讲成「说话 / 等回话 / 谁先开口」，不出现线程、锁、协议这类行话；失败时先指出「谁在等谁」，再给一步。'
```

**三句开场（docs/25 §3，进入关卡时逐句出现）**：
1. **世界状态**：「峡谷把村子和大织机隔成两半，散线已经爬到织机底座；对岸的灯一盏也没亮，桥面断在中间，只剩两岸各一截旧织纹。」
2. **任务**：「让两只织偶从两岸同时补上缺口：先约定各自取几块、从哪头开始铺，再把桥面铺到只剩中间一格。」
3. **为什么是你**：「最后一块合龙石只有活人的手能放；织偶能替你铺桥，替不了你把这座桥「合上」。」

## 3. 世界与场景（`world`）

桥沿 x 轴、y=64；插件已预铺约八成桥面，缺口连续 4–6 列、固定从 x=10 开始；缺口块数 = `gap − 1` = 材料箱总量，两只织偶各取一半（左取 ceil、右取 floor）；合龙石位在缺口正中，只由玩家右键放置（测试模式用 `world.keystone` 等价）。桥推荐 3 宽（两侧护栏已预铺），1 宽为降级方案；bot 只补中心列，掉落风险与材料量不随宽度翻倍。双 agent 必须同时在线：两只各有一个真实沙箱，消息只走各自邮箱。

```yaml
world:
  anchor: { kind: ravine, id: split_ravine }
  dimension: overworld
  time: 12000
  weather: clear
  region: { center: [0, 64, 0], radius: 64 }
  vars: { deck: 0, gap: 0, bridgeWidth: 3, materialsLeft: 0, deadlock: false, durationSec: 0, testMode: false, complete: false }
  entities:
    - { type: agent, role: agent, name: 左织, count: 1 }
    - { type: agent, role: agent, name: 右织, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
    - { type: villager, role: npc, count: 6 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: ravine, id: split_ravine }
        - { op: buildProps, builder: brokenBridge, params: { deck: '$random.deck', gap: '$random.gap', width: '$random.bridgeWidth', y: 64, keystone: lodestone } }
        - { op: spawnAgent, id: golem, name: 左织, look: automaton, at: '$bridge.leftBank' }
        - { op: spawnAgent, id: golem2, name: 右织, look: automaton, at: '$bridge.rightBank' }
        - { op: bossbar, id: dawn, title: '日出前的最后一段时间', color: red, progress: 1 }
        - { op: objective, items: ['两只织偶各补一半缺口', '桥面无缝、不丢块', '由你放下合龙石'] }
    - phase: climax
      steps:
        - { op: freezeInput, value: true }
        - { op: particle, type: end_rod, at: '$bridge.deck', count: 120 }
        - { op: sound, id: block.bell.use, volume: 1 }
        - { op: title, text: '桥合了', subtitle: '两只织偶，一条心' }
        - { op: advancement, id: loomcraft/act3/two_weavers }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['两岸护栏', '合龙石基座', '对岸大织机']
```

**专用界面（解决双织偶调试难，D31）**：织线日志常驻右侧（每条消息与等待都记时间）；所有执行者都在等且 5 秒无新消息 → 头顶「…」、倒计时条变紫「织线缠住了」；运行超时按原因码给一句话（`deadlock` / `over-take` / `starved`）。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '两只织偶分工补桥：先互报份额、各取一半材料，再从两岸同时铺到中间；桥面只剩一格时，由你放合龙石。'
  makeTask: '桥变宽或缺口变长时协议不改：只让份额与铺法跟着缺口走，两只织偶仍各说一句完工再交给你。'
  playerBeat: '桥面只剩中央一格时，你手持合龙石右键中央基座；放下后触发合龙演出与村民过桥。'
  timeLimitSec: 150
  successCriteria:
    - id: deck-full
      text: 全桥面（预铺 + 织偶补 + 合龙石）没有缺口
      check: |
        (g) => { const d = g.var("deck"), gap = g.var("gap"), w = g.var("bridgeWidth");
          const ks = 10 + Math.ceil((gap - 1) / 2), zs = w === 3 ? [-1, 0, 1] : [0];
          for (const z of zs) for (let x = 0; x < d; x++) {
            const b = g.block([x, 64, z]).id;
            if (z === 0 && x === ks) { if (b !== "minecraft:lodestone") return false; }
            else if (b !== "minecraft:oak_planks") return false;
          }
          return true; }
    - id: materials-exact
      text: 织偶放置数等于材料箱初始数（缺口块全部用完、一块不丢）
      check: |
        (g) => { const gap = g.var("gap"), ev = g.events("block.place").filter(e => e.block === "minecraft:oak_planks" && e.actorType === "agent");
          const l = ev.filter(e => e.actor === "左织").length, r = ev.filter(e => e.actor === "右织").length;
          return ev.length === gap - 1 && g.var("materialsLeft") === 0 && l === Math.ceil((gap - 1) / 2) && r === Math.floor((gap - 1) / 2); }
    - id: no-deadlock
      text: 没有死锁，且在 60 秒内完成
      check: |
        (g) => g.var("deadlock") === false && g.var("durationSec") <= 60
    - id: keystone-placed
      text: 合龙石落位（玩家右键，或测试模式下等价落位）
      check: |
        (g) => g.events("block.place").some(e => e.block === "minecraft:lodestone" && (e.byPlayer || g.var("testMode")))
  hiddenTests:
    - id: h-random
      name: 随机缺口与慢右织
      setup: { deck: '$random:24-32', gap: '$random:4-6', bridgeWidth: 3, rightDelayTicks: '$random:0-60' }
      assertions:
        - id: h-random-ok
          text: 缺口随机、右织晚到时仍无死锁且桥面完整
          check: |
            (g) => g.var("complete") && !g.var("deadlock") && g.var("gap") >= 4 && g.var("gap") <= 6
    - id: h-tight-budget
      name: 最紧预算（缺口 4、单宽桥）
      setup: { deck: 24, gap: 4, bridgeWidth: 1, rightDelayTicks: 0 }
      assertions:
        - id: h-tight-ok
          text: 3 块材料刚好用完、桥面无缝、合龙石落位
          check: |
            (g) => g.var("complete") && g.var("materialsLeft") === 0 && g.events("block.place").filter(e => e.block === "minecraft:oak_planks" && e.actorType === "agent").length === g.var("gap") - 1 && g.events("block.place").some(e => e.block === "minecraft:lodestone")
    - id: h-slow-right
      name: 右织慢到 90 tick
      setup: { deck: 28, gap: 6, bridgeWidth: 3, rightDelayTicks: 90 }
      assertions:
        - id: h-slow-ok
          text: 一方晚到也不抢跑、不饿死对方
          check: |
            (g) => g.var("complete") && !g.var("deadlock") && g.var("materialsLeft") === 0
    - id: h-wide-bridge
      name: 三宽桥与更长缺口
      setup: { deck: 32, gap: 6, bridgeWidth: 3, rightDelayTicks: 30 }
      assertions:
        - id: h-wide-ok
          text: 宽度与缺口都变了，协议不改仍能合龙
          check: |
            (g) => g.var("complete") && g.var("bridgeWidth") === 3 && g.var("gap") === 6
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: deck, range: [24, 32] }
      - { id: gap, range: [4, 6] }
      - { id: bridge-width, choices: [1, 3] }
      - { id: right-delay-ticks, range: [0, 120] }
```

**阶段（2 段，玩家可见目标按段推进）**：
- **阶段一 · 单织偶失败**：先跑单织偶版（starter），看它铺到一半被峡谷逼回来、倒计时归零；再看「两只但谁都不先开口」的死锁演出——两只头顶同时冒出「…」，日志停住。这一段的产出是：说出「必须有人先开口」。
- **阶段二 · 双织偶协议**：用消息约定份额与顺序。通过标准：份额谈妥、材料箱归零、桥面无缝、60 秒内完成、没有死锁；最后由玩家放合龙石。

**挑战层（可跳过、不计星）· 更紧预算 + 禁用「完工」消息**：缺口缩到 4（只有 3 块材料），两只织偶仍要各取一半、一块不丢；并且**禁止发送文字里含「完工」的消息**——完成确认必须改成「各报自己铺了几块，再互相核对总数」的数字汇合。判定：①桥面无缝、材料箱归零、放置数 = 3；②消息日志里没有任何含「完工」的消息；③存在两条数字汇总消息且数字相加等于缺口块数；④无死锁、60 秒内完成。参考解与判定见 `L10.content.ts` 的 `challenge`（独立验收，不影响星数）。**schema 暂无 `challenge` 字段，实现期以 content.ts 为准（docs/06 §6.1 #15）。**

**判定口径**：只读世界快照、事件流（`block.place` 带 `actorType`/`actor`）与运行变量（`deadlock`/`durationSec`/`materialsLeft`/`complete`）；消息内容用运行日志的 `messageTexts` 句柄。**多解**：谁先发、份额怎么算（写死 ceil/floor 或按缺口算）、消息文案都可以不同，只要状态与日志达标。**部分成功**：桥铺满但材料多放/少放 → 只差「材料恰好」一项。**时限**：`timeLimitSec: 150`（正常 30–50s + 演出）；首次游玩 24–28 分钟可接受，超过 `estimatedMinutes=24` 不算失败；无限重试。

## 5. 代码与 API（`code`）

**执行模式：`runMode: explicit`**（L9 起关闭 auto-await，必须显式 `await`）；**多 agent 要求**：两只织偶各有一个真实沙箱与邮箱，消息只经 `agent.send` / `agent.receive`（方向见 D29：发到对方邮箱，收方读自己的邮箱）；`Promise.all` 让两岸同时开工。

| registry 符号（`docs/12` §3 L10） | 签名 | 读/写 | 人话 |
|---|---|---|---|
| `agent(name)` | `(name: "左织" \| "右织") => Agent` | 创建 | 取得另一只织偶（继承织偶的动词） |
| `agent.send(msg)` | `(msg: string) => Promise<void>` | 写 | 发一条消息到**该 agent** 的邮箱 |
| `agent.receive(timeoutSec?)` | `(sec?) => Promise<Msg>` | 写 | 等自己邮箱里的下一条；超时失败 |
| `world.supply(pos)` | `(pos: Vec3) => Container` | 读（同步） | 材料箱只读快照（用 `.count(...)` 数块） |
| `agent.collect(item, pos)` | `(item, pos) => Promise<number>` | 写 | 从材料箱取料（本关每次 1 块） |
| `world.keystone()` | `() => Promise<void>` | 写 | 放合龙石：正式流程唤起玩家右键，测试模式直接落位 |
| `agent.tryReceive()` / `agent.waitIdle(name)` | — | — | 扩展：不等待地看一眼邮箱 / 结算前等世界安静 |

```yaml
code:
  expectedLoc: 67
  starterCode: |
    const 材料箱 = { x: -2, y: 64, z: 0 }
    const 缺口起点 = 10
    const 木板 = "minecraft:oak_planks"
    const 材料总数 = world.supply(材料箱).count(木板)

    // 阶段一：单织偶版。先跑一次，看天亮与断桥。
    async function 单织偶铺桥(): Promise<void> {
      for (let i = 0; i < 材料总数; i++) {
        const x = 缺口起点 + i
        await golem.moveTo(x, 0)
        const 取到 = await golem.collect(木板, 材料箱)
        if (取到 !== 1) {
          break
        }
        await golem.place(木板, x, 64, 0)
      }
      await golem.say("铺完了")
    }

    await 单织偶铺桥()

    // 阶段二：两只织偶。先用 agent("左织") / agent("右织") 取得两只，
    // 再各写一个 async 函数：先发份额、再收对方的话、各取一半、从两岸铺到中间。
    // 最后 await Promise.all([...]) 让两岸真正同时开工。
  referenceSolution: |
    const left = agent("左织")
    const right = agent("右织")
    const 材料箱 = { x: -2, y: 64, z: 0 }
    const 缺口起点 = 10
    const 木板 = "minecraft:oak_planks"
    const 材料总数 = world.supply(材料箱).count(木板)
    const 左份额 = Math.ceil(材料总数 / 2)
    const 右份额 = 材料总数 - 左份额

    async function 左取料(块数: number): Promise<void> {
      for (let i = 0; i < 块数; i++) {
        const 取到 = await left.collect(木板, 材料箱)
        if (取到 !== 1) {
          throw new Error("材料箱提前空了")
        }
      }
    }

    async function 右取料(块数: number): Promise<void> {
      for (let i = 0; i < 块数; i++) {
        const 取到 = await right.collect(木板, 材料箱)
        if (取到 !== 1) {
          throw new Error("材料箱提前空了")
        }
      }
    }

    async function 左铺桥(块数: number): Promise<void> {
      for (let i = 0; i < 块数; i++) {
        const x = 缺口起点 + i
        await left.moveTo(x, 0)
        await left.place(木板, x, 64, 0)
      }
      await left.say("左岸铺好了")
    }

    async function 右铺桥(块数: number): Promise<void> {
      for (let i = 0; i < 块数; i++) {
        const x = 缺口起点 + 左份额 + 1 + i
        await right.moveTo(x, 0)
        await right.place(木板, x, 64, 0)
      }
      await right.say("右岸铺好了")
    }

    async function 左织开工(): Promise<void> {
      await right.send("我取 " + 左份额 + " 块，从缺口这头往中间铺")
      const 回话 = await left.receive()
      if (Number(回话.text) !== 右份额) {
        throw new Error("右岸的份额对不上")
      }
      await 左取料(左份额)
      await 左铺桥(左份额)
      await right.send("左岸完成 " + 左份额 + " 块")
      await left.receive()
    }

    async function 右织开工(): Promise<void> {
      await left.send("我取 " + 右份额 + " 块，从另一头往中间铺")
      const 回话 = await right.receive()
      if (Number(回话.text) !== 左份额) {
        throw new Error("左岸的份额对不上")
      }
      await 右取料(右份额)
      await 右铺桥(右份额)
      await left.send("右岸完成 " + 右份额 + " 块")
      await right.receive()
    }

    await Promise.all([左织开工(), 右织开工()])
    await agent.waitIdle("左织")
    await agent.waitIdle("右织")
    await left.say("桥面铺好了，最后一块交给织者")
    await world.keystone()
```

**常见错误**：两边都先 `receive` → 5 秒后死锁（「先开口要写在等之前」）；两边都不谈份额、直接抢材料 → 一侧饿死、桥留缺口；右织从 0 铺 → 与左织撞车；提前放合龙石 → 基座锁定；用 `agents` 复数 → TS 2304；把 `agent.send` 当成广播 → 对方收不到。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '两只织偶都先 receive、谁也没 send，会发生什么？', options: ['报错停止', '一直等下去', '自动协商'], answer: 1 }
    - { question: '缺口 5 块，两只都按 Math.ceil(5/2)=3 取，合起来是多少？', options: ['5', '6', '4'], answer: 1 }
    - { question: '为什么最后一块合龙石必须由活人来放？', options: ['因为更重', '因为只有织者之印能合上最后一格', '因为织偶不会放方块'], answer: 1 }
  investigate:
    brokenCode: |
      const left = agent("左织")
      const right = agent("右织")
      await left.receive()
      await right.receive()
      await left.say("右岸呢？")
    expectedError: '没有语法报错；运行 5 秒后进入死锁：两只头顶同时冒出「…」，日志停在两条等待，倒计时条变紫'
    explanation: '两边都在等对方先开口，而「开口」排在等待后面，永远执行不到。把 send 移到 receive 之前，握手就有第一步。'
  beats:
    - { beat: painBeat, durationSec: 90, playerAction: '先看单织偶失败，再看两只互相干等', coachLine: '一只来不及；两只不会说话，就一起卡住。', uiChange: '倒计时归零；第二次头顶「…」、日志停住、条变紫', expectedOutput: '说出「必须有人先开口」' }
    - { beat: predictRun, durationSec: 110, playerAction: '答 3 道预测题，跑 starter 看单织偶失败', coachLine: '先猜，再跑；看看桥断在哪。', uiChange: '桥面只补一半，目标面板 1/4', expectedOutput: '2/3 以上正确，找到断点' }
    - { beat: investigate, durationSec: 90, playerAction: '修死锁坏代码：把 send 移到 receive 前', coachLine: '先发，再等。握手就这两步。', uiChange: '日志出现份额往返，死锁提示消失', expectedOutput: '死锁解除' }
    - { beat: modify, durationSec: 300, playerAction: '补取料、铺桥两个循环与两岸 async 函数', coachLine: '各取一半，从两岸往中间铺。', uiChange: '桥面从两岸同时增长，材料箱数字递减', expectedOutput: '桥面只剩中央一格' }
    - { beat: make, durationSec: 180, playerAction: '跑慢右织与宽桥变体', coachLine: '预算变了，协议不变。', uiChange: '变体重载，目标面板逐项打勾', expectedOutput: '三个隐藏变体都稳' }
    - { beat: challenge, durationSec: 180, playerAction: '选做：更紧预算、禁用「完工」消息', coachLine: '只剩三块料，连一句「完工」都不许说。', uiChange: '挑战徽章（不计星）', expectedOutput: '挑战判定通过或跳过' }
    - { beat: wrap, durationSec: 50, playerAction: '放合龙石', coachLine: '最后一块，得由织者放。', uiChange: '全屏合龙演出、村民过桥、advancement', expectedOutput: '通关' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '日志最后一行说谁在等谁？两只织偶各自在等谁开口？', codeAnchor: 'left.receive()' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '协议只有两步：先发，再等；谁先发都行，不能先等。', codeAnchor: 'right.send(' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '先报份额再碰箱子；取料和铺桥各写一个循环，最后用 `Promise.all` 一起等。', codeAnchor: 'Promise.all' }
  errorMap:
    - { tsCode: 2304, text: '织偶不认识这个名字：检查拼写——是 `agent`，不是 `agents`。' }
    - { tsCode: 2339, text: '这只织偶没有你要的方法；先看右侧的可用动作。' }
    - { tsCode: 2322, text: '这里要的是一句话，你给了别的类型。' }
    - { tsCode: 0, text: '死锁：两边都在等对方先开口；把发消息挪到等消息前面。' }
    - { tsCode: 0, text: '材料不够：先谈好各取几块，再碰材料箱。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「日志最后一行说谁在等谁？两只织偶各自在等谁开口？」
2. **technique（2 次失败后）**：「协议只有两步：先发，再等。谁先发都行，但不能先等。」并高亮两条 `receive` 的相对位置。
3. **near-solution（3 次失败或 120s 无进展）**：给出**结构**不给成品——「两边都先 send 份额、再 receive 确认；取料一个循环、铺桥一个循环，最后 `Promise.all`」；60s 后仍无进展，自动补上两条握手 `send`，保留取料与铺桥循环给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '合龙石落位后桥面从中央向两岸逐格亮起，对岸大织机亮灯，村民跑过桥；advancement「双织之符」弹出，符文飞入织典'
    - '两只织偶头顶各冒出一句完工台词，织线日志最后一行是两条数字汇总'
  partial:
    - '材料用超：倒计时条转橙，提示「布料不够了，回去对账」'
    - '一只织偶没动过：目标面板只亮四分之三'
  failure:
    - '死锁：头顶「…」、日志高亮最后两条、「两边都在等对方先开口」'
    - '超时：强杀运行，诊断条给原因，按 R 重置；不扣资源'
  wowMoment: '玩家右键放下合龙石的一刻，整座桥从中央向两岸爆出 end_rod 粒子，对岸大织机轰然亮起，散线像退潮一样沿峡壁褪去；太阳跳出地平线，六名村民排成一列跑过桥、每人头顶冒一颗 totem_of_undying 绿光；音效叠加 block.bell.use 与 entity.player.levelup，全屏 title「桥合了」。'
  ambience: '峡谷风声、织线绷紧的细响、消息提示音；失败时只剩风声与心跳'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '单次运行 150s 强杀；终止前 5 秒 actionbar 倒计时；超时先停两只织偶再复位桥面'
  infiniteLoop: '每只织偶指令数上限 3000；超过抛「织偶跑太久了」并交给提示梯'
  disconnected: '任一织偶断开即暂停，显示重连中；恢复后恢复快照并重放最后 3 条消息'
  resetPolicy: '一键重置 ≤2 秒：先传送两只织偶回岸、再清缺口修桥（顺序反了会掉下去）；材料箱回满、日志清空；无限重试'
  cheatPolicy: '允许任意协议写法；禁止绕过 SDK 直接改方块；材料箱只有缺口块（gap−1），先取者多得——这是关卡机制，不是缺陷'
  isolation: '每只织偶独立沙箱；消息只经各自邮箱；判定只读世界快照与事件流'
```

**超时诊断（事件流 → 原因码 → 一句人话）**：`deadlock` = 全活跃织偶都在等消息且 5 秒无新消息 →「先发再等：两边都在等对方开口。」；`over-take` = 材料箱空但桥未满且两侧取料不等 →「一边向上取整，另一边要向下取整。」；`starved` = 一侧结束但桥缺格 →「右织还没铺完，它取到料了吗？」；其余 →「慢一点没关系，先检查两条铺桥循环。」

## 10. 隐藏测试与反硬编码

随机缺口 4–6、桥宽 1/3、右织延迟 0–120 tick 让写死坐标与份额的解失败；starter 未修改必须稳定复现「单织偶失败 + 半桥」，死锁坏代码必须稳定复现死锁（教学资产）。四个隐藏变体：①随机缺口与慢右织；②最紧预算（缺口 4、单宽桥，3 块刚好）；③右织慢到 90 tick；④三宽桥与更长缺口。判定只读世界快照、事件流（含 `actorType`）与运行变量；随机种子记日志可复现。挑战层另有独立判定（紧预算 + 禁用「完工」消息），不影响星数。

## 11. 验收证据（DoD）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过（schema 必填键、文本预算、API ⊆ registry、提示恰好 3 级、隐藏测试 ≥2、随机化 hiddenOnly）'
    - '未修改 starter 连续运行多次均复现「单织偶失败 + 半桥」；死锁坏代码稳定复现死锁；referenceSolution 在缺口 4/5/6 与桥宽 1/3 下均 60 秒内完成'
    - '四个隐藏变体全过并记录随机种子；挑战层（紧预算 + 禁用「完工」消息）独立判定通过'
    - '盲测 solver ≤26 分钟、≤2 级提示完成主任务；两只织偶同时在线（多 agent）验收日志留存'
  blindSolver: { criteria: '只读玩家可见文本与 API 面板，≤26 分钟、≤2 级提示完成主任务；首玩 24–28 分钟属正常；挑战层可跳过' }
  screenshots: ['开场断裂峡谷与两只织偶', '织线日志与头顶「…」死锁', '合龙石落位全屏演出与村民过桥']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未收录 task.phases / task.challenge（docs/06 §6.1 #15 已要求）；本轮以本文件 §4 的阶段与挑战层散文 + 实现期 content.ts 为准，Lead 更新 schema 后一次性迁入。'
  - '消息日志 / 死锁检测是 D31 的 P2 硬依赖；若 Day3 12:00 未开工，按 docs/05 §7.4 降级为 L9 彩蛋 + Lab-C（预录）。'
  - '两 bot 真并行 place 尚未在 runner 层验证（docs/02c 是串行调用）；Day-2 在 runner 层补测，失败则保留 3 宽、降低 bot 同时铺的格数。'
  - '挑战层「禁用完工消息」的判定需要运行日志暴露 messageTexts 句柄；若尚未实现，退化为「消息数量与数字汇总」的结构检查并写进挑战说明。'
```
