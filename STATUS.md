# STATUS — 项目状态（Lead 维护，每个集成点更新）

## 2026-11-01 Round 2（v1.5，已完成）

第二轮试玩反馈的修复与增强已全部落地并终验，契约/验收清单与实施结果见 `docs/48-round2-guidance-api-visual-plan.md` §6。

- **语义 API**：新增 `collect`/`deposit`/`count`/`harvest`/`plant`/`world.container`/`goTo`/`moveTo(point)`/`place(block, point)` 与命名坐标点（`LevelDef.world.points` → 沙箱全局常量 + `world.points`）；旧 `place("air")` 反例废弃，旧签名保留且评分事件语义完全一致（collect→air、deposit→item）。
- **引导**：`ProgressStep.hint`（2–4 句：怎样算完成/可照抄写法/坐标从哪来），失败时进教练卡 + 游戏内 actionbar（每次失败 1 条、去重不刷屏）；指令手册（顶栏/教练卡/REPL 三入口，可开关/搜索/复制示例）；位置 HUD（灰崽/关键点/木桶计数，1s 轮询、页面隐藏暂停）。
- **REPL**：试符台用当前关卡打开（不再跳回 L01），显示「当前关卡：X」，`help` 打开本关指令手册，命名点与 `golem.pos` 可读。
- **概念揭晓**：结算/手记/织典按关揭示正式术语（L01 函数调用、L02 变量、L03 分支、L04 循环、L05 函数、L06 记录、L07 高阶函数、L08 接口、L09 异步、L10 协议），不回避专业术语。
- **名实相符**：每关 `codeRequirements` + AST 分析器判定；starter 全不满足、参考解全满足；L02 参考解真用变量、L06 真用记录/switch、L07 真用 filter/map 流水线等。
- **字体/Monaco**：嵌包 Maple Mono CN（OFL），代码与提示类 UI 统一（Zpix 仅装饰大标题）；Monaco 右键菜单不透明并中文化（根因：Monaco 0.57 默认 `useShadowDOM:true` 隔离主题 CSS，已设 `useShadowDOM:false`）。
- **起始点/截图**：10 关 `world.playerSpawn` 落盘；修复 L02/L09「玩家出生与灰崽重合、镜头糊在模型体内」；真实 Minecraft 26.1.2 客户端高清重拍（2560×990 ×10 关，含 L10）替换 Studio 关卡素材与 report 证据；Studio UI DPR2 高清截图。
- **文案政策**：自然中文 + 必要英文术语（`for` 循环、`let` 变量、`Promise.all`…），`check-copy --pure-zh --strict` 0 违规。

**终验**：`tsc` 0；`npm test` 25 files / 235 tests；content 162 tests；`verify.sh` pass（仅 Round 1 遗留 `G-FRESH-READER` tracked warning）；Studio e2e 6/6 + local 2/2；guidance 隔离冒烟 42/42；monaco-font 22/22 + 桌面壳 8/8；真实 Paper e2e L01–L10 全 PASS；重新打包 AppImage（428MB）/ RPM（435MB，2026-11-01 14:13），包内已含新字体/引擎/插件/世界素材。证据：`evidence/playtest-fix/start-positions.md`、`evidence/scene-shots/hi-res/`、`evidence/ui-hires/`、`evidence/monaco-font-verify.json`、`evidence/code-analysis.json`、`apps/studio/public/world/`、`report/`。

**已知边界**：真实 Paper 模式同一时刻只重建一个真实世界会话，但试符台使用独立 Mock 会话，不再 dispose/影响当前关卡进度；L10 出生朝向看不到桥（素材用桥面机位并注明）；L03 钟本体在钟楼内不可见（对钟楼右键可完成）；`guard-tests` manifest drift 为 Round 1 前基线。

## 2026-11-01 试玩反馈修复（v1.4，已完成）

用户真实试玩反馈的 4 类问题已全部修复，并按「同类问题全关卡一次解决」落地（详见 `docs/46-playtest-fix-plan.md` §5）：

- **任务进度**：`LevelDef.progress` 成为 Studio 目标面板唯一真值；L01 三任务（1→3 号灯 / 亲手点 4 号 / 回艾拉）逐条打勾；L01–L10 每关 2–3 条可机器判定 progress。
- **线性玩家节拍**：引擎在「织偶部分完成」后发 `playerBeatReady`；Studio 只在此时显示「轮到你」+ 教程；插件 `playerBeat.activate` 之前会拦截提前右键。只点亮 1 盏不再出现第 4 盏提示。
- **sandbox 纯净**：切关清上一场景/旧实体/玩家背包/待发道具；L01 增加自己的 clearRegion；老用户脏世界自动换干净世界（世界布局版本 marker）。
- **彻底 reset**：全区域 checkpoint 还原（玩家挖掉/乱放/上一关残留都还原/清除）、区域实体清理、NPC 重生、玩家回 playerSpawn、背包回本关基准、事件清零、两次 hash 稳定。
- **第 4 盏灯可达**：通用容错右键（手持本关道具、6 格内、视线大致朝向即可，不必看见柱顶面）；激活后目标处发光标记；删掉误导性石阶，文案改为「站地面对着柱子右键」。
- **全关卡同类修复**：L02–L10 的 player beat 全部走同一套 arm/activate/容错机制；重复运行不重置的事件计数判定改为 first-occurrence/distinct 目标；L10 双织偶 + 合龙石通过真实 e2e。

**验收**：`npx tsc --noEmit` 0；`npm test` 235/235；`npm --prefix apps/studio run test:e2e` 6/6、`test:e2e:local` 2/2；`it/l1-real.ts`–`it/l10-real.ts` 真实 Paper 全 PASS；L01 集成验收 25/25、插件级真实 Paper 验收（脏世界自愈/reset/全关卡节拍）全绿。证据：`evidence/playtest-fix/`、`evidence/l*-real-latest.json`、`tmp/plugin-work/evidence/`、`tmp/progress-evidence/`。

**升级注意**：新桌面包会自动替换 `~/.loomcraft/runtime/paper/world` 为干净世界（旧关卡残留会污染 sandbox）；Studio 的关卡进度/星级不在世界里，不受影响。



## 2026-11-01 独立验收补充（verifier）

独立 verifier 在隔离端口（Paper 25566 / RPC 8766 / engine 4321）用 mineflayer 玩家复验（证据 `evidence/playtest-fix/report.md`、`after/*.json`）：

- L01 全流程 35 项检查 PASS（进度逐条/门控/提前右键拦截/玩家右键 3 星/reset 哈希稳定/切关纯净）；全关卡 10/10 progress 契约、17/17 player beat 可由真实玩家右键完成。
- 独立验收发现的真实玩家体验问题已修：L03/L05 显式 `playerSpawn`（`[0,65,12]`/`[13,64,6]`）；L02 蛋糕 `[4,66,-6]`、L04 南瓜 `[14,67,26]` 改为目标方块上方的空气格（会真的落块）。仅剩 L03 钟本体在钟楼结构内不可见（美术边界，对着钟楼右键可完成）。
- 独立验收未覆盖真人客户端画面（prismarine-viewer 1.33 只支持到 1.21.4，已改用体素光栅化替代截图）。

## 历史快照（2026-10-31 及更早）

> 以下段落保留为历史记录，**不代表当前状态**；当前状态以上方 v1.4 段、`docs/46-playtest-fix-plan.md` 与代码为准。

> 最后更新：2026-10-31 12:25（Asia/Shanghai）｜阶段：**设计交付完成（v1.3：审计 + 两轮独立评审 + 修订 + 关键 spike），等待 CP0 拍板后进入 T1**

## 一句话（历史，已被上方 v1.4 段取代）

**交付状态（2026-10-31 14:30，历史）**

- **可玩**：L01–L09（Mock + Studio；真实 MC 已验收 L01–L04）。L10 当时为终局设计（多织偶运行时当时未接；**2026-11-01 已接，见上方 v1.4 段**）。
- **真实 MC**：Engine `LOOM_WORLD=paper` 跑通 L01–L04（34/34 check，3 星）；真实评分与 Mock 逐项一致。
- **桌面**：Tauri 2 自包含安装包（AppImage ≈400MB / RPM ≈415MB，2026-11-01 重打包）；包内带 Node/Java/Paper/插件/世界/真实引擎/织偶。
- **质量**：185 项自动化测试全绿；verify l0–l3+lg exit 0；门禁 8 pass / 1 warn / G-FRESH-READER Round 4 仍 tracked fail（需继续收敛）；Studio 真实 Playwright 5/5（含文字溢出自动断言、等待玩家、错误态、试符台、织典）。
- **真实 MC 视觉**：客户端已在 Xvfb 真实启动进服；L01 完成村门/风车/池塘/集市/村舍/苔藓小径/灯笼等美术 pass，L02 完成谷仓/鸡舍/水槽/树/干草等美术 pass；真实 L1/L2 e2e PASS；截图 evidence/scene-shots/L01.png、L02.png；场景质量门 `qa/scene-quality.mjs`；流程 docs/34、docs/35。
- **场景美术（region-aware）**：新增 `scripts/scene-shot.mjs` + 插件 `session.status` 的 region/spawn/center 与 `player.teleport yaw/pitch`，截图不再拍旧竞技场。**L01–L09 全部通过真实截图质量门**（L04 修复 y65 逻辑田不可见 + 天气；L08 修复插件补灰柱/相机在场景外，真机主视角能看到烟囱/熔炉/红石门/工具架；自然材质约 85%，红石灯/羊毛为小面积点缀）；L07 实拍仍空/灰，继续返工；L06 机位需调整；L09/L10 未做。L05 第三次返工：clearRegion 中心从空草地改到工地，playerSpawn=(13,64,-2)，真实机位可见脚手架/工棚/半成品房/木料场；自然材质为主、点缀色 3.88%。已向并行 agent 强调：不得为了凑丰富滥用高饱和彩色，点缀色小面积使用。
- **桌面最新包**：AppImage ≈400MB / rpm ≈415MB（2026-11-01 重打包），包内带 Node/Java/Paper/插件/世界/真实引擎/织偶；自绘像素标题栏、拖动/最大化/最小化/关闭、A-/A+、系统页、伴玩、四颗连接灯。
- **游戏内提示**：`POST /api/in-game` 支持 `title`（短句大字）与 `actionbar`（长句小字）；真实客户端截图 20/21 已验证不裁切；Studio 开始/等待/报错/通关/重置都已接入。
- **真实玩家路径验收**：L01–L10 真实 Paper e2e 全 PASS（各 3 星，L10 双织偶含 Studio 会话注入）；UOS 4/4、纯中文 0 违规；挑战层仍为说明卡，真人键鼠盲测未执行。
- **世界内中文标注**：插件 `annotations.set/clear/visible` 已实现并打日志（L01 一次生成 6 个、直接测试 2 个 ArmorStand 名牌）；Studio 有「世界标注：开/关」与说明。**受控测试里 2.2x TextDisplay 可见但过大；1.2x 在 L01 实际机位仍不易看到，标注字号/机位未定稿，未宣称可用。**
- **零 MC 基础引导**：只在「轮到你」阶段出现可折叠「第一次玩 Minecraft？」分步说明（切窗口/WASD/准星/右键），并提供「我弄乱了世界，重置本关」一键恢复；Playwright 已断言。
- **随时重置**：工作台顶栏「重置本关」+ 结算页重置常驻。
- **UI 修复**：目标三条不再被裁、等待态有「我已在游戏里点亮」入口、错误态不再显示「准备就绪/灰崽开始照做」、结算主按钮为「下一关」、坐标/失败/试符台/序章排版/红色波浪线等已修；所有卡片加文字溢出 Playwright 断言。
- **Fresh Reader**：Round 3 仍 FAIL（主要剩「没有真实游戏画面/世界方位图不随关卡变、织典术语密度、部分文案指代」）；未清零前不宣布通过。
- **内容**：9 关 Mock 内容、L01–L04 真实场景、17 页织典、试符台 REPL、序章/手记、纯中文 UI、Fresh Reader 修复循环。
- **未完成/限制**：L10 多 agent 运行时；桌面安装包接真实 MC；无真人客户端视觉验收；Fresh Reader Round 3 结果待定。
：真实 Paper 26.1.2 上 L01 无头 e2e **PASSED/3 星**，真实评分与 MockWorld 逐项一致，reset ≤2s hash 稳定；`npm test` **70 测试全绿**，`verify.sh` l0–l3 全绿；Engine HTTP/SSE 3 星；Studio 构建通过；安全加固 4 项完成。进入 **T2：Studio live + L02–L04 真实 MC 场景 + 美术/文案**。

设计交付包 v1 完成；M0（MC 技术栈）已实证通过（双通道 7/7）；10 关规格与 4 个 Labs 正在收尾；等待用户确认 8 个前提问题后开始 4 天实施。

## 门禁（历史）

| 门 | 状态 | 证据 |
|---|---|---|
| M0 环境锁定 | ✅ 通过 | `spikes/mc-bot-paper/`（Paper 26.1.2 + mineflayer 4.39.0，7/7；见 docs/02） |
| 设计交付 v1.3 | ✅ 完成 | docs/00–15 + 13 份 level spec + 3 个实证 spike（见下方「今日完成」） |
| L10 铺桥 spike | ✅ 通过 | 路线 A 10/10、0 掉落（docs/02c） |
| Spec 修订波 | ✅ 完成 | L01–L10/EP/Labs 按 docs/14/14b 修复并自查 0 error；待 fresh critic 复评一次（≈1h）后冻结 |
| CP0 用户拍板 | ⏳ 等待 | 待确认问题见 docs/11 §13 |

## 今日完成（历史）

- 5 路研究：行业对标（01）、MC 技术栈与实证（02）、语言/macro/sandbox（research）、学习设计（research，收尾中）、AI 工程保证（research）。
- 设计文档：BRIEF、03 语言判断、04 学习设计、05 课程骨架、06 关卡 spec 体系、07 架构、08 AI 工作流 + 附录模板、09 4 天执行计划、10 demo/报告/评估、11 决策与开放问题、12 SDK API registry、13 Codex 跨语言（收尾中）。
- 关卡规格：L01（样板）、L02、L08、L10 已交付；L03–L07、L09、Epilogue、Labs 写作中。
- 独立审计：docs/00 一致性审计、docs/00b 审计响应（P0 全处置）、docs/14 学习设计评审（2 PASS/11 需修）、docs/14b 机器契约校验（meta 13/13 PASS，8 FAIL 中 5 个契约缺口已由 Lead 修复）、docs/15 评审处置与 spec 冻结计划。
- 技术可行性：docs/02b（无不可做关卡）；docs/02c L10 铺桥 spike **路线 A 10/10 通过、0 掉落**（B 作预录兜底）；docs/06b level-kit 实现规格（3 包，Day1 可照写）。
- 评审修订波（12:08–12:20）：L01–L10/EP/Labs 的 blocking 已按 docs/14/14b 修复并自查 0 error；待 fresh critic 复评一次即可冻结（docs/15）。

## 下一步（T1 开工时，历史）

1. CP0：用户确认 docs/11 §13 的 8 个问题 + 按 docs/17 安装 **Minecraft Java 26.1.2**（Prism Launcher；**不是 1.21.4/26.3**）。
2. T1 09:30 前：完成 spec 修订并冻结（docs/15 §5 的 4 项门禁）。
3. T1 09:00 起：仓库骨架 + 协议 zod + MockWorld + Paper 插件最小版 + L01 端到端。
4. T1 20:00：M1 垂直切片验收（L1 在真 MC 跑通 + 录屏 90 秒）。

## 对照方案评审（2026-10-31）

- 已收到并评审另一份架构方案（`incoming/other-plan/`），结论：**母本用本方案**；吸收 4 项：顺序语义 auto-await（D36）、会话/权限不变量（D37）、参考解 tsc 全绿（D38）、单页 HTML 报告（D39）。详见 [docs/18](docs/18-comparison-other-plan.md)。

## 阻塞 / 需要人类决策（历史）

- 见 docs/11 §13（8 项，均有默认假设；未回复时按默认执行）。

## 范围与风险变化（历史）

- D4 细化：Act I 用「自然村庄 + 局部平整短路径 + 和平难度」保证 pathfinder 稳定；Act II 起扩展自然地形（M0 实测结论）。
- 版本锁升级为不可协商项：MC/Paper 26.1.2 build 74 + mineflayer 4.39.0（禁止 26.2/26.3）。


## 最终交付快照（2026-10-31，历史）

- **L01–L10 真实 Paper e2e 全部 PASS**；L10 双织偶真实 17 项、Studio 注入 11 项。
- Studio：L05–L10 完整中文引导；挑战层说明卡；天空/天气/云；UOS 4/4。
- 门禁：`npm test` 25 files / 235 tests；Studio e2e 6/6；纯中文 0 违规；`verify.sh` exit 0。
- 桌面安装包 AppImage 125MB / rpm 23.17MB，隔离 `:98` 实测启动。
- **明确边界**：挑战层目前是可阅读说明而非可玩会话；真实人类键鼠盲测尚未执行（自动化代理为 UOS）。


## 自包含安装包（2026-10-31 20:52，历史；当前体积见 v1.4 段）

- `Loomcraft-x86_64.AppImage` ≈400MB / RPM ≈415MB（2026-11-01 重打包），内置 Node 22、Java 25、Paper 26.1.2、插件/世界、真实引擎与 mineflayer 织偶。
- 桌面应用启动时自动起 Paper + 引擎；用户只需安装 Minecraft 26.1.2 并连接 `localhost:25565`。
- 真实运行时目录由 `bash scripts/build-real-runtime.sh` 生成，体积约 1GB，不入 GitHub；安装包随附。
