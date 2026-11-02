# 配套教材（Textbook）写作规范（Markdown 源 + 构建校验）

> 教材 = 与游戏配套的 10 章长文（每关一章），在 Studio 的独立弹出窗口中阅读。
> 内容源文件：`apps/studio/src/textbook/content/L01.md` … `L10.md`
> 构建/校验：`npx tsx scripts/build-textbook.ts --write`（生成 `library.generated.ts`）
> 内容模型：`apps/studio/src/textbook/types.ts`

## 0. 目标读者与定位

- 读者：**真的不懂编程**的玩家（第一次接触「变量」「函数」）。
- 目标：每章读完后，读者能用自己的话解释本关概念，并照着改代码解决同类问题。
- 定位：小教材，不是提示卡。借鉴 SICP 的「直觉 → 抽象」推进，但**不**照搬对话体；中文要严谨、清晰、少套话。
- 与剧情关系：可以用世界里的织偶/灯/货箱举例，但不复述剧情；教材应能独立阅读。

## 1. 文件格式（Markdown 方言）

````markdown
---
levelId: L01
act: 1
order: 1
title: 第一缕光：让世界动起来
subtitle: 从一句话开始，理解函数调用与顺序
minutes: 22
prereq:
  - 无
goals:
  - 能拆解一次函数调用的三个部分
  - 能按顺序预测 3 条调用后的世界
  - 能修好括号、引号、名字、顺序四类错误
---

# 第一缕光：让世界动起来

> 从一句话开始，理解函数调用与顺序

## 0 本章要解决的问题

正文段落。行内代码用反引号包裹，例如 `golem.moveTo(lamp1)`。

:::warn 常见误解
很多人以为灰崽会自己找最近的灯。它不会：它只照你写的顺序执行。
:::

### 一个可以预测的实验

先猜：下面三行执行完，哪一盏灯亮？

```ts caption:点亮 1 号灯
golem.moveTo(lamp1)
golem.place("lantern", lamp1)
golem.say("1 号灯亮了")
```

运行后世界会看到：……

## 术语

- 函数调用（function call）— 让一个函数按你给的实参做一件事；示例：`golem.moveTo(lamp1)`
- 命名点（named point）— 关卡给好的位置名字，如 `lamp1`、`eira`
````

方言规则：
- **front matter**：YAML 子集，支持标量 + `- ` 列表；必填 `levelId/act/order/title/subtitle/minutes/goals`，`prereq` 建议填。
- **标题**：`#` 章标题可省略（front matter 有 title）；`##` 二级（本章小节）、`###` 三级。
- **段落**：空行分隔；手工换行会被合并（中文之间不插空格）。
- **列表**：`- ` 无序、`1. ` 有序。
- **代码**：```` ```ts caption:可选说明 ````；每块 ≤30 行；**必须可被 esbuild 解析为 TypeScript**。
- **提示框**：`:::tip 可选标题` / `:::warn 可选标题` / `:::aside 可选标题` … `:::`。
- **术语**：`## 术语` 小节下用 `- 中文名（English term）— 一句话定义；示例：\`code\``（示例可选）。构建时会转成术语块。
- **分隔线**：单独一行 `---`（在 front matter 之后）。

## 2. 硬性指标（构建脚本会校验）

| 项 | 要求 |
|---|---|
| 正文汉字数（不含代码） | **≥5500**（目标 6500–9000；用户要求「接近教材质量、篇幅明显长」） |
| 代码块 | ≥4 个，每块 ≤30 行，语法必须合法 |
| API 使用 | 只允许本关及之前引入的 API（api-registry `sinceLevel`）+ 命名点/`world.vars`；禁用设计稿符号 |
| 术语 | ≥5 条，格式「中文名（English）— 定义」 |
| warn callout | ≥1（讲常见误解） |
| 小节结构 | 建议 7 节：本章问题 / 直觉 / 定义与机制 / 语法与示例 / 常见错误 / 与关卡的关系 / 小结与练习（可合并，顺序保持） |
| goals | 3–5 条，正文必须有对应讲解 |

禁用/不存在的符号（构建脚本会报错）：`world.scenario`、`world.field(`、`world.plot`、`world.machines(`、`world.lever(`、`world.containers(`、`world.items`、`world.give`、`world.clock`、`world.runTablet`、`ringBell(`、`placeTorch(`、`countEntities(`、`startBrewing(`、`treatZombieVillager`、`ringDawnBell(`、`allay`、`pipe(`、`tryReceive(`、`writeRune(`、`golem.fill(`、`golem.placeSign(`。

## 3. 每关真实可用的 API / 数据（写作前必读）

> 事实源优先级：`packages/runner/src/sandbox.ts`（真实注入面）> `content/levels/Lxx.content.ts`（本关数据/参考解）> `apps/studio/src/copy/levels.json`（玩家可见文案）> `docs/12`（命名契约，可能超前于实现）。

| 关卡 | 真实可用的 API / 数据（摘要） |
|---|---|
| L01 | `golem.moveTo/place/say/pos`；命名点 `lamp1..lamp4`、`eira`；`golem.place("lantern", lamp1)`；第 4 盏是玩家节拍 |
| L02 | `golem.collect("egg", perchN)`、`golem.deposit("egg", barrel, count?)`、`golem.count("egg")`、`world.container(barrel).count/items()`；命名点 `perch1..6`、`hatch1..3`、`barrel`、`eira`；变量/`let` 是本章核心 |
| L03 | `world.vars.scenario`（`{night,threat,trapped,gateOpen}`）；`golem.place("bell"/"torch"/"cobblestone", ...)`；命名点 `bell/well/gate/door/eira` 等；**没有** `world.scenario/ringBell/placeTorch` |
| L04 | `world.vars.fieldA/B/C`（`{rows,cols,x,z,waterRow,waterRow2?,seeds,plantable}`）、`world.vars.matureCellsA/B/C`；`golem.harvest("wheat",[x,65,z])`、`golem.plant("wheat",[x,65,z])`；命名点 `barn/fieldA..C/eira`；**没有** `world.field()` |
| L05 | `world.vars.plots`（`[{x,z,style}]`）、`world.vars.signs/materialBudget/protected`；`golem.moveTo/place/say`；数组速成（字面量/下标/`.length`/`.push`）；**没有** `world.plot/fill/placeSign`，工作台也不跑 `import` |
| L06 | `world.vars.cargo`（`{id,kind,food?}`）、`boxes`、`jobs`；`golem.place(item.id, slot)`；命名点 `toolsBox/materialsBox/foodBox/.../trader`；**没有** `world.containers/jobs/giveTool/caravan` |
| L07 | `world.vars.cargo/recheck`、`boxes/recheckBoxes`；原生 `Array.prototype.filter/map`；箭头函数/闭包/高阶函数；**没有** `allay/pipe/world.items/world.give` |
| L08 | `world.vars.machines`（`{id,name,switchPos,status}`）、`world.vars.lever`；`interface Machine { name; status; startSteps(); stopSteps() }`；启停=`place("redstone_block"/"air", 合闸位)`；**没有** `world.machines()/world.lever()` |
| L09 | `world.vars.brewStands/materials/cage/chest/cauldron/bell/dawn`；`async/await/Promise.all/try/catch`；取苹果旧写法 `place("air", chest)`（要标注为旧写法，不是通用收东西模式）；**没有** `startBrewing/world.clock/treatZombieVillager/ringDawnBell` |
| L10 | `agent("左织")/agent("右织")`、`left/right.moveTo/place/say/collect/send/receive`、`agent.waitIdle()`、`world.supply(materialsBox).count("oak_planks")`、`world.keystone()`；消息 `{from,text}`；`receive` 默认 10s；**没有** `tryReceive`；`world.supply` 仅本章可用 |

语法不越级：第 N 章代码只允许使用第 1..N 章已教的语法构造（变量 → 分支 → 循环 → 函数 → 记录/联合/switch → 箭头函数/高阶 → 接口/组合 → async；L10 增加多 agent）。**不要**用 `var`、`++`、`==`、`class`、`this`、`import` 代码块。

## 4. 各章必须讲透的要点（写作落点清单）

- **L01 函数调用/顺序**：调用拆解（接收者/方法/实参）、语句顺序（先走再放）、命名点 vs 坐标、字面执行、四类错误（括号/引号/名字/顺序）、第 4 盏为何是玩家节拍。
- **L02 变量（用户点名/全书最细）**：为什么需要变量；绑定不是盒子；`const/let` 选择；声明/初始化/赋值；求值顺序（先右后左）；`carried/banked/remaining` trace 表；`let banked = carried` 是复制值；从世界读数（背包 vs 木桶）；作用域初步；模板字符串；**`let` 至少 2500 字**。
- **L03 布尔/分支**：布尔与比较、`if/else if/else`、代码块、条件互斥与覆盖、顺序=优先级、剧本只读、嵌套 vs `&&/||`。
- **L04 循环**：`for` 三段式/`while` 终止、嵌套、差一错误、数据驱动边界（rows/cols）、跳过水渠、先收后种、循环不变量直觉。
- **L05 函数**：声明/调用/参数/实参/返回值/局部作用域、分解与泛化、数组速成、参考解走读。
- **L06 记录/联合**：字段绑定、`type`/可选属性、可辨识联合、`switch` 与穷尽性（`never`/`throw`）、类型擦除与 `as`、参考解走读。
- **L07 闭包/高阶**：函数是值、箭头函数、`filter/map`、闭包捕获绑定（非快照）、管道思想（`pipe` 只讲思想不给可运行代码）。
- **L08 接口/组合**：接口=能力清单、结构化类型、多态、组合优于继承、启停顺序、计划与执行分离。
- **L09 异步/并发**：Promise/await、顺序等待 vs 并发、`Promise.all`、try/catch、L01–L08 的「隐藏 await」在此揭开、时间线。
- **L10 协议/多 agent**：两个执行者/消息/协议/握手/死锁/共享资源/`Promise.all` 协调、桥面几何与份额、合龙石由玩家放。

## 5. 写作风格

- 术语首现「中文名（English term）」；同一概念只用正式名；API/关键字保持英文 + 反引号。
- 结构：先痛（没有这个抽象会怎样）→ 名（定义/边界/反例）→ 拆（可执行规则/trace 表/时间线）→ 用与限（照抄/改写/自写 + 代价）。
- 每章最好 ≥2 个 trace/状态表、≥1 个反例实验、≥3 个常见错误（现象→原因→改法）。
- 语气严谨克制：完整句、具体动词、先事实后判断；不用「让我们/其实/众所周知/简单来说/总而言之」这类套话；不用 emoji/网络梗/考试语气；不空夸。
- 代码示例标注类型（正文文字即可）：`[照抄]` 完整可运行、`[改写]` 前后对比、`[错误示例]`、`[读参考解]`。
- 每个代码块后写一句「运行后世界/日志会看到什么」；设计稿代码块必须标注「设计稿，当前构建不可运行」（本套教材不需要设计稿代码）。

## 6. 工作流

```powershell
# 写完 / 改完内容后：
npx tsx scripts/build-textbook.ts --write   # 校验 + 生成 library.generated.ts
npx tsx scripts/build-textbook.ts           # 只校验
```

构建失败会列出所有问题（字数、API 越级、禁用符号、术语格式、语法错误等）。生成文件不要手改。
