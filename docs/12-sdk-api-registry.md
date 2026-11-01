# 12 — SDK API Registry（学生可见接口的唯一权威来源）

> 状态：v1（冻结候选，CP1 后不再改名）｜负责人：Lead｜最后更新：2026-10-31
> 用途：所有关卡 spec 的 `apiIntroduced` / `apiAllowlist`、`packages/sdk` 的 `.d.ts`、Monaco 补全、validator 的越级检查，都以本文件为准。
> 规则：**改名 = 改契约**，需要 ADR + Lead 签字；关卡 spec 里出现 registry 之外的名字，validator 直接报错。
> 历史说明（2026-11-01 文档审计）：本文件是设计期学生 API 命名契约；实现以 `packages/level-spec` 的 `LevelDef` 与内容代码为准，2026-11-01 的进度/玩家节拍接口不在本文件范围（见 docs/46 §2）。
> 上游：docs/05-curriculum.md、docs/06-level-spec-system.md、content/levels/*.md

---

## 1. 命名与语义规则

1. **读写分离**：读操作**同步**返回缓存快照（不返回 Promise）；写操作**异步**（返回 `Promise<void>`）。Act I–II 学生可不写 `await`（runner 自动插 await，顺序模式，见 §1.1）；Act III（L9 起）切显式 await 模式。
2. 命名：写操作用动词开头（`moveTo`、`collect`、`deposit`、`ringBell`）；读操作名词/属性（`pos`、`time`、`scenario`、`chest`）；布尔读用 `is/has`。
3. 单位：坐标 = 方块坐标；距离 = 方块；时间 = 游戏 tick（1s = 20 ticks）或秒（`wait(seconds)` 用秒）。
4. 坐标约定：`(x, z)` 为水平面（与 Minecraft 一致，`x` 东、`z` 南），`y` 为高度；**学生 API 一律用 `(x, z)` 两参数表示水平位置**，需要高度时用 `(x, y, z)`。**展开规则（2026-10-31 定稿）**：注册表中写作 `pos` 的参数，学生面一律展开为 `(x, z)`；引擎侧 SDK 接收客户端传来的 `Vec2/Vec3` 并做适配。所有关卡 spec 的示例必须按展开后的签名书写（如 `golem.collect("egg", x, z)`、`golem.deposit(x, z, "egg", n)`）。
5. 世界错误：SDK 抛出 `GolemError` / `WorldError`，带 `humanMessage`（中文人话）；学生代码不需要认识内部 code。
6. 不暴露：RPC 名、socket、JSON、bot 内部状态、插件实现类名、原始 NBT。
7. 兼容：同一符号在不同关卡的签名不变；新关卡只能「新增」符号，不能改变旧符号语义。

---

## 1.1 运行模式（runMode）：卷 I–II 顺序 / 卷 III 显式 await

关卡用 `LevelDef.runMode`（内容侧标记；兼容读取 `def.meta.runMode`）声明运行模式，缺省 `"sequential"`，旧关卡行为不变。

| runMode | 适用 | 运行时行为 | 学生写法 |
|---|---|---|---|
| `"sequential"`（默认） | Act I–II（L01–L08） | runner 在 esbuild 前做 AST 变换，**自动**给异步 SDK 调用插 `await`（顺序门面） | 写操作可直接调用，不必写 `await` |
| `"explicit"` | Act III（L9 起） | **不插 await**，只做 TS 类型剥离；写操作返回 `Promise`，由学生自己等待 | 必须写 `await`，或把 Promise 存进变量稍后 `await`，或交给 `Promise.all/allSettled/race/any` |

`explicit` 模式要点（D36 / docs/07 §3.4 / docs/03 §2588）：

- **顶层 await 允许**：学生代码整体包在 `async function` 里执行。
- **漏 await**：运行前静态检查（TS AST）发现「没被 await、也没交给 Promise 组合器、也没存变量后 await」的异步 SDK 调用，
  直接给出中文提示并停止本次运行（不执行任何世界动作）：
  `第 N 行还没等它做完：golem.xxx(…) 这里是异步操作，前面要加 await，不然你会带着 Promise 往下跑。`
  对应 2588 教学错误码（docs/03 §7）。
- **合法写法**：`await golem.moveTo(x, z)`；`const p = golem.moveTo(x, z)` 后 `await p`；
  `await Promise.all([p1, p2])`；`function f(){ return golem.say("…") }`（由调用方 await）。
- **并行**：`Promise.all` 中多个写操作同时开始、一起等待；计分按真实完成顺序/时间判定（L9 两坛并行、L10 双织偶）。
- **入口**：`runStudentSandboxed(sdk, source, { mode: "explicit" })`；runner 直连入口 `runStudentProgram(sdk, source, { autoAwait: false })`。
- **会话**：`GameSession` 读取关卡 `runMode` 选择模式；`/api/run` 行为不变（结果仍走 SSE）。
- **超时**：显式模式参考解较长，Engine 可按关卡预算传 `runTimeoutMs`（D20：`timeLimitSec + 10s`；T4 接线）。

## 2. 类型定义（`.d.ts` 摘要）

```ts
type Vec2 = { x: number; z: number }
type Vec3 = { x: number; y: number; z: number }
type BlockId = string        // "minecraft:oak_log" 或简写 "oak_log"
type ItemId = string         // "minecraft:wheat_seeds" 或简写 "wheat_seeds"
type EntityKind = "zombie" | "villager" | "iron_golem" | "allay" | "chicken" | "trader" | "llama"

interface ItemStack { kind: ItemId; count: number; name?: string }
interface Container { pos: Vec3; items(): ItemStack[]; count(item: ItemId): number }
interface Entity { id: string; kind: EntityKind | string; pos: Vec3; name?: string; health?: number }
interface Machine { start(): void; stop(): void; status(): string }  // L8 学生面同步签名；引擎内部异步排队（L9 才显式 Promise）
interface Job { id: string; name: string; requires: "axe" | "pickaxe" | "sword" | "shovel" | "hoe"; at: Vec3 }
type Recipe = "weakness" | "swiftness" | "healing"           // L9 酿造配方（仅本关可见）
interface Brew { recipe: Recipe; stand: Vec3; done: Promise<void> }  // L9：Future 形态，学生存起来稍后 await
```

## 3. 符号表（按引入关卡）

### L1（顺序 / 调用）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `golem` | `Golem` | — | 织偶单例（L10 前） |
| `golem.pos` | `Vec3` | 读（同步） | 当前位置（只读快照） |
| `golem.moveTo(x, z)` | `Promise<void>` | 写 | 寻路走到 (x, z) 同一高度地面 |
| `golem.place(block, x, y, z)` | `Promise<void>` | 写 | 在指定位置放置方块（必须有相邻支撑） |
| `golem.say(text)` | `Promise<void>` | 写 | 织偶在头顶气泡/聊天里说话 |
| `golem.where()` | `Vec2` | 读（同步） | `golem.pos` 的兼容别名（L01 spec 使用；二者同义） |

### L2（变量 / 记忆）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `golem.count(item)` | `number` | 读（同步） | 背包里某物品数量 |
| `golem.has(item, count?)` | `boolean` | 读（同步） | 背包是否够数 |
| `golem.collect(item, x, z)` | `Promise<number>` | 写（返回收集数量） | 从 (x,z) 处的方块/容器收集物品到背包（如鸡窝的鸡蛋） |
| `golem.deposit(x, z, item, count)` | `Promise<void>` | 写 | 把背包里 count 个 item 放进 (x,z) 处容器（桶/箱子） |
| `world.container(x, z)` | `Container` | 读（同步） | 只读容器快照（含 count/items） |

> 关卡作者若已使用 `takeEgg`/`storeEggs`/`barrelCount` 等关卡专用名，**建议改为上面通用 API**；如保留，必须在 spec 「代码与 API」节加「与 registry 的映射表」，validator 白名单需包含映射后的通用名。

### L3（分支 / 场景试炼）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.scenario` | `Scenario` | 读（同步） | 当前试炼场景的只读状态（见下） |
| `world.countEntities(kind, radius)` | `number` | 读（同步） | 半径内某类实体数量 |
| `world.entities(kind?, radius?)` | `Entity[]` | 读（同步） | 实体快照列表 |
| `golem.ringBell()` | `Promise<void>` | 写 | 敲响最近的村庄钟 |
| `golem.placeTorch(x, z)` | `Promise<void>` | 写 | 在指定地面位置插火把 |
| `golem.patrol(...points)` | `Promise<void>` | 写 | 依次巡逻到若干点（可变参数） |

```ts
interface Scenario {
  night: number          // 第几夜（1..3）
  time: number           // 0..24000
  threat: "none" | "zombie" | "raider"
  threatCount: number
  threatDistance: number // 距村口最近威胁距离（方块）
  villagerHurt: boolean
  northGateOpen: boolean
}
```

### L4（循环 / 随机田地）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.field()` | `Field` | 读（同步） | 田地尺寸/原点/水格 |
| `golem.plant(x, z)` | `Promise<void>` | 写 | 在 (x, z) 种下一颗种子（耕地） |
| `golem.harvest(x, z)` | `Promise<void>` | 写 | 收获 (x, z) 的作物 |
| `golem.placeScarecrow(x, z)` | `Promise<void>` | 写 | 放稻草人（玩家节拍用，学生可调用） |

```ts
interface Field {
  rows: number; cols: number; origin: Vec2
  water: Vec2[]           // 水格位置（保留数组形态）
  waterRow: number | null // 若水渠是整行，给标量（推荐学生用这个，避免数组下标）
}
```

### L5（函数 / 模块）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.plot(id)` | `Plot` | 读（同步） | 第 id 个地块（位置/尺寸/风格要求） |
| `golem.placeSign(pos, lines)` | `Promise<void>` | 写 | 放告示牌并写最多 4 行文字（玩家节拍 UI 输入） |
| `golem.fill(block, from, to)` | `Promise<void>` | 写 | 用方块填满区域（教学用，避免每块手写） |
| `golem.clear(from, to)` | `Promise<void>` | 写 | 清空区域 |

```ts
type RoofStyle = "oak" | "spruce" | "brick"
interface Plot { id: number; origin: Vec2; size: number; style: RoofStyle; hasDoor: boolean }
```

### L6（记录 / 变体 / 模式匹配）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.containers()` | `Container[]` | 读（同步） | 所有可分类容器的快照 |
| `world.jobs()` | `Job[]` | 读（同步） | 当日工作报告（需要什么工具） |
| `golem.giveTool(jobId, toolKind)` | `Promise<void>` | 写 | 把工具（`ToolKind`：axe/pickaxe/sword/shovel/hoe）交给对应工作 |
| `world.caravan()` | `Caravan` | 读（同步） | 商队信息（羊驼/交易需求） |

```ts
interface Caravan { traderPos: Vec3; demand: ItemStack[]; offer: ItemStack }
```

### L7（闭包 / 高阶 / 管道 / 迭代器）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `allay` | `Allay` | — | 悦灵控制对象（本关） |
| `allay.release()` | `Promise<void>` | 写 | 释放悦灵（玩家节拍可同时做） |
| `allay.assign(name, strategy)` | `Promise<void>` | 写 | 给悦灵一条策略：`strategy: (item: ItemStack) => boolean` |
| `allay.patrol(route)` | `Promise<void>` | 写 | `route: Generator<Vec2>` 或 `Vec2[]`，无限路线用 generator |
| `world.items(pos)` | `ItemStack[]` | 读（同步） | 容器内物品快照（`world.container(pos).items()` 等价） |
| `world.give(x, z, item, count)` | `Promise<void>` | 写 | 把物品送进 (x,z) 处容器（供管道末端使用） |

**Prelude（L7 起全局可用，Monaco 补全可见）**：`pipe(...fns)`、`map(f)`、`filter(p)`、`reduce(f, init)`、`take(n, iterable)`（返回前 n 项数组）、`repeat(n, fn)`、`when(pred, fn)`、`assert(cond, msg)`。

### L8（接口 / 组合）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.machines()` | `Machine[]` | 读（同步） | 工坊里的机器集合（各自实现 `Machine` 契约；学生面 `start/stop` 为同步 void，引擎内部排队执行） |
| `world.lever()` | `Promise<void>` | 写 | 拉下总开关（玩家节拍可同时做） |
| `grader.injectMachine(m)` | — | 仅隐藏测试 | 测试注入：给 `runAll` 一台学生没见过的机器（见 L8 spec） |

> `Machine` 接口由学生在代码里定义（`interface Machine { start(): void; stop(): void; status(): string }`；学生面同步签名，引擎内部异步排队，L9 才显式 Promise）；SDK 的 `world.machines()` 返回的对象在结构上满足它。

### L9（异步 / Future / 错误）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.clock` | `{ time: number; dawnIn: number }` | 读（同步） | 游戏内时间与距黎明秒数 |
| `world.startBrewing(recipe)` | `Promise<Brew>` | 写（返回 Future） | 开始酿造，立刻返回 Promise（代表将来的结果） |
| `world.hasItem(item)` | `boolean` | 读（同步） | 营地物资是否有某物 |
| `world.brewStand(pos)` | `BrewStand` | 读（同步） | 酿造台状态 |
| `golem.treatZombieVillager(pos)` | `Promise<void>` | 写 | 使用虚弱药水+金苹果治疗（玩家节拍可同时做） |
| `golem.ringDawnBell()` | `Promise<void>` | 写 | 敲晨钟（完成条件） |

**错误语义**：`startBrewing` 在缺材料时返回 rejected Promise（学生用 `try/catch` 处理）；`timeout` 由 runner 产生 `GolemError`。

### L10（并发 / 消息）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `agent(name)` | `Agent` | 创建 | 取得指定织偶（`"左织"` / `"右织"`），L10 前不可用 |
| `agent.pos` | `Vec3` | 读（同步） | 该 agent 位置 |
| `agent.send(msg)` | `Promise<void>` | 写 | 发消息到**该 agent** 的邮箱（`agent("右织").send(...)` = 发给右织；右织用 `receive()` 取） |
| `agent.receive(timeoutSec?)` | `Promise<Msg>` | 写 | 等待下一条消息（超时 reject） |
| `agent.tryReceive()` | `Msg \| null` | 读（同步） | 非阻塞取消息 |
| `world.supply(pos)` | `Container` | 读（同步） | 共享材料箱快照 |
| `world.keystone()` | `Promise<void>` | 写 | 放置合龙石（玩家节拍也可） |
| `agent.waitIdle(name)` | `Promise<void>` | 写 | 等待 agent 空闲（结算用） |

```ts
type Msg = { from: string; text: string; tick: number }
interface Agent extends Golem { send(msg: string): Promise<void>; receive(timeoutSec?: number): Promise<Msg>; tryReceive(): Msg | null }
```

### Epilogue（元语言 / 解释器）

| 符号 | 签名 | 读/写 | 说明 |
|---|---|---|---|
| `world.runTablet(fn)` | `Promise<void>` | 写（回调 harness） | 把学生的 `run(program)` 作为回调交给 harness：harness 用 3 条测试表 + 1 条史诗表调用它并记录图案；学生最后一行写 `world.runTablet(run)` |
| `golem.writeRune(text)` | `Promise<void>` | 写 | 在织机面板上刻字（结尾演出） |

> Epilogue 不引入新 SDK 概念，只把前 7 关学过的数据/函数/循环用于「解释器」；`world.runTablet` 仅用于最终演出。

## 4. 各关 API 增量（validator 用）

| 关卡 | 新符号数 | 新增符号 |
|---|---|---|
| L1 | 4 | `golem.pos`、`golem.moveTo`、`golem.place`、`golem.say`（+兼容 `where`） |
| L2 | 4 | `golem.count`、`golem.collect`、`golem.deposit`、`world.container` |
| L3 | 4 | `world.scenario`、`world.countEntities`、`golem.ringBell`、`golem.placeTorch`（+`patrol`） |
| L4 | 3 | `world.field`、`golem.plant`、`golem.harvest`（+`placeScarecrow`） |
| L5 | 3 | `world.plot`、`golem.fill`、`golem.placeSign`（+`clear`） |
| L6 | 4 | `world.containers`、`world.jobs`、`golem.giveTool`、`world.caravan` |
| L7 | 4 | `allay`、`allay.assign`、`world.items`、`world.give`（+ prelude `pipe/map/filter`；`allay.release`/`allay.patrol`/generator 标 `kind: extension`，不计教学符号） |
| L8 | 2 | `world.machines`、`world.lever` |
| L9 | 4 | `world.clock`、`world.startBrewing`、`golem.treatZombieVillager`、`golem.ringDawnBell`（+`world.hasItem`） |
| L10 | 4 | `agent`、`agent.send`、`agent.receive`、`world.supply`（+`agent.tryReceive`） |
| EP | 0 | 复用前序 |

> 规则：新符号 >5 一律打回（与 `docs/05` §7.1 一致）。所有写 API 在 Act I–II 可省略 `await`（顺序模式）；L9 起明确教 `await`。计数口径：教学符号（`apiIntroduced`）≤5；同族方法（`tryReceive`/`waitIdle`）与纯演出 harness（`runTablet`/`writeRune`）不计入，但必须列入 `apiAllowlist` 并标 `kind: extension|harness`（见 docs/06 §6.1 #5）。

## 5. 兼容与迁移

- 关卡 spec 中如出现 registry 之外的名称（例如 L02 的 `takeEgg/storeEggs/barrelCount`），二选一：**改为通用名**（推荐）或在 spec 末尾提供「名字 → registry 名」映射；validator 会检查映射并给出引用计数。
- 已冻结：`golem.moveTo`、`golem.place`、`golem.say`、`golem.pos`、`world.scenario`、`world.field`、`world.container`、`world.machines`、`world.startBrewing`、`agent`。改这些 = 破坏 L01/L03 已冻结 spec，必须 Lead 签字。
- 本文件与 `docs/07-architecture.md` §3 的协议是两层：协议面向引擎↔插件（RPC 名），registry 面向学生（语义名）；不要混用。
