# 18 — 与另一份架构方案的对比评审（Peer Review / Merge Decision）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 评审对象：用户提供的 `architecture design.zip`（作者：另一 AI/同学；日期 2026-10-30；含 README、report.html、7 份 specs、SDK/levels/schema、QuickJS 实验与 evidence 工具）
> 目的：判断「哪份更好」，并给出合并动作。结论：**以本方案为母本，吸收对方的 4 项工程强项；不更换基础。**
> 历史说明（2026-11-01 文档审计）：本文件是对照方案的评审记录，结论仍有效（本方案为母本）；对照方案 zip 在 `incoming/` 只读留档。
> 上游：incoming/other-plan、BRIEF.md

---

## 0. 结论（先说）

| 问题 | 判断 |
|---|---|
| 哪份方案更好？ | **本方案（Minecraft + TS 子集 + 15 抽象 + 10 关/EP/Labs + 真实双通道实证 + 两轮独立评审）更适合这个项目与你的愿景。** 对方是「更保守、更工程化、包装更完整」的 4 天版本。 |
| 直接换成对方方案？ | **不建议。** 对方明确砍掉 async/并行/接口（可选），而这正是你愿景里强调的部分；且对方未做真实 MC 联调。 |
| 要吸收什么？ | ①**同步顺序语义**（QuickJS Asyncify 实验证明的问题，我们用更轻的 auto-await 变换解决并作为 T1 首个门禁）；②**会话/权限不变量**（epoch/runId/取消/去重/重置 hash/原子库存）；③**可编译的参考解证据**；④**单页 HTML 报告交付物**（对方包装更专业）。 |
| 语言/引擎基础 | 维持 **Minecraft + TypeScript**（D35）。对方基线 `1.21.4 / JDK 21 / mineflayer 待定` 是 2024–25 的旧组合，且未联调；我们用 2026-10 实测的 `Paper 26.1.2 + Java 25 + mineflayer 4.39.0`。 |

## 1. 对方方案强在哪（必须承认）

1. **语言运行时被真正验证过**：TS 6.0.2 完整类型检查 + QuickJS Asyncify **同步 API 桥**（学生代码无 `await`、宿主动作异步完成后再恢复）+ 死循环中断 + 隔离检查，证据在 `evidence/checks.json` 与 `feasibility.md`。这是本方案当前最大的空白：我们的 `worker + esbuild + 隐藏 await` 只有设计、没有实验。
2. **会话/协议工程细节更硬**：`levelEpoch`、`runId`、capability、命令状态机（ACCEPTED/EXECUTING/COMPLETED/REJECTED/FAILED/CANCELLED）、去重账本、原子批量库存、旧 epoch 消息拒绝、Reset 后规范化 hash 相等、Stop 顺序（撤销 capability→拒绝新动作→清控制→取消 ticket→终止 worker）。这些我们只有零散描述。
3. **可执行证据与包装更完整**：`checks.json`、`design-manifest.json`（文件 hash）、`verify-all.cjs`、`check-docs.py`、`build-report.cjs`、单页 `report.html`（含插画/架构图/课程图）与三张 report 截图。作为课程交付物，**观感与可验证性更「成品」**。
4. **范围克制**：一座村庄、3 个场所、12 个小任务、155 分钟；明确「异步/并行不进主线」，因此 4 天完成概率更高。
5. **安全/教学边界清楚**：类型/解析错误零世界效果、SDK 参数宿主校验、revision 快照、策略回调拒绝游戏效果、机器人无 OP、教学区域锁定、loopback+token。

## 2. 本方案强在哪（不客气）

1. **真实 MC 集成已实证，对方完全没有**：双通道 **7/7**、L10 双 bot 铺桥 **10/10 零掉落**、3 bot 同服、actorType 区分 bot/真人、Mannequin/ItemDisplay、精确延迟与冷启动数据；版本锁经实测。
2. **抽象覆盖更接近你的愿景**：本方案含 **记录/ADT、interface/trait 组合、async/await、并发/多 agent**（L6–L10），并有 Codex 17 页跨语言对照（C/Lisp/Python/Haskell/Java/JS/C++/Swift/Kotlin/Go/Rust，代码本机编译）。对方主线到 HOF/闭包/模块为止，接口可选、async 可选、并行排除。
3. **关卡与 spec 深度更高**：13 份关卡规格（含 successCriteria/trials/hiddenTests/提示梯/playerBeat/wow/regions/vars/随机化）+ spec schema + validator + level-kit 实现规格；经两轮独立评审（docs/14/14b）并完成修订。
4. **AI 工作流更完整**：8 层质量门、四行证据协议、测试 hash 冻结、红队 12 攻击、spec 变异、盲测 solver、人类 3 checkpoint、DSH 原语映射与并发纪律；对方有很好的 invariants/model-based 测试但反作弊/内容校验维度较少。
5. **调研更广**：5 路并行研究（行业、MC 栈、语言/macro、教学法、AI 保证）+ 2026 版本核实 + 教育研究引用；对方研究/来源更薄。
6. **演示上限更高**：L10 双织偶合龙桥是已验证的「高光」，对方是单机器人 + 修路/库存的稳健演示；在「让老师记住」这件事上本方案更强。

## 3. 十维评分（1–5，主观但给证据）

| 维度 | 本方案 | 对方 | 说明 |
|---|---|---|---|
| MC 集成可信度 | **5** | 2 | 我们 7/7 + 10/10 实测；对方未联调且基线旧 |
| 语言运行时验证 | 2 | **5** | 对方 QuickJS 同步桥 + 类型检查 + 中断已验证；我们设计未跑 |
| 抽象覆盖/愿景契合 | **5** | 3 | 我们含接口/异步/并发；对方砍掉 |
| 关卡 spec 深度 | **5** | 3 | 13 份详细 spec + 评审 vs 12 任务清单 + 通用契约 |
| 4 天完成概率 | 3 | **5** | 对方范围克制、有 80h 排期与降级；我们 Act III 有风险但有 P0–P2 + DP2 |
| 协议/会话严谨度 | 3 | **5** | 对方 epoch/取消/去重/reset hash/状态机更完整 |
| AI 工作流 | **5** | 4 | 我们更全（红队/变异策略/盲测/证据协议）；对方 invariants/model 测试更具体 |
| 调研深度 | **5** | 2 | 5 路研究 + 2026 核实 + Codex |
| 交付物包装 | 2 | **5** | 对方单页 HTML + evidence + manifest + 截图 |
| 演示高光/差异化 | **5** | 3 | 双织偶合龙桥 vs 稳健单机器人 |
| **加权（视觉/愿景优先）** | **≈4.2** | ≈3.6 | 若只按「4 天保守交付」权重，对方会反超（≈4.0 vs 3.6） |

## 4. 决策：不换母本，吸收 4 项（已立项）

| # | 吸收项 | 落点 | 状态 |
|---|---|---|---|
| M1 | **顺序语义门面**：Act I–II 学生代码经 AST 变换自动在 SDK 调用前插入 `await`（`const n = await golem.collect(...)`），彻底消除「隐藏 drain 的读后写不一致」；失败则退回 QuickJS/Asyncify 方案。T1 第 0 小时冒烟验证 | `docs/03` §4.2、`docs/07` §4、`docs/08` §13、T1 任务 | 已写入决策 D36；实现进 T1 |
| M2 | **会话/权限不变量**：epoch、runId capability、命令状态机、去重账本、原子批量库存、旧消息拒绝、Reset 规范化 hash、Stop 顺序 | `docs/07` 新增 §3.5；`docs/08` 增加 model-based session 测试 | 已写入 D37 |
| M3 | **可编译参考解证据**：从 13 份 spec 抽取 referenceSolution + SDK `.d.ts`，`tsc --noEmit` 全绿并产出 `evidence/specs-typecheck.json` | `docs/08` 层 L2 扩展；T1 任务 | 已写入 D38 |
| M4 | **单页 HTML 报告**：用 `report/build-report` 由设计文档 + 架构图/村庄布局/关卡表/证据摘要生成 `report/index.html`（课程报告入口） | `docs/10` + `report/`；T1 产出 | 已写入 D39 |

**不吸收/保留分歧**：
- 不采用对方 `1.21.4/JDK21` 基线（旧且未验证）；维持 26.1.2/Java 25。
- 不采纳「类型错误阻断执行」——我们保持「类型不阻断、语法阻断」以降低新手挫败（Codex 与 T1 再评估）。
- 不砍 async/并发（用户愿景核心）；但把对方「单地图/多场所/小任务」作为 **DP2 的降级形态参考**（若 Act III 爆掉，可把 Act III 改为 12 个小任务同图，而不是直接砍关）。
- 不合并两套文档体系（避免 4 天内双份维护）；只吸收其工程思想。

## 5. 对对方的 3 个风险提示（若他们继续用那份方案）

1. **MC 版本/联调是最大未验证项**：1.21.4/JDK21 的 Paper 与 mineflayer 组合需首日实测；npm 上 mineflayer 4.39 虽支持老版本，但 Pathfinder/实体/插件 API 必须真实跑通后才能冻结。
2. **QuickJS Asyncify 的工程复杂度**：source map、单挂起调用、跨 worker 句柄、取消/清理、性能（16MB heap、100ms 片段）在真实 MC 延迟下未验证；首日若不过，需按他们 §10 的降级（显式 await）——那会改变全部课件，代价不小。
3. **范围过窄**：12 个任务覆盖不到 interfaces/async/concurrency，与「程序语言思想全貌 + typeclass/trait 组合」的用户愿景有差距；若课程评审看重抽象广度，需要额外补充。

## 6. 一句话给用户

**母本用本方案**：它在「真实 MC 可行、抽象够全、关卡够深、AI 工作流够稳」这四件事上更强；把对方的 **同步语义、会话不变量、可编译证据、成品报告** 吸收进来，就同时拿到对方「4 天更稳、更像成品」的优点。4 天预算下没有理由推倒重来。

---

## 9. 后续实现补充（2026-10-31）

- 本方案已在真实 Paper 26.1.2 + Java 25 + mineflayer 4.39.0 上跑通 **双真实 bot 并发**：L10 两只织偶经邮箱握手、各自真实 `moveTo`/`placeBlock`、玩家合龙石、生产 grader 3 星，并与 MockWorld digest 对照通过；证据 `evidence/l10-real-latest.json`、实现在 `content/levels/L10.content.ts` 与 `it/l10-real.ts`。
- 这意味着「async/并发/多 agent 只有设计、没有真实联调」在本项目已不再是空白；剩余缺口是 Studio/Engine 会话层把多 agent SDK 注入沙箱（计划中，见 docs/02c §8）。
