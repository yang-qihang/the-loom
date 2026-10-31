# L09 — 破晓之前（Before Dawn）

> 状态：v2（T2 扩体量：阶段 2 + 挑战层 + 三句开场 + 显式并发）｜负责人：smith-act3｜最后更新：2026-10-31
> 上游：`docs/05-curriculum.md` §8 L9（任务骨，不得改）、`docs/06-level-spec-system.md`（12 章格式与门禁）、`docs/12-sdk-api-registry.md`（API 唯一权威）、`docs/20` §3b/§3b2/§3c、`docs/23`、`docs/25`
> 下游：`content/levels/L09.level.ts`（实现）、`packages/grader`（L9 判定）、Codex 页 A12
> 体量自检：参考解有效行 **64**｜starter 有效行 **26**｜行差 **38**｜阶段 **2**｜挑战 **1**（三坛并行、不许用 try/catch）｜隐藏变体 **4**｜`runMode` **explicit（L9 起关闭 auto-await，学生必须自己写 await）**
> 机器块：按 schema 顶层键分散为 YAML 块（§0/§2/§3/§4/§5/§6/§8/§9/§11/§12），validator 合并后即完整 spec 对象。`task.phases` / `task.challenge` 为 docs/06 §6.1 #15 新增字段，schema 尚未收录，实现期以 `L09.content.ts` 为准（与 L02/L04 同口径）。

---

## 0. 元信息（`meta`）

```yaml
meta:
  id: L09
  title: { zh: 破晓之前, en: Before Dawn }
  act: 3
  order: 9
  priority: P1
  prerequisites: [L08]
  estimatedMinutes: 22
  difficulty: 5
  abstractions: [A12]
  objectives:
    - { id: o-await, learnerView: 等待不再堵住程序：await 只让这一条线在这里等, evidence: 两坛酿造并行 20 秒完成，程序在黎明前结束 }
    - { id: o-promise-value, learnerView: Promise 是「正在进行、还没好的事」，可以先拿在手里, evidence: 未 await 的 brewing / curing 在别的任务完成后才结算 }
    - { id: o-error, learnerView: 缺材料不是崩溃，是走另一条路, evidence: 隐藏变体缺一种或两种材料时换备方完成，不抛未捕获错误 }
  misconceptions: [async-is-faster, await-blocks-world, promise-all-is-sequential, forget-await, catch-swallows-bug]
  apiIntroduced: [world.clock, world.startBrewing, golem.treatZombieVillager, golem.ringDawnBell]
  apiAllowlist: [ALL_PRIOR, world.clock, world.startBrewing, golem.treatZombieVillager, golem.ringDawnBell, "world.hasItem (kind: extension)", 'potion.splash (kind: harness)', 'entity.cured (kind: harness)']
  syntaxIntroduced: [async, await, Promise, Promise.all, try/catch]
  reward: { rune: A12, advancement: loomcraft/act3/before_dawn, codexPage: A12 }
  languageLevel: act3
```

## 1. 学习目标（学习者视角）

1. **await**：`await` 不是「让世界暂停」，而是「让这一条线在这里等」；等待期间别的动作可以发生。证据：两坛酿造并行用时 20 秒，而不是 40 秒。
2. **Promise 作为值**：`world.startBrewing(...)` 立刻返回「还没好的药水」；可以把它存起来，先去做别的，最后再 `await`。证据：`brewing` 与 `curing` 在等待期间被用于别的工作。
3. **并发等待**：`Promise.all([...])` 表示「这些一起等」，总用时等于最慢的那个，而不是相加。证据：并发版 57 秒完成，顺序版 84 秒必超时。
4. **错误处理**：缺材料时 `startBrewing` 返回一个会失败的 Promise；`try/catch` 是「换一条路」，不是「把错误吞掉」。证据：隐藏变体缺一种或两种材料时仍按时完成。**代价**（织典 A12 页）：时序不再直观，哪一步先发生要自己推理。

误解与对策：`async-is-faster` → 计时对比；`await-blocks-world` → 预测题 + 坏代码修复；`promise-all-is-sequential` → 两坛用时实测；`forget-await` → 漏写 await 的错误翻译；`catch-swallows-bug` → 备方必须真的接上（缺料变体判定交付与治愈）。

## 2. 叙事（`narrative`）

```yaml
narrative:
  setup: '苔溪营地外的夜。黎明只剩最后一段路，酿造台的火刚生起来。艾拉把最后一枚符文按在钟绳上：「黎明不等人。它只会一秒一秒地来。」'
  stakes: '日出前必须治愈笼中的僵尸村民、把 3 瓶节日药水交给女巫苔婆、敲响晨钟；错过只是天黑了再来一夜，没有人受伤。'
  painBeat: '艾拉把旧符文贴上墙，世界以八倍速重演顺序版：灰崽站在酿造台前一动不动，天边的亮一格一格压过来；等它跑到钟楼，院墙已经被晨光染白，僵尸村民还关在笼子里。她合上石板：「每一步都对。只是它把等待排成了一队。」'
  resolution: '你把等待叠起来：两座酿造台一起开火、取金苹果藏进酿造的等待里、治愈与交付并行。破晓前十二秒，钟响，金光漫过营地——僵尸村民的眼睛先亮起来。'
  coachTone: '稳、短句、只报事实与剩余时间。不喊倒计时，不制造恐慌；失败时先认账，再给一个方向。'
```

**三句开场（docs/25 §3，进入关卡时逐句出现）**：
1. **世界状态**：「苔溪的夜越来越短，今晚的亮比昨晚又早了一刻；营地里的酿造台只烧得起一次火。」
2. **任务**：「天亮之前，把僵尸村民治好、把 3 瓶节日药水交给苔婆、敲响晨钟——每一件事都要等，等法不同，结果就不同。」
3. **为什么是你**：「最后泼药水、敲钟这两下，只有活人的手能做；灰崽能替你跑、替你等，但不能替你到场。」

## 3. 世界与场景（`world`）

营地是林间空地：两座酿造台、金苹果木桶、关僵尸村民的牢笼、苔婆的炼药锅与钟楼围在篝火四周。黎明由世界时钟驱动：`world.clock.dawnIn` 与顶部的倒计时条同源；玩家节拍的窗口内倒计时冻结为「织者时刻」，让右键动作不至于被时间追着跑。牢笼在东/西两套模板中随机选一，坐标由面板同步。

```yaml
world:
  anchor: { kind: camp, id: witch_camp }
  dimension: overworld
  time: 22800
  weather: clear
  region: { center: [0, 64, 0], radius: 56 }
  vars: { brewStands: 2, requiredPotions: 3, cureSeconds: 30, brewSeconds: 20, fallbackExtraSeconds: 10 }
  entities:
    - { type: agent, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
    - { type: witch, role: npc, name: 苔婆, count: 1 }
    - { type: zombie_villager, role: target, count: 1 }
    - { type: villager, role: npc, count: 2 }
    - { type: cat, role: prop, count: 1 }
    - { type: bat, role: prop, count: 3 }
  staging:
    - phase: setup
      steps:
        - { op: locateAnchor, kind: camp, id: witch_camp }
        - { op: buildProps, builder: witchCamp, params: { origin: '$anchor', brewStands: [[4, 0, -6], [-4, 0, -6]], chest: [-7, 0, 2], cage: [10, 0, 7], cauldron: [-10, 0, -8], bellTower: [0, 0, 14], lamps: 4 } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: '$anchor+[0,0,2]' }
        - { op: spawnEntity, type: villager, role: npc, name: 艾拉, at: '$anchor+[-2,0,4]' }
        - { op: spawnEntity, type: witch, role: npc, name: 苔婆, at: '$anchor+[-10,0,-8]' }
        - { op: spawnEntity, type: zombie_villager, role: target, at: '$anchor+[10,0,7]' }
        - { op: spawnEntity, type: villager, role: npc, count: 2, at: '$anchor+[6,0,10]' }
        - { op: time, value: 22800 }
        - { op: bossbar, id: dawn, title: '距黎明', color: red, progress: 1 }
        - { op: dialog, speaker: eira, text: '黎明不等人。它只会一秒一秒地来。' }
        - { op: objective, items: ['黎明前治愈僵尸村民', '把 3 瓶节日药水交给苔婆', '亲手敲响晨钟'] }
    - phase: climax
      steps:
        - { op: freezeInput, value: true }
        - { op: bossbar, id: dawn, title: '破晓', color: white, progress: 1 }
        - { op: particle, type: end_rod, at: '$anchor+[0,0,14]', count: 60 }
        - { op: particle, type: happy_villager, at: '$anchor+[10,0,7]', count: 30 }
        - { op: sound, id: block.bell.use, volume: 1, pitch: 0.8 }
        - { op: sound, id: block.beacon.activate, volume: 1 }
        - { op: time, value: 23400 }
        - { op: advancement, id: loomcraft/act3/before_dawn }
        - { op: dialog, speaker: eira, text: '等待不是墙，是可以折叠的布。' }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
  protectedBlocks: ['钟楼', '酿造台', '牢笼', '木桶', '炼药锅', '营地灯']
```

**事实与压缩（核到 2026-10-31）**：酿造台一次酿造 20 秒、产出 3 瓶；僵尸村民治疗是「虚弱 + 金苹果」，原版转化 3–5 分钟；日光周期约 23000 tick 开始破晓。本关保留酿造 20 秒与 3 瓶产量，把治愈压缩为 30 秒并在织典 A12 页标注原版时长。

## 4. 任务与评分（`task`）

```yaml
task:
  mainTask: '把顺序版改成能重叠的写法：两坛同酿、取苹果藏进酿造、治愈与交付并行；缺材料时换备方；天亮前把钟留给织者敲。'
  makeTask: '用 world.clock.dawnIn 在开场与结束各报一次剩余时间，再想：缺一种材料时哪一段会变长，为什么仍来得及。'
  playerBeat: '① 治疗开始时，你右键僵尸村民泼下虚弱药水；② 程序走到钟楼后，你右键钟敲响晨钟。两次都是右键一次，窗口内倒计时冻结。'
  timeLimitSec: 150
  successCriteria:
    - id: cured-and-delivered
      text: 黎明前治愈村民并交付 3 瓶节日药水（顺序版在此失败）
      check: |
        (g) => g.events("dawn.break").length === 0 && g.events("run.error").length === 0 && g.entities({ type: "minecraft:zombie_villager" }).length === 0 && g.events("trade.witch").some(e => e.items === 3)
    - id: player-actions
      text: 你亲手泼药水，也亲手敲钟
      check: |
        (g) => g.events("potion.splash").some(e => e.byPlayer === true) && g.events("bell.ring").some(e => e.byPlayer === true)
  hiddenTests:
    - id: h-shortage
      name: 缺一种材料
      setup: { variant: shortage, missing: { random: [glistering_melon, fermented_spider_eye] }, dawnSeconds: [76, 84] }
      assertions:
        - id: h-shortage-done
          text: 换备方后仍在黎明前完成全部三步
          check: |
            (g) => g.events("dawn.break").length === 0 && g.events("trade.witch").some(e => e.items === 3) && g.events("entity.cured").length === 1
        - id: h-shortage-nocrash
          text: 没有未捕获的 Promise 拒绝
          check: |
            (g) => g.events("run.error").length === 0
    - id: h-dawn-jitter
      name: 黎明时长与牢笼位置随机
      setup: { variant: dawn-jitter, dawnSeconds: [66, 74], cage: { random: [east, west] } }
      assertions:
        - id: h-jitter-done
          text: 随机黎明时长下仍按并发路径完成
          check: |
            (g) => g.events("dawn.break").length === 0 && g.events("bell.ring").some(e => e.byPlayer === true)
    - id: h-shortage-both
      name: 两种材料同时缺
      setup: { variant: shortage, missingBoth: true, dawnSeconds: [88, 96] }
      assertions:
        - id: h-shortage-both-done
          text: 两坛都换备方，仍然完成治愈、交付与敲钟
          check: |
            (g) => g.events("dawn.break").length === 0 && g.events("run.error").length === 0 && g.events("trade.witch").some(e => e.items === 3) && g.events("bell.ring").some(e => e.byPlayer === true)
    - id: h-dawn-edge
      name: 黎明只剩六十六秒的极限夜
      setup: { variant: dawn-jitter, dawnSeconds: 66, cage: west }
      assertions:
        - id: h-dawn-edge-done
          text: 极限黎明下没有走顺序路径，仍然完成
          check: |
            (g) => g.events("dawn.break").length === 0 && g.events("entity.cured").length === 1 && g.events("trade.witch").length === 1
  randomization:
    mode: session
    hiddenOnly: true
    variants:
      - { id: dawn-seconds, range: [66, 74] }
      - { id: cage-side, choices: [east, west] }
      - { id: shortage-material, choices: [glistering_melon, fermented_spider_eye], hidden: true }
      - { id: shortage-dawn-seconds, range: [76, 84], hidden: true }
      - { id: both-shortage, hidden: true, note: '两种材料都缺的极限变体（仅隐藏测试）' }
```

**阶段（2 段，玩家可见目标按段推进）**：
- **阶段一 · 顺序版 → 并发版**：先跑艾拉的顺序版，亲眼看到天亮；再把「一个等完再等下一个」改成能重叠的写法——两坛同时开酿、取苹果藏在酿造等待里、治愈开始时先去交付。通过标准：面板显示本次用时与剩余时间，第一次在天亮前跑完。
- **阶段二 · 缺料降级**：在 `safeBrew` 的 `catch` 里写真正的备方（换配方再酿一次），并保证备方变慢后仍然来得及；开场与结尾各报一次剩余时间。通过标准：缺一种材料时仍完成三步，且没有未处理的运行错误。

**挑战层（可跳过、不计星）· 三坛并行、不许用 try/catch**：在不使用 `try/catch` 的前提下，用 `world.hasItem` 先检查材料，再让**三座酿造台同时开火**（虚弱、治疗、再生各一坛；缺料的那坛改用备方，而「检查与选择」必须在开火前完成），三坛一起等完后按顺序交付与治疗，仍然在黎明前敲钟。判定：①三坛启动时刻差 ≤1 秒（真并行，用运行日志的启动时间戳）；②全程没有 `try/catch`（AST 检查）；③黎明前完成三步且没有未捕获错误。参考解与判定见 `L09.content.ts` 的 `challenge`（独立验收，不影响星数）。**schema 暂无 `challenge` 字段，实现期以 content.ts 为准（docs/06 §6.1 #15）。**

**时间差（本关设计的核心，数字即验收依据）**：

| 步骤 | 顺序版（starter） | 并发版（reference） |
|---|---|---|
| 走到酿造台 + 两坛酿造 | 2s + 20s + 20s = 42s | 2s + 20s（同酿） |
| 取金苹果（走 + 拿，藏在酿造里） | 3s | 0 额外 |
| 走到牢笼 + 治疗转化 | 2s + 30s | 2s + 30s |
| 交付 3 瓶（走 + 放，藏在转化里） | 4s | 0 额外 |
| 走到钟楼 + 敲钟 | 3s | 3s |
| **合计 vs 黎明 66–74s** | **84s，必超时（差 10–18s）** | **57s，剩余 9–17s** |
| 缺一种材料时 | 94s（更糟） | 67s（隐藏变体黎明 76–84s） |

**判定口径**：只读世界状态与事件流——`potion.splash`、`entity.cured`、`trade.witch`、`bell.ring`、`dawn.break`、`run.error`；顺序版必超时是结构性保证（差值 ≥10 秒，不依赖手速）。**多解**：两坛可以挂在变量上也可以直接进 `Promise.all`；交付可以放在治疗前/后，只要重叠；报时次数与说法不限。**部分成功**：治愈与交付完成但没敲钟 → 只差玩家那一下。**时限**：`timeLimitSec: 150`（黎明 66–84s + 玩家节拍冻结 + 演出余量）；首次游玩 20–24 分钟可接受，超过 `estimatedMinutes=22` 不算失败；无限重试。

## 5. 代码与 API（`code`）

**执行模式：`runMode: explicit`**。L9 起关闭 Act I–II 的 auto-await（D36）：所有写操作必须显式 `await`，顶层 await 允许；漏写触发 2588 提示（「你带着一个还没好的 Promise 往下跑了」）。**并发要求**：两坛必须真的同时开酿；治愈与交付必须真的重叠——这两点由计分判定，不是注释里的口号。

| registry 符号（`docs/12` §3 L9） | 签名 | 读/写 | 本关语义 |
|---|---|---|---|
| `world.clock` | `{ time: number; dawnIn: number }` | 读（同步） | `dawnIn` = 距黎明秒数；与倒计时条同源 |
| `world.startBrewing(recipe)` | `Promise<Brew>` | 写 | 立刻返回「还没好的药水」；20s 后产出 3 瓶；缺材料时失败 |
| `golem.treatZombieVillager(pos)` | `Promise<void>` | 写 | 仪式 + 玩家泼药水 + 30s 转化；需要背包里有虚弱药水与金苹果 |
| `golem.ringDawnBell()` | `Promise<void>` | 写 | 把钟绳拉到位置，等玩家亲手敲响 |
| `world.hasItem(item)` | `boolean` | 读（同步） | 背包/营地是否已有该物（extension，不计教学符号） |

复用旧 API：`golem.moveTo`（L1）、`golem.collect`（L2）、`golem.deposit`（L2，交付 3 瓶到苔婆炼药锅）、`golem.say`（L1，报剩余时间）。**不新增**「交付/取物」类符号：交付复用 `deposit`，是刻意的旧抽象回收。`Recipe`、`BrewNote`、坐标常量是 starter 预填的本地类型与常量，不是 SDK 符号。

```yaml
code:
  expectedLoc: 64
  starterCode: |
    type Recipe = "weakness" | "healing" | "weakness_slow" | "regeneration"
    const backup: Record<string, Recipe> = { weakness: "weakness_slow", healing: "regeneration" }
    const brewStand = { x: 4, z: -6 }
    const chest = { x: -7, y: 65, z: 2 }
    const cage = { x: 10, y: 64, z: 7 }
    const cauldron = { x: -10, y: 65, z: -8 }
    const bellTower = { x: 0, z: 14 }

    async function safeBrew(recipe: Recipe): Promise<void> {
      try {
        await world.startBrewing(recipe)
      } catch (e) {
        // 阶段二：缺材料时换成 backup 里的备方，再酿一次。
      }
    }

    // 阶段一：这是艾拉的顺序版。先跑一次，看天亮。
    await golem.moveTo(brewStand.x, brewStand.z)
    await safeBrew("weakness")
    await safeBrew("healing")
    await golem.moveTo(chest.x, chest.z)
    if (!world.hasItem("golden_apple")) {
      await golem.collect("golden_apple", chest)
    }
    await golem.moveTo(cage.x, cage.z)
    await golem.treatZombieVillager(cage)
    await golem.moveTo(cauldron.x, cauldron.z)
    await golem.deposit(cauldron, "healing_potion", 3)
    await golem.moveTo(bellTower.x, bellTower.z)
    await golem.ringDawnBell()

    // 阶段一续：把「一个等完再等下一个」改成能重叠的写法（并发）。
    // 阶段二续：补完 catch 的备方；开场与结尾各报一次剩余时间。
  referenceSolution: |
    type Recipe = "weakness" | "healing" | "weakness_slow" | "regeneration"
    type BrewNote = { recipe: Recipe; fallback: boolean }
    const backup: Record<string, Recipe> = { weakness: "weakness_slow", healing: "regeneration" }
    const brewStand = { x: 4, z: -6 }
    const chest = { x: -7, y: 65, z: 2 }
    const cage = { x: 10, y: 64, z: 7 }
    const cauldron = { x: -10, y: 65, z: -8 }
    const bellTower = { x: 0, z: 14 }

    async function safeBrew(recipe: Recipe): Promise<BrewNote> {
      try {
        await world.startBrewing(recipe)
        return { recipe, fallback: false }
      } catch (e) {
        const spare = backup[recipe]
        await world.startBrewing(spare)
        return { recipe: spare, fallback: true }
      }
    }

    async function walkTo(pos: { x: number; z: number }): Promise<void> {
      await golem.moveTo(pos.x, pos.z)
    }

    async function takeApple(): Promise<void> {
      await walkTo(chest)
      if (!world.hasItem("golden_apple")) {
        await golem.collect("golden_apple", chest)
      }
    }

    async function startBothBrews(): Promise<BrewNote[]> {
      const brews = Promise.all([safeBrew("weakness"), safeBrew("healing")])
      await takeApple()
      return await brews
    }

    async function deliverToWitch(): Promise<void> {
      await walkTo(cauldron)
      await golem.deposit(cauldron, "healing_potion", 3)
    }

    async function cureTheVillager(): Promise<void> {
      await walkTo(cage)
      const curing = golem.treatZombieVillager(cage)
      await deliverToWitch()
      await curing
    }

    async function ringTheBell(): Promise<void> {
      await walkTo(bellTower)
      const left = world.clock.dawnIn
      await golem.say("离天亮还有 " + left + " 秒，我去敲钟")
      await golem.ringDawnBell()
    }

    async function reportPlan(notes: BrewNote[]): Promise<void> {
      for (let i = 0; i < notes.length; i++) {
        const note = notes[i]
        if (note.fallback) {
          await golem.say("材料不够，" + note.recipe + "顶上")
        }
      }
      const left = world.clock.dawnIn
      await golem.say("两坛一起等，天亮前还剩 " + left + " 秒")
    }

    await golem.say("离天亮 " + world.clock.dawnIn + " 秒，开工")
    await walkTo(brewStand)
    const notes = await startBothBrews()
    await reportPlan(notes)
    await cureTheVillager()
    await ringTheBell()
```

**常见错误**：漏写 `await` → 2588，药水还没好，代码已经跑到牢笼；一坛一坛等 → 40 秒，天亮在交付前；`catch` 里什么都不做 → 缺料变体没有备方药水；治疗前忘记取金苹果 → 治疗失败，笼子没变化；顺序错（先交付再治疗）→ 交付正常但治愈没开始，时间不够。

## 6. 教学节拍（`pedagogy`）

```yaml
pedagogy:
  predict:
    - { question: '两坛各要 20 秒，同时酿，一共等多久？', options: ['40 秒', '约 20 秒', '0 秒'], answer: 1 }
    - { question: 'await 的时候，世界会停住吗？', options: ['世界暂停', '只有灰崽这一条线在等，别的照常', '服务器卡住'], answer: 1 }
    - { question: '缺材料时，catch 里应该做什么？', options: ['安静地忽略', '换成备方继续', '退出程序'], answer: 1 }
  investigate:
    brokenCode: |
      await golem.moveTo(brewStand.x, brewStand.z)
      world.startBrewing("weakness")
      await golem.moveTo(cage.x, cage.z)
      await golem.treatZombieVillager(cage)
    expectedError: '编辑器提示 2588；世界反馈：酿造台还在冒泡，灰崽已经到笼子前，治疗失败，天亮继续走'
    explanation: 'await 不是装饰，它让「这一步真的完成」成为下一句的前提。少写它，你就带着一个还没好的药水往下跑。'
  beats:
    - { beat: painBeat, durationSec: 60, playerAction: '看旧符文的顺序版被八倍速重演', coachLine: '每一步都对。只是它把等待排成了一队。', uiChange: '倒计时条一格一格消失，天边泛白', expectedOutput: '说出「顺序会输」' }
    - { beat: predictRun, durationSec: 130, playerAction: '答 3 道预测题，再跑顺序版 starter', coachLine: '先猜，再跑；看看天是怎么亮的。', uiChange: '倒计时归零，天亮失败演出', expectedOutput: '2/3 以上正确，亲眼看到失败' }
    - { beat: investigate, durationSec: 90, playerAction: '修好漏写 await 的坏代码', coachLine: '少写了「等」这一步，你就在带着还没好的药水往下跑。', uiChange: '织偶跑在酿造前面，治疗失败', expectedOutput: '补上 await 并理解为什么' }
    - { beat: modify, durationSec: 300, playerAction: '把等待叠起来：同酿、取苹果、治疗与交付重叠', coachLine: '让等待叠起来。', uiChange: '面板显示本次用时与剩余，首次天亮前完成', expectedOutput: '并发版跑通' }
    - { beat: degrade, durationSec: 180, playerAction: '补 safeBrew 的备方，跑缺料变体', coachLine: '材料不够，就换一条路；路远一点，也得在天亮前。', uiChange: '治疗与交付仍完成，错误面板没有红字', expectedOutput: '降级路径跑通' }
    - { beat: challenge, durationSec: 180, playerAction: '选做：三坛并行、不许用 try/catch', coachLine: '三座台一起开火，先检查，再点火。', uiChange: '挑战徽章（不计星）', expectedOutput: '挑战判定通过或跳过' }
    - { beat: make, durationSec: 120, playerAction: '读剩余时间、泼药水、敲钟', coachLine: '你现在能看见时间，也能折叠它。', uiChange: '玩家节拍提示，倒计时冻结', expectedOutput: '亲手完成最后两下' }
    - { beat: wrap, durationSec: 40, playerAction: '看破晓演出与织典解锁', coachLine: '等待不是墙，是可以折叠的布。', uiChange: '符文入典、advancement 弹出', expectedOutput: '通关' }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: '顺序版的 84 秒里，哪几段等待其实可以同时发生？', codeAnchor: 'safeBrew' }
    - { level: 2, trigger: { afterFailures: 2 }, text: '两个 `Promise` 可以先拿在手里，再用 `Promise.all` 一起等。', codeAnchor: 'const brews' }
    - { level: 3, trigger: { afterFailures: 3 }, text: '`catch` 里换 `backup[recipe]`；治愈先存再 `await`。', codeAnchor: 'catch (e)' }
  errorMap:
    - { tsCode: 2588, text: '这里是异步操作，前面要加 `await`，不然你带着 `Promise` 往下跑。' }
    - { tsCode: 2304, text: '织偶不认识这个名字：检查拼写，或者它还没被声明。' }
    - { tsCode: 2322, text: '这里要的是一句话（字符串），你给了别的类型。' }
    - { tsCode: 0, text: '天亮了：先数一数，你有几段等待是排队的。' }
    - { tsCode: 0, text: '缺材料没接上：`catch` 里要换成备方，再酿一次。' }
```

## 7. 提示梯（恰好 3 级，不直接给答案）

1. **nudge（1 次失败后）**：「顺序版的 84 秒里，哪几段等待其实可以同时发生？」
2. **technique（2 次失败后）**：「两坛不相关：先各拿一个 Promise，再用 `Promise.all` 一起等；治愈也能先拿在手里。」
3. **near-solution（3 次失败或 120s 无进展）**：给出**结构**不给成品——「先存两坛的等待，再取苹果；治愈先启动，交付完再回来等」，并高亮 starter 中可直接模仿的两行；60s 后仍无进展，自动填入 `startBothBrews` 与 `cureTheVillager`，保留 `safeBrew` 的 catch 给学生（防死局底线）。

## 8. 反馈与演出（`feedback`）

```yaml
feedback:
  success:
    - '倒计时条由红转白并冻结为「织者时刻」；玩家泼药水的一瞬，笼中炸开红色粒子，僵尸村民颤抖 30 秒后化为村民'
    - '玩家敲钟后金光从峡谷线漫上来，钟声与信标激活声叠加，破晓演出与 advancement「破晓之前」；符文飞入织典'
  partial:
    - '治愈完成但没交付：苔婆的炼药锅冷着，提示「药水还在你背包里」'
    - '交付完成但顺序版超时：天亮演出只报「差十秒」，不扣资源'
  failure:
    - '天亮了：鸡鸣、晨光扫过营地，提示「按 R 把夜倒回去」，进度不清空'
    - '缺料没接上：治疗失败，提示「材料不够时，先想备方」'
  wowMoment: '玩家敲钟瞬间：画面定格 20 tick，金色黎明从东侧峡谷线漫过营地，笼中爆出最后一簇红色粒子后变成村民；倒计时条从红到白，碎成金色粒子。'
  ambience: '夜枭、酿造台咕嘟声、猫叫与锅底火星；破晓时鸟鸣与钟声余韵'
```

## 9. 边界与失败处理（`boundaries`）

```yaml
boundaries:
  timeout: '程序时间上限 = 黎明秒数（66–74，隐藏变体 76–96）；到点触发 dawn.break 与天亮演出；timeLimitSec=150 是含玩家节拍的硬上限（按关卡覆盖 runner 默认超时）'
  infiniteLoop: '观察器在循环体首插计数；等待由世界时钟驱动，await 不消耗预算；持续无进展提示「灰崽在等什么？」'
  disconnected: '暂停关卡与倒计时，重连后从最近检查点继续；已完成的酿造与治疗不丢'
  resetPolicy: 'R 或界面一键重置 ≤2 秒：重摆道具、时钟倒回、倒计时回满、灰崽回篝火、玩家回营地；可无限重试'
  cheatPolicy: '黎明由世界时钟控制，学生代码无法暂停或改写（玩家节拍冻结是唯一例外，窗口 ≤10 秒）；world.clock 只读'
  isolation: '学生代码跑在 worker 沙箱；SDK 白名单外调用不可达；每次运行新沙箱，避免 Promise 状态泄漏'
```

## 10. 隐藏测试与反硬编码

**顺序版为什么必超时（结构性保证）**：世界只累计「程序主动执行时间」，玩家节拍冻结不计时。顺序版最短 84 秒 > 黎明上限 74 秒；并发版 57 秒（缺料 67 秒）< 黎明下限 66 秒。差值大于 10 秒，不依赖手速，也不依赖随机数落在哪一端。

**四个隐藏变体**：①缺一种材料（黎明放宽到 76–84 秒，考验备方）；②黎明时长与牢笼位置随机（66–74 秒，防写死）；③两种材料同时缺（黎明 88–96 秒，两坛都要换备方）；④极限黎明 66 秒（并发版仍有 9 秒余量，顺序版必失败）。随机种子写进运行日志，固定种子可复现。挑战层另有独立判定（三坛并行 + AST 检查无 `try/catch`），不影响星数。

## 11. 验收证据（DoD）

```yaml
acceptance:
  evidence:
    - 'level-kit validate-spec 通过（schema 必填键、文本预算、API ⊆ registry、提示恰好 3 级、隐藏测试 ≥2、随机化 hiddenOnly）'
    - 'starter 编译通过且不改时必须失败（dawn.break、缺治愈与交付）；reference 在 MockWorld 与真实 Paper 通过主判定，顺序版同场测必须超时（留日志）'
    - '隐藏测试日志（含随机种子）：缺一种材料、随机黎明、两种材料同缺、极限黎明全过'
    - '挑战层（三坛并行、无 try/catch）独立判定通过；盲测 solver ≤24 分钟、≤2 级提示完成主任务'
  blindSolver: { criteria: '只读玩家可见文本与 API 面板，≤24 分钟、≤2 级提示完成主任务；挑战层可跳过；首玩 20–24 分钟属正常' }
  screenshots: ['营地夜景与倒计时满格', '两座酿造台同时冒泡、玩家泼药水', '敲钟后金色黎明与恢复的村民']
```

## 12. 开放问题（`openQuestions`）

```yaml
openQuestions:
  - 'schema 尚未收录 task.phases / task.challenge（docs/06 §6.1 #15 已要求）；本轮以本文件 §4 的阶段与挑战层散文 + 实现期 content.ts 为准，Lead 更新 schema 后一次性迁入。'
  - '三坛并行的挑战判定需要运行日志记录每坛启动时间戳与「无 try/catch」的 AST 检查；若 AST 检查成本高，退化为「运行日志标记 + 人工复核」并写进挑战说明。'
  - '治愈压缩为 30 秒、酿造保持原版 20 秒；织典 A12 页必须标注原版治愈时长，避免学生把压缩值当成事实。'
  - '玩家节拍插入 await 等待之中，可能打断自动化快感；若试玩显示超过 60 秒或被跳过，降级为「织偶自动泼药水，玩家只敲钟」。'
```
