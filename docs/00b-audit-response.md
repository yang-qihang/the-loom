# 00b — 审计响应与修订记录（Audit Response）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 上游：`docs/00-consistency-review.md`（独立审计，2026-10-31 11:55–11:58 快照）、`docs/06b-levelkit-implementation-spec.md` §8、`docs/02b-level-feasibility.md` §7
> 用途：记录审计发现的处置结果，供实施团队确认「哪些契约已变、以谁为准」。
> 历史说明（2026-11-01 文档审计）：本文件是设计阶段的审计/评审记录，保留原始结论与日期；部分处置与当前实现已变化，当前以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

---

## 1. 结论

审计的 **6 个 P0 已全部处置**；P1 中与「实现会撞墙」相关的项已修；剩余项分三类：①等 L06/L07 交付后补审（docs/14/14b 独立评审进行中）；②已记录为决策（D13–D26）；③保留为已知局限（写进报告）。

当前状态：**设计包 v1.1，可交给实现团队；开工前仍需 CP0 用户拍板（docs/11 §13）与 L06/L07 评审结论。**

## 2. P0 处置表（审计 §1）

| # | 审计问题 | 处置 | 落点 |
|---|---|---|---|
| 1 | schema `primitive` 非法键 + 带参 step 全失败；缺 `unlockHint` | 设计期 schema 改为 permissive `additionalProperties: true` + primitive 白名单由 validator 严格检查；`unlockHint` 从 L01 删除（提示由引擎触发，不是插件 primitive）；实现期以 zod 生成的 JSON Schema 为准（D22） | `content/level-spec.schema.json`、`docs/06` §5.4、`L01` staging |
| 2 | L01「抄坐标」vs「换位隐藏测试」矛盾 | L1 改为**固定布景**（`seed: fixed`），隐藏测试只查「物理走位/无乱放/不跳灯」；随机化从 L2 起（D14）。参考解与隐藏测试不再矛盾 | `L01` §3/§4/§10、`docs/05` §8 L1 |
| 3 | spec 格式不统一（L01/L08/L09 只有 meta YAML） | 设计期只强制 `meta` 机器块，其余章节散文合法；实现期统一 `defineLevel()` TS + zod（D22/D26） | `docs/06` §2 |
| 4 | L02 API 不在 registry | smith-act1 已按 `docs/12` 全面改名（collect/deposit/count/world.container），无旧名残留 | `L02`、`docs/12` |
| 5 | L8 Act 归属冲突 | **L8 属 Act II**（接口/组合=结构之核）；docs/09 全部改为 Act II 收尾（D13） | `docs/09`、`docs/11` D13 |
| 6 | 评分契约三方不一致（g API/事件） | 单一契约：`g` 以 `docs/06` §5.2 + `docs/06b` §3 为准；事件以 `docs/07` §3.3 为准（补 bell.ring/potion.splash/entity.cured/machine.*）；`byPlayer` 改为 `actorType`（D16） | `docs/06`、`docs/07`、`docs/12` |

## 3. P1/其他处置摘要（审计 §2）

| 类别 | 处置 |
|---|---|
| 版本/事实 | `docs/07` 两处 Java 21 → Java 25；isolated-vm 表述改为「7.x 需 Node≥24」；M0 锁版已写入 BRIEF/docs/02/docs/07 §10.1/docs/11/AGENTS 五处 |
| 决策一致性 | D4 细化（Act I 自然村庄+局部平整短路径+和平难度；L3 单关 normal 但僵尸不攻击玩家）；D2 版本锁升级为不可协商 |
| 课程/关卡 | L8 改为「SDK 提供机器，学生写 runAll/combine」（D19）；L9 `runMode: explicit` + 按关超时（D20）；L09/L10 符号计数按 D17 口径；L-Epilogue 统一为 `L11 = L-Epilogue = EP`；builder 清单补 14 个、primitive 白名单 v2（D18） |
| 数字口径 | 抽象：Codex 17 页 = A0–A14 + X1/X2，核心教学抽象 14（A1–A14）；关卡：10 关 + L11(EP) + 4 Labs；总时长：2.5–3.5h（含 Labs ≤4h）；primitive：v2 白名单（见 docs/06 §5.4） |
| 格式/机械 | docs/09 残留 `*/`、「MQ」、DP0 标记已关闭；docs/08 verify 骨架去掉 `\|\| true`；AGENTS `--layers` 大小写；L01 隐藏测试 id typo；BRIEF 头补负责人、术语表补「织偶/织典/L11」 |
| 可执行性 | `research/pedagogy-notes.md` 已交付并并入 docs/04 §12；`docs/02b` 提供了真正的逐关可行性审查；`docs/06b` 把 spec 体系落成实现规格 |
| 过度宣称 | docs/05 的「迁移 ≥80%」加限定（正式评估检验）；docs/04 评估口径补「前测测试效应/盲测≠学习证据/SUS-lite 非验证量表」 |

## 4. Level-Kit 契约差异（回应 06b §8）

见 `docs/11` §15 的 D21–D26。要点：结构化 `expect` 为主 + `check` 逃生舱；0–3 星部分成功；快照坐标数组 + `PosLike` 归一化；zod 为 canonical 源；wow/evidence/languageLevel 的机器字段归属；validator 分层（TS 严格 / MD warn）。

## 5. 仍开放的事项

1. **评审与修订**：`docs/14`/`docs/14b` 已覆盖 13/13 关；blocking 已按 `docs/15` 分工修完（L01–L10/EP/Labs 自查 0 error，2026-10-31 12:20）。剩余动作是 fresh critic 复评一次（约 1h）→ T1 09:30 冻结。
2. **L10 红区实证**：`docs/02c-finale-spike.md`（双 bot 铺桥 10 次成功率 + 视觉兜底）出来后，若路线 A <8/10，按路线 B（插件铺桥 + display 演出）冻结设计。
3. **U1–U11 未验证项**（docs/02b §5）：Day 1 按表逐条闭环，最晚时间已标。
4. **CP0 用户拍板**（docs/11 §13，8 项，均有默认假设）。
5. **外部链接**：Day 0 用 `scripts/check-links.mjs` 全量抽查（docs/13 的代码已本机编译核验）。

## 6. 给实现团队的一句话

> 以 `docs/12`（学生 API）、`docs/06`+`06b`（spec/评分/包契约）、`docs/07`（架构/事件/版本）、`docs/02`+`02b`+`02c`（MC 事实）为准；设计期 MD 的散文只作意图参考，冲突时以上述权威文件与 `docs/11` 的 D 编号裁决为准。
