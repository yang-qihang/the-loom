# LAB-T — 证明你的符文（Prove Your Runes）
> 状态：v1 初稿｜负责人：scout-language（writer）｜最后更新：2026-10-31｜上游：`docs/05-curriculum.md` §8、`docs/06-level-spec-system.md`、`docs/12-sdk-api-registry.md`。Challenge Lab 迷你规格（`code` 字段取 §3 两个 TS 块，同 L01 样板）；`assert` 为 L7 prelude；D30 裁决本 Lab 解锁于 L7 后（docs/05 已改）。
---
## 0. 元信息
```yaml
meta:
  id: LAB-T
  title: { zh: 证明你的符文, en: Prove Your Runes }
  act: 2
  order: 22
  priority: P2
  prerequisites: [L07]
  estimatedMinutes: 7
  difficulty: 3
  abstractions: [X2]
  objectives: [{ id: o-assert, learnerView: 我能把「我觉得对」变成「机器帮我检查」, evidence: 4 条 assert 在正确装置上全部通过 }, { id: o-invariant, learnerView: 我能说出并检查装置的 4 条不变量, evidence: 4 条断言 message 各不相同且覆盖 4 件事 }, { id: o-mutation, learnerView: 我的断言能抓住被破坏的装置，而不是永远为真, evidence: 3 个隐藏损坏版本都被至少一条断言抓到 }]
  misconceptions: [assert-is-print, always-true-assert, only-happy-path]
  apiIntroduced: [assert]
  apiAllowlist: [assert, world.container, world.entities, golem, golem.pos, golem.say]
  syntaxIntroduced: []
  reward: { rune: X2, advancement: loomcraft/labs/prove_runes, codexPage: X2 }
  languageLevel: act2
```
## 1. 叙事与世界
```yaml
narrative:
  setup: 工坊外的丰收补给站：四只补给桶、一口铜钟、塔顶信标，节日清晨就要启用。艾拉：「你说它能用？证明给我看。」
  stakes: 昨天修站的人只留一句「我试过了，没问题」；今天一只桶少了两块面包，没领到补给的村民错过了晨钟。
  painBeat: 艾拉演示上一次的「检查」：一段只写 console.log 的流程，把坏桶原样放过，信标整夜没亮。她敲了敲石板：「你写下的每一条断言，都是替全村人问一句——真的吗？」
  resolution: 玩家写出 4 条断言证明装置满足 4 条不变量；四盏指示灯全绿，玩家敲钟，信标光柱冲上天空。
  coachTone: 温和、具体；把断言讲成「替村民问一句真的吗」，不纠正语法之外的审美。
world:
  anchor: { kind: workshop, id: harvest_depot }
  dimension: overworld
  time: 6000
  weather: clear
  region: { center: [0, 64, 0], radius: 24 }
  entities: [{ type: agent, role: agent, name: 灰崽, count: 1 }, { type: villager, role: npc, name: 艾拉, count: 1 }, { type: villager, role: npc, count: 3 }]
  staging:
    - phase: setup
      steps:
        - { op: buildProps, builder: supplyDepot, params: { barrels: 4, bread: 3, torches: 2, villagers: 3 } }
  reset: { strategy: restore_snapshot }
  seed: { mode: fixed, value: 20261031 }
```
装置参数（starter 给出）：四只桶在四角，每桶应有 3 个 `minecraft:bread` 与 2 支 `minecraft:torch`；钟在中央，村民就在钟边。只读 API：`world.container(pos)`（`.count(item)` / `.items()`）、`world.entities(kind, radius)`。
## 2. 任务与评分
```yaml
task:
  mainTask: 写出 verify()：用 4 条 assert 证明装置满足 4 条不变量——① 每桶正好 3 个面包 ② 四桶物品总数相同 ③ 桶里只允许出现面包和火把 ④ 钟周围 12 格内至少 3 名村民。四盏指示灯全绿后敲钟，点亮信标。
  makeTask: 把 verify() 写成「能失败的检查」：隐藏测试会用 3 个损坏版本跑你的 verify，每个版本都必须至少触发一条断言失败；永远为真的断言不算。
  playerBeat: 四盏指示灯全绿后，玩家右键敲响中央铜钟，信标光柱升起。
  timeLimitSec: 120
  successCriteria:
    - id: four-green
      text: 正确装置上 4 条不同的断言全部通过
      check: "(g) => g.asserts().filter(a => a.pass).length >= 4 && new Set(g.asserts().map(a => a.text)).size >= 4"
    - id: mutants-caught
      text: 3 个损坏版本都被至少一条断言抓住
      check: "(g) => g.mutants().length >= 3 && g.mutants().every(m => m.caught)"
    - id: beacon-lit
      text: 玩家敲钟点亮信标
      check: "(g) => g.events(\"player.interact\").some(e => e.block === \"minecraft:bell\")"
  hiddenTests:
    - id: h-bread
      name: 一只桶多一块面包
      setup: { mutant: extra-bread }
      assertions: [{ id: h1, text: 抓住数量不对, check: "(g) => g.mutant(\"extra-bread\").caught" }]
    - id: h-tool
      name: 一只桶混进工具
      setup: { mutant: tool-in-barrel }
      assertions: [{ id: h2, text: 抓住混进工具, check: "(g) => g.mutant(\"tool-in-barrel\").caught" }]
    - id: h-villager
      name: 少一名村民
      setup: { mutant: missing-villager }
      assertions: [{ id: h3, text: 抓住村民没到齐, check: "(g) => g.mutant(\"missing-villager\").caught" }]
  randomization: { mode: session, hiddenOnly: true, variants: [{ id: mutant-order, shuffle: true }] }
```
## 3. 代码与 API
`assert(cond, msg)` 是 L7 起的全局 prelude：条件为假就停下并说 `msg`；`world.container` / `world.entities` 是前序读 API。**本 Lab 不引入新 SDK 符号**。
**starterCode（4 条断言都是空壳；先跑，看几盏灯亮）**：
```ts
const 补给桶 = [{ x: -6, y: 65, z: -6 }, { x: 6, y: 65, z: -6 }, { x: -6, y: 65, z: 6 }, { x: 6, y: 65, z: 6 }];
const 允许的物品 = ["minecraft:bread", "minecraft:torch"];

function verify(): void {
  // TODO ① 每桶 3 个 bread ② 四桶总数相同 ③ 只允许白名单物品 ④ 钟旁 ≥3 名村民
  // 每个 TODO 都是一条 assert(条件, 人话)
}
verify();
```
**referenceSolution**：
```ts
function verify(): void {
  let breadOk = true;
  for (let i = 0; i < 补给桶.length; i++) if (world.container(补给桶[i]).count("minecraft:bread") !== 3) breadOk = false;
  assert(breadOk, "每桶必须正好 3 个面包");
  const first = world.container(补给桶[0]).items().length;
  let evenOk = true;
  for (let i = 1; i < 补给桶.length; i++) if (world.container(补给桶[i]).items().length !== first) evenOk = false;
  assert(evenOk, "四只补给桶的物品总数必须相同");
  let cleanOk = true;
  for (let i = 0; i < 补给桶.length; i++) {
    const items = world.container(补给桶[i]).items();
    for (let j = 0; j < items.length; j++) if (允许的物品.indexOf(items[j].kind) === -1) cleanOk = false;
  }
  assert(cleanOk, "补给桶里不允许出现工具");
  assert(world.entities("villager", 12).length >= 3, "钟旁至少要有 3 名村民");
}
verify();
```
常见错误：恒真断言（`assert(true, …)` / `>= 0`）能亮灯但漏掉全部变异（「永远为真的断言证明不了任何事」）；一条大断言包住 4 件事 → 只亮 1 盏灯；用 `console.log` 代替 assert → 灯不亮；忘了调用 `verify()` → 一条断言都没执行。
## 4. 教学节拍（PriMM 六拍）
```yaml
pedagogy:
  predict:
    - { question: assert(条件, msg) 和 console.log 最大的区别是, options: [打印更快, 条件为假时会停下报错, 没有区别], answer: 1 }
  investigate:
    brokenCode: 把最后一条断言写成 assert(world.entities("villager", 12).length >= 0, "钟旁有村民")
    expectedError: 无 TS 报错；该盏灯「通过」，但 missing-villager 变异没有被抓住
    explanation: 条件永远为真，断言就没有检查任何东西。断言的价值在「什么时候会失败」，不在「通过」。
  beats:
    - { beat: 0-painBeat, durationSec: 60, playerAction: 看上一位修站者的「我试过了」与没亮的信标, coachLine: 别告诉我它能用。让机器担保。, uiChange: 坏桶高亮、信标熄灭, expectedOutput: 说出需要可检查的证据 }
    - { beat: 1-Predict, durationSec: 45, playerAction: 回答两道预测题, coachLine: 断言的价值，在它会失败的时候。, uiChange: 高亮 assert 语法, expectedOutput: 2/2 正确 }
    - { beat: 2-Run, durationSec: 45, playerAction: 运行 starter（4 条空壳）, coachLine: 灯没亮，是因为你还没检查。, uiChange: 四盏指示灯全灭, expectedOutput: 定位空壳断言 }
    - { beat: 3-Modify, durationSec: 180, playerAction: 补前两条断言（面包数、总数）, coachLine: 一条不变量，一条断言。, uiChange: 两盏灯亮, expectedOutput: 2/4 绿灯 }
    - { beat: 4-Make, durationSec: 120, playerAction: 补白名单与村民断言，跑隐藏变异, coachLine: 现在让坏装置自己露馅。, uiChange: 四盏灯亮、变异报告三条, expectedOutput: 4/4 绿灯 }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: 四条不变量各需要读世界的哪一部分？, codeAnchor: world.container }
    - { level: 2, trigger: { afterFailures: 2 }, text: 用 for 循环遍历四只桶；先算一个基准，再比较其余。, codeAnchor: 补给桶 }
    - { level: 3, trigger: { afterFailures: 3 }, text: 白名单用 indexOf；村民用 world.entities 的数量。, codeAnchor: assert }
  errorMap: []
```
## 5. 反馈与演出
```yaml
feedback:
  success: [四盏指示灯依次变绿，木桶盖同时翻开，面包与火把的粒子飞向村民；敲钟后信标光柱升起，advancement「证明之符」]
  partial: [亮 1–3 盏灯：未完成的不变量在目标面板标红，对应桶冒灰烟]
  failure: [断言失败时把出问题的桶框成红石色轮廓并附人话；全绿但变异漏掉则 actionbar「你的检查放过了坏装置」]
  wowMoment: 四盏指示灯全绿的一刻，四只木桶盖同时翻开，面包与火把化作 happy_villager 粒子飞向钟边的村民；玩家敲钟，信标光柱从塔顶冲上天空、把工坊屋顶照亮；音效 block.bell.use 连响三声 + entity.player.levelup，title「证明成立」。
```
## 6. 边界与失败处理
```yaml
boundaries:
  timeout: 单次运行 120s；隐藏变异逐组限时 10s，超时该组判「未抓住」
  infiniteLoop: 断言/循环总执行上限 2000 步；超过提示「检查里可能有死循环」
  disconnected: 断线暂停；重连后恢复装置与断言记录
  resetPolicy: 一键重置 ≤2s：装置还原、指示灯复位；无限重试
  cheatPolicy: 允许任意写法；恒真断言会被隐藏变异揭穿；禁止直接调用评分 API
  isolation: verify() 在沙箱执行；读 API 只返回快照；变异版本由 grader 在独立世界生成
```
## 7. 验收证据（DoD）与开放问题
```yaml
acceptance:
  evidence: [starter 未修改运行 4 盏灯全灭并判定失败, referenceSolution 4/4 绿且 3 个变异全部 caught, 恒真断言版本能亮 4 灯但 mutants-caught 失败（反作弊日志）]
  blindSolver: { criteria: 只读 UI、4 条不变量说明与函数骨架，≤10 分钟、≤2 级提示完成主任务 }
  screenshots: [补给站全景与四只木桶, 四盏指示灯全绿, 敲钟后信标光柱]
```
1. **变异注入与 UI 映射**：`g.mutant(id)` 需 grader 在独立世界生成 3 个变异体并调用学生 `verify()`（建议沿用 L8 `grader.injectMachine` 先例）；评分只要求 4 条不同 message，不建议改 `assert` 签名做灯映射。
