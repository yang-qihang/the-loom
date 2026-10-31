# L-Epilogue — 元织机（The Loom's Codex）

> 状态：v1 初稿｜负责人：scout-language（writer）｜最后更新：2026-10-31｜上游：`docs/05-curriculum.md` §8、`docs/06-level-spec-system.md`、`docs/12-sdk-api-registry.md`（Epilogue 节）、`content/levels/L01-first-light.md`（样板）
> 机器字段：各节 YAML 子树；`code.starterCode` / `code.referenceSolution` 取 §5 两个 TS 块（同 L01 样板，level-kit 抽取）。
> 机器 id：`L11`（D27：L11 = L-Epilogue = EP；schema 已允许）；文件名与显示名保持 `L-Epilogue`。

---

## 0. 元信息
```yaml
meta:
  id: L11
  title: { zh: 元织机, en: The Loom's Codex }
  act: 3
  order: 11
  priority: P2
  prerequisites: [L10]
  estimatedMinutes: 18
  difficulty: 4
  abstractions: [A14]
  objectives: [{ id: o-data-program, learnerView: 我能看懂一张指令表就是一段程序, evidence: 三条测试表的图案全部正确 }, { id: o-interpreter, learnerView: 我能写 run() 执行任意合法指令表，包括嵌套 repeat, evidence: 嵌套 repeat 隐藏测试通过 }, { id: o-robust, learnerView: 表里没有的指令要让它报错，而不是假装没看见, evidence: 非法指令隐藏测试抛出可读错误且世界无变化 }]
  misconceptions: [code-vs-data, repeat-must-be-recursive, unknown-op-ignore, nesting-is-hard]
  apiIntroduced: []
  apiAllowlist: [golem, golem.pos, golem.moveTo, golem.place, golem.say, "world.runTablet (kind: harness)", "golem.writeRune (kind: harness)", while, for, switch, JSON.stringify]
  syntaxIntroduced: []
  reward: { rune: A14, advancement: loomcraft/act3/loom_codex, codexPage: A14 }
  languageLevel: act3
```
> `apiIntroduced` 说明：按 D17，Epilogue 教学符号为 **0**；`world.runTablet` / `golem.writeRune` 是纯演出 harness，只列入 `apiAllowlist` 并标 `kind: harness`。

## 1. 学习目标（学习者视角）
1. **数据即程序（A14）**：程序不一定是代码；`Instruction[]` 这样的数据也能表示一段程序。→ 手工推演一条表会画出什么。
2. **解释器 = 读表的人（A14）**：`run()` 就是「读一条、执行一条、直到表读完」；`repeat` 也只是待办清单里的一项。→ 通过嵌套 repeat 隐藏测试。
3. **防御性穷举（复用 A8）**：未知指令必须报错，不能静默跳过。→ 非法指令测试抛出可读错误、世界无新增方块。
4. **旧抽象复用**：`for...of`、`while`、`switch`、对象/联合类型、`async/await`、函数全部用来写一个 20–30 行的解释器；**本关不引入新语法**。

## 2. 叙事
```yaml
narrative:
  setup: 大织机内部。艾拉把最后一块石板递给你：它不是符文，是一张「远古指令表」——织机时代的人把程序写成了数据。
  stakes: 最后一行必须被「执行」；解释器错一处，整面织纹就错位，村庄的日出停在这一刻。
  painBeat: 艾拉先演示「手工翻译版」：表里 40 多条，她一条条手写成 golem.moveTo / golem.place，写到第 30 条时顺序抄错，整面织纹歪斜。她停笔：「他们不写四十行——他们只写一个 run()。」
  resolution: 玩家补完 run()，三条测试表依次通过；远古指令表被交给织机，灰崽在织台上走出完整的元织之符；玩家右键诵读最后一行，大织机重启，村庄破晓。
  coachTone: 少用术语；把解释器叫「会读表的织偶」；每次报错都指向具体那条指令。
```

## 3. 世界与场景
```yaml
world:
  anchor: { kind: custom, id: great_loom_interior }
  dimension: overworld
  time: 18000
  weather: clear
  region: { center: [0, 70, 0], radius: 32 }
  entities: [{ type: agent, role: agent, name: 灰崽, count: 1 }, { type: villager, role: npc, name: 艾拉, count: 1 }, { type: villager, role: npc, count: 6 }]
  staging:
    - phase: setup
      steps:
        - { op: buildProps, builder: runeStage, params: { size: 9, floor: 69, rune: ancient } }
        - { op: spawnAgent, id: golem, name: 灰崽, look: automaton, at: "$loom.stage" }
        - { op: objective, items: [补完 run() 让三条测试通过, 让远古指令表画出完整织纹, 右键诵读最后一行] }
    - phase: climax
      steps:
        - { op: particle, type: enchant, at: "$rune_stage", count: 200 }
        - { op: sound, id: block.enchantment_table.use, volume: 1 }
        - { op: sound, id: entity.player.levelup, volume: 0.8 }
        - { op: time, value: 23000 }
        - { op: animate, target: "$village_far", kind: village_runs }
        - { op: title, text: 元织, subtitle: 世界不是被许愿修好的 }
        - { op: advancement, id: loomcraft/act3/loom_codex }
  reset: { strategy: restore_snapshot }
  seed: { mode: fixed, value: 20261031 }
```
**演练场与主舞台**：`$loom.rehearsal` 是 9×9 空白演练台，三条测试表在这里各跑一次、按图案对错判定；全部通过后，`$loom.stage` 主舞台才接受远古指令表。玩家在画廊高处俯瞰整面织纹。

## 4. 任务与评分
```yaml
task:
  mainTask: 补完 run(program)：用 for...of 遍历指令、switch 分派 move / place / repeat；repeat 用「待办帧」栈展开（不要求递归，但嵌套也要正确）；把 run 交给 `world.runTablet(run)`（回调 harness 用三条测试表 + 史诗表调用它并记录图案），完成最后一幅织纹。
  makeTask: 给 run() 加防御：表里出现不认识 op 时必须抛出一句人话错误（不许静默跳过）；再让同一份 run() 通过一张三层嵌套 repeat 的隐藏表。
  playerBeat: 全部通过后，玩家右键大织机核心，诵读最后一行符文；织机把最后一行刻在织典上。
  timeLimitSec: 90
  successCriteria:
    - id: three-tests
      text: 三条测试表的织纹全部正确
      check: '(g) => ["test-1", "test-2", "test-3"].every(t => g.tablet(t).pass)'
    - id: nested-repeat
      text: 嵌套 repeat 也能画出正确织纹
      check: '(g) => g.tablet("h-nested").pass'
    - id: illegal-op
      text: 未知指令会报错，且世界没有被乱画
      check: '(g) => g.tablet("h-illegal").rejected === true && g.var("blocksAfterError") === 0'
    - id: epic-rune
      text: 远古指令表画出完整织纹
      check: '(g) => g.tablet("epic").pass && g.var("durationSec") <= 60'
    - id: no-extra
      text: 世界里没有多余方块
      check: '(g) => g.var("extraBlocks") === 0'
  hiddenTests:
    - id: h-nested
      name: 三层嵌套 repeat
      setup: { tablet: nested-repeat-3, depth: 3 }
      assertions: [{ id: h1, text: 三层嵌套 repeat 的图案与 oracle 一致, check: '(g) => g.tablet("h-nested").pass' }]
    - id: h-illegal
      name: 表里混进未知指令
      setup: { tablet: illegal-op }
      assertions: [{ id: h2, text: 未知指令被拒绝且不落任何方块, check: '(g) => g.tablet("h-illegal").rejected === true' }]
    - id: h-epic-variant
      name: 换一张远古表
      setup: { tablet: epic-variant, shuffle: true }
      assertions: [{ id: h3, text: 换一张表也能画出正确织纹, check: '(g) => g.tablet("epic-variant").pass' }]
  randomization: { mode: session, hiddenOnly: true, variants: [{ id: tablet-order, shuffle: true }, { id: epic-nesting, range: [2, 3] }] }
```
`g.tablet(name)` 是本关评分扩展：`world.runTablet(run)` 的 harness 每调用 `run` 一次，记录「表名 → 织台图案快照 / 是否抛错」，判定只读快照。

## 5. 代码与 API
**API 全部取自 registry §3 Epilogue**；`run` 是学生定义的函数，不是 SDK 符号。`world.runTablet(run)` 是**回调 harness**（D28）：把它当参数交给织机，harness 用三条测试表 + 史诗表依次调用它、在隔离演练台记录图案；`golem.writeRune(text)` 在织机面板刻最后一行。`world.runTablet` / `golem.writeRune` 属 `kind: harness`，不计入教学符号（D17）。

**starterCode（只处理 move；先运行，看哪条表画歪了）**：
```ts
type Instruction =
  | { op: "move"; dx: number; dy: number }
  | { op: "place"; block: string }
  | { op: "repeat"; times: number; body: Instruction[] };

async function run(program: Instruction[]): Promise<void> {
  for (const ins of program) {
    if (ins.op === "move") {
      const p = golem.pos;
      await golem.moveTo(p.x + ins.dx, p.z + ins.dy);
    }
    // TODO：place 分支
    // TODO：repeat 分支（提示：把 body 压进待办栈，不要求递归）
  }
}

// 三条测试表与史诗表由织机持有（右侧「指令表」面板可读），形状就是 Instruction[]，例如：
// [{ op: "repeat", times: 4, body: [{ op: "place", block: "minecraft:rune_block" }, { op: "move", dx: 1, dy: 0 }] }]

// 脚手架：这一行不要改——把 run 交给织机，harness 用测试表与史诗表调用它
await world.runTablet(run);
```
**referenceSolution（`run` 通过三条测试、嵌套与非法指令隐藏测试）**：
```ts
type Instruction =
  | { op: "move"; dx: number; dy: number }
  | { op: "place"; block: string }
  | { op: "repeat"; times: number; body: Instruction[] };

async function run(program: Instruction[]): Promise<void> {
  type Frame = { body: Instruction[]; index: number };
  const todo: Frame[] = [{ body: program, index: 0 }];   // 待办清单

  while (todo.length > 0) {
    const frame = todo[todo.length - 1];                 // 只看清单最后一项
    if (frame.index >= frame.body.length) {              // 这一项做完了
      todo.pop();
      continue;
    }
    const ins = frame.body[frame.index];
    frame.index += 1;
    switch (ins.op) {
      case "move": {
        const p = golem.pos;
        await golem.moveTo(p.x + ins.dx, p.z + ins.dy);
        break;
      }
      case "place": {
        const p = golem.pos;
        await golem.place(ins.block, p.x, p.y - 1, p.z);
        break;
      }
      case "repeat": {
        // repeat 不是魔法：拆成 times 张待办，一张一张做（嵌套自动成立）
        for (let i = 0; i < ins.times; i++) todo.push({ body: ins.body, index: 0 });
        break;
      }
      default:
        throw new Error(`不认识的指令：${JSON.stringify(ins)}`);
    }
  }
}
// 三条测试表与史诗表由 harness 持有；这一行把 run 交给织机
await world.runTablet(run);
await golem.writeRune("世界是被一行一行执行的。");
```
`expectedLoc`: 22–40 行（starter 22 → reference 38，增量 1.7 倍，符合 R3）。**常见错误**：只处理 `move` → 测试 2/3 缺块（「表里有 repeat，你的 run 当它不存在」）；`repeat` 只执行一次 body → 图案少一层；未知 op 静默跳过 → 隐藏测试失败（「表里没有的指令，要让它停下来」）；`ins.op` 拼错大小写 → TS 2339。

## 6. 教学节拍（PriMM 六拍）
```yaml
pedagogy:
  predict:
    - { question: 一条 repeat times:3 的 body 里有 place 和 move 各一条，会放几块, options: [3, 6, 1], answer: 0 }
    - { question: 指令表里出现 run 不认识的 op，正确的做法是, options: [跳过继续, 抛错停下, 猜一个], answer: 1 }
  investigate:
    brokenCode: starterCode 的 run 只处理 move：测试表二和三里的 repeat 被静默忽略
    expectedError: 无 TS 报错；运行测试后织台图案缺行，actionbar 提示「织纹错位：表里还有指令没被听见」
    explanation: for...of 只遍历一遍，遇到 repeat 时什么都没做。解释器必须为每种 op 安排动作；表里没有的先报错，再决定要不要支持。
  beats:
    - { beat: 0-painBeat, durationSec: 75, playerAction: 看艾拉手抄 40 条指令抄错, coachLine: 他们不写四十行。他们只写一个 run()。, uiChange: 织纹歪斜、石板高亮, expectedOutput: 说出必须让程序自己读表 }
    - { beat: 1-Predict, durationSec: 45, playerAction: 回答两道预测题, coachLine: 表里说什么，就做什么。, uiChange: 高亮 repeat 行, expectedOutput: 2/2 正确 }
    - { beat: 2-Run, durationSec: 60, playerAction: 运行测试，看哪条表画歪, coachLine: 测试表二和三缺了很多块。, uiChange: 三条测试灯只亮一条, expectedOutput: 定位缺的 op }
    - { beat: 3-Investigate, durationSec: 90, playerAction: 补 place 分支后再跑, coachLine: 一条指令，一个分支。, uiChange: 测试灯亮两条, expectedOutput: 只剩 repeat 未处理 }
    - { beat: 4-Modify, durationSec: 300, playerAction: 用待办栈补 repeat，跑通三表, coachLine: repeat 是重复的待办，不是魔法。, uiChange: 三盏测试灯全绿, expectedOutput: 嵌套也能跑 }
    - { beat: 5-Make, durationSec: 240, playerAction: 运行远古指令表，看整面织纹, coachLine: 现在，读最后一张表。, uiChange: 主舞台织纹逐格点亮, expectedOutput: 元织之符完成 }
    - { beat: 6-玩家节拍, durationSec: 40, playerAction: 右键大织机核心诵读, coachLine: 最后一行，你来念。, uiChange: 全屏演出、advancement, expectedOutput: 大织机重启 }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: 先数一数：三条表里出现了哪几种 op？, codeAnchor: switch }
    - { level: 2, trigger: { afterFailures: 2 }, text: repeat 的 body 要重复 times 次；把 body 放进待办栈。, codeAnchor: 'case "repeat"' }
    - { level: 3, trigger: { afterFailures: 3 }, text: 栈顶帧做完就 pop；每次只处理帧里的下一条指令。, codeAnchor: todo }
  errorMap:
    - { tsCode: 2339, text: 这个 op 不在类型里：先看 Instruction 联合有哪几种。 }
    - { tsCode: 2304, text: 名字拼错了——是 golem.pos，不是 golem.postion。 }
```

## 7. 提示梯（恰好 3 级）
nudge：三条测试表里除了 move 还有什么 op；technique：repeat 不需要递归，把 body 当新表重复压进待办清单；near-solution：自动补上 `Frame` 类型与 `while` 骨架、`place` 分支，保留 `repeat` 分支与 `default` 报错给学生，**不给完整解释器**。

## 8. 反馈与演出
```yaml
feedback:
  success: [远古表执行完毕，9×9 织纹从中心向外逐格亮起，大织机重新转动；advancement「元织之符」]
  partial: [三条测试灯只亮一两条：对应表名高亮，织台缺块处冒灰烟]
  failure: [未知指令：运行中止并高亮那条指令在表里的位置，世界不落任何新方块]
  wowMoment: 远古指令表被执行时，UI 里整张表像乐谱一样逐行流动，每执行一条就亮起一个符文音符；最后一行落下，9×9 织纹从中心爆出 enchant 粒子并扫向四角，织机核心射出一道光柱击穿屋顶；全屏 title「元织」浮现时，远处村庄开始「运行」——风车转、羊群走、灯笼明灭；音效 enchantment_table.use + entity.player.levelup + 一声悠长的钟。
```

## 9. 边界与失败处理
```yaml
boundaries:
  timeout: 单次运行 90s 强杀；测试表逐条限时 15s，超时该条判失败并提示
  infiniteLoop: 指令总数上限 5000；嵌套 repeat 展开帧上限 500，超限抛「表展开得太大了」
  disconnected: 断线暂停；重连后恢复织台快照，已通过的测试保留结果
  resetPolicy: 一键重置 ≤2s：织台清空、织偶回起点、测试灯复位；无限重试
  cheatPolicy: 允许任意实现（递归版也算过）；禁止直接 setBlock 画图案——只认 run 经 golem 的动作
  isolation: 每条测试表在独立演练环境执行；图案快照只读；学生代码只能访问 apiAllowlist
```

## 10. 隐藏测试与反硬编码
嵌套 repeat（三层）只能执行一次 body 的实现会画错；非法指令要求先校验再执行或立即抛错（两种都可）；换一张史诗表（打乱顺序、改嵌套层数 2–3）会让写死输出/按固定下标展开的解失败；测试表与史诗表由 harness 持有（UI 可读），隐藏表在验收时注入、重跑同一回调。

## 11. 验收证据（DoD）
```yaml
acceptance:
  evidence: [未修改 starter 运行：测试灯仅 1/3 亮并判定失败, referenceSolution 通过三条测试+嵌套+非法指令+换表四组隐藏测试, 隐藏表图案 oracle 由独立参考解释器生成（与 §5 参考解分离实现）]
  blindSolver: { criteria: 只读 UI 与 Instruction 类型，≤20 分钟、≤2 级提示完成主任务 }
  screenshots: [织机内部与 9×9 空织台, 三条测试灯与乐谱流动的指令表, 元织之符完成与光柱破晓]
```

## 12. 开放问题
1. **隐藏表注入**：h-nested / h-illegal / h-epic-variant 由 harness 在验收时用隐藏表调用同一回调（D28 已把 harness 定为关卡侧能力，无需 `grader.injectTablet`）；若实现上仍要 grader 注入，请 Lead 在 registry 补一条。
2. **递归实现是否允许**：验收不禁止（只看行为），但 starter 提示待办栈，避免学生卡在未教的 Lab-R 概念上。
3. **「纯函数」措辞**：registry 说「学生的 run() 是纯函数」，本 spec 理解为「只依赖 program 参数与 golem 当前状态」；若要求真正无副作用（返回行动列表），§4 评分与 §5 代码需重写，建议维持现理解。
4. **史诗表归属**：史诗表（40–60 条、2–3 层嵌套）由关卡数据持有并与图案 oracle 同源生成，避免双份维护；UI 的「乐谱流动」演出需要 harness 回传每条指令的事件流。
5. **API 计数**：按 D17，Epilogue 教学符号 0；`world.runTablet` / `golem.writeRune` 已在 apiAllowlist 标 `kind: harness`。
