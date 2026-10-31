# LAB-R — 递归图腾（Recursion Totem）

> 状态：v1 初稿｜负责人：scout-language（writer）｜最后更新：2026-10-31｜上游：`docs/05-curriculum.md` §8、`docs/06-level-spec-system.md`、`docs/12-sdk-api-registry.md`。Challenge Lab 迷你规格（`code` 字段取 §3 两个 TS 块，同 L01 样板）（省略部分独立小节，字段见 YAML）。

---
## 0. 元信息
```yaml
meta:
  id: LAB-R
  title: { zh: 递归图腾, en: Recursion Totem }
  act: 2
  order: 21
  priority: P2
  prerequisites: [L05]
  estimatedMinutes: 7
  difficulty: 3
  abstractions: [X1]
  objectives: [{ id: o-base, learnerView: 我能给递归写出「什么时候停」的 base case, evidence: 塔在 level=0 处停下并放荧石 }, { id: o-self-similar, learnerView: 我能让每层都长成同一种形状，只是更小, evidence: 四座子塔与主塔形状一致、尺寸逐层减半 }, { id: o-generalize, learnerView: 我的函数能适应没见过的深度与尺寸, evidence: depth=3、size=8 的隐藏变体通过 }]
  misconceptions: [no-base-case, recursion-is-loop, shrink-not-happening]
  apiIntroduced: []
  apiAllowlist: [golem, golem.pos, golem.moveTo, golem.fill, golem.place]
  syntaxIntroduced: []
  reward: { rune: X1, advancement: loomcraft/labs/recursion_totem, codexPage: X1 }
```
## 2. 叙事与世界
```yaml
narrative:
  setup: 高地晨雾。艾拉要竖一座「回声图腾」：每一层都是同一座塔，退后看像一整个回声。
  stakes: 节日清晨前塔要立好；塔基要留给玩家放「图腾之心」，全塔才会亮。
  painBeat: 艾拉展示去年手写的版本：4 层、90 行、坐标全是手算；今年塔要换尺寸，她算到一半天黑了。她把石板翻过来：「写一个函数，让它自己算。」
  resolution: 玩家写出递归，塔从地面长到高处，四座子塔同时回应；玩家放入图腾之心，整座塔按层亮起。
  coachTone: 温和、少形容词；递归只讲两件事——「什么时候停」和「每次小多少」。
```
```yaml
world:
  anchor: { kind: meadow, id: highland_totem }
  dimension: overworld
  time: 1000
  weather: clear
  region: { center: [0, 70, 0], radius: 32 }
  entities:
    - { type: agent, role: agent, name: 灰崽, count: 1 }
    - { type: villager, role: npc, name: 艾拉, count: 1 }
  staging:
    - phase: setup
      steps:
        - { op: buildProps, builder: totemPlateau, params: { size: 16, y: 70 } }
        - { op: objective, items: [让塔长出 2 层「回声」, 塔基放入图腾之心] }
  reset: { strategy: rebuild_region }
  seed: { mode: session }
```
几何：平台 y=70、中心 (0,0)；`half = Math.floor(size/2)`；当前层 `golem.fill` 铺 `[cx-half..cx+half] × [cz-half..cz+half]`（含端点）；四子塔中心 `(cx±half, cz±half)`、`size=half`、`y+1`；`level===0` 时放一块 glowstone 并返回。
## 4. 任务与评分
```yaml
task:
  mainTask: 补完递归 buildTier(level, size, cx, cz, y)：level 为 0 时在中心放一块 glowstone 并 return；否则用 golem.fill 铺当前层方形平台，再在四角各递归一次（size 减半、y 加 1）。先跑通 level=2、size=6。
  makeTask: 把塔加到 level=3、size=8；回答：为什么 size 每次减半，塔不会无限长？
  playerBeat: 塔立好后，玩家在塔基中央凹槽放入「图腾之心」（海晶灯）→ 全塔按层亮起。
  timeLimitSec: 90
  successCriteria:
    - id: totem-shape
      text: 塔的形状与参考几何逐格一致
      check: "(g) => g.pattern(\"totem\").pass"
    - id: leaves
      text: 每个最小塔尖都有一块荧石，数量正好是 4 的层数幂
      check: "(g) => g.countBlocks({ center: [0,70,0], radius: 24 }, \"minecraft:glowstone\") === g.var(\"leaves\")"
    - id: fast-enough
      text: 60 秒内完成，没有栈溢出
      check: "(g) => g.var(\"durationSec\") <= 60 && g.var(\"stackOverflow\") === false"
  hiddenTests:
    - id: h-depth3
      name: 三层八格
      setup: { level: 3, size: 8, origin: [12, 70, -8] }
      assertions:
        - { id: h1, text: depth=3、size=8 的塔与参考几何一致, check: "(g) => g.pattern(\"h-depth3\").pass" }
  randomization: { mode: session, hiddenOnly: true, variants: [{ id: depth, values: [2, 3] }, { id: size, values: [4, 6, 8] }] }
```
## 5. 代码与 API
API 全部复用前序：`golem.fill(block, from, to)`（L5，含端点）、`golem.place`（L1）、`golem.pos`（L1）；**不引入新符号**。本 Lab 前置 L05：异步语法到 L9 才教，这里用**顺序执行模式**（写 API 直接调用，引擎自动排队与结算）。**starterCode**：
```ts
function buildTier(level: number, size: number, cx: number, cz: number, y: number): void {
  if (level === 0) {
    // TODO 1：在 (cx, y, cz) 放一块 minecraft:glowstone，然后 return
    return;
  }
  const half = Math.floor(size / 2);
  // TODO 2：golem.fill 铺当前层（cx±half, y, cz±half）
  // TODO 3：四角各递归一次（level-1、half、y+1）
}

buildTier(2, 6, 0, 0, 70);      // 隐藏变体会换深度与尺寸
```
**referenceSolution**：
```ts
function buildTier(level: number, size: number, cx: number, cz: number, y: number): void {
  if (level === 0) {                       // base case
    golem.place("minecraft:glowstone", cx, y, cz);
    return;
  }
  const half = Math.floor(size / 2);
  golem.fill("minecraft:stone_bricks",
    { x: cx - half, y: y, z: cz - half }, { x: cx + half, y: y, z: cz + half });
  buildTier(level - 1, half, cx - half, cz - half, y + 1);
  buildTier(level - 1, half, cx + half, cz - half, y + 1);
  buildTier(level - 1, half, cx - half, cz + half, y + 1);
  buildTier(level - 1, half, cx + half, cz + half, y + 1);
}

buildTier(2, 6, 0, 0, 70);
```
`expectedLoc`: starter 12 行 → reference 13 行，比值约 1.1（≤2.5）。常见错误：删掉 base case → 无限递归被终止；size 不传 `half` → 子塔一样大；漏一个角 → 只有三座子塔；y 忘加 1 → 子塔压在平台里。
## 6. 教学节拍（PriMM 六拍）
```yaml
pedagogy:
  predict:
    - { question: 把 level === 0 的 return 删掉，会发生什么, options: [塔长得更快, 无限递归到被终止, 什么都不变], answer: 1 }
  investigate:
    brokenCode: 删掉 starter 里的 base case 分支，或把 level - 1 写成 level
    expectedError: 指令数上限被触发，运行中止并提示「递归没有停下来」；世界只留下半层平台
    explanation: 递归每次调用自己都要更接近停止条件；level 减 1、size 减半，缺一都会让塔长不完或长不停。
  beats:
    - { beat: 0-painBeat, durationSec: 60, playerAction: 看 90 行手写塔与「换尺寸就全废」, coachLine: 写一个函数，让它自己算。, uiChange: 旧石板高亮, expectedOutput: 提出用函数递归 }
    - { beat: 1-Predict, durationSec: 45, playerAction: 回答两道预测题, coachLine: 先想停，再想长大。, uiChange: 高亮 base case 行, expectedOutput: 2/2 正确 }
    - { beat: 2-Run, durationSec: 60, playerAction: 运行 starter，看它只长出平台, coachLine: 塔还没开始长——缺的是四角。, uiChange: 世界只出现一层平台, expectedOutput: 定位缺失的递归调用 }
    - { beat: 3-Modify, durationSec: 150, playerAction: 补 base case 与四角递归, coachLine: 四角各一次，尺寸减半。, uiChange: 塔逐层出现, expectedOutput: 两层塔成形 }
    - { beat: 4-Make, durationSec: 90, playerAction: 换 depth=3/size=8 再跑, coachLine: 同一份代码，换一组数。, uiChange: 三层塔成形, expectedOutput: 隐藏变体通过 }
  hints:
    - { level: 1, trigger: { afterFailures: 1 }, text: 递归函数里哪一句会让它停下来？, codeAnchor: "level === 0" }
    - { level: 2, trigger: { afterFailures: 2 }, text: 当前层铺完，四角各调一次自己；参数要变小。, codeAnchor: buildTier }
    - { level: 3, trigger: { afterFailures: 3 }, text: half 是子塔的 size；y+1 是子塔高度；四个角都要写全。, codeAnchor: half }
  errorMap:
    - { tsCode: 2304, text: 名字拼错了——是 buildTier，不是 buildTierr。 }
```
## 8. 反馈与演出
```yaml
feedback:
  success: [塔成形时从基座到塔尖逐层爆出 end_rod 粒子，塔尖荧石心跳式闪烁；advancement「递归之符」]
  partial: [塔只有三座子塔：空缺的角冒灰烟]
  failure: [递归不停：指令数上限终止并提示「递归没有停下来」；按 R 重置]
  wowMoment: 塔尖最后一块荧石落位的一刻，四座子塔的塔尖依次爆出 end_rod 光点，像回声一样从远到近传回主塔；玩家放入图腾之心后整座塔从下往上亮成一棵发光的树；镜头被传送到高台俯拍，四层结构同时可见；音效 block.amethyst_block.chime 叠加一声钟，title「回声图腾」。
```
## 9. 边界与失败处理
```yaml
boundaries:
  timeout: 单次运行 90s；指令数上限 5000；递归深度上限 64（超过按栈溢出报告）
  infiniteLoop: 递归不停按「指令数超限」处理，给可读原因与提示梯
  disconnected: 断线暂停；重连后恢复快照，已铺平台保留
  resetPolicy: 一键重置 ≤2s：平台清空、织偶回中心；无限重试
  cheatPolicy: 手写坐标能过当前层但隐藏变体会失败；禁止直接 setBlock
  isolation: 学生代码在 worker 沙箱；只能访问 apiAllowlist；图案快照只读
```
## 11. 验收证据（DoD）
```yaml
acceptance:
  evidence: [starter 未修改时只长出一层平台并判定失败, referenceSolution 通过主判定与隐藏变体, 图案 oracle 与 §5 参考解分离实现]
  blindSolver: { criteria: 只读 UI 与函数签名，≤10 分钟、≤2 级提示完成主任务 }
  screenshots: [高地空场与图腾之心基座, 两层塔成形, 俯拍三层塔与全塔亮起]
```

