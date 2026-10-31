# BRIEF — 项目共享上下文（所有 agent 必读）

> 状态：v1（Lead 维护）｜负责人：Lead｜最后更新：2026-10-31｜适用：本 session 全体 teammate
> 规则：本文档是唯一共享上下文入口；研究/设计产出时先读本文件。发现本文件中的假设错误 → 在交付物里用证据指出，不要默默绕过。

## 0. 一句话

做一个**以 Minecraft 为舞台、以一门真实主流语言（TypeScript）为教具**的编程教育游戏：玩家通过写程序驱动游戏中的「魔像」与「世界逻辑」完成一系列 Minecraft 地道的任务，在 3 个 Act（10 关 + Epilogue）里依次掌握从「顺序/变量/分支/循环」到「函数/ADT/闭包/高阶函数/管道/接口组合/异步/并发」的共通抽象，并理解每个抽象**被发明出来是为了解决什么问题**。

## 1. 用户愿景与不可违背的 invariants

1. 舞台必须是 Minecraft（Java 版），玩法必须「MC 地道」——像真 MC 玩家会做的事，而不是披着 MC 皮的刷题。
2. 我们有自己的软件界面：关卡选择（与 MC 强联动）、代码编辑器、教练提示、运行反馈。
3. 教具语言必须让新手写起来不恐惧：要能 **deliberately hide the noise**。优先 TypeScript（SICP 3rd ed 用 JS 有先例；mineflayer 是 JS 生态）。
4. 编译/解释后的结果要反映到 Minecraft 的视觉结果上；「给物体本身写逻辑」（entity 逻辑）必须是可实现的。
5. 技术接口倾向双通道：**(1) 与 Mineflayer 对应的机器人部分；(2) 把 Entity/世界逻辑发给 MC 服务端插件**——对用户隐藏底层细节。用户严重倾向此方案。
6. 4 天不到（课程汇报项目）。原则：**限定边界，小而精**；少做几个场景，但每个必须丰富、美观、有意思、梯度平滑，不能挫败玩家。
7. 交付必须「深度够」：不能因为时间少就做一个 low 的东西。
8. 工程本身要能用 **AI 多智能体、尽可能少人类监督**的方式在 4 天内完成；DSH / DeepSeek v4 flash 是主力工具。

## 2. Lead 决策快照（scout 可以拿证据挑战，但必须在交付物里明确写出「挑战 + 证据 + 建议」）

| # | 决策 | 状态 |
|---|---|---|
| D1 | 学生语言 = **TypeScript**（非自造语言、非 Racket）。理由：真实主流语言 + 生态/工具链 + SICP JS 先例 + AI 实现速度 + 异步/并发原生；用 SDK/骨架/错误翻译/编辑器补全来 hide noise。Racket/自造语言列为「明确否决 + 理由」。 | 待 scout 验证 |
| D2 | MC 集成 = **单逻辑 API + 双物理通道**：玩家能力（移动/挖掘/放置/背包/寻路/多机器人）走 **Mineflayer bot**（外观做成「魔像 automaton」，玩家实体）；世界/entity/NPC/过场/评分真值走 **Paper 服务端插件**（WebSocket JSON-RPC）。学生只看到统一的 `golem` / `world` SDK。**版本锁（不可协商）**：MC/Paper **26.1.2 build 74** + Java **25** + mineflayer **4.39.0** + minecraft-protocol 1.68.0 + mineflayer-pathfinder 2.4.5。**禁止升级**到 26.2/26.3（mineflayer #4189 join 1.5s 被踢）。 | M0 实证通过（7/7，2026-10-31） |
| D3 | 内容即数据：关卡 = **声明式 SceneScript + 评分断言 + 教练脚本**，插件提供通用 primitives（摆方块/生成实体/对话/粒子/音效/title/进阶/bossbar…）；关卡作者（AI）不写 Java。 | Lead 定 |
| D4 | 世界美术策略 = **seed-first**：用固定 seed 的原生世界生成（村庄/峡谷/矿洞/要塞）当舞台，插件只做小型道具摆放与重置；少手工搭景，保 MC 原生质感。**细化（M0）**：Act I（L1–L4）优先「自然村庄 + 局部平整短路径 + 和平难度」保证 pathfinder 稳定；Act II 起扩展自然地形。结构/村庄坐标 Day 1 用插件 locate 一次并预存 spec，运行时只传送，不运行时碰运气。 | M0 已验证可行，细节见 docs/02 |
| D5 | 关卡体系 = **3 Act / 10 关 + Epilogue（=L11=EP）+ 4 个 Challenge Lab**；每关 1 个主抽象（至多 2 个），PriMM 节拍（Predict→Run→Investigate→Modify→Make），分级提示梯，3-strike 自动提示，无死局。 | Lead 定 |
| D6 | 工作主题（working title）：**「织界 / THE LOOM」**——村庄的古老「织机」把语言编织成世界法则；标准银河字母=符文；关卡选择做成制图台/地图墙；魔像=被编织出来的伙伴。可被更好的创意替换，但必须 MC 地道、视觉可落地。 | 允许创意发挥 |
| D7 | 验收第一位是**文本/状态真值**（服务端世界快照、ASCII World Digest、结构化日志），截图只作人类审美证据。AI 若缺视觉能力也能闭环。 | Lead 定 |

## 3. 本阶段交付物（本次 session，落盘到工作区）

```
BRIEF.md                          # 本文
docs/01-prior-art.md              # 行业/现有作品调研（scout-prior-art）
docs/02-minecraft-stack.md        # MC 技术栈调研与选型（scout-minecraft）
research/language-notes.md        # 语言/macro/sandbox/渐进式调研笔记（scout-language）
research/pedagogy-notes.md        # 学习科学 + 游戏化 + 评估调研笔记（scout-pedagogy）
research/assurance-notes.md       # AI 多智能体工程 + 质量保证调研笔记（scout-assurance）
docs/03-language-decision.md      # Lead：语言选型判断（含 macros 回答、hide-noise 清单）
docs/04-learning-design.md        # Lead：学习设计 + 抽象地图（motivation-first）
docs/05-curriculum.md             # Lead：课程骨架、关卡总览、梯度验证
docs/06-level-spec-system.md      # Lead：level spec 模板/schema/validator/评分设计
docs/07-architecture.md           # Lead：技术架构、协议、仓库结构、测试策略
docs/08-ai-workflow.md            # Lead：全 AI 多智能体工作流与保证体系
docs/09-execution-plan.md         # Lead：4 天执行计划、kill criteria、fallback、验收
docs/10-demo-and-report.md        # Lead：demo 脚本 + 课程报告结构 + 评估方案
content/levels/L01..L10-*.md      # 关卡详细规格（Lead 写 L01 样板，level smith 写其余）
content/level-spec.schema.json    # Lead：机器可读 spec schema
```

## 4. 写作与事实规范（所有交付物）

- **语言**：中文正文；专业术语首次出现给英文（例：代数数据类型（algebraic data type, ADT））。代码/协议/标识符用英文。
- **时效**：今天是 2026-10-31。所有版本号、项目存活状态、API 能力必须**联网核实到 2026 年**，标注来源链接与查询日期。不允许凭记忆编造版本号。
- **区分事实与判断**：事实给来源；判断写「Lead/我的判断 + 理由 + 反方风险」。
- **可执行性**：每条建议要能让一个 AI agent 直接开工（文件路径、命令、验收标准）。禁止「建议进一步研究」式空话，除非同时给出具体研究方法和验证命令。
- **反 AI 味**：不用 "delve/tapestry/robust/landscape" 等空词；不堆叠无信息 bullet；段落之间要有论证关系；数字具体；主动语态；不写营销口号。
- **图表**：优先表格；流程/架构用 mermaid；坐标/协议给具体 JSON 示例。
- **文件头**：每个 docs 文件头写明 `状态 / 负责人 / 最后更新 / 上游依赖`。

## 5. Scout 通用要求

1. 先读本 BRIEF；产出写到任务指定的**唯一文件**，不要改别的文件。
2. 时长目标：一次 turn 内交付（约 20-30 分钟等效工作量）。宁可少而准，不要长而空。
3. 结构：`TL;DR（10 条以内）` → 分节正文（带表格/链接）→ `对项目的直接建议` → `不确定/未验证事项 + 验证方法` → `来源清单`。
4. 每个 scout 在最后给出一段 **「如果只能改 BRIEF 里一条决策，我改哪条，为什么」**。
5. 完成后用 send_message 向 lead 汇报 ≤30 行摘要：文件路径、关键结论、挑战了哪个假设、剩余风险；不要把全文粘回来。

## 6. 环境与能力自测（2026-10-31，Lead 实测）

- 开发机：Linux Fedora 44，32 核，14 GB RAM，93 GB 空闲磁盘；网络可用（npm registry 200）。
- 工具链：Node v22.23.1 / npm 10.9.8（无 pnpm，可用 npm workspaces）；Java 25（Paper 需要 21+，插件编译 target 需按 Paper 要求设定）；**Docker 29.9.2 可用**（可跑 itzg/minecraft-server 做集成测试）；无 gradle/maven（用 Gradle/Maven Wrapper）；无 `~/.minecraft`（**MC Java 客户端需要在 Day 0 装好**，或准备 prismarine-viewer 兜底）。
- **视觉能力自测**：用脚本生成 400x200 PNG（三色块 + 阶梯形 + 圆盘），`read_image` 回读后模型能准确描述颜色、形状、相对位置 → **本 harness 的模型具备基本图像识别能力**。但「复杂 MC 3D 场景的审美判断 / 细节缺陷识别」未验证，不能作为审美验收依据（D7 仍以文本/状态真值为准，截图只作人类证据）。
- DSH 可用能力：Agent Teams（teammate、共享文件系统、任务板）、subagent、workflow 编排、后台 job、worktree、session 搜索。
- **M0 实证结果（2026-10-31，scout-minecraft）**：Paper 26.1.2 build 74 + Java 25 + mineflayer 4.39.0 双通道 spike **7/7 通过**（bot 放方块→插件快照读到、插件 setblock/spawn→bot 观测、双向聊天、bot 调插件命令）。Docker `itzg/minecraft-server:java25` 实测启动（12.3s）。Paper 下载服务已换代：`api.papermc.io/v2` sunset，必须用 Fill API v3；插件依赖坐标 `io.papermc.paper:paper-api:26.1.2.build.74-stable`。实测延迟：connect→spawn 2.13s、寻路 4.2 格/s、挖 0.3–0.8s、放 0.5–1.0s、冷启动 11.6–12.3s。证据：`spikes/mc-bot-paper/`。

## 7. 术语表（统一用词）

- **魔像 / golem**：玩家程序驱动的 agent 实体（Mineflayer bot 外观）。
- **符文 / rune**：游戏内对「编程概念」的叙事化称呼。
- **织机 / Loom**：运行时/世界法则的叙事化称呼。
- **SceneScript**：声明式关卡场景与演出脚本（JSON）。
- **WorldDigest**：服务端世界状态的紧凑文本快照，供 AI 无视觉验证。
- **PriMM**：Predict–Run–Investigate–Modify–Make 教学节拍。
- **织偶（golem）**：玩家程序驱动的 agent（旧文档中的「魔像」一律改称织偶）。
- **织典（Loom Codex）**：游戏内跨语言对照图鉴，A0–A14 + X1/X2 共 17 页。**注意：这里的 Codex 取「古籍/抄本」义，不是 OpenAI Codex 编程模型；UI 中文名只用「织典」，英文对外用 Loom Codex，内部代码 key 才用 `codex`。**
- **L-Epilogue = L11 = EP**：尾声关的三种写法，指同一关。
- **Level spec**：单关的完整规格（世界观、任务、评分断言、提示、验收）。
