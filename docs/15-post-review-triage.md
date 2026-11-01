# 15 — 评审处置与 Spec 冻结计划（Post-Review Triage）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31 12:45
> 上游：`docs/14-level-critique.md`（学习设计/盲读/梯度）、`docs/14b-mechanical-validation.md`（机器/契约/格式）、`docs/00b-audit-response.md`
> 下游：T1 早上的 spec 冻结门禁；各关 spec 的作者修订
> 历史说明（2026-11-01 文档审计）：本文件是设计阶段的审计/评审记录，保留原始结论与日期；部分处置与当前实现已变化，当前以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

---

## 1. 两份评审的结论

| 评审 | 范围 | 结论 |
|---|---|---|
| 14（pedagogy） | 13 份 spec 学习设计/盲读/梯度 | **2 关 PASS（L04、L09）**；11 关 FAIL 但多数 1–3 处可修；最陡跳跃 L04→L05、L06→L07、L08→L09 |
| 14b（mechanical） | 13 份 spec 机器/契约/格式 | **meta/schema 13/13 PASS**；8 个 FAIL，其中 5 个是**契约缺口**（g API/事件 payload/builder/primitive），不是 spec 内容问题 |

结论：**教学骨架成立、meta 健康；问题集中在「契约表不全」与「少数 spec 的断言/负荷」**。不重做课程。

## 2. Lead 已完成的契约修复（docs 层，已落盘）

| 缺口（14b） | 修复 |
|---|---|
| F2 primitive 缺 `wait/waitUntil`、L03 用已删 snapshot | `docs/06` §5.4 v2 补回 `wait/waitUntil`；L03 改用 `trialPatch/resetScene`（由 smith-act1 修 spec） |
| F3/F4 事件名不在 docs/07 | `docs/07` §3.3 事件表补 `machine.call/lever.pull/chat/sign.edit/trade/trade.witch/dawn.break/run.error/patrol.visit/item.move/tool.given/budget.exceeded`；别名 `cure.splash≡potion.splash`、`cure.done≡entity.cured` |
| F5 判分契约缺口 | `docs/06` §5.2 补 `g.region/g.var/g.injected` + 命名句柄规则 + 事件 payload（`actor/actorType/byPlayer` 双字段等价）；`docs/07` 同步 |
| F6 builder 白名单 | `docs/07` §6 扩到 **28 个 builder**（覆盖 21 个 spec 实际用名） |
| F8 Lab 章节模板 | `docs/06` §4 增加「Lab 简化模板豁免」（0/2/4/5/6/8/9/11 等价合法） |
| 全局：ALL_PRIOR 宏/双模式 | `docs/06`：`apiAllowlist` 允许 `ALL_PRIOR` 宏 + `kind` 标注；validator 区分 designTime（MD 只校验 meta）/ implementation（TS 全量） |
| 语义冻结 | `docs/12`：`take(n,iterable)`、`world.give(x,z,item,count)`、`giveTool(jobId,toolKind)`；L7 增量行补 `world.items`；`Machine` 同步签名；`runTablet(fn)` 回调 |

## 3. Spec 修订分工与状态

| 负责人 | 文件 | 必修项（来自 14/14b） | 状态 |
|---|---|---|---|
| smith-act1 | L01–L04 | L01 API 统一 `golem.*`/makeTask 矛盾/regions；L02 报数断言+regions；L03 trialPatch 替代 snapshot+scenario UI 契约；L04 `field.waterRow` | 处理中 |
| smith-act2 | L05–L07 | L05 门牌断言互斥/材料计数/文本≤120/语法≤4；L06 落实 D5-A8 两 phase/文本≤120/去提交级评分；L07 交付物 3→2/语法≤4/文本≤120/ref 比≤2.5 | 处理中 |
| smith-act3 | L08–L09 | L08 trials 补 check/allowlist 用 `ALL_PRIOR`；L09 事件名归一（cure.*→标准）+扩展符号 kind 标注 | 处理中 |
| scout-language | L10/EP/Labs | L10 声明 `world.vars`+时长 20；LAB-R 去 async/await；EP/LAB-T 确认 | ✅ 完成 |

## 4. 待 Lead 决策（不阻塞 Day1，但影响“教学价值上限”）

1. **L06 编译期穷举**：要让漏 case 真的报错，需要关卡级 `.d.ts` 收窄 + 验收注入 v2（约 0.5 天）。建议 Day1 先做「运行时 assertNever + 预检面板提示」，Day3 若有余力再升级；报告里诚实写。
2. **L07 两阶段执行**：spec 需要「预演 → 玩家开笼 → 真实执行 → 终验」两次执行。建议改为「先开笼再跑」的一次执行（P0），两阶段进 backlog。
3. **L05/L06 编译器 API 依赖**：若 level-kit 无法给 `buildHut` 注入随机第 5 块地（import 学生模块），隐藏测试降级为「删除/替换 main 文件调用」的 harness 方式（记录在 spec）。
4. **EP schema id**：保留 `L11`（已与 schema/术语表一致）。

## 4b. 修订完成状态（2026-10-31 12:20）

四路修订均已回报并自查 0 error：
- smith-act1：L01–L04（L01 API 统一 `golem.*`、makeTask 矛盾修复、`g.var` 句柄；L02 报数正则；L03 trialPatch；L04 `field.waterRow`）
- smith-act2：L05–L07（L05 断言互斥与精确材料计数修复；L06 落实 D5-A8 二 phase；L07 交付物 3→2、语法 7→4、语义冻结）
- smith-act3：L08–L09（trials 机器 check、事件名归一、ALL_PRIOR）
- scout-language：L10/EP/Labs（L10 `world.vars`，LAB-R 去 async/await，EP/Labs 确认）

**待复评**：修订后需 fresh critic 复跑 14/14b 一次（约 1h）→ 通过后 spec 冻结（T1 09:30）。L06 的 `.d.ts` 收窄、L07 的 generator 可选化、L05 的 `g.submission` 类目仍是 Day1 决策项（见 §4）。

## 5. Spec 冻结门禁（T1 09:30 前必须完成）

- [ ] 4 位作者报告「修订完成 + 自查 0 error」
- [ ] Lead 跑 7 条最小复验（14b 末尾命令）：API 名 ∈ registry、事件 ∈ docs/07、builder ∈ docs/07、primitive ∈ docs/06、同步 `F1–F8` 复发检查、meta 13/13、starter 未改必失败
- [ ] `docs/14` 的 A 档问题（L01/L02/L08/L09/LAB-R/LAB-T）清零；B 档（L05/L06/L10/EP）至少清零 blocking；C 档（L03/L07）记录为「Day1 设计决定」
- [ ] 更新 `STATUS.md` 为「spec frozen」，之后只允许缩小范围，不允许改教学意图

## 6. 复验命令（可直接转 task 卡）

```bash
node scripts/validate-levels.mjs --design        # meta + 文本预算 + 隐藏测试存在
grep -h 'apiIntroduced' content/levels/*.md | ...
grep -ho 'events("[a-z._]*"' content/levels/*.md | sort -u   # 对照 docs/07 §3.3
grep -ho 'builder: [a-zA-Z_]*' content/levels/*.md | sort -u # 对照 docs/07 §6（28 个）
grep -ho 'op: [a-zA-Z]*' content/levels/*.md | sort -u      # 对照 docs/06 §5.4
grep -c 'async\|await' content/levels/LAB-R-recursion-totem.md   # 必须 0
grep -c 'saveSnapshot\|restoreSnapshot' content/levels/*.md     # 必须 0
```

> 说明：以上为静态复验；真正的门禁是 14 的 blind read + 14b 的机器校验在**修订后复跑一次**（约 1 小时，Lead 或 fresh critic）。
