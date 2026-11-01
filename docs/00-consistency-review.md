# 00 — 全设计文档一致性审计（Independent Consistency Audit）

> 状态：v1 审计报告（只读审计，未修改其它文件）｜审计人：scout-assurance（fresh reviewer 视角）｜最后更新：2026-10-31
> 审计快照：**2026-10-31 11:55–12:05**。审计期间工作区持续写入/修复（L03/L04/L05/LAB-T/docs/13 落盘；L02 升 v2；schema/docs/06/docs/12/AGENTS 有并发修正）。本报告以最终快照为准，行号可能漂移，定位请用「节号 + 关键词」。已交付关卡 11 份；L06/L07/LAB-M/LAB-C 未交付，按约定不算错。
> 范围：`BRIEF.md`、`AGENTS.md`、`docs/01–13`（含 `docs/02b-level-feasibility.md`、`docs/08-appendix-templates.md`、`docs/13-codex-cross-language.md`）、`content/level-spec.schema.json`、`content/levels/*.md`、`spikes/`、`research/`。
> 方法：逐文件通读 + 跨文档脚本比对（版本串/meta/API/数字/围栏/本地引用）+ 关键声明本机复验；只报问题与修法。
> 历史说明（2026-11-01 文档审计）：本文件是设计阶段的审计/评审记录，保留原始结论与日期；部分处置与当前实现已变化，当前以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。
> 负责人：scout-assurance（审计人）
> 上游：BRIEF.md、docs/01–13、content/levels/*.md（审计范围）

## 1. TL;DR（最严重 10 条）

1. **[P0] L01 样板坐标矛盾**：隐藏测试「换一组灯柱位置」（`L01:132`），但 starter/reference 写死坐标且注释说「本关可以直接抄」（`L01:153,168-176`）；`docs/05:197` 与 `docs/06` §6.1 #7/#10 互斥，`docs/02b` §7.1 独立复现同一问题。9 关都会抄这个样板。
2. **[P0] spec 机器字段/代码抽取两套格式**：L01/L08/L09 只有 `meta:` 一个 YAML 块（其余顶层字段为散文）；L10/L-Epilogue/LAB-R/LAB-T 有 8 个顶层键但**没有 `code:` YAML**；L02/L03/L04/L05 才是完整 9–10 键。`docs/06:26` 声称「YAML 字段 1:1 映射 + validator」，却未定义「散文 TS 块 → `code.starterCode/referenceSolution`」抽取规则（`L-Epilogue:5` 却假定 level-kit 会抽取）。
3. **[P0] L8 的 Act 归属冲突**：`docs/05:102` 与 L08 meta（act: 2）定 L8 属 Act II；`docs/09:31,51,102` 把 L8 当 Act III 候选（「Act III 至少 1 关：L9 优先于 L8」「砍 L8…L9 保为 Act III 唯一完整关」）。
4. **[P0] 评分/事件契约未闭环**：`docs/07:126` 事件表缺 L09 实际使用的 `cure.splash`/`bell.ring`/`dawn.break`/`run.error` 与 L08 的 `machine.start`；`byPlayer` 语义未定义（bot 也是 player 实体，BlockPlaceEvent 同样触发；`docs/02b` §7.2 已指出）。`docs/06` 的 `g` API 已补 `g.region/g.npc/withinRadius`（好），但事件与 `byPlayer` 仍是空白 → grader/插件各写一套。
5. **[P1] `docs/07` 两处仍写 Java 21**（`:71`、`:227`）：与全局锁 Java 25（`BRIEF:26`、`docs/02:26`、`docs/07:255`、`AGENTS:17`）冲突；`docs/02b` §7.6 同指。
6. **[P1] 数字口径未统一**：抽象数 **12/14/15/17** 四种（`docs/04:26`、`docs/05:35`、`docs/03:73`、`docs/10:85`；`docs/13` 实际覆盖 A0–A14+X1/X2 = 17）；关卡 9-10 vs 10（`BRIEF:8,29`、`docs/01:104,114` vs `docs/05:12`、`docs/11:47`）；时长 2.5–3.5h vs 3–4h（`docs/05:12,89`、`docs/11:51` vs `docs/04:52`、`docs/10:8,93`）；primitive 28 vs 29（`docs/11:33` vs `docs/06:163` 与 schema）。
7. **[P1] `docs/09` 机械 + 语义残留**：`:160` 行尾残留 `*/`；`:27`「MQ 客户端」应为 MC；`:31` 的 L8/L9 Act 表述同 TL;DR #3。
8. **[P1] `docs/08:189` 的 verify 骨架用短路 `true` 兜底**，会把 mutation 失败吞掉（附录 §A.7 才是正确版本，08 正文应替换或指向附录）。
9. **[P1] 术语与事实**：BRIEF/docs/02 用「魔像」（各 4 处）、实现文档与全部 spec 用「织偶」（07 有 7 处），未统一；`docs/05:208`「喂种子催蛋是 MC 真实机制」不成立（Java 版喂种子=繁殖；`L02:296` 已指出）；`docs/07` §2.2 仍说用 resource pack 给 bot 皮肤，`docs/02b` §7.7 指出不可行（应 `Player#setPlayerProfile` 或 Mannequin）。
10. **[P1/P2] 其余可执行性**：`docs/07` builder 白名单仅 6 个（`:181`），但 L08/L09/EP 用 `loomWorkshop/witchCamp/runeStage` 与 anchor kind `workshop/camp/custom`；`L01:137` 的 `h-extr lamppost` 带空格；`docs/09` 的 DP0 已因 M0 7/7 通过而失效未标注；`docs/01:114` 的证据文件 `research/solver-log.md` 不存在；`docs/13` A0 示例引用 L01 坐标，L01 若改需同步。

**审计期间已修复、复核通过（不计入问题）**：schema primitive 定义（`additionalProperties` 放宽、删无效键、设计期/实现期白名单规则写入 docs/06）；L02 v2 已全面 registry 化（`L02:27` 与 `docs/12` 一致）；`docs/06` 更新（L03 示例 API、`g` API 扩充、计数口径、`L-Epilogue=L11=EP` 命名、Lab 的 act/order 约定）；`docs/12` 更新（`(x,z)` 展开规则、`Machine` 学生面同步签名、L10 计数口径）；`research/pedagogy-notes.md` 已落盘（11:56）；`AGENTS:39` 已改为 `--layers l0,l1`。`docs/02b` 是新的独立可行性审查，与本次审计交叉印证（见 §5）。

## 2. 分维度明细（仍开放项）

| # | 维度 | 问题 | 位置 | 严重度 | 建议修法 |
| --- | --- | --- | --- | --- | --- |
| 1 | 课程/关卡 | L01 坐标与隐藏测试矛盾（seed 随机 vs 写死） | `L01:132,153,168-176`；`docs/05:197` | P0 | Lead 二选一：Act I 场景相对出生点摆放、学生用 `golem.pos`+偏移（L02 v2 已验证可行）；或隐藏测试不动可见几何、L01 固定坐标 |
| 2 | 格式 | spec 两类格式 + `code` 抽取规则缺失 | `L01:12`、`L08:13`、`L09:12`；`L10` 等 5 份缺 `code:`；`docs/06:26` | P0 | 要么 L01/L08/L09 补 YAML，要么 docs/06 定义「§5 TS 块 → code 字段」的抽取规则并让 level-kit 实现 |
| 3 | 决策 | L8 属 Act II 还是 Act III | `docs/05:102`、L08 meta、`docs/09:31,51,102` | P0 | 建议保 Act II，改 docs/09（实现时间不变，只改叙事归属与 DoD 计数） |
| 4 | 评分契约 | 事件表缺 5+ 事件；`byPlayer` 未定义 | `docs/07:126`；`L08`、`L09:139-146`；`docs/02b` §7.2 | P0 | docs/07 §3.3 扩事件表（含 `machine.start`、`cure.splash`、`bell.ring`、`dawn.break`、`run.error`），并定义「`byPlayer` = 非 session bot 名单的真人」 |
| 5 | 事实/版本 | Java 21 残留 2 处 | `docs/07:71,227` | P1 | 改 Java 25 |
| 6 | 数字 | 抽象数 12/14/15/17；关卡 9-10/10；时长 2.5–3.5/3–4；primitive 28/29 | `docs/04:26`、`05:35`、`03:73`、`10:85`、`11:33`、`BRIEF:8,29`、`01:104` | P1 | 定义「核心 12（A1–A12）/全量 15（A0–A14）/含 Lab 17」，BRIEF/docs/03/04/05/10/13 统一；其余两处按 docs/05 逐关表统一 |
| 7 | 格式 | docs/09 行尾 `*/`、`MQ` 错字 | `docs/09:160,27` | P1/P2 | 机械删除/改正 |
| 8 | 格式 | verify 骨架吞 mutation 失败 | `docs/08:189` | P1 | 替换为附录 §A.7 完整版并引用 |
| 9 | 术语 | 魔像 vs 织偶 | `BRIEF:8,26,30,82`、`docs/02` 4 处、`docs/10:1`、`docs/11:1` | P1 | BRIEF 术语表改「织偶（golem；旧称魔像仅历史文档保留）」，全量替换 |
| 10 | 事实 | docs/05 L2「喂种子催蛋=MC 真实机制」不成立 | `docs/05:208`；`L02:296` | P1 | 改为「织机法则」并同步 |
| 11 | 事实 | docs/07 皮肤方案不可行（resource pack 改不了 player 皮肤） | `docs/07` §2.2；`docs/02b` §7.7 | P1 | 改为 `Player#setPlayerProfile` 注入 + Mannequin NPC |
| 12 | 可执行性 | builder/anchor 白名单不含 spec 实际用法 | `docs/07:181`；`L08:71-73`、`L09:68-69`、`L-Epilogue:74-75` | P1 | 补 3 个 builder 与 `custom` anchor 语义；或把自定义场景改为 `loadScene`+固定坐标 |
| 13 | 可执行性 | `docs/09` DP0 已失效未标注（M0 7/7 通过） | `docs/09:160`；`BRIEF:78` | P2 | 标「DP0 已于 M0 关闭，保留为回归检查」 |
| 14 | 引用 | `research/solver-log.md` 被当已存在证据 | `docs/01:114` | P2 | Day2 盲测后创建，或改「计划产出」 |
| 15 | 过度宣称 | 课程目标「迁移测验 ≥80%」vs 评估 n=4–6 只报描述统计 | `docs/05:36`、`docs/10:122,127` | P2 | docs/05 目标加「在正式评估中检验」限定 |
| 16 | 一致性 | registry L9 `world.brewStand` 无 spec 使用（L09 用本地常量） | `docs/12:153`；`L09:176` | P2 | 删符号或改 L09 使用它 |
| 17 | 数字 | docs/09「单日峰值并发 6 agents」与角色表/08 的 ≤5 写代码口径含糊 | `docs/09:118-131`、`docs/09:266`；`docs/08` §4 | P2 | 明确「写代码 ≤5、总并发 ≤7」 |
| 18 | 索引 | `docs/02b` 未进 BRIEF/AGENTS 必读清单 | `BRIEF:33-52`、`AGENTS` §1 | P2 | 加入 AGENTS §1 第 3.5 条（实现前读一次） |
| 19 | 课程/关卡 | L01 隐藏测试 id 含空格；docs/06 例子 `g.trial(...).bellRang` 的 trial 结果结构仍未定义 | `L01:137`；`docs/06:111` | P2 | id 改 `h-extra-lamp`；在 docs/06 定义 trial 结果对象（或改用世界状态断言） |

**已核实为真（抽样）**：11 份 spec 的 `reward.rune` 与 `abstractions` 一致、advancement id 全局唯一（loomcraft/act1、act2、act3、labs 四组）；已交付 spec 的 act/order/分钟数落在 docs/05 §6 区间（L01 10、L02 11、L03 11、L04 13、L08 18、L09 20、L10 22）；`docs/13` 的本机编译声明已复验属实（gcc 16.2.1 / ghc 9.10.3 / rustc 1.98.1 / Python 3.14.8 / Node 22.23.1 / Java 25）；`spikes/mc-bot-paper/` 证据目录存在；`docs/08-appendix` 的 verify.sh 经 `bash -n` 通过。

## 3. 必须由 Lead 决策的语义冲突

1. **L01 坐标策略**（决定 Act I 全部关卡与 docs/13 示例）：相对出生点 + `golem.pos` 偏移（推荐，L02 v2 已跑通）vs 固定坐标 + 隐藏测试不动可见几何。
2. **L8 的 Act 归属**：保 Act II、改 docs/09（推荐）vs 改 docs/05/L08。
3. **事件契约与 `byPlayer` 语义**：在 docs/07 §3.3 定稿事件表与「真人 vs session bot」判定；否则 L01/L08/L09 的评分断言无法实现。
4. **spec 格式/抽取规则**：补 YAML（工作量大）vs docs/06 定义 TS 块抽取（推荐，与 L-Epilogue 现状一致）。
5. **数字口径**：抽象 12/14/15/17、关卡 9-10/10、时长 2.5–3.5/3–4、primitive 28/29，各选一个口径并全量替换。
6. **docs/07 外观与白名单更新**：resource pack 方案改 `PlayerProfile`+Mannequin；补 3 个 builder 与 `custom` anchor。
7. **交付顺序**：L06/L07/LAB-M/LAB-C 未交付；需确认 CP1 前的 spec 冻结与生产顺序（与 docs/09 DP1/DP2 对齐）。

## 4. 明显机械错、可直接修（不涉语义）

- `docs/07:71,227` Java 21 → Java 25。
- `docs/09:160` 删行尾 `*/`；`:27` MQ → MC；DP0 行加「已关闭」注记。
- `docs/08:189` 删短路 `true` 兜底（或整段换附录 §A.7）。
- `docs/11:33`「28 个」→「29 个」。
- `L01:137` `h-extr lamppost` → `h-extra-lamp`。
- `docs/05:208` 喂种子催蛋 → 织机法则。
- `BRIEF:8,29` 9-10 关 → 10 关；`BRIEF:82` 术语表加「织偶（golem）/织典（Codex）」并统一。
- `docs/04:195`「待 pedagogy scout 补齐」占位说明：pedagogy-notes 已落盘，改为引用路径即可。
- `docs/01:104,114` 的「9-10 关」与 `research/solver-log.md` 标注改「计划/待产出」。
- `docs/02b` 加入 AGENTS §1 必读清单与 BRIEF 交付物清单。

## 5. 与 docs/02b 的交叉核对

`docs/02b`（scout-minecraft 逐关可行性审查）§7 列了 8 条冲突；本次独立复现其中 6 条：L01 坐标写死、`byPlayer` 语义、坐标签名（docs/12 已修）、`Machine` 契约（docs/12 已修）、Java 21、L01 隐藏测试 id。`docs/02b` 未覆盖、本次补上的：spec 格式/代码抽取规则、L8 Act 归属、事件表缺口、数字口径（抽象/关卡/时长/primitive）、docs/09 与 docs/08 的机械错。两份报告结论一致：**内容侧还有一批必须在 T1 开工前对齐的契约问题**。

## 6. 一致性结论

**现在还不能直接交给实现团队开工。** 阻塞项是 4 个 P0：①L01 样板坐标矛盾；②spec 机器字段/代码抽取两套格式；③L8 Act 归属；④评分事件与 `byPlayer` 契约。它们都不是「写代码」能解决的，必须 Lead 决策后回写 docs/05/06/07/09/12 与相关 spec。

建议修复顺序（总约 2–3 h agent 工作量）：①30–60 min 机械修（§4）；②1–1.5 h 做 §3 的 7 个决策并回写；③30–60 min 返修 L01/L08/L09 三份 spec 的格式与坐标策略；④再发 Content Implementor 开工。

设计质量本身是高的：架构自洽（WorldPort/评分真值在插件侧）、工作流门禁闭环（docs/08+附录）、版本锁五处一致（除 docs/07 两行）、docs/13 的证据是真实本机编译、docs/02b 的可行性审查把 L10 桥段等红区提前暴露。修完上述 P0/P1 后，这套设计可以支撑 4 天交付，且报告里「AI 工作流 + 一致性审计」本身可作为一个方法亮点。工作区仍在写入，L06/L07/LAB-M/LAB-C 交付后建议按本报告 §2 的同类项再做一次 30 分钟增量审计。
