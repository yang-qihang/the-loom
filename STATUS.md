# STATUS — 项目状态（Lead 维护，每个集成点更新）

## 2026-11-01 Round 4（教学体验 / 配套教材 / 工程化，已完成并推送 main）

> 上游：用户 2026-11-01 的 10 项反馈；契约与分工见 `docs/49-round4-teaching-ux-and-textbook-plan.md`。
> 提交：`715b8e5`（剧情浮层+字体）、`31580e3`（自动结算+运行鲁棒性）、`1d87085`（教材窗口+内容+接入）、`c1ba514`（教材 L01–L05）。

- **玩家任务自动检测/自动结算（任务 1/7/9）**：引擎 `GET /api/session/:id/snapshot` 附带 `progress`（含 `player` 标志）/`playerBeatReady`/`allPassed`/`playerBeatRequired`/`playerBeatDone`/`sessionEpoch`（顶层+嵌套）；Studio 轮询每秒按 id 同步 GoalList（解决「世界 3/3、面板 2/3」），世界侧全部完成时一次性自动 confirm 玩家节拍并自动打开结算（paper 保持 confirm-only、mock 模拟语义不变；手动按钮保留兜底）。
- **运行状态鲁棒性（用户 bug 真根因）**：同一 `GameSession` 内每次 run 前不恢复场景——第一次失败前已执行的语句把世界改脏（L02 蛋被收走 / L04 田被种乱 / L09 两坛已开酿），参考解按干净世界执行必失败。修复：`session.run()` 前条件恢复（上一轮失败 && !playerBeatReady && 确有世界写动作 → port.reset + epoch+1，已通过/已轮到玩家不回滚）；runner 执行前检查 TS `parseDiagnostics`（半截代码不再偷偷执行）；事件带 runId、SSE 帧带 id + `Last-Event-ID`（新连接不回放旧 error/hint）；后端 `{code,message,hint}` 透传到 Studio 错误卡并给「重置本关后重试」；双击运行同步防重入；本地 mock 支持块注释。
- **剧情浮层排版（任务 2/5）**：序章/幕开场/关开场/旅途手记重构为「固定头 / 可滚内容 / 固定底」，隐藏原生滚动条 + 自绘悬浮滑轨 + 滚轮/键盘/拖拽/触屏 + 上下渐隐；左右留白恒对称（不依赖 `scrollbar-gutter`）；1024×600 / 896×603 / 720×560 不再裁切；同类长内容浮层（结算/手册/织典/试符台/完整解）同修；桌面壳 36px 标题栏避让。
- **字体系统（任务 3/4）**：所有【代码】统一 **Maple Mono**（编辑器/参考解/手册/织典/试符台/结算/日志/inline-code/教材代码块）；长段正文统一 **Noto Sans SC**（OFL-1.1，随包子集 woff2 400/700 共 2.21MB、7554 码点、缺字 0）；短标题/按钮/标签保留像素字体（Zpix/Departure Mono）。策略见 `docs/20` §3b4，实现 `apps/studio/src/typography.css`。
- **配套教材（任务 6）**：**10 章、合计 76,429 汉字**（L01 7188 / L02 9713 / L03 8743 / L04 8895 / L05 9168 / L06 6504 / L07 6564 / L08 6547 / L09 6544 / L10 6563；每章 5–8 代码块、10–12 术语、warn callout、goals，只用本关及之前 API）。内容源 `apps/studio/src/textbook/content/*.md`，构建校验 `npx tsx scripts/build-textbook.ts --write`（0 error）；独立浮动窗口可拖动/缩放/置顶/持久化/章内目录/代码复制；进入关卡首次自动打开、关闭即记已读、工作台常驻「读本关教材/回看教材」入口。
- **基础设施（任务 10）**：Playwright `webServer` 的 POSIX 环境变量前缀改为 `env` 注入 + `vite --mode e2e/mock`，`npm run test:e2e` / `test:e2e:local` 在 Windows 可直接运行；既有多份 spec 增加「教材已读」预置（回访玩家），与教材首次自动打开兼容。

**Round 4 验收**：`tsc --noEmit` 0；`npm test` 28 files / **251 tests**（含新增引擎回归 16 条）；Studio real-config e2e **37/37**（新增 narrative-layout 22、typography 2、textbook-window 1、auto-beat 2、runtime-recovery 3）；mock-config e2e 4/4；教材内容校验 0 error；C 等价 8/8；真实 Paper e2e：L01 PASS（3 星、report/digest 与 Mock 一致、reset 稳定）、L10 PASS、`it/engine-paper-regressions.ts` PASS（见 `evidence/l*-real-latest.json`、`evidence/engine-paper-regressions-latest.json`）。证据：`evidence/narrative-layout/`、`evidence/typography/`、`evidence/runtime-ui/`、`evidence/textbook-window/`。

**Round 4 已知边界/遗留**（详见 docs/49 §5）：教材为长文阅读界面，**真人阅读/学习效果盲测未做**（Fresh Reader Round 4 仍未清零）；挑战层仍是说明卡；L09「取金苹果」仍用旧写法 `place("air", chest)`（内容侧语义 API 待修，教材已标注为旧写法）；`it/engine-paper.ts:191` 仍按旧 testMode 断言（待改成显式 simulate）；Zpix 字体许可证未核实；Noto 子集按 GB2312 + 仓库文本生成（新增生僻字需重跑 `scripts/build-font-subset.py`）；桌面壳 WebKitGTK 的字体/滚动需 Linux 实机复验；`build-assets.mjs` 在 Windows 仍有既有 `spawn .bin/vite` 平台限制（图标路径已单测）。

## 2026-11-01 P0 修复与独立验证（Windows 原生，已完成）

**背景**：Windows/VM 环境报告（`loom-vm/环境问题总结-给同学.md`；本地副本 `.tools/ISSUES-2026-11-01.md`）列出 3 个 P0：Studio 固定 5s 超时在 VM 环境误判离线、换关/重进 503 `STALE_SESSION`、浏览器 Studio 的 L10 双织偶回退成同一只 `Golem`。修复已提交 **`1345989`**（`fix(engine): L10 multi-agent bots, serialized session creation, studio timeout`）：engine 多织偶、session 创建/销毁串行队列、Studio 30s 可配置超时、`PaperWorldPort.disposeBot`、`build-assets.mjs` 先建 `runtime/`。本轮由 Lead 在 Windows 原生栈独立复验，并新增回归脚本 `it/engine-paper-regressions.ts`。

**验证环境**：Windows 11 + Node 22.23.4 + Java 25 + Paper 26.1.2 build 74 + LoomCraft 0.1.0；本机验证栈用 Paper `25568` / engine `4318` / Studio `5188`（当时避开 Fedora VM 的 SSH 隧道）。**2026-11-01 晚已按用户要求关机并清理 VM**：`D:\VScode_code\loom-vm` 仅保留 3 份报告 md（约 15KB）；本机恢复 canonical 端口 Paper `25567` / 插件 RPC `8765` / engine `4317` / Studio `5173`，`it/.mc-server/server.properties` 已改回 25567。Paper 用 `.tools/win/paper-host.mjs` 托管。

**复验结果**（命令与产物均可复跑）：

1. `it/engine-paper-regressions.ts` **PASS 20/20**：顺序重进 L01→L01→L02→L01 全 201（旧缺陷第二次必 503）；并发 2 个 `POST /api/session` 均 201、最终只留 1 个会话；L10 插件登记 `LeftWeaver`+`RightWeaver` 两只真实 bot，参考解后 `playerBeatReady=true`（尚未通过），模拟玩家节拍 → 3 星；离开 L10 后插件 bots 只剩 `Golem`、主 bot 全程只登录 1 次、无「另一处登录」顶号、无 `STALE_SESSION`。证据 `evidence/engine-paper-regressions-latest.json`。
2. **Studio 真实 UI 回归**（Playwright + 系统 Chrome + 真引擎 + 真 Paper）：L10→返回→L01→返回→L10 共 3 次进关，`POST /api/session` 3/3 均 201、工作台全部打开、无错误横幅、无 4xx/5xx；L10 会话实测 3.1–3.3s（本机未触发旧 5s 阈值；VM 环境此前常态 >5s，30s 可配置超时作防御）。证据 `evidence/p0-fixes/studio-entry-check-latest.json` + 截图。
3. **真机 e2e**：`it/l10-real.ts` **PASS**（双 bot 在线、参考解 3 星、report/digest 与 Mock 一致、reset 稳定）；`it/l1-real.ts` 主流程 **PASS**（3 星、h1/h2、report/digest 与 Mock 一致、reset ≤2s 哈希稳定）。运行产物 `evidence/p0-fixes/l1-real-windows-native.json`、`l10-real-windows-native.json`；canonical `evidence/l*-real-latest.json` 保持上一轮基线未改动。
4. **`build-assets.mjs` 缺 `runtime/` 场景**：该脚本在 Windows 有既有平台限制（`spawn node_modules/.bin/vite` ENOENT），改在 Fedora 44 VM 复验：`rm -rf apps/desktop/src-tauri/runtime && npm run desktop:assets` → `NPM_EXIT=0`，`runtime/` 自动重建（engine.mjs 1.2MB / engine.cjs / stubs / node_modules，冒烟健康检查通过）。日志 `evidence/p0-fixes/desktop-assets-build-linux.log`。
5. **质量门**：`tsc --noEmit` exit 0；`vitest` 25 files / **235 tests 全绿**（期间一次 timing 测试因并发构建抖动失败，单独重跑 PASS，属既有 flaky）。

**顺带发现（未在本轮修，建议下一轮处理）**：L01 hidden `h1`「每次放置前织偶到灯柱 2 格内」依赖插件 `agent.move` 采样点。starter 负向对照里 `moveTo(lamp1)` 结束后最后一个采样点可能落在灯柱 2.83 格（x/z）外，导致 real-vs-mock 偶发不一致（主流程参考解 2 次运行均过；no-beat 对照 1 过 1 败）。属既有判据/采样边界（Round 3 命名点 + 灯位抬高后更易触发），与 P0 修复无关；但会影响真实学生判星公平性，建议下一轮把 h1 改为「moveTo 结束位置判定 / 放宽容差 / 采样补点」。

**环境结论**：VM 已清理、不再需要。Windows 原生栈已覆盖开发 + 单测 + 真 Paper e2e + Studio UI 回归；AppImage/RPM 由同学在原生 Linux 侧打包。

## 2026-11-01 Round 2（v1.5，已完成）

第二轮试玩反馈的修复与增强已全部落地并终验，契约/验收清单与实施结果见 `docs/48-round2-guidance-api-visual-plan.md` §6。

- **语义 API**：新增 `collect`/`deposit`/`count`/`harvest`/`plant`/`world.container`/`goTo`/`moveTo(point)`/`place(block, point)` 与命名坐标点（`LevelDef.world.points` → 沙箱全局常量 + `world.points`）；旧 `place("air")` 反例废弃，旧签名保留且评分事件语义完全一致（collect→air、deposit→item）。
- **引导**：`ProgressStep.hint`（2–4 句：怎样算完成/可照抄写法/坐标从哪来），失败时进教练卡 + 游戏内 actionbar（每次失败 1 条、去重不刷屏）；指令手册（顶栏/教练卡/REPL 三入口，可开关/搜索/复制示例）；位置 HUD（灰崽/关键点/木桶计数，1s 轮询、页面隐藏暂停）。
- **REPL**：试符台用当前关卡打开（不再跳回 L01），显示「当前关卡：X」，`help` 打开本关指令手册，命名点与 `golem.pos` 可读。
- **概念揭晓**：结算/手记/织典按关揭示正式术语（L01 函数调用、L02 变量、L03 分支、L04 循环、L05 函数、L06 记录、L07 高阶函数、L08 接口、L09 异步、L10 协议），不回避专业术语。
- **名实相符**：每关 `codeRequirements` + AST 分析器判定；starter 全不满足、参考解全满足；L02 参考解真用变量、L06 真用记录/switch、L07 真用 filter/map 流水线等。
- **字体/Monaco（第三轮按用户要求修正）**：代码编辑器与编辑器浮层用嵌包 Maple Mono CN（OFL；菜单/补全/悬停/查找为清晰普通字体、不透明、中文化，根因 Monaco 0.57 `useShadowDOM:true` 已关）；**其余 UI 恢复上一版中文像素字体**（Zpix + Departure Mono），不再全站 Maple。
- **起始点/截图**：10 关 `world.playerSpawn` 落盘；修复 L02/L09「玩家出生与灰崽重合、镜头糊在模型体内」；真实 Minecraft 26.1.2 客户端高清重拍（2560×990 ×10 关，含 L10）替换 Studio 关卡素材与 report 证据；Studio UI DPR2 高清截图。
- **文案政策**：自然中文 + 必要英文术语（`for` 循环、`let` 变量、`Promise.all`…），`check-copy --pure-zh --strict` 0 违规。
- **第三轮补充**：L01 流程按玩家直觉改为 7 行（3×moveTo+place + 回艾拉；4 号灯玩家亲手点，不再要求灰崽走到 4 号灯下）；学生 starter/参考解注释改为「正规工业结构 + 零基础可读」（JSDoc 文件头、编号分节、两种写法编号二选一）；新增「完整解（调试）」按钮（与指令手册/试符台同区域，可查看/复制参考解，成熟后移除）；字体按反馈回退（仅编辑器+编辑器浮层用 Maple，其余 UI 恢复中文像素字）。

**终验**：`tsc` 0；`npm test` 25 files / 235 tests；content 162 tests；`verify.sh` pass（仅 Round 1 遗留 `G-FRESH-READER` tracked warning）；Studio e2e 6/6 + local 2/2；guidance 隔离冒烟 42/42；字体策略 Playwright 验收（UI 像素字/编辑器 Maple/右键菜单清晰不透明）；真实 Paper e2e L01–L10 全 PASS；重新打包 AppImage（429MB）/ RPM（436MB，2026-11-01 14:40），包内已含新字体/引擎/插件/世界素材。证据：`evidence/playtest-fix/start-positions.md`、`evidence/scene-shots/hi-res/`、`evidence/ui-hires/`、`evidence/ui-hires/font-policy-verify.json`、`evidence/code-analysis.json`、`apps/studio/public/world/`、`report/`。

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
