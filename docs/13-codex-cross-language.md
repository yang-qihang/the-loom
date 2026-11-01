# 13 — 《织典》跨语言对照页（Codex: Cross-Language Pages）

> 状态：v1 草稿｜负责人：scout-prior-art（Lead 委派）｜最后更新：2026-10-31｜上游：docs/01、docs/03、docs/04 §7、docs/05 §3/§8、docs/12
> 用途：游戏内每枚符文解锁一页的正文来源；每页固定骨架 = 问题 → 机制 → 代价 → 跨语言对照 → 在我们游戏里 → 常见误解（docs/04 §7）。
> 代码核验：C/C++（gcc 16.2.1）、Java（javac 25）、Haskell（ghc 9.10.3）、Rust（rustc 1.98.1）、Python 3.14.8、Node 22.23.1、TypeScript 6.0.3（项目锁定版）本机编译/类型检查通过；Go/Erlang/Scheme 片段因本机无工具链标注「待核」，见文末清单。
> 历史说明（2026-11-01 文档审计）：本文件为设计阶段产物（2026-10-31），保留原始设计结论；实现与当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

## 0. 使用与解锁约定（给 UI / 关卡实现）

- **解锁节奏**：A0/A1→L1，A2→L2，A3→L3，A4→L4，A5/A6→L5，A7/A8→L6，A9/A10→L7，A11→L8，A12→L9，A13→L10，A14→Epilogue；X1→Lab-R，X2→Lab-T（与 docs/05 §3 的抽象地图一一对应）。
- **页面由本文件生成**：UI 固定四段「问题 → 机制 → 代价 → 跨语言对照」，再追加「在我们游戏里 / 常见误解」两块；不要改写代码块，只做语言 tab 切换与折叠。
- **跨语言选材原则**：选「在该语言里最自然」的写法，而不是强行逐行等价；差异本身就是教学内容。标「待核」的片段在 UI 里加小字「示例，未在本机构建验证」。
- **误解高发页**（A8/A11/A13）在标题旁挂「常见误解」徽章，点开即读该页最后一句。

### A0 求值 — 织机之心（Evaluation / Notional Machine）

**解决**：程序不是许愿：它按固定规则求值、按顺序执行；先能预测「下一句会发生什么」。
**机制**：表达式先算出一个值，语句再按书写顺序一条条执行。
```ts
const y = 2 * 3;        // 先算出 6
golem.moveTo(6, y);     // 再把结果当参数用
```
**代价**：它不理解意图；写错一个字，错的就是结果。
**跨语言**：
```python
# Python（解释器逐句执行）
y = 2 * 3
print(y)
```
```c
// C（先编译成机器码，运行时不再看源码）
int y = 2 * 3;
printf("%d\n", y);
```
```haskell
-- Haskell（纯表达式，惰性求值：y 可以一直不算）
y = 2 * 3
main = print y
```
```js
// JavaScript（事件循环上依次执行任务）
const y = 2 * 3;
console.log(y);
```
**在我们游戏里**：L1「第一缕光」——你改一个坐标，灰崽就多走一步；写成想当然的顺序，它真的会卡住。
**常见误解**：「它应该懂我的意思」——织偶只做你写的，不做你想的。

### A1 顺序 — 顺序之符（Sequencing）

**解决**：世界按时间发生，动作有先后依赖；顺序错了，结果就错。
**机制**：一条写完再写下一条；游戏里写操作按调用顺序入队，程序结束自动排空。
```ts
golem.moveTo(-12, 10);                 // 1
golem.place("lantern", -12, 14, 10);   // 2 必须在 1 之后
golem.moveTo(-12, -2);                 // 3
```
**代价**：写得越长越难改（为 L4 循环、L5 函数埋线）。
**跨语言**：
```c
// C（语句按分号顺序执行）
int x = 1;
x = x + 1;
printf("%d\n", x);
```
```python
# Python（自上而下）
print("walk")
print("place")
```
```haskell
-- Haskell（do 把 IO 动作串成顺序）
main = do
  putStrLn "walk"
  putStrLn "place"
```
```js
// JavaScript（同步语句顺序执行）
console.log("walk");
console.log("place");
```
**在我们游戏里**：L1 第四盏灯必须最后点亮；先点它，前面的灯不会自己亮（隐藏测试会抓）。
**常见误解**：「都写上了就行」——没写清楚先后，顺序会由运行时而不是你的意图决定。

### A2 变量 — 记忆之符（Variables / Binding / Mutable State）

**解决**：需要「记住」中间结果；否则每次从头算，或者把值写死。
**机制**：给值起名；可变绑定能重新赋值，不可变绑定只能新定义。
```ts
let eggs = 0;
eggs = eggs + 1;         // 旧值 -> 新值
const home = golem.pos;  // 绑定后不再改变
```
**代价**：状态一多就乱：谁改了它？为什么变？（为 L10 共享状态埋线）
**跨语言**：
```c
// C（变量 + 赋值）
int count = 0;
count = count + 1;
```
```python
# Python（动态绑定，名字可指向新对象）
count = 0
count = count + 1
```
```haskell
-- Haskell（绑定不可变；"赋值"其实是新绑定/遮蔽）
count = 0 + 1
```
```rust
// Rust（可变必须显式声明）
let mut count = 0;
count += 1;
```
**在我们游戏里**：L2「会数数的织偶」——它没有记性，收到 3 枚蛋就重新开始兜圈；你给它一个变量追着数。
**常见误解**：「x = x + 1 是数学等式」——它是「把旧值加一后存回去」。
**延伸**：[MDN let](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/let)

### A3 分支 — 抉择之符（Booleans / Branching）

**解决**：世界有多种情形（有没有威胁、村民受不受伤），一套固定动作必然在某些情形出错。
**机制**：先算出布尔条件，再选一条路走。
```ts
if (world.scenario.threat !== "none") {
  golem.ringBell();
} else {
  golem.placeTorch(0, 0);
}
```
**代价**：情形组合一多就「分支爆炸」（为 L6 的变体类型埋线）。
**跨语言**：
```c
// C（if/else，函数体内）
int zombies = 2;
if (zombies > 0) { printf("ring the bell\n"); } else { printf("light the torch\n"); }
```
```python
# Python（if/elif/else）
zombies = 2
if zombies > 0:
    print("ring the bell")
else:
    print("light the torch")
```
```haskell
-- Haskell（guard：分支的另一种写法）
decide z | z > 0 = "ring the bell"
         | otherwise = "light the torches"
```
```rust
// Rust（条件与 match 都行，函数体内）
let zombies = 2;
if zombies > 0 { println!("ring the bell"); } else { println!("light the torch"); }
```
**在我们游戏里**：L3「岔路与钟声」——同一份程序连跑三夜，条件漏一种，第三夜就守不住。
**常见误解**：「if 只会看一种情况」——条件之间要互斥且穷尽，否则总有场景漏网。
**延伸**：[Rust Book: match](https://doc.rust-lang.org/book/ch06-02-match.html)

### A4 循环 — 循环之符（Loops / Iteration）

**解决**：重复动作不该靠复制粘贴；规模未知时也要能继续。
**机制**：让同一段动作按条件重复；用终止条件收尾。
```ts
const field = world.field();
for (let r = 0; r < field.rows; r++) {
  golem.plant(field.origin.x + r, field.origin.z);
}
```
**代价**：边界与终止条件容易错：差一、越界、死循环。
**跨语言**：
```c
// C（三段式 for，函数体内）
for (int i = 0; i < 5; i++) { printf("plant %d\n", i); }
```
```python
# Python（for-in 迭代）
for i in range(5):
    print(f"plant {i}")
```
```haskell
-- Haskell（没有循环：递归 / fold）
sumTo n = go 0 1
  where go acc i | i > n = acc
                 | otherwise = go (acc + i) (i + 1)
```
```rust
// Rust（for + 迭代器，函数体内）
for i in 0..5 { println!("plant {i}"); }
```
**在我们游戏里**：L4「麦田的咒语」——25 行 `place` 写到天亮；循环几秒种完整片田，还要跳过水格。
**常见误解**：「循环 = 一直做」——没有终止条件的 while 是把时间交给意外。

### A5 函数 — 函数之符（Functions / Decomposition）

**解决**：同一行为出现在多处，改一处不该改 N 处；顺便给行为起个名字。
**机制**：把动作与「要变的参数」分离，写成可复用的函数，用返回值把结果带回来。
```ts
function buildHut(x: number, z: number): Vec2 {
  golem.fill("oak_planks", { x, z }, { x: x + 3, z: z + 3 });
  return { x, z };   // 返回门的位置
}
```
**代价**：参数与作用域是新的负担；名字起不好，抽象反而更乱。
**跨语言**：
```c
// C（函数 + 参数 + 返回值）
int add(int a, int b) { return a + b; }
```
```python
# Python（def）
def add(a, b):
    return a + b
```
```haskell
-- Haskell（柯里化：Int -> (Int -> Int)）
add :: Int -> Int -> Int
add a b = a + b
```
```js
// JavaScript（箭头函数）
const add = (a, b) => a + b;
```
**在我们游戏里**：L5「一百座房子」——复制粘贴 3 栋后再抽 `buildHut(x, z)`；隐藏测试换地块，不参数化就失败。
**常见误解**：「函数 = 写短一点」——不参数化只是把代码搬家，不是抽象。

### A6 模块 — 织典之符（Modules / Boundaries）

**解决**：东西多了一定要分边界，否则一个文件装不下整个心智。
**机制**：把函数放进独立文件并导出，用 import 显式声明依赖；游戏里由织机自动接好 import。
```ts
// blueprints.ts
export function buildHut(x: number, z: number): Vec2 { /* ... */ }
// main.ts（学生只写调用，import 由织机代劳）
const door = buildHut(10, 20);
```
**代价**：依赖关系变显式，也多了一层「东西在哪」的查找成本。
**跨语言**：
```c
// C（头文件声明 + 实现文件定义）
/* blueprints.h */ int build_hut(int x, int z);
/* blueprints.c */ int build_hut(int x, int z) { return x + z; }
```
```python
# Python（模块 = 文件，import 引入）
from blueprints import build_hut
```
```rust
// Rust（mod 划分边界，use 引入名字）
mod blueprints { pub fn build_hut(x: i32, z: i32) -> (i32, i32) { (x, z) } }
```
```js
// JavaScript（ES Module：export / import）
import { buildHut } from "./blueprints.mjs";
```
**在我们游戏里**：L5 把 `buildHut` 抽到 `blueprints.ts`；L7 再把策略函数抽出来——「同一份逻辑，织偶能用，悦灵也能用」。
**常见误解**：「import 是运行时复制一份代码」——它建立引用与依赖声明，不是复制。
**延伸**：[Python 模块](https://docs.python.org/3/tutorial/modules.html)

### A7 记录 — 结构之符·上（Product Types / Records）

**解决**：相关信息要绑在一起，否则参数爆炸、顺序错位（把「铁镐」当成「铁斧」）。
**机制**：用字段名把一组值描述成一条记录，类型负责表达「缺了哪个字段」。
```ts
type Item = { kind: ItemId; name: string };
const ledger: Item[] = [{ kind: "iron_pickaxe", name: "铁镐" }];
```
**代价**：多写类型；建模前要先想清楚「数据到底长什么样」。
**跨语言**：
```c
// C（struct：字段按名字访问）
struct Item { const char *kind; const char *name; };
```
```python
# Python（dataclass：给字段起名）
from dataclasses import dataclass
@dataclass
class Item:
    kind: str
    name: str
```
```haskell
-- Haskell（record：具名字段）
data Item = Item { kind :: String, name :: String }
```
```ts
// TypeScript（interface：结构化的记录，字段名即文档）
interface Item { kind: ItemId; name: string }
```
**在我们游戏里**：L6「商队的账本」——全字符串账本把铁镐分给了矿工；用记录 + 字段名后，三个桶各归其位。
**常见误解**：「记录 = 数组」——数组靠位置，记录靠名字；放错位置数组不会提醒你，字段名会。
**延伸**：[Python dataclasses](https://docs.python.org/3/library/dataclasses.html)

### A8 变体 — 结构之符·下（Sum Types / Discriminated Unions）

**解决**：「几种互斥情况」要能被穷举；漏一种，程序在某个场景必错。
**机制**：用 `kind` 区分互斥形态（可辨识联合），`switch` 穷举，漏项交给 `assertNever` 在编译期报错。
```ts
type Tool = { kind: "axe"; name: string } | { kind: "pickaxe"; name: string };
function useTool(t: Tool): string {
  switch (t.kind) {
    case "axe": return t.name + " chops";
    case "pickaxe": return t.name + " mines";
    default: return assertNever(t);   // 漏一种 kind 这里就编译报错
  }
}
```
**代价**：多写类型；TS 的联合不是真 ADT——没有构造子，模式匹配要靠 `switch` 模拟。
**跨语言**：
```haskell
-- Haskell（真 ADT：构造子 + 模式匹配）
data Tool = Axe String | Pickaxe String
use (Axe n)     = n ++ " chops"
use (Pickaxe n) = n ++ " mines"
```
```rust
// Rust（enum + match：编译器强制穷举）
enum Tool { Axe(String), Pickaxe(String) }
fn use_tool(t: Tool) -> String { match t { Tool::Axe(n) => n, Tool::Pickaxe(n) => n } }
```
```java
// Java（sealed interface + record + 穷举 switch，Java 21+）
sealed interface Tool permits Axe, Pickaxe {}
record Axe(String name) implements Tool {}
record Pickaxe(String name) implements Tool {}
```
```ts
// TypeScript（联合值的构造：kind 是"标签"，不是语言构造子）
type Tool = { kind: "axe"; name: string } | { kind: "pickaxe"; name: string };
const t: Tool = { kind: "axe", name: "iron axe" };
```
**在我们游戏里**：L6 新增一种工具 kind——旧 `switch` 在《织典》里标红；你必须处理新情况，账本才算完。
**常见误解**：「TS 联合类型 = 真 ADT」——它是用类型编码的和类型；真 ADT 的构造子是语言原语、模式匹配是编译器特性（Haskell/Rust/Swift enum/Kotlin sealed class 属此类）。
**延伸**：[TS Narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html)

### A9 闭包 — 流动之符·上（Closures / Functions as Values）

**解决**：行为本身是数据：要能传给别人、保存起来、稍后执行。
**机制**：函数可以返回函数；内部函数捕获定义时所在的环境（闭包）。
```ts
const home = golem.pos;
const isOre = (item: ItemStack) => item.kind.endsWith("_ore");
const goHome = () => golem.moveTo(home.x, home.z);  // 捕获 home
```
**代价**：抽象层数变多；值被记住多久、被谁改了，不看追不到。
**跨语言**：
```c
// C（函数指针：能传函数，但不能捕获局部变量）
int add(int a, int b) { return a + b; }
int (*op)(int, int) = add;
printf("%d\n", op(2, 3));
```
```js
// JavaScript（闭包：函数 + 词法环境）
const makeAdder = (n) => (x) => x + n;
```
```python
# Python（闭包：n 被内部函数捕获）
def make_adder(n):
    def add(x):
        return x + n
    return add
```
```rust
// Rust（闭包可捕获；函数指针不能）
let n = 2;
let add_n = |x: i32| x + n;
fn add_one(x: i32) -> i32 { x + 1 }
```
**在我们游戏里**：L7「信风与织线」——给悦灵一条策略函数，它自己飞；策略里捕获「回家坐标」。
**常见误解**：「C 的函数指针就是闭包」——它不能捕获局部变量；闭包 = 函数 + 环境。
**延伸**：[MDN Closures](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Closures)

### A10 高阶 — 流动之符·下（Higher-order Functions / Iterators / Pipes）

**解决**：控制流与业务逻辑缠在一起会变成泥巴；组合优于嵌套。
**机制**：把函数当参数；用 `filter`/`map`/`reduce`/`pipe` 把数据流串起来。
```ts
pipe(
  world.items(chestPos),
  filter((it: ItemStack) => it.kind.endsWith("_ore")),
  map((it: ItemStack) => it.kind),
  (names: string[]) => golem.say(`共 ${names.length} 种矿石`),
);
```
**代价**：抽象层数增加，调试不直观：出错时要知道是哪一段「管道」漏了。
**跨语言**：
```haskell
-- Haskell（组合 (.) + map/filter）
result = map (*2) . filter even $ [1, 2, 3, 4]
```
```python
# Python（推导式：过滤 + 映射）
result = [x * 2 for x in range(1, 5) if x % 2 == 0]
```
```js
// JavaScript（reduce 把列表收成一个值）
const total = [1, 2, 3].reduce((acc, x) => acc + x, 0);
```
```rust
// Rust（迭代器链，惰性求值）
let out: Vec<i32> = (1..5).filter(|x| x % 2 == 0).map(|x| x * 2).collect();
```
**在我们游戏里**：L7 把「for + if 写死分拣」重写成管道：换一条规则只改一个函数，悦灵还是那群悦灵。
**常见误解**：「管道 = 更短的循环」——关键区别是控制流被抽走，业务逻辑变成可替换的小函数。
**延伸**：[SICP JS](https://sicp.sourceacademy.org/)

### A11 接口 — 契约之符（Interfaces / Traits / Composition over Inheritance）

**解决**：用继承建模「是什么」会把系统焊死；用契约建模「能做什么」才能替换与组合。
**机制**：定义能力契约；任何满足它的对象都能传进来，新增实现不改调用方。
```ts
interface Machine { start(): Promise<void>; stop(): Promise<void>; status(): string }
const furnace: Machine = {
  start: async () => {}, stop: async () => {}, status: () => "idle",
};
function runAll(machines: Machine[]): Promise<void[]> {
  return Promise.all(machines.map((m) => m.start()));
}
```
**代价**：需要先想清契约；过度抽象会把简单系统拆得更难读。
**跨语言**：
```cpp
// C++（继承反例：菱形）
struct A { virtual void tick() {} };
struct B : A {}; struct C : A {};
struct D : B, C {};   // D 有两个 A 子对象，d.tick() 有歧义
```
```java
// Java（接口：能力契约；Furnace 与 Bell 无需同一父类）
interface Machine { default String status() { return "idle"; } }
class Furnace implements Machine {}
class Bell implements Machine {}
```
```go
// Go（隐式实现：方法集吻合即满足接口，无需 implements 声明）【待核】
type Machine interface { Start() error }
type Furnace struct{}
func (Furnace) Start() error { return nil }
```
```rust
// Rust（trait：显式 impl；可静态单态化，也可 dyn 动态分发）
trait Machine { fn start(&self) -> String; }
struct Furnace;
impl Machine for Furnace { fn start(&self) -> String { "on".into() } }
```
**在我们游戏里**：L8「同一种心跳」——艾拉的继承树（`Machine → Furnace → FurnaceWithBell`）在加「熔炉+警钟」时打结；你写接口后，验收注入一台没见过的机器，代码一行不改。
**常见误解**：「interface = typeclass = trait」——TS/Go 的 interface 是结构/能力检查（结构型、可隐式满足）；Java 的 interface 要显式 implements；Rust trait 要用 impl 声明（名义型，偏向静态分发）；Haskell typeclass 是「按类型的全局实例」（开放世界、字典传递）。名字像，语义不同。
**继承的代价**：菱形继承带来重复状态与调用歧义（C++ 需虚继承）；父类的内部调用会变成对子类的隐式契约（fragile base class）——L8 的继承小剧场演的就是这两件事。
**延伸**：[Go Tour: Interfaces](https://go.dev/tour/methods/9)

### A12 异步 — 时间之符（Async / Futures / Errors）

**解决**：等待会阻塞；把「将来的结果」先拿在手里，等待时去做别的事。
**机制**：异步函数返回 Future/Promise；`await` 取结果，`Promise.all` 同时等多个；错误是「被拒绝的 Future」，不是只能崩。
```ts
async function dawn(): Promise<void> {
  const brew1 = world.startBrewing("strength");
  const brew2 = world.startBrewing("night_vision");
  const [a, b] = await Promise.all([brew1, brew2]);   // 两个等待同时进行
}
```
**代价**：执行顺序不再直观；竞态与漏掉的 catch 是新的 bug 源。
**跨语言**：
```js
// JavaScript（Promise.all：并发等待，仍是单线程）
const brew = (p) => new Promise((res) => setTimeout(() => res(p), 100));
const r = await Promise.all([brew("strength"), brew("night")]);
```
```python
# Python（asyncio.gather）
result = await asyncio.gather(brew("strength"), brew("night"))
```
```java
// Java（CompletableFuture.allOf）
static CompletableFuture<String> brew(String p) { return CompletableFuture.supplyAsync(() -> p + " done"); }
CompletableFuture.allOf(brew("strength"), brew("night")).join();
```
```rust
// Rust（async fn 返回 Future；Result 把错误当返回值）
async fn brew(p: &str) -> String { format!("{p} done") }
fn parse(s: &str) -> Result<i32, std::num::ParseIntError> { s.parse() }
```
**在我们游戏里**：L9「破晓之前」——顺序 `await` 会错过黎明；`Promise.all` 让两个酿造台同时走，缺材料时 `try/catch` 降级。
**常见误解**：「async = 并行 = 更快」——单线程里它只是「等待时不阻塞」（并发）；真正的多核并行要 worker/线程/调度器。

### A13 并发 — 双织之符（Concurrency / Message Passing）

**解决**：多个执行者共享世界时，协调比算力更难：会抢资源、会互相等死。
**机制**：每个执行者独立跑，通过消息/邮箱通信，而不是共享内存；同步点靠协议约定。
```ts
async function weave(): Promise<void> {
  const left = agent("左织");
  const right = agent("右织");
  await left.send("锚块已放");
  const ack = await right.receive(5);   // 最多等 5 秒
}
```
**代价**：死锁、竞态、协调成本；调试要读「谁在等谁」。
**跨语言**：
```go
// Go（goroutine + channel：通信代替共享内存；需 import "fmt"）【待核】
func main() {
    ch := make(chan string)
    go func() { ch <- "left done" }()
    fmt.Println(<-ch)
}
```
```erlang
%% Erlang（actor：spawn + receive + ! 发消息）【待核】
Pid = spawn(fun() -> receive {msg, X} -> io:format("~p~n", [X]) end end),
Pid ! {msg, "left done"}.
```
```js
// JavaScript（事件循环：并发但不并行；Worker 才加线程）
setTimeout(() => console.log("B"), 0);        // 宏任务
Promise.resolve().then(() => console.log("C")); // 微任务，先于 setTimeout
console.log("A");                             // 输出 A C B
```
```rust
// Rust（线程 + mpsc 通道）
use std::sync::mpsc;
use std::thread;
let (tx, rx) = mpsc::channel();
thread::spawn(move || tx.send("left done").unwrap());
println!("{}", rx.recv().unwrap());
```
**在我们游戏里**：L10「双织者」——先给你看两只没协议、头顶「…」互等的死锁；加消息协议后，桥从两岸同时织起。
**常见误解**：「并发 = 并行」——并发是「同时处理多个任务」（交错/等待），并行是「同一时刻真的在跑」；单线程 JS 能并发不能并行，Go/Erlang 靠调度器两者都能做到。
**延伸**：[Go Tour: Concurrency](https://go.dev/tour/concurrency/1)

### A14 元语言 — 元织之符（Metalinguistic Abstraction / Data as Program）

**解决**：语言本身可以被当作数据来构造；理解这点，就理解了「语言的边界是人为的」。
**机制**：把指令写成数据（数组/对象），再写一个解释器（20 行）去执行它。
```ts
type Instruction = { op: "move"; x: number; z: number } | { op: "place"; block: BlockId };
function run(program: Instruction[]): void {
  for (const ins of program) {
    if (ins.op === "move") golem.moveTo(ins.x, ins.z);
    else golem.place(ins.block, 0, 64, 0);
  }
}
```
**代价**：抽象层级最高，离具体应用最远；调试要同时看「数据」和「执行它的程序」。
**跨语言**：
```scheme
; Scheme/R5RS（同像性：代码就是列表，可被 quote/eval）【待核】
(eval '(+ 1 2))
```
```haskell
-- Haskell（程序是数据类型，解释器是普通函数）
data Expr = Lit Int | Add Expr Expr
eval (Lit n) = n
eval (Add a b) = eval a + eval b
```
```python
# Python（eval / ast：把字符串变程序）
value = eval("1 + 2")
```
```js
// JavaScript（eval / new Function）
eval("1 + 2");
new Function("return 1 + 2")();
```
**在我们游戏里**：Epilogue「元织机」——你把艾拉留下的「远古指令表」当数据跑起来，织偶按表完成最后一笔（SICP 4.1 元循环求值器的迷你版）。
**常见误解**：「有 eval 就叫元语言」——eval 只是入口；同像性的关键是程序本身用语言的数据结构表示（Lisp 的列表），因此程序能被读、写、生成。

### X1 递归 — 递归之符（Recursion，Lab-R）

**解决**：有些结构是自相似的（塔、树、表达式）；循环不是唯一的重复方式。
**机制**：函数调用自身，用 base case 收口；每次调用把问题缩小一点。
```ts
function tower(n: number): void {
  if (n === 0) return;      // base case
  tower(n - 1);
  golem.place("stone", n, 64, 0);
}
```
**代价**：每次调用都占栈；base case 没想清 = 无限下坠。
**跨语言**：
```haskell
-- Haskell（模式匹配就是 base case 的写法）
fact 0 = 1
fact n = n * fact (n - 1)
```
```python
# Python（函数调用自身）
def fact(n): return 1 if n == 0 else n * fact(n - 1)
```
```c
// C（递归 + 终止条件）
int fact(int n) { return n == 0 ? 1 : n * fact(n - 1); }
```
```js
// JavaScript（递归）
const fact = (n) => (n === 0 ? 1 : n * fact(n - 1));
```
**在我们游戏里**：Lab-R「递归图腾」——10 行代码造出分形塔，塔尖由你亲手停住（base case）。
**常见误解**：「递归 = 循环的替换写法」——它擅长表达自相似的嵌套结构（表达式、树、目录），循环表达不了那么自然。
**延伸**：[Haskell](https://www.haskell.org/)

### X2 验证 — 证明之符（Assertion / Verification，Lab-T）

**解决**：「我觉得对」不算对；要让机器帮你检查不变量。
**机制**：在程序里写断言：条件不满足就立即失败，并打印期望与实际。
```ts
assert(
  world.containers().every((c) => c.count("iron_axe") === 1),
  "每个桶只能有一把铁斧",
);
```
**代价**：断言要写对、要维护；断言写错，反而会骗你。
**跨语言**：
```c
// C（assert.h：不满足则 abort；-DNDEBUG 可整体关闭）
int lamps_lit = 4;
assert(lamps_lit == 4);
```
```python
# Python（assert：语法级，-O 可关闭）
assert lamps_lit == 4
```
```rust
// Rust（assert_eq!：失败打印两边值；release 下默认仍保留）
assert_eq!(lamps_lit, 4);
```
```java
// Java（assert 默认关闭，需 -ea 才生效）
int lampsLit = 4;
assert lampsLit == 4;
```
**在我们游戏里**：Lab-T「证明你的符文」——给建好的装置写 4 条不变量断言，全绿才亮信标。
**常见误解**：「断言 = 日志」——日志记录发生过什么，断言在「不该发生」时当场炸；Java/Python 的 assert 默认可能被关掉，这一点要记住。
**延伸**：[Rust assert_eq!](https://doc.rust-lang.org/std/macro.assert_eq.html)

## 待核清单（交付 lead 前需补的 3 项）

1. **Go 片段（A11/A13）**：本机无 Go 工具链，按 Go 1.22 语法人工核对，未编译。验证：装 Go 后 `go vet` / `go build` 三个片段。
2. **Erlang 片段（A13）**：本机无 Erlang/OTP，按 OTP 26 语法人工核对。验证：`erlc` 编译一个带 `-module`/`-export` 的完整文件后 `erl -noshell` 跑一遍。
3. **Scheme 片段（A14）**：本机无 Racket/Guile；`(eval '(+ 1 2))` 是 R5RS 写法，在 Racket 中需带命名空间，已按「Scheme/R5RS」标注。验证：Guile 或 Chez 执行。

> 已核验环境（2026-10-31）：gcc 16.2.1 / g++ 16.2.1 / javac 25.0.4.1 / ghc 9.10.3 / rustc 1.98.1 / Python 3.14.8 / Node v22.23.1 / TypeScript 6.0.3。A8 的 `assertNever` 穷举性已用「漏一种 kind 应报 TS2345」反向测试确认。
