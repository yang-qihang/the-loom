# research/pedagogy-notes.md — 学习科学、游戏化与评估调研笔记

> 状态：v1（完成）｜负责人：scout-pedagogy｜最后更新：2026-10-31
> 上游：`BRIEF.md`、`docs/04-learning-design.md`、`docs/05-curriculum.md`、`docs/06-level-spec-system.md`
> 下游：Lead 的 level design、`docs/10-demo-and-report.md`、level smith 的 spec
> 核实方式：DOI 经 OpenAlex 元数据核对（2026-10-31）；课程站/商店页 HTTP 200 检查。DOI 页对无头请求常 403（浏览器正常）。
> 历史说明（2026-11-01 文档审计）：本文是设计阶段调研记录，保留原始结论与来源；项目实现已落地，当前状态以 `STATUS.md`、`docs/46-playtest-fix-plan.md` 与代码为准。

## 0. TL;DR（10 条）

1. PriMM 可保留，但 Predict 要分级：L1–L2 只做行为预测，L3 起才读代码预测输出——先有 notional machine 才谈得上预测执行（Sorva 2013）。
2. `docs/04`/`05` 方向与证据一致；本文件补**阈值与验收方法**，不另立理论。
3. 游戏化收益小且有条件：认知 g=.49、动机 g=.36、行为 g=.25；只有「游戏虚构 + 社交互动」显著调节行为结果（Sailer & Homner 2020）。Loom 叙事与双织偶是教学组件，不是包装。
4. 严肃游戏 vs 传统教学：学习 d=.29、保持 d=.36、动机 d=.26 **不显著**；补充其他教学法、多会话、小组时更强（Wouters 2013）。不能靠「好玩」自动学会。
5. 语法是新手第一大错误源（Hedy 引用：73% 提交含语法错误）。TS 噪声须用骨架 + 错误翻译 + 补全压到最低，这比抽象深度更可能劝退。
6. 每关预算数字化：新抽象 ≤1 主 +1 同族、新 API ≤5、新语法 ≤3、reference/starter ≤2.5 倍。L6 的 A7+A8 最危险，建议拆 phase。
7. 「无死局」可判定：Reset ≤2 击/≤2 秒；L3 后 60 秒给半解兜底；失败信息含「改哪、为什么、下一步」。
8. 盲测 solver 只证明可发现、可解、时间合理，不是学习证据；学习效果靠迁移任务与前后测，而前测有测试效应（Roediger & Karpicke 2006），口径分开（§7）。
9. 盲测建议阈值：P0 关 3 runs ≥2 通过、中位 attempts ≤4、≤2 级提示、≤15 min、0 死局；P1 关 ≥2/3、≤5 attempts、≤20 min；全套用「相邻关中位时间比 ≤1.8」查尖峰。
10. 若只能改 BRIEF 一条：D5 收紧为「第二抽象须同族并拆 phase，L6 的 A8 后移」；另需修「学生不写 import」与 L5 要求 import 的矛盾（§9-4）。

## 1. 证据分级

A 级＝meta 分析/大样本对照；B 级＝单研究/准实验；C 级＝设计判断（标 `[判断]`，不得写成「研究表明」）。

## 2. 学习科学证据

| 主题 | 关键结论 | 强度 | 落地 |
|---|---|---|---|
| 建构主义（Papert） | 知识在「做可分享的物件」中建构 | 理论 | 每关产出可见世界变化；评分看世界状态 |
| 认知负荷 / 示例淡出（Sweller 2019 综述） | 新手问题解决耗工作记忆；worked example→fading 有效；split-attention 有害；后期 expertise reversal | A | 预填 50–80%，L2+ 每关减约 10%；代码行与世界结果同行高亮，避免三处同时看 |
| PriMM（Sentance et al. 2019） | 13 校 493 名 11–14 岁、8–12 周，后测优于对照 | B | 保留六拍；Predict 按 notional machine 成熟度分级（§4） |
| Use-Modify-Create（Lee 2011；Lytle 2019） | 先给可运行物→修改→创造，降低门槛 | B | Modify 用 Parsons/填空；Make 换场景 |
| Parsons / faded Parsons | 重排代码聚焦结构；faded 版本支持渐进淡出；低龄新手加诱饵行降低效率 | B | P0 无诱饵，L4 起 1 个；L3 提示可给「排序两行」 |
| Notional machine（Sorva 2013） | 新手最大障碍是运行时心智模型，应作为显式教学目标 | A | 「织偶字面执行」是资产，但每关要有执行可见化（计数/路径/失败点），否则学到魔法 |
| 误解（Qian & Lehman 2017；Sirkia & Sorva 2012） | 语法/概念/策略三类；变量、循环、递归高发 | A | `misconceptions[]` ≥2 条并绑定触发时刻；补「引用/别名」「事件顺序」`[判断]` |
| 自我决定理论（Ryan et al. 2006） | 自主/胜任/联结预测游戏享受 | B | 自主=多解；胜任=advancement/小胜利；联结=艾拉、村民、双织偶 |
| 游戏化 meta（Sailer & Homner 2020） | 认知 g=.49（k=19）、动机 g=.36（k=16）、行为 g=.25（k=9）；game fiction 与 social interaction 调节行为 | A | 用叙事与协作，不用积分/排行榜 |
| 严肃游戏 meta（Wouters et al. 2013） | 学习 d=.29、保持 d=.36、动机 d=.26（n.s.）；多会话/小组更强 | A | 每关内建 worked example 与复盘，不靠好玩替代教学 |
| 测试效应（Roediger & Karpicke 2006） | 延迟保持上测试优于重复学习 | A | 预测题是学习事件；每关结尾复盘题 |
| 渐进语法（Hedy, Hermans 2020） | 语法是新手第一大错误源，分级隐藏有效 | B | L1–L4 类型/import 不可见；错误只露第一条 |

## 3. 标杆课程拆解

| 课程 | 顺序/节拍 | 可迁移招式 |
|---|---|---|
| SICP（JS 版） | 第 1 章函数抽象（表达式→命名→组合→高阶）→数据→状态→元语言 | 每章先给「没有它会怎样」的痛点程序；L1–L2≈1.1+3.1；EP≈4.1 |
| HtDP / Pyret | design recipe：data definition→signature/purpose→examples→template→body→tests | Make 前必填 2 个例子（可复用为预测题）；UI 用「配方卡」 |
| Realm of Racket | 一章一个游戏，世界/事件循环驱动 | L9 异步、L10 并发用「世界 tick / 双 agent」；不搬 Racket 语法 |
| Hedy | 多级渐进，第一级只有 print/input | `docs/03` §3.1 白名单即「Hedy levels」，每关只解锁本关语法 |
| Bootstrap | low-floor high-ceiling；代数与编程同构 | 预测题用「求值顺序图」；报告可讲跨学科 |

## 4. 每关节拍模板（`pedagogy.beats`）

| 拍 | 时长 | 玩家做什么 | spec 必填 | 通过门槛 | 常见失败 |
|---|---|---|---|---|---|
| 0 动机刺 | 30–90s | 看艾拉演示「没有它很痛」 | `painBeat` | 有情绪有画面、无惩罚 | 变成旁白 |
| 1 Predict | 30–60s | 猜行为/结果（二选一、排序） | `predict[]`+`targetAccuracy` | 首答正确率 50–70% | L1 就要求预测代码输出 |
| 2 Run/See | 1–2min | 跑 starter 看世界变化 | `starterCode`（不改必失败） | 10s 内世界反馈 | 只有 toast |
| 3 Investigate | 1–2min | 改一个值/修一处坏代码 | `investigate` | 玩家说出「为什么」 | 只说「错了」 |
| 4 Modify | 2–4min | Parsons/填空 3–8 行 | `mainTask`+`successCriteria` | 目标逐条打勾 | 只允许一种写法 |
| 5 Make | 2–5min | 新场景独立写/扩展 | `makeTask`+`hiddenTests`≥1 | 随机化变体通过 | 只改参数不算迁移 |
| 6 玩家节拍+结算 | 30–60s | 亲手做一次 MC 操作 | `playerBeat` | 动作可检测、≤60s | 手动操作 >60s 打断快感 |

**Predict 分级（核心修正）**：L1–L2 问「按写的顺序走还是自动找最近」这类行为题，不要求读代码；L3 起才给 3–6 行代码预测输出。依据：Sorva 指出缺运行时模型无法可靠预测；PriMM 原研究的 Predict 建立在教师带读之上。

## 5. 可直接抄进 level spec 模板的设计规则编号清单

> 用法：LR 编号写入 `content/level-spec.schema.json` 的 `pedagogy` 块与评审 rubric；可机器检查项追加为 `docs/06` §6.1 的 V15–V26。

| ID | 规则 | spec 字段/检查 |
|---|---|---|
| LR-01 | 每关 1 主抽象；第二抽象须与主抽象**同族**并拆 phase | `abstractions[]`；≤2，异族需 Lead 签字 |
| LR-02 | A0/notional machine 是贯穿线程，不占关内新抽象预算；每关声明 ≥1 个执行可见化 | `pedagogy.executionTrace` |
| LR-03 | 数字预算：新 API ≤5、新语法点 ≤3、reference/starter ≤2.5 倍 | validator（对齐 05 §7.1） |
| LR-04 | `misconceptions[]` ≥2 条，各绑定一个关内触发时刻 | investigate/hiddenTests 引用 id |
| LR-05 | painBeat 在 90s 内演完、失败不惩罚、不得用文本替代 | `painBeat` |
| LR-06 | 动机先于语法：新 API/语法首现必须在 painBeat 之后 | `beats[]` 排序检查 |
| LR-07 | Predict 分级：L1–L2 只考行为/概念；L3 起才考代码输出/状态 | `predict[].form` |
| LR-08 | Predict 2–3 题，首答正确率目标 50–70%，进 telemetry | `targetAccuracy` |
| LR-09 | 每关 1 次「改一个值看变化」的受控实验，带 `expectedError` 与一句人话解释 | `investigate` |
| LR-10 | Modify 3–8 行 Parsons/填空；Make 必须换坐标/尺寸/情境 | `modify.type`、`makeTask.transfer` |
| LR-11 | 玩家节拍 ≤60s、可检测、失败可跳过 | `playerBeat` |
| LR-12 | nudge ≤40 字、technique ≤80 字、near-solution ≤120 字，且留 ≥1 个决策点 | `hints[]` 字数校验 |
| LR-13 | 触发＝失败且代码自上次运行未改，或 90s 无操作；纯次数会打断改代码 | `hints[].trigger`；`[判断]`，盲测校准 |
| LR-14 | 每条 successCriterion/hiddenTest 至少对应 1 条提示（提示覆盖矩阵） | validator：缺覆盖即失败 |
| LR-15 | 无死局：Reset ≤2 点击/≤2s；L3 后 60s 自动补前半段；失败信息含「改哪/为什么/下一步」 | `reset`、`hints[].fallback` |
| LR-16 | 同一错误重复 ≥2 次且代码未变 → 直接 L2，不连弹同类 nudge | `hints[].trigger.dedup` |
| LR-17 | 文本预算：教练 ≤45 字/条、任务 ≤120 字、叙事 ≤400 字、目标 ≤3 条 | 对齐 06 §6.1 第 9/14 条 |
| LR-18 | 每屏 ≤1 个新术语，首现写「中文（English / 符文名）」，术语表外词禁止 | 术语表校验 |
| LR-19 | 代码行与世界结果同屏联动；禁止「先读 3 段再写」 | UI 检查（人工） |
| LR-20 | starter 可运行且不改必失败；P0 预填 50–80%，L2–L4 每关减约 10% | DoD 检查（06 §7-3） |
| LR-21 | 每关 `mcAuthenticity` 写一句「真 MC 玩家会这样做」的理由，写不出就不做 | 对齐 05 §1 P4 |
| LR-22 | 反馈优先世界内（方块/粒子/音效/村民/advancement），toast 只补充；成功须有世界状态变化 | `feedback` 表 |
| LR-23 | 禁止以弹窗选择题作为通关条件；Predict 题只记 telemetry，不卡关 | `successCriteria` 检查 |
| LR-24 | 评分只读世界状态/事件，不读代码形状；≥2 种合法写法可通过 | 对齐 05 §1 P7 |
| LR-25 | 每关 ≥1 随机化 hiddenTest（坐标/尺寸/清单/顺序），种子可复现 | 对齐 05 §1 P8 |
| LR-26 | 每 Act 末关 + 终局含「同抽象新场景」；后测/访谈测迁移 | `makeTask.transfer` |
| LR-27 | telemetry 最小集可重建「尝试→提示→通过」链路 | §7.4 表 |
| LR-28 | 盲测 3 runs + 新手模拟 ≥3 困惑点写进 DoD | 对齐 06 §7-5 |

## 6. 游戏化、叙事与 MC 地道性

**SDT 映射**：自主＝多解评分、Make 可选风格、提示可关闭；胜任＝advancement 小胜利、每关可见成果；联结＝艾拉的具体表扬、村民回家、双织偶。反模式：唯一答案、强制剧情、「真棒！」空夸。

**游戏化证据的用法**：效应量都只算小，积分/徽章/排行榜拉不动学习；有收益的是游戏虚构与社交互动，「竞争+合作」最有效 → Loom 叙事与双织偶是有效投入，积分砍掉。Wouters 也提示游戏要**补充**教学法（示例、复盘、多会话）。

**Diegetic UI**：Minecraft advancements 以目标树 + toast 引导新玩家（Java 版 wiki 原话「gradually guide new players」），recipe book 渐进解锁配方 → 我们做 advancement + Codex 符文石板 + 按 Act 解锁。Portal 用关卡与台词教机制（`[判断]`）；The Farmer Was Replaced「代码即玩法」、Human Resource Machine 指令可视化可作报告对照。

**MC 地道 vs 反感**：地道＝点灯/铺路/修桥/守村（L1/L10）、种田养鸡（L2/L4）、造房放门牌（L5）、村民交易（L6）、机器按节拍联动（L8）；反感＝弹窗答题、打怪掉代码碎片、无限方块/瞬移/无消耗合成、把方块贴图换成编程符号、全屏 HUD 教学墙、固定连线红石谜题、把村民当纯道具人、教育版 Code Builder 式「Agent 命令按钮」（编程退化成遥控器，`[判断]`）。反例列是判断；验证：2–3 名玩家各 15 分钟访谈。

## 7. 评估设计

**作弊风险与对策**：写死坐标→随机化 + hiddenTest；碰巧过→≥3 断言 + 不变量 + 2 个种子；反推测试→断言不下发、失败只给方向；抄 L3→留决策点、不贴完整答案；绕过 SDK→白名单 + 插件侧再校验；抄袭→n 小不查重，留 code snapshot。

**测什么**：前测 6–8 题（Python/Haskell/Rust 片段问概念 + 1 题解释 + 信心分）→ 后测同构换题 → 迁移任务（新场景写 ≤10 行）→ SUS-lite 5 题（继续意愿/反馈清晰/错误提示有用/知道在教什么/愿推荐）→ 5 问访谈。前测有测试效应（Roediger 2006），前后测差异不能全归给游戏；SUS-lite 非验证量表，只报分数与范围。

**n=4–6 的可信做法**：被试内、L1 + 1 个自选关、前后测等值换题、顺序平衡（一半先 L1）；报中位数与范围，不报 p 值；质性 2 人独立编码；结论只写「可玩性 + 短程概念识别变化」，与 `docs/10` §5.4 一致；盲测与人类数据分表。

**telemetry 最小集（JSONL）**：`attempt`（P0 中位 ≤4）、`hint_tier`（中位 ≤2）、`time_on_task`（超 05 §5 目标 1.5× 报警）、`stall`（>90s 无操作，位置即 spec 歧义）、`error_code` 分布、`predict_accuracy`（50–70%）、`transfer_pass`（trials 第 2/3 场景首跑）、`replay_after_fail`、`player_beat`。

## 8. 梯度验证协议

**盲测 solver 协议**：输入只给玩家可见信息（标题/叙事/目标、starter、编辑器与运行 DOM、API 摘要、错误消息、可点提示）；不给 spec、参考解、hiddenTests、BRIEF。每关 3 个独立 session（模型与参数固定）。记录 attempts、提示级与次数、耗时、卡点、Reset 次数、是否无提示通过。

**盲测 solver agent 的通过标准**：

| 关卡档 | 通过率 | attempts 中位 | 提示 | 时间 | 死局 |
|---|---|---|---|---|---|
| P0（L1–L4） | 3 runs ≥2 通过 | ≤4 | ≤2 级、≤2 次 | ≤15 min | 0 |
| P1（L5–L9） | 3 runs ≥2 通过 | ≤5 | ≤2 级、≤3 次 | ≤20 min | 0 |
| P2（L10/EP/Labs） | 3 runs ≥1 通过 | ≤7 | ≤3 级 | ≤25 min | 0 |

全局检查：相邻关中位 `time_on_task` 比 ≤1.8（>2.0 需归因）；后关提示级中位不得比前关低 2 级；L3 须 ≥2 次失败后才可达（否则算泄露）；Act 末迁移关通过率不低于上一关 −10pp。死局＝连续 8 分钟无通过/新提示/有效操作；出现即不通过。

**新手模拟 agent**：persona「零编程、玩过 MC」，只用关卡内词。通过标准：目标要素复述 ≥80%；Predict 正确率 40–70%（过低=不清，过高=太浅）；≥3 个困惑点且 100% 能映射到 `misconceptions[]`。

**Cognitive walkthrough 检查表（10 min/关，2 人独立）**：①一句话复述目标？②知道第一步？③首 run 到首次世界反馈 ≤10s？④做对能看出来？⑤做错知道改哪？⑥提示 ≤2 击可达？⑦有必须猜的隐藏要求？⑧失败后 ≤2 击重试且不丢代码？⑨文本超预算？⑩≥2 种合法写法可过？⑪每个断言都有提示覆盖？⑫WorldDigest 与玩家所见一致？任一「不确定」记为缺陷，修完才进 DoD。

**归因与复测**：失败归入阅读（LR-17/18）、发现（LR-21/23）、概念（LR-01/04/07）、评分（LR-24/25）、技术（反馈/重置）→ 只改对应规则 → 重跑 3 次；两次不收敛就拆关或降级（对齐 05 §7.4）。

## 9. 对项目的直接建议

1. `docs/06` §6.1 追加 validator V15–V26 覆盖 LR-01/03/08/12/14/17/20/21/24/25；§8 骨架 `pedagogy` 补 `targetAccuracy`、`executionTrace`、`transfer`、`blindSolver{passRuns,attempts,hintTier,deadEnds}`。
2. 把 §4 的「通过门槛」列并进 `docs/04` §3 / `docs/05` §5——现表只有「做什么」，没有「什么算过」。
3. **L6 降载**：A7+A8 不同族、负荷最高；拆成「记录」与「一种联合」两 phase，验收只考记录 + 一种 `kind`，A8 穷举检查后移 L8。不改则盲测 L6 失败率大概率 >40%（05 §11 已预感）。
4. **修 import 矛盾**：`docs/03` §3.1 黑名单写「import（学生不写）」，`docs/05` L5 却要求 `import blueprints.ts`，`docs/03` §6 的 A6 又写「学生第一次 import」。三选一：允许 L5 写 import 并改白名单；A6 做成 UI 蓝图槽（不写语法，负荷最低，推荐）；或后移 L7。不解决则 L5 验收无法落地。
5. Day2 起埋 telemetry（§7.4）并建 `qa/blind/<level>.md` 模板（3 runs 表 + 卡点 + 修改记录），否则 DoD-5 无证据。
6. 报告里学习证据与可用性证据分表；SUS-lite 只当体验指标；盲测只证明可解性；测试效应写进局限。

## 10. 不确定 / 未验证事项

| 事项 | 状态 | 验证方法 |
|---|---|---|
| PriMM 效应能否迁移到成人/游戏情境 | 未验证；原研究 11–14 岁、8–12 周 | 只采过程指标不外推；看 Predict 正确率与提示曲线 |
| 文本阈值 45/120/400 字 | 经验值 | 盲测记录 reading time；>2 次「没读就点继续」→ 收紧 |
| 引用/别名、事件顺序误解的专项文献 | 未核实（检索无可靠条目） | 3 名新手 think-aloud + 错误分类；spec 标 `[判断]` |
| MC 玩家反感清单 | 设计判断 | 2–3 名玩家各 15 分钟访谈 |
| SUS-lite 5 题 | 改编自 SUS，非验证量表 | 只报分数与范围，与访谈三角验证 |
| 自动评分反作弊 | 只覆盖随机化+隐藏测试，无静态度量 | n 小不需要；公开演示前加 API 调用审计 |
| DOI 可点性 | 无头请求 403（浏览器可开） | OpenAlex 元数据核对：`curl -s https://api.openalex.org/works/https://doi.org/<DOI>`；定稿前人工点开一次 |

## 11. 如果只能改 BRIEF 里一条决策

改 **D5**：把「每关 1 主抽象（至多 2 个）」收紧为「每关 1 主抽象；第二个须同族并拆 phase；A0 作贯穿线程不占预算；L6 的 A8 后移」。理由：现有 4 关塞 2 个抽象，L6（A7+A8）不同族、负荷最高；认知负荷证据与 `docs/05` 自己「新 API>5 / 新语法>3 不通过」规则都指向它是劝退点；A0 每关在用，算成 L1 新抽象会挤首关预算。反方风险：收紧后 10 关装不下 A0–A14，需靠 L8 合并接口与 union、或把 A6/A8 降为 Codex——与「深度够」有张力，Day1 前权衡。

## 12. 来源清单（2026-10-31 核实）

| 来源 | URL | 级别 |
|---|---|---|
| PriMM 研究（Sentance et al. 2019） | https://doi.org/10.1080/08993408.2019.1608781 | B |
| PRIMM 方法站 | https://primmportal.com/ | 方法 |
| Use-Modify-Create（Lee et al. 2011） | https://doi.org/10.1145/1929887.1929902 | B |
| UMC 对照（Lytle et al. 2019） | https://doi.org/10.1145/3304221.3319786 | B |
| Parsons 综述 | https://doi.org/10.1145/3373165.3373187 | B |
| Faded Parsons（CHI 2021） | https://doi.org/10.1145/3411764.3445228 | B |
| Notional machine（Sorva 2013） | https://doi.org/10.1145/2483710.2483713 | A |
| 误解综述（Qian & Lehman 2017） | https://doi.org/10.1145/3077618 | A |
| 程序模拟误解（Sirkia & Sorva 2012） | https://doi.org/10.1145/2401796.2401799 | B |
| 认知负荷综述（Sweller et al. 2019） | https://link.springer.com/article/10.1007/s10648-019-09465-5 | A |
| SDT 与游戏（Ryan et al. 2006） | https://link.springer.com/article/10.1007/s11031-006-9051-8 | B |
| 游戏化 meta（Sailer & Homner 2020） | https://link.springer.com/article/10.1007/s10648-019-09498-w | A |
| 严肃游戏 meta（Wouters et al. 2013） | https://doi.org/10.1037/a0031311 | A |
| 测试效应（Roediger & Karpicke 2006） | https://doi.org/10.1111/j.1467-9280.2006.01693.x | A |
| 脚手架（Wood et al. 1976） | https://doi.org/10.1111/j.1469-7610.1976.tb00381.x | B |
| Hedy（Hermans, ICER 2020） | https://doi.org/10.1145/3372782.3406262 | B |
| Hedy 官网 | https://www.hedy.org/ | 课程 |
| SICP JS | https://sicp.sourceacademy.org/ | 教材 |
| HtDP | https://htdp.org/2026-5-28/Book/index.html | 教材 |
| Pyret | https://www.pyret.org/ | 教材 |
| Realm of Racket | https://nostarch.com/realmofracket | 教材 |
| Bootstrap | https://www.bootstrapworld.org/ | 课程 |
| Minecraft advancements | https://minecraft.wiki/w/Advancement | wiki |
| Minecraft recipe book | https://minecraft.wiki/w/Recipe_book | wiki |
| Minecraft Education | https://education.minecraft.net/ | 产品 |
| Portal（Valve） | https://www.valvesoftware.com/en/portal | 游戏；教程观察 `[判断]` |
| The Farmer Was Replaced | https://store.steampowered.com/app/2060160/The_Farmer_Was_Replaced/ | 游戏 |
| Human Resource Machine | https://tomorrowcorporation.com/humanresourcemachine | 游戏 |
| Cognitive walkthrough（Wharton et al.） | https://ics.uci.edu/~dfredmil/ics203b-SQ05/papers/Whartonetal99.pdf | 方法 |
| SUS 说明 | https://www.usability.gov/how-to-and-tools/methods/system-usability-scale.html | 量表 |
| FCS1（Tew & Guzdial 2011） | https://doi.org/10.1145/1953163.1953200 | 测评 |
| 自动评估综述（Ihantola et al. 2010） | https://doi.org/10.1145/1930464.1930480 | B |
| 建构主义（Papert） | http://www.papert.org/articles/SituatingConstructionism.html | 理论；HTTPS 证书异常，用 http |
