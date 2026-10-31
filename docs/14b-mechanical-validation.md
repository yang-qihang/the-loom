# 14b — 关卡 spec 机器/契约/格式独立校验（Mechanical Validation）

> 状态：v1 独立校验报告（只读，未修改其它文件）｜校验人：scout-assurance（fresh reviewer）｜最后更新：2026-10-31
> 快照：**2026-10-31 12:10**。范围：`content/levels/*.md` 已交付 **13 份**（L01–L07、L08–L10、L-Epilogue、LAB-R、LAB-T；L07 于校验期间落盘，L06 已交付），`content/level-spec.schema.json`、`docs/05/06/07/12`、`docs/02b`。
> 方法：Python 解析全部 YAML 块 + 手写 meta schema 校验 + registry/builder/event/primitive 白名单比对 + 学生代码块扫描（语法阶梯/API 名/越级调用）+ 断言与隐藏测试抽查。设计期裁决（docs/06 §2：只强制 `meta` 机器块，其余散文合法）已作为前提，**不把散文格式当失败**。
> 说明：本报告只做机器/契约/格式，不评价学习设计（那部分归 pedagogy critic）。PASS/WARN/FAIL 定义：PASS=可直接进实现；WARN=能实现但会带债/需文档补一句；FAIL=按现有契约实现会卡住或判分错误。
>
> **一句话结论**：13 份 spec 的机器骨架（meta/schema、隐藏测试、advancement、预算）是健康的；但 **8 个 FAIL 中有 5 个是契约缺口**（`g` API、事件 payload、builder 白名单、primitive 白名单），不先修 docs，implementor 会各写一套。
>
> **校验脚本做了什么**（一次性只读审计，不落盘）：① 解析 13 份 spec 的全部 YAML 块；② 按 schema 手写 meta 子校验（required/type/pattern/enum/min/max）；③ 用 docs/12 §4 建「每关新符号 + extension/harness」集合，比对 `apiIntroduced`/`apiAllowlist`；④ 按 docs/06 §4 的语法阶梯扫描 `starterCode`/`referenceSolution`；⑤ 比对 docs/06 §5.4 primitive、docs/07 §6 builder、docs/07 §3.3 事件、docs/06 §5.2 `g` API；⑥ 检查预算（叙事/mainTask/hints/时长）与隐藏测试。所有 FAIL/WARN 均已回原文逐行复核。

## 1. 全关卡汇总（★=PASS，△=WARN，✗=FAIL）

| 关卡 | 1 meta/schema | 2 API registry | 3 语法阶梯 | 4 断言可判定 | 5 预算 | 6 格式/节 | 7 交叉引用 | 8 一致性抽样 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L01 | ★ | ✗ | ★ | △ | ★ | ★ | △ | △ |
| L02 | ★ | ★ | ★ | ★ | ★ | ★ | ✗ | ★ |
| L03 | ★ | △ | ★ | △ | ★ | ★ | ✗ | △ |
| L04 | ★ | △ | ★ | ★ | ★ | ★ | ✗ | ★ |
| L05 | ★ | △ | ★ | ✗ | ★ | ★ | ✗ | ★ |
| L06 | ★ | ★ | ★ | ✗ | ★ | ★ | ✗ | ★ |
| L07 | ★ | △ | ★ | △ | ★ | ★ | ✗ | ★ |
| L08 | ★ | ★ | ★ | ✗ | ★ | ★ | ✗ | ★ |
| L09 | ★ | △ | ★ | ✗ | ★ | ★ | ✗ | △ |
| L10 | ★ | ★ | ★ | ✗ | ★ | ★ | ★ | △ |
| L-Epilogue | ★ | △ | ★ | △ | ★ | ★ | ★ | ★ |
| LAB-R | ★ | ★ | ✗ | △ | ★ | ✗ | ✗ | △ |
| LAB-T | ★ | △ | ★ | ★ | ★ | ✗ | ✗ | △ |

**维度 2 的基准**：API 名 ∈ `docs/12` §3/§4；扩展（`kind: extension`）不计教学符号但必须走 allowlist。**维度 3 的语法门槛**：L1 调用/字面量；L2 const/let；L3 if/else；L4 for/while；L5 function/import；L6 type/switch；L7 箭头/map/pipe/generator；L8 interface；L9 async/await；L10 agent。**维度 6**：0–12 节模板（docs/06 §4，§12 可选）。**维度 8**：L01/L02 坐标约定、L08/L09 签名、L10 预算与断言。

**meta 机器校验 13/13 全部通过**：`id` 匹配 `^(L[0-9]{2}|LAB-[A-Z])$`（`L11=L-Epilogue` 已由 docs/06 注明）；`title.zh` 非空；`act/order/priority/estimatedMinutes/difficulty` 与 docs/05 §6 一致（时长逐关在区间内）；`abstractions` 1–2 个且 ∈ A0–A14/X1/X2；`reward.rune ∈ abstractions`；`reward.advancement` 全匹配 `loomcraft/[a-z0-9_/]+` 且 13 份无重复；`prerequisites` 与 docs/05 依赖图一致（唯一例外见 WARN 4）。**结论：meta 层不需要返工，问题都在契约与代码示例层。**

## 2. FAIL 明细（每项给最小修法）

**F1｜L01 学生 API 风格与 registry 脱节（维度 2，必修）**

- 位置：`L01` meta `apiIntroduced: [moveTo, place, say, where]`、§4 successCriteria、§5 starterCode/referenceSolution 全部用裸名 `moveTo/place/say/where`；`docs/12` §3 与 `docs/03` 都写 `golem.moveTo/golem.place/golem.say`（L02–L07 已全部用 `golem.*`）。`where` 与 `pos` 的别名关系只在 L01 有，registry 未冻结。验证：`grep -n 'moveTo(' content/levels/L01-first-light.md` 与 `docs/12` §3 对照。
- 最小修法：L01 统一改为 `golem.moveTo / golem.place / golem.say / golem.pos`（`where` 删除或降为「L1 教学别名」并在 docs/12 §3 明写）；同步 §4 断言与 §5 示例、allowlist。改动约 20 处，30 分钟。

**F2｜L03 使用已删除 primitive + 未登记 primitive（维度 7，必修）**

- 位置：`L03` staging 用 `saveSnapshot`/`restoreSnapshot`（docs/06 §5.4 v2 已**删除**）与 `waitUntil`（v2 白名单没有）。同类：`wait` 用于 L01，`waitUntil` 用于 L02–L05/L07。验证：`grep -n 'saveSnapshot\|waitUntil' content/levels/L03-bell-at-dusk.md`。
- 最小修法：L03 三夜试炼改为 v2 的 `trialPatch` + `resetScene`（或 `beginTrial/endTrial`）；docs/06 §5.4 v2 补回 `wait`、`waitUntil`（docs/07 §6 已在用），否则 6 份 spec 都过不了 validator。

**F3｜L09 事件名不在 docs/07 §3.3（维度 4/7，必修）**

- 位置：`L09` 断言/演出使用 `cure.splash`、`cure.done`、`dawn.break`、`run.error`、`trade.witch`；docs/07 现有事件为 `potion.splash`、`entity.cured`、`bell.ring` 等。验证：`grep -o 'cure.splash\|cure.done\|dawn.break\|run.error\|trade.witch' content/levels/L09-before-dawn.md | sort | uniq -c`（各 1–7 处）。
- 最小修法：二选一（推荐 A）：A. 把 `dawn.break`、`run.error`、`trade.witch` 补进 docs/07 §3.3，L09 的 `cure.splash`→`potion.splash`、`cure.done`→`entity.cured`；B. 全部改写为「clock/时间 + 状态字段」断言。改 spec 约 1 h。

**F4｜L08 事件名不在 docs/07（维度 4/7，必修）**

- 位置：`L08` 断言用 `machine.call`、`chat`、`lever.pull`；docs/07 只有 `machine.start/machine.stop`、`agent.say`。验证：`grep -c 'machine.call' content/levels/L08-one-heartbeat.md` → 8 处。
- 最小修法：docs/07 §3.3 增加 `machine.call`（含 `kind/machine` 字段）、`lever.pull`、`chat`；或把 L08 断言改为 `machine.start/stop` + `agent.say`。前者更贴合 L08「按 machineId 去重」的设计，30 分钟。

**F5｜判分 API `g` 与事件字段无契约（维度 4，跨 6 关，最系统性）**

- 位置：`L01` 用 `g.lamps`（未声明 `world.regions`）、`e.pos.equals/equalsAny`；`L05` 用 `e.text`（`sign.edit` 事件也未登记）；`L06` 用 `g.shrine`、`e.got`；`L08` 用 `g.injected.mockIds`；`L10` 用 `g.var("deck"/"materialsLeft"/"deadlock"/"durationSec")`、`e.by`；另 `L05/L06/L07/L08/L09` 用 `e.byPlayer`，而 docs/07 已定稿 `actorType ∈ {player,agent}`。验证：`grep -n 'g\.var\|g\.injected\|g\.shrine\|g\.lamps' content/levels/*.md`。
- 最小修法：在 docs/06 §5.2 增加 `g.region(name)`（命名区域来自 spec `world.regions`，L01 补 `regions.lamps`）、`g.injected`（仅隐藏测试）、`g.var(name)`（trial 变量，声明式）；在 docs/07 §3.3 补事件 payload 字段表（`actorType/byPlayer` 双字段兼容、`block/items/got/target/kind/machine/byGolem`）；或把断言改写为现有 API。**不改契约则 grader 无法实现 L01/L05/L06/L08/L10 的判分。**

**F6｜builder 名不在 docs/07 §6 白名单（维度 7，跨 7 关）**

- 位置：L03 `nightWatch`；L04 `wheatField/barnBarn/scarecrowHead/scarecrowBase`；L05 `villageWell/plotRow/villagerFamilies`；L06 `caravanCamp`；L07 `allayRoost`；LAB-R `totemPlateau`；LAB-T `supplyDepot`。docs/07 §6 明确「validator 强制 builder ∈ 本清单」。验证：`grep -h -o 'builder: [a-zA-Z]*' content/levels/*.md | sort -u` 对比 docs/07 §6。
- 最小修法：把这 12 个 builder 补进 docs/07 §6 清单（推荐，实现成本低、与 02b 的道具方案一致）；或各 spec 改用已有 builder。**不补则 7 关 validator 必红。**

**F7｜LAB-R 语法越级（维度 3，必修）**

- 位置：`LAB-R` starter/reference 用 `async function` + `await buildTier(...)` + `Promise<void>`；该 Lab 的前置是 L05（docs/05 依赖图 L5→Lab-R），async/await 到 L9 才教。验证：`grep -c 'async\|await' content/levels/LAB-R-recursion-totem.md` → 10 处。
- 最小修法：删掉 async/await，改用顺序执行模式（引擎已隐藏 await；reference 直接调用即可）；若坚持 async，则把 Lab-R 前置改到 L09 之后（不推荐，破坏 Act II 节奏）。

**F8｜LAB-R/LAB-T 章节编号不符合 §4 模板（维度 6，必修）**

- 位置：LAB-R 只有 0/2/4/5/6/8/9/11 节，LAB-T 重排为 0–7（「1. 叙事与世界」「2. 任务与评分」…）。docs/06 §4 的 0–12 模板未声明实验室例外。验证：`grep -n '^## ' content/levels/LAB-R-recursion-totem.md`。
- 最小修法：按 §4 重新编号（内容不变，30 分钟/份）；或在 docs/06 §4 增加「Lab 简化模板」并明确豁免的节号。二选一，不要两套并存。

## 3. WARN 明细（可带债实现，但需登记）

1. **扩展符号混入 apiIntroduced**：L04 `golem.placeScarecrow`、L05 `golem.clear`、L07 `world.items`（registry §4 未列）、L09 `world.hasItem`、L-Epilogue `world.runTablet/golem.writeRune` 均属 extension/harness；docs/06 §6.1 #5 要求它们只进 allowlist 并标 `kind`。修法：移出 apiIntroduced 或给 apiIntroduced 加 `kind` 标注，并同步 docs/05 §7.1 的「新 API 符号数」。
2. **docs/05 计数与 spec 不一致**：L3 文档写 3、spec/registry 实为 4；L4/L5/L7/L9 因扩展算入导致 4 vs 3、4 vs 3、5 vs 4、5 vs 4。修法：docs/05 §7.1 按「教学符号」口径重算并加脚注。
3. **`byPlayer` vs `actorType`**：L05/L06/L07/L08/L09/L10 断言仍写 `e.byPlayer`，docs/07 定稿是 `actorType`；L01 已改。修法：插件事件同时发 `actorType` 与 `byPlayer`（兼容 1 行），docs/07 写清二者等价。
4. **LAB-T 前置**：spec `prerequisites: [L07]`，docs/05 依赖图是 L6→Lab-T；且 `assert` 是 L7 prelude。修法：以 L07 为准更新 docs/05 依赖图（推荐）或把 assert 移到 Lab-T 专属引导。
5. **L01 的隐藏测试例外**：L01 现为「固定布景 + 物理走位/无多放」检查（无随机化），符合审计裁决，但需在 docs/06 §6.1 #8 明确「L1 例外条件 = 物理走位 + 顺序检查」，否则 validator 会按通用规则报红。
6. **L01 的 `world.regions` 缺失**：`g.lamps` 需要 spec 声明 `regions.lamps`；当前 L01 没有 regions 字段（schema 允许但 g 依赖）。
7. **LAB 不可用 registry §4 校验**：docs/12 §4 只有 L1–EP，没有 LAB-R/LAB-T 行；verifier 对 Lab 只能跳过或特判。修法：docs/12 §4 增加两行（Lab 的 apiIntroduced=[] / assert 归 prelude 并注明）。
8. **格式小项**：L01 缺 §12（§12 可选，PASS）；hints/对话在散文型 spec（L01/L08/L09/LAB）无法机器校验预算，建议实现期转换时补测量脚本。

9. **事件 payload 字段缺表**：除 F5 的 `e.text/e.got` 外，`L05` 的 `sign.edit`、`L06` 的 `trade`、`L07` 的 `player.interact(e.target)` 都依赖未定义的 payload 字段；与 F5 同源，建议 docs/07 §3.3 一次补全「事件 → 字段」表（每个事件列 2–4 个必要字段）。
10. **LAB 的 registry 行缺失**：docs/12 §4 只有 L1–EP，没有 LAB-R/LAB-T 行；LAB-R `apiIntroduced: []`、LAB-T `[assert]`（L7 prelude）只能靠 verifier 特判。修法：docs/12 §4 加两行（Lab-R 0 个；Lab-T 0 个教学符号，`assert` 归 prelude 并注明）。
11. **L01 `where` 的处理方式**：L01 仍用 `where`，docs/12 §3 把它写成 `golem.pos` 的兼容别名。若 F1 选择「保留 where」，必须在 registry 明写「L1 学生面可省略 `golem.` 前缀」；不建议这样做（L2+ 全用 `golem.*`，新手会困惑），建议直接统一为 `golem.pos`。

## 4. 全局 validator/schema 缺口（比单关更值得先修）

1. **schema 与设计期裁决不一致**：schema 顶层 `required` 仍是 9 个字段，而 docs/06 §2 裁决设计期只强制 `meta`。level-kit 若直接跑 schema，13 份全部必红。**修法**：加 `designTime` 模式（`required: ["meta"]` + 只校验 `meta` 子 schema），或在 docs/06 指定 validator 只引用 `schema.properties.meta`。
2. **primitive 白名单 v2 与 spec 漂移**：v2 删了 `saveSnapshot/restoreSnapshot` 但 L03 在用；v2 漏了 `wait/waitUntil` 但 6 关在用。**修法**：docs/06 §5.4 补 `wait/waitUntil`，L03 换 `trialPatch/resetScene`，并让 validator 对「设计期允许白名单外 op」只 WARN（实现期必须映射）。
3. **builder/事件/`g` API 三张表需要作为 validator 的输入**：docs/07 §6 builder 清单、§3.3 事件表、docs/06 §5.2 `g` API 表。当前 specs 在这三处各有越界（F5/F6/F3/F4）；建议 docs/06 §6.1 增加三条机器规则：builder ∈ 清单、`g.events(name)` ∈ 事件表、`g.*` 方法 ∈ `g` API 表。
4. **命名别名**：schema id 用 `L01`，docs/05/12 用 `L1`；`L-Epilogue=L11=EP` 已定稿。validator 需要一张 alias 表（`L1↔L01`、`EP↔L11`、`Lab-R↔LAB-R`），否则 registry/课程表对不上。

5. **validator 输出规范缺失**：建议 `level-kit validate-spec` 输出 JSON（`{level, checks:[{id, status, section, message}], exitCode}`），并复用本报告 F/W 编号或 M1–M8 编号；否则每个 implementor 各写脚本，CI 结果无法比较、也无法回归。

**复核备注**：本报告与 `docs/00-consistency-review.md` 的修复状态一致——schema/L02/Java 25/事件表/`g` API 等 P0 已在 12:00 前修复，剩余内容侧契约问题即本报告 F1–F8。审计期间 L06/L07 落盘、docs/06/07/12 仍在小改，复验请按「关键字 + 节号」定位，不要只依赖行号。

## 5. 结论：能否交给实现 agent？

**不能全部交付。** 13 份 spec 的 **meta/schema 全部 PASS**（字段齐全、id/act/order/prerequisite/优先级/时长/符文-抽象一致、advancement 全局唯一），隐藏测试 ≥1、无恒真断言（L10 的 `return true` 是循环终止，不是恒真）、reference 无 TODO——**机器骨架是健康的**；但 8 个 FAIL 里有 5 个是「契约缺口」（F2/F3/F4/F5/F6 需要先改 docs/06/07/12），3 个是 spec 自身要改（F1 L01 API、F7 LAB-R async、F8 Lab 章节）。

建议修复顺序（约 2–3 h）：①先修 4 张契约表（`g` API、事件 payload、builder 白名单、primitive 补回）——这些不改，implementor 会各写一套；②修 L01 API 风格与 L03 primitive；③修 L09/L08 事件名；④重编号 LAB-R/T 并去掉 LAB-R 的 async；⑤最后跑一遍本报告的脚本复验（脚本逻辑已固化：YAML 解析 + meta schema + registry/白名单比对 + 语法阶梯扫描）。修完后 Level spec 可以交给 Content/Platform implementor；在此之前，建议把本报告 F1–F8 直接转成 8 张 task 卡（每张给「文件 + 最小 diff 范围 + 验收命令」）。

**修复后最小复验清单**：① `grep -c 'saveSnapshot\|restoreSnapshot' content/levels/*.md` 为 0（或 docs/06 已补回）；② `grep -h -o 'builder: [a-zA-Z]*' content/levels/*.md` 全 ∈ docs/07 §6；③ `grep -o 'events("[^"]*"'` 全 ∈ docs/07 §3.3；④ L01 无裸 `moveTo(`；⑤ LAB-R 无 `async/await`；⑥ `grep '^## '` 与 docs/06 §4 模板对齐；⑦ 重跑本报告脚本→0 FAIL。以上 7 条可当作 8 张 task 卡的联合验收命令。
