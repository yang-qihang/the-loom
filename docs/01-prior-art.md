# 01 现有作品与行业对标（Prior Art）

> 状态：v1 草稿｜负责人：scout-prior-art｜最后更新：2026-10-31｜上游依赖：BRIEF.md v1
> 核验口径：版本号、项目存活状态、评分均于 **2026-10-31** 联网核验；链接为查询入口。标「判断」处是我的推断，不是来源事实。

## TL;DR

1. Minecraft 生态里的编程教学只有两种形态：官方教育管线的**可视化积木**（Code Builder/MakeCode、Code.org 教程）和社区**模组/服务端脚本**（CC:Tweaked 的 Lua、KubeJS 的 JS、Carpet 的 Scarpet、datapack）。前者不教真实语言，后者没有教学层——没有作品把两者合成。
2. **The Farmer Was Replaced（TFWR）是最接近我们的作品**：类 Python 文本语言 + 编程无人机 + 执行即见结果。抢先体验 2023-02-10，正式版 2025-10-10；Steam 全部评测 95%（4,396 条，好评如潮，2026-10-31）。它证明真实文本语言的编程游戏能进大众市场。
3. 但 TFWR 的世界是 2D 农场、单一主体，没有世界逻辑、多实体、服务端真值；Minecraft 舞台补上的是这部分——这是结构性差异，不是美术差异。
4. 硬核抽象系（HRM、TIS-100、Shenzhen I/O、7 Billion Humans）证明「汇编/并行/状态机」能做成高口碑关卡制游戏，但受众窄且不迁移到主流语言；**7 Billion Humans 的并行关卡是 Act3「并发」现成参照**。
5. 可视化系（Scratch、Blockly Games、Lightbot、Autonauts、Gladiabots）占据启蒙与算法生态位；CodeCombat 是唯一把真实 Python/JS 做成闯关课的产品，但它是刷题外壳，不是游戏世界。
6. 寿命教训：ScriptCraft 最后 release 停在 2019、LearnToMod 内容停在 2016/17、原版 ComputerCraft 官网 2026-10-31 已不可达；活得久的是随 MC 版本更新的 fork/模组（CC:Tweaked、KubeJS、Carpet）→ 4 天项目必须锁死版本，不做跨版本兼容。
7. MC 官方管线 2026 现状：Minecraft Education 的 CS 路径仍是「Hour of Code → MakeCode Blocks → Python」，叠加 AI 素养主题；Code.org 的 Minecraft 教程已改叙为「Hour of AI」，底层仍是 Agent 积木指令。
8. 教育研究不支持「文本一定更好」：Weintrop & Wilensky（2019）15 周准实验发现积木/文本入门的概念差异，在转入 Java 10 周后消失、编程实践无差异。MC 侧 2025/2026 仍出新论文，但没有可引用的 meta 分析（未验证）。
9. Voyager 的「自动课程 + 可执行技能库 + 执行反馈自验证」就是「AI 盲测 solver + 关卡断言」的现成范式；它用环境反馈而非模型微调把科技树解锁做到 15.3×。
10. 结论：我们的位置 = **真实主流语言（TS）× MC 原生世界因果 × 声明式关卡数据 × AI 可批量生产与盲测**。现有作品最多命中其中 2 条。

## 1. Minecraft 生态内的编程/逻辑教学作品

| 作品 | 语言/接口 | 教什么 | 2026-10-31 现状 | 可借鉴 / 失败教训 |
|---|---|---|---|---|
| [Minecraft Education Code Builder](https://minecraft.wiki/w/Code_Builder) | 游戏内代码 UI，经 MakeCode 编程 Agent（积木为主，可到 Python） | 顺序、循环、条件、坐标 | 官方 CS 页在线，路径 Hour of Code → MakeCode Blocks → Python（[CS 资源页](https://education.minecraft.net/en-us/resources/computer-science-subject-kit)） | 零安装、教师生态强；但 Agent 是「遥控乌龟」，抽象止步于移动/挖/放，闭源且与真实工具链脱节 |
| [Code.org Minecraft 教程](https://code.org/minecraft) | 浏览器积木，指挥 Agent | 基础 CS 概念、AI 素养 | 2015-11-16 起微软与 Code.org 合作（[Xbox Wire](https://news.xbox.com/en-us/2015/11/16/minecraft-hour-of-code/)）；2026 页面已改为 Hour of AI，保留 Voyage Aquatic/Hero's Journey/Adventurer/Designer | 单小时体验的节奏与无障碍最好；无连续课程、无文本语言、无真实工程；注：Dance Party 是独立教程（[code.org/dance](https://code.org/dance)），非 MC 系列 |
| [ComputerCraft / CC:Tweaked](https://github.com/cc-tweaked/CC-Tweaked) | Lua，可编程电脑与海龟 | 真实编程语言、API 设计、自动化 | CC:Tweaked 活跃：仓库 2026-10-30 仍有提交，最新 release 标签 v1.21.1-1.120.2；[文档站](https://tweaked.cc/) 在线（含 Lua）；原版官网 computercraft.info 已打不开 | 「程序→世界动作」闭环与社区规模是标杆；教训：单维护者原版死亡、社区 fork 续命，Lua 非主流语言 |
| [ScriptCraft](https://github.com/walterhiggins/ScriptCraft) | JavaScript 写 Bukkit/Spigot 插件 | JS 语法、服务端 API | 最后 release 3.4.0（2019-01-20），最后提交 2021-08-27，已停滞 | 证明 JS 直连服务端可行且有需求；缺乏维护与教学包装，随 MC 版本淘汰 |
| [LearnToMod](https://www.learntomod.com/) | 可视化 + JavaScript 改 mod/材质包 | modding、JS 基础 | 站点仍返回 200，但页面可见内容停在 2016 年附近，运营状态未验证 | 「卖 modding 教育」平台生命周期风险高；私有服务器 + 浏览器内测引擎的体验路径可参考 |
| [KubeJS](https://kubejs.com/) | JavaScript 脚本，服务端/客户端事件 | 世界逻辑、配方、数据驱动 | 7.x：7.0 对应 1.21、7.2 对应 1.21.1；官方称后续只支持 NeoForge（[7.0 更新页](https://kubejs.com/wiki/other/major-updates/7.0)） | 直接证明「JS/TS 脚本 + 服务端事件」是 MC 社区可接受的接口；但面向 modpack 作者，无学习者视角 |
| [Carpet / Scarpet](https://github.com/gnembon/fabric-carpet) | 服务端模组 + 内置脚本语言 Scarpet | 世界规则、实体行为、原版玩法实验 | 活跃：v26.4-beta-4（2026-10-21）；[Scarpet 文档](https://github.com/gnembon/fabric-carpet/wiki/Scarpet) 称其为「fully featured, in-game, programming language…preserving the vanilla feel」 | 「在 MC 里写脚本改世界」有十年社区基础；Scarpet 的原话印证 D4：vanilla feel 是 MC 玩家的价值锚点 |
| [命令方块 / datapack](https://minecraft.wiki/w/Data_pack) | mcfunction + JSON，官方能力 | 函数、循环、条件、状态机 | 官方能力长期存在（[命令方块](https://minecraft.wiki/w/Command_Block)） | 服务端可控世界状态并承载真值；语法不迁移，适合做底层原语而非教学语言 |

判断：官方管线的抽象上限是「让 Agent 走/挖/放」，正是 D2 要突破的边界——玩家能力走 Mineflayer、世界逻辑走插件，学生程序可直接改变实体与世界。社区脚本（KubeJS/Scarpet）证明服务端脚本接口可行且持久，但都假设使用者是 modder；把脚本能力包装成「教学关卡 + 错误翻译 + 提示梯」这一层，无人占据。

## 2. 非 Minecraft 编程游戏

### 2.1 The Farmer Was Replaced（重点，最接近我们）

事实（[Steam 商店页](https://store.steampowered.com/app/2060160/)，2026-10-31）：玩家「用一门简单的类 Python 语言编程无人机」自动化农场；抢先体验 2023-02-10，正式版 2025-10-10；全部评测 95%（4,396 条，好评如潮）；代码以 `.py` 保存，可用 VS Code 等外部编辑器并开 File Watcher 同步；商店文案称开局「一次引入一个编程概念」。

判断：它成功的关键不是「教得好」，而是三件事叠加——真实文本语言、单一可见执行主体、按 Run 就看到世界变化的反馈节拍；语言特性靠科技树逐个解锁，玩家没有「上课」感。短板是抽象上限：无类型系统、ADT、高阶函数/异步/并发场景，任务空间是 2D 农场而非有实体因果的世界。反馈节拍与解锁设计可直接借；Act2/Act3 的抽象覆盖与 MC 世界逻辑它给不了。

### 2.2 其余作品速览

| 作品 | 语言 | 教学抽象 | 关键事实与可借鉴点 |
|---|---|---|---|
| [Human Resource Machine](https://store.steampowered.com/app/375820/) | 可视化「小人工厂」指令集 | 顺序、跳转、循环、内存 | 2015；Metacritic 78。极简虚构机器教低级控制流，关卡短、即时回放；不迁移到主流语言 |
| [7 Billion Humans](https://store.steampowered.com/app/792100/) | 可视化并行指令 | 并行、同步、分工 | 2018；把「人」换成并行执行单元，Act3 并发关卡可直接参考 |
| [TIS-100](https://store.steampowered.com/app/370360/) | 汇编风格 | 寄存器、内存、流水 | 2015；Zachtronics 硬核路线，证明硬抽象有忠实受众但小众 |
| [SHENZHEN I/O](https://store.steampowered.com/app/504210/) | 汇编 + 电路 | 状态机、时序、资源约束 | 2016；同样的高口碑/窄受众 |
| [CodeSpells](https://store.steampowered.com/app/324190/) | 用代码施法（研究原型为 Java） | 函数、参数、世界修改 | 2015-09-18 上架，商店自述为「unguided, sandbox for the bravest wizards」；[Wired 2014 报道](https://www.wired.com/story/codespells/)记录其研究原型。教训：无引导沙盒会让新手迷失——反证「有限边界 + PriMM」 |
| [Algo Bot](https://store.steampowered.com/app/286300/) | 指令序列/伪代码 | 顺序、循环、调试 | 2018；小体量、强叙事，可参考单关节奏 |
| [Screeps: World](https://store.steampowered.com/app/464350/) | JavaScript（[screeps.com](https://screeps.com/)） | 真实语言、长期运行、资源管理 | 2016；24/7 持久世界 MMO，证明真实语言沙盒能留住核心玩家，但无课程与新手支架 |
| [Else Heart.Break()](https://store.steampowered.com/app/400110/) | 游戏内脚本化「黑入」物件 | 变量、对象属性、世界改写 | 2015；官网 2026-10-31 不可达（000）。「给世界写逻辑」的叙事幻想最接近 D2 |
| [Autonauts](https://store.steampowered.com/app/979120/) | Scratch 风格可视化 | 循环、过程、自动化 | 2019；用「教机器人」做可见循环，可参考新手第一小时 |
| [Gladiabots](https://store.steampowered.com/app/871930/) | 可视化 AI 规则（[官网](https://gladiabots.com/)） | 状态机、条件、优先级 | 2019；「构造 AI 再观战」的反馈方式适合参考评估/调试 UI |
| [Lightbot](https://lightbot.com/) | 图标式指令 | 顺序、过程、递归、循环、条件 | 官网称 2,000 万+ 儿童玩过；SpriteBox「从图标进阶到真实语言」的路线可参考（站点版权停在 2017，现状未验证） |
| [Blockly Games](https://blockly.games/) | 积木 | 从无循环到函数/音乐 | 多模块递进，是「零文字入门」的标杆 |
| [Scratch](https://scratch.mit.edu/) | 积木 | 事件、循环、广播、克隆 | 全球最大少儿编程社区；分享机制值得参考，但非真实语言 |
| [CodeCombat](https://codecombat.com/) | Python/JavaScript | 语法、循环、函数、算法 | 浏览器闯关课：真实语言 + 关卡制 + 自动判定，与我们的验收最像，但关卡是刷题外壳，没有世界因果 |

## 3. LLM-agent × Minecraft（技术 + QA 参考）

| 项目 | 事实（2026-10-31） | 对我们的用法 |
|---|---|---|
| [Voyager](https://arxiv.org/abs/2305.16291) | 2023-05-25；GPT-4 驱动：自动课程、可执行代码技能库、带环境反馈/执行错误/自验证的迭代提示。报告 3.3× 独特物品、2.3× 移动距离、科技树解锁最高 15.3× 于此前 SOTA | 盲测 solver 范式：solver 用同一 SDK 写解，断言失败日志进下一轮 prompt；技能库对应可复用解法片段 |
| [MineDojo](https://arxiv.org/abs/2206.08853)（[站点](https://minedojo.org/)） | 2022；把 Minecraft 做成开放任务/知识库基准 | 技能/科技树/任务语汇可借来做关卡命名与难度分档 |
| [Cradle](https://arxiv.org/abs/2403.03186)（[repo](https://github.com/BAAI-Agents/Cradle)） | 2024；截图输入 + 键鼠输出的通用计算机控制；repo 最后提交 2024-11-07 | GUI 级通用 agent 可行但贵且脆；我们的结构化 SDK 是更便宜、可重复的评测接口——可写进报告 |
| [Mindcraft](https://github.com/mindcraft-ce/mindcraft-ce) | 社区 fork 2026-10-26 仍活跃，LLM + Mineflayer 协作 agent | D2 的 Mineflayer 通道有先例；但 LLM agent 不稳定，只做体验增强，不做关卡验收 |
| [Project Malmo](https://github.com/microsoft/malmo) | 微软 2016 年起的 MC AI 平台；GitHub 已归档（最后提交 2025-09-03） | 平台绑定旧 MC 版本的结局：必须锁版本、留插件化网关 |

对盲测 solver 最值得抄的不是 Voyager 的提示词，而是**闭环结构**：自动生成/排序任务 → 生成可执行解 → 环境反馈判失败 → 失败信息回灌下一轮。映射到我们：评分断言即 reward，WorldDigest 即观测，solver 日志即证据——AI 写关卡、AI 验关卡才闭环。

## 4. 教育研究证据

Weintrop & Wilensky 的 15 周准实验（[DOI: 10.1016/j.compedu.2019.103646](https://doi.org/10.1016/j.compedu.2019.103646)，Computers & Education，2019）比较高中生用积木/文本入门 5 周后统一转入 Java 再学 10 周：两种入门方式的概念学习差异在转入 Java 10 周后消失，编程实践无差异。含义：文本语言「不更差」，不必为教学效果退回积木；但入门语法负担是真实成本，必须用工具链（错误翻译、补全、骨架）消化——这支撑 D1，也要求「hide the noise」是硬指标。

Minecraft 侧：Sawada 等 2025 年分析疫情期 K-12 用 Minecraft 元宇宙做编程教学（[DOI: 10.1145/3641555.3705122](https://doi.org/10.1145/3641555.3705122)）；Goh 2026-09 的 HAI-MinePy 用 Minecraft Education 教 Python 与计算思维，摘要强调 AI 支持应「强化而非替代」学生的计算思维与创造性（[文章页](https://journals.mmupress.com/index.php/ijcm/article/view/4744)）。2024 年另有一篇「游戏作为编程教学工具」的系统综述（[DOI: 10.1007/s10639-024-13005-2](https://doi.org/10.1007/s10639-024-13005-2)），我只核验题录、未读全文。

判断：现有研究多为小样本、自报告、异质工具，无法证明「某类设计必然更有效」。我们不宣称学习效果，只宣称可玩性、抽象覆盖与可验证性；若要引用效果，需自己做前后测（10 人即可，见 docs/10 建议）。

## 5. 对比表与 gap

符号：● 强/是，◐ 部分，○ 弱/否。

| 作品 | 真实语言 | 抽象覆盖 | MC 原生 | UI/反馈 | 关卡颗粒度 | AI 可批量生产 | 开源 |
|---|---|---|---|---|---|---|---|
| MC Education Code Builder | ◐ | ○ | ● | ◐ | 课级 | ○ | ○ |
| Code.org Minecraft | ○ | ○ | ◐ | ● | 单次 | ○ | ○ |
| CC:Tweaked | ● | ◐ | ● | ○ | 沙盒 | ● | ● |
| ScriptCraft | ● | ○ | ● | ○ | 沙盒 | ◐ | ● |
| LearnToMod | ◐ | ○ | ● | ◐ | 沙盒 | ○ | ○ |
| KubeJS | ● | ◐ | ● | ○ | 沙盒 | ◐ | ● |
| Carpet/Scarpet | ● | ◐ | ● | ○ | 沙盒 | ◐ | ● |
| The Farmer Was Replaced | ● | ◐ | ○ | ● | 科技树 | ◐ | ○ |
| HRM / TIS-100 / Shenzhen I/O | ○ | ○ | ○ | ● | 短关卡 | ◐ | ○ |
| 7 Billion Humans | ○ | ◐ | ○ | ● | 短关卡 | ◐ | ○ |
| CodeSpells | ◐ | ○ | ○ | ○ | 沙盒 | ○ | ○ |
| Screeps: World | ● | ◐ | ○ | ○ | 持续世界 | ◐ | ◐ |
| Else Heart.Break() | ◐ | ○ | ○ | ◐ | 叙事 | ○ | ○ |
| Autonauts / Gladiabots | ○ | ◐ | ○ | ◐ | 沙盒/竞技 | ◐ | ○ |
| Lightbot / Blockly Games | ○ | ○ | ○ | ● | 短关卡 | ● | ◐ |
| Scratch | ○ | ◐ | ○ | ● | 项目制 | ◐ | ● |
| CodeCombat | ● | ◐ | ○ | ● | 关卡+课程 | ◐ | ◐ |
| **我们（目标）** | **● TS** | **●** | **●** | **自建** | **9-10 关 + Lab** | **●（数据驱动）** | **可开源** |

Gap 结论（判断）：①没有作品同时具备「MC 原生 + 真实主流语言 + 世界/实体逻辑 + 教学梯度」；②官方管线把编程缩成 Agent 遥控，社区脚本没有教学层，TFWR 没有世界因果，CodeCombat 没有世界；③关卡都是手工内容，没有一个把「关卡 = 数据 + 断言」做成 AI 可生成、可盲测的形态；④研究缺少「抽象 × 关卡设计」的课程级证据，这反而是我们的深度所在；⑤MC 玩家要 vanilla feel（Scarpet 原话），支持 D4 seed-first 而非手工搭景。

## 6. 对项目的 10 条直接建议

1. 版本锚定，不做跨版本兼容：Paper、MC、插件 API、Mineflayer 版本写进 `docs/02`，验收：起服后 `/version` 与插件 `api-version` 匹配（见 docs/07）。
2. 抄 TFWR 的反馈三件套：单一可视线索（魔像）、Run/Pause/加速、编辑器与世界同屏；写进 level spec 的 `feedback` 必填字段，验收：L01 首次 Run 到世界变化 < 1 秒。
3. Act1 的 TS 不给学生写类型标注：类型由 SDK `.d.ts` 提供，错误信息经「错误翻译表」转成教练话术；验收：20 条常见错误全部有中文映射的快照测试。
4. 抽象解锁 = API 子集冻结（参考 CC:Tweaked「先给能力，再给语法」）：`sdk/act1.ts` 只导出 6-8 个函数，验收：每关 `grep -c "^export"` 数量断言。
5. 用 Voyager 闭环做盲测 solver：solver 只读 SDK 与题面写解，断言失败日志回灌；计划产出：10 关各有 1 条 solver 通过记录（`research/solver-log.md`，Day2 起生成）。
6. 把 solver 的尝试次数/时长当难度信号，做自动难度排序（Voyager 自动课程的轻量版）；验收：L01→L09 难度单调性检查脚本。
7. CodeSpells 的反面教训写进 schema：PriMM 的 Predict 题、提示梯、3-strike 是 validator 的 required 字段，验收：缺字段的 spec 被拒绝。
8. 用 Code.org 单小时体验的节奏做 5 分钟 Challenge Lab；验收：Lab demo 计时 ≤ 5 分钟。
9. 卖点排序：先「好玩」后「教学」（TFWR/HRM 都这么卖）；demo 先展示 Run 的视觉结果，再解释概念。
10. 差异化 demo：2 分钟内演示「5 行 TS → 魔像在 MC 里做 3 件事 + 世界状态改变」并给出 WorldDigest 对照；这是 D7 验收样板。

## 7. 如果只能改 BRIEF 里一条决策

我改 **D1**：从「学生语言 = TypeScript」改为「**TypeScript 的渐进方言**」——Act1 学生不写类型标注、不出现泛型/装饰器/`async` 语法，类型只由 SDK 的 `.d.ts` 提供；严格模式到 Act3 再开。理由：Weintrop & Wilensky（2019）显示文本入门相对积木的概念差异会在后续 10 周收敛，说明「一开始就用全量文本语言」没有长期教学收益，短期语法负担却是确定成本；TFWR 用无类型的类 Python 语法拿到 95%/4,396 条好评，证明新手友好与真实文本语言不矛盾。反方风险：隐藏类型会削弱补全质量与「类型即文档」的教学价值——折中是类型信息只出现在 hover/补全/`docs`，`.d.ts` 当教学材料而非学生作业。

次选挑战：**D5 的 9-10 关**偏少。HRM 有 40+ 短关、7 Billion Humans 60+、Lightbot 约 20；每关只教一个抽象时，9-10 关难以覆盖 8 个抽象加复习。建议 12-14 关，或每关内置 2-3 个子任务（同场景递进）。

## 8. 不确定 / 未验证事项 + 验证方法

| 事项 | 状态 | 验证方法 |
|---|---|---|
| TFWR 的实际概念覆盖、关卡/科技树数量 | 未验证（未游玩，仅读商店页/新闻） | 购买游玩 3 小时记录解锁顺序；或读 thegamer 攻略逐段对照 |
| LearnToMod 是否仍在运营 | 未验证（站点 200，内容停在 2016 附近） | Wayback Machine 查 2025-2026 快照；尝试注册/支付流程 |
| CodeSpells 当前是否可购买/停更 | 未验证（2015 上架，商店文案自称 unguided sandbox） | Steam API `appdetails` + `ISteamNews`；看最近更新日期 |
| MineDojo/MineRL 维护状态 | 未验证（站点 200，论文 2022） | GitHub API 查 `pushed_at`；minerl.io 状态 |
| MC 1.21.x 与 26.x 版本号关系、Paper 对应 API | 未验证（交给 scout-minecraft） | papermc.io downloads API；CC:Tweaked release 标签对照 |
| 是否存在 MC 编程教学 meta 分析 | 信息不足，未找到 | Google Scholar：`"Minecraft" meta-analysis programming education`，2015-2026 |
| 2024 系统综述的具体结论 | 仅核验题录/DOI，未读全文 | 下载 EIT 全文读结果与局限 |
| 各作品 UI/错误提示的细节 | 仅看商店页/官网文案，未实机 | 各买/下 1 小时试玩，做 3 列对比表 |

## 9. 来源清单（均于 2026-10-31 访问/核验）

- MC 官方/生态：[Minecraft Education CS 资源页](https://education.minecraft.net/en-us/resources/computer-science-subject-kit)、[Python 101 课程页](https://education.minecraft.net/en-us/lessons/python-101-lesson-5)、[Minecraft Wiki: Code Builder](https://minecraft.wiki/w/Code_Builder)、[Minecraft Wiki: Data pack](https://minecraft.wiki/w/Data_pack)、[Command Block](https://minecraft.wiki/w/Command_Block)、[Code.org Minecraft](https://code.org/minecraft)、[Code.org Dance](https://code.org/dance)、[Xbox Wire 2015-11-16](https://news.xbox.com/en-us/2015/11/16/minecraft-hour-of-code/)
- MC 社区作品：[CC:Tweaked](https://github.com/cc-tweaked/CC-Tweaked) / [tweaked.cc](https://tweaked.cc/)、[ScriptCraft](https://github.com/walterhiggins/ScriptCraft)、[LearnToMod](https://www.learntomod.com/)、[KubeJS](https://kubejs.com/) / [7.0 更新](https://kubejs.com/wiki/other/major-updates/7.0)、[Fabric Carpet](https://github.com/gnembon/fabric-carpet) / [Scarpet 文档](https://github.com/gnembon/fabric-carpet/wiki/Scarpet)
- 非 MC 游戏：[TFWR](https://store.steampowered.com/app/2060160/)、[HRM](https://store.steampowered.com/app/375820/)、[7 Billion Humans](https://store.steampowered.com/app/792100/)、[TIS-100](https://store.steampowered.com/app/370360/)、[Shenzhen I/O](https://store.steampowered.com/app/504210/)、[CodeSpells](https://store.steampowered.com/app/324190/) / [Wired 2014](https://www.wired.com/story/codespells/)、[Algo Bot](https://store.steampowered.com/app/286300/)、[Screeps: World](https://store.steampowered.com/app/464350/) / [screeps.com](https://screeps.com/)、[Else Heart.Break()](https://store.steampowered.com/app/400110/)、[Autonauts](https://store.steampowered.com/app/979120/)、[Gladiabots](https://store.steampowered.com/app/871930/) / [官网](https://gladiabots.com/)、[Lightbot](https://lightbot.com/)、[Blockly Games](https://blockly.games/)、[Scratch](https://scratch.mit.edu/)、[CodeCombat](https://codecombat.com/)
- LLM-agent：[Voyager arXiv 2305.16291](https://arxiv.org/abs/2305.16291)、[MineDojo arXiv 2206.08853](https://arxiv.org/abs/2206.08853) / [minedojo.org](https://minedojo.org/)、[Cradle arXiv 2403.03186](https://arxiv.org/abs/2403.03186) / [repo](https://github.com/BAAI-Agents/Cradle)、[Mindcraft](https://github.com/mindcraft-ce/mindcraft-ce)、[Project Malmo](https://github.com/microsoft/malmo)
- 研究：[Weintrop & Wilensky 2019](https://doi.org/10.1016/j.compedu.2019.103646)、[Wilson et al. 2024](https://doi.org/10.1007/s10639-024-13005-2)、[Sawada et al. 2025](https://doi.org/10.1145/3641555.3705122)、[Goh 2026 HAI-MinePy](https://journals.mmupress.com/index.php/ijcm/article/view/4744)
