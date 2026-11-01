# 39 — 挑剔玩家 / 真实玩家终验：验收矩阵

> 状态：v1（可执行验收矩阵；本文件只写文档，不含实现）｜负责人：scout-pedagogy｜最后更新：2026-10-31
> 上游：`docs/04-learning-design.md`（节拍/提示/盲测）、`docs/25-onboarding-and-guidance.md`（四层引导/文本预算）、`docs/29-user-operation-simulation.md`（U1–U6）、`docs/30-fresh-reader-simulation.md`（Fresh Reader 协议）、`docs/31-fresh-reader-report.md`（Round 1–3 历史评审）、`docs/47-docs-audit-2026-11-01.md`、`docs/34-mc-visual-verification.md`（真实客户端/隔离显示）、`docs/37-client-visual-baseline.md`、`STATUS.md`、`docs/12-sdk-api-registry.md`、`apps/studio/src/copy/{levels,catalog}.json`、`apps/studio/src/components/{Workbench,MapWall,SystemScreens,onboarding,ReplScreen}.tsx`
> 下游：T4 彩排、CP 终验、最终报告；本文件给出「谁、按什么步骤、看到什么才算过、证据放哪、当前哪些还过不了」。
> 硬约束：全部真实客户端输入只允许 `:98`/`:99`（`scripts/isolated-x.sh` 会拒绝 `:0`）；同一 Paper 上的真实 e2e **串行**跑，不并发。
> 本文件只做验收设计，不改任何代码/内容/测试；§5 的 blocker 均为当前仓库可验证项，不包含已修复项。

---

## 0. 一句话结论（先看这个）

**真实 Paper 的评分链路（L01–L09）已经能过，但「真实玩家能在 Studio 里把 L05–L09 玩下来」目前不成立。** 原因不是评分，是 Studio 的关卡文案只有 L01–L04：L05–L09 会没有关卡开场、目标面板为空、教练卡停在「加载中…」、提示按钮不可用、通关后没有结算页（详见 §5 的 P0-1）。L10 没有运行时。因此本矩阵把「协议通过」和「玩家通过」分成两列验收，禁止拿前者替代后者。

验收分两条启动路径，两条都要跑：

| 路径 | 用途 | 启动方式 | 当前能覆盖到 |
|---|---|---|---|
| **P1 桌面安装包**（发布物） | 验证用户拿到的东西能打开、能进 L01 | `npm run desktop:assets && npm run desktop:build` 后运行产物（或 `npm run desktop:run`），只在 `:98` 下自动化 | 序章 + L01（Mock 引擎；L02 起地图卡「未解锁」） |
| **P2 Studio + 真实织机 + MC 客户端** | 验证全游戏 L01–L09（以及未来 L10） | `bash scripts/mc-up.sh` → `PORT=4320 npm run dev:engine:paper` → `VITE_ENGINE_URL=http://127.0.0.1:4320 npm --prefix apps/studio run dev` → Prism 客户端在 `:99` 进服 | 序章 + L01–L09；L05–L09 目前卡在 UI 文案（见 §5） |

> P1 是**必需的发布物冒烟**，P2 是**全游戏验收**。若只跑 P2，不能宣称「安装包可玩全游戏」；若只跑 P1，不能宣称「全游戏已验收」。

---

## 1. 四类 persona（这次不是「再找两个 agent」，是四种真实背景）

| id | 背景 | 能带来什么真实风险 | 必须不依赖的东西 |
|---|---|---|---|
| **A 懂 MC、不会编程** | 玩 MC 多年，熟悉 WASD/准星/右键/合成/村民；没写过代码 | 会把「编程」当成聊天/命令，凭直觉点，不看代码注释；卡在「为什么写字能让它动」上 | 不能查 docs；不能有人口头教 API |
| **B 没玩过 MC、不会编程** | 第一次进 3D 世界，不熟悉视角/按键/窗口切换；也没写过代码 | 分不清「编辑器」和「世界」是两个窗口；站在 4 号灯旁边却不知道右键；视角卡住/掉进沟里就放弃 | 不能有人替他操作；不能读外部教程 |
| **C 会编程、不懂 MC** | 写 Python/JS，很快读懂练习；不会 MC 操作 | 代码一遍过，但「玩家节拍」成了唯一卡点；对提示/脚手架不耐烦；会追问「这行 API 到底做什么」 | 不能只靠代码注释猜 MC 操作 |
| **D 挑剔的文学/教学评审** | 文字工作者/老师；不追求速度，专门挑中文 AI 味、引导、失败后的去向、教学深度 | 会把「能跑」判成「不能读」：身份、指代、翻译腔、术语密度、错误页是否说人话、星级和提示是否诚实 | 不能拿「内部设定我知道」解释；只看屏幕 |

D 不是玩家代理，是**质量守门人**：A/B/C 证明「能通关」，D 证明「通关过程像人话」。二者都过才算终验通过。

---

## 2. 真实操作脚本（P2 全游戏路径；P1 只在 §2.1 冒烟）

### 2.1 P1 桌面安装包冒烟（每个 persona 都先跑，≤5 分钟）

| 步 | 操作 | 必须看到的可观察反馈 | 证据 | 不过即 FAIL |
|---|---|---|---|---|
| S0 | 在 `:98` 启动安装包 | 窗口标题「织界」；无浏览器地址栏；首启向导出现（Java/Prism/Paper 检测） | `evidence/player-acceptance/<persona>/desktop/00-launch.png` | 出现地址栏/白屏/崩溃 |
| S1 | 点「继续」过向导，进地图墙 | 地图墙标题、第一幕卡片、L01 为「可玩」，L02 起显示「未解锁 · 先过第 N 关」 | `01-map.png` | 卡片文案空白/全部可点 |
| S2 | 进 L01，随便按几次「运行」 | 无织机时也能看到错误/状态是中文；界面不崩 | `02-l01.png` | 英文堆栈/卡死 |
| S3 | 关掉 App 重开 | 序章不再自动播（已看过）；进度还在 | `03-relaunch.png` | 每次重播序章/进度丢失 |

> P1 当前就是 Mock 引擎（`apps/studio/src/engine/mockEngine.ts:55-60` 只返回 L01），L02 起不可玩——这是**发布物现状**，按 §5 的 P0-2 记录，不算「玩家操作失误」。

### 2.2 P2 启动（所有 persona 共用）

1. 起 Paper 与真实织机（串行，不要和别人的 e2e 抢同一 Paper）：
   `bash scripts/mc-up.sh` → `PORT=4320 npm run dev:engine:paper`（另开终端，记 PID）。
2. 起 Studio：`VITE_ENGINE_URL=http://127.0.0.1:4320 npm --prefix apps/studio run dev`，浏览器打开提示的地址。
3. 起真实客户端（只在 `:99`）：`bash scripts/mc-client-baseline.sh`（一次性中文/画质基线），
   `DISPLAY=:99 nohup flatpak run org.prismlauncher.PrismLauncher --launch "Village Development" >/tmp/mc-launch.log 2>&1 &`
   进多人 → Direct Connection → `127.0.0.1` → Join Server。
4. 记录开始时间与构建号：`git rev-parse --short HEAD`、engine 端口、Paper 日志路径 `it/.mc-server/console.log`。

### 2.3 Persona A（懂 MC、不会编程）脚本

| 步 | 操作 | 必须看到的可观察反馈 | 判 FAIL 的观察点 |
|---|---|---|---|
| A-00 | 按 §2.2 启动 | 地图墙出现；L01 卡片「可玩 · 进入关卡」；右上角「织机在线」 | 不知道点哪/卡片灰掉却无解释 |
| A-01 | 进 L01，看序章（或从旅途手记回看序章） | 8 屏可翻页；有「跳过/继续」；跳过不影响后面 Esc 手记 | 跳过即永久丢失剧情 |
| A-02 | 看第一幕开场 + L01 开场 3 句 | 每屏 2 句以内；三句分别像「村子怎么了/我要做什么/为什么是我」；有「再看一遍/进入关卡」 | 只有一句任务就开局；文字墙 |
| A-03 | 点「运行」跑 starter | 状态从「准备就绪」变「灰崽正在……」；失败后出现「第 N 行：……」中文原因；目标 0/3 | 英文堆栈；只有「失败了」无行号 |
| A-04 | 点 1–2 次「提示」 | 提示逐级展开（1/3、2/3、3/3），不直接给完整答案；「不扣星」看得见 | 提示直接贴答案/提示按钮灰色无说明 |
| A-05 | 按目标改代码再运行 | 目标逐条打勾；灰崽在世界里走到对应灯；日志逐条中文（「灰崽走到（…）」） | 代码对了目标不动/日志是内部英文 |
| A-06 | 玩家节拍：切到 MC 窗口，右键点亮 4 号灯 | 工作台出现「轮到你」卡片与「我已在游戏里点亮」；世界灯亮、粒子/音效有反馈；点确认后 3/3 | 卡片只说「完成最后一步」不给操作；点确认无反应 |
| A-07 | 看结算 | 结算弹层：3 星、三条目标全勾、「下一关」是主按钮、织典翻到新页 | 只有「返回」；星星含义没解释 |
| A-08 | 进 L05（真实织机） | **应有**：第二幕开场、L05 三句开场、三条目标；**当前实际**：没有 L05 开场，目标面板为空，教练卡「加载中…」 | 若实际如当前：立即记 P0-1，不继续「通关」 |
| A-09 | 进 L09（异步关） | **应有**：第三幕开场、L09 三句开场、目标三条、异步提示；**当前实际**：同 L05（无开场/目标空/教练加载中） | 同 A-08，记 P0-1 |
| A-10 | 进 L10 | 地图卡若存在只能是「未解锁」；无内容/无运行时 | 记录 `BLOCKED（无运行时）`，不得写通过 |

### 2.4 Persona B（没玩过 MC、不会编程）脚本

B 的前 7 步与 A 相同，差别在「世界操作」必须靠**屏幕内建帮助**完成，不能有人口头教。

| 步 | 操作 | 必须看到的可观察反馈 | 判 FAIL 的观察点 |
|---|---|---|---|
| B-00 | 按 §2.2 启动；先不碰键盘，读屏幕 | 界面有一句「世界在另一个窗口里」；「第一次玩 Minecraft？」可展开 | 以为整个世界就是这个网页；无处可问 |
| B-01 | 展开「第一次玩 Minecraft？」 | 四步说明：切窗口 → WASD 走 + 鼠标转视角 → 走到 4 号灯下 → 准星对准右键点亮；还有「弄乱了按重置本关，代码不丢」 | 只有「按右键」这种默认玩家已知的说法 |
| B-02 | 照说明切到 MC 窗口 | 鼠标点一下游戏窗口后，视角能转；W 能走；HUD/准星正常 | 点一下变成攻击/放方块；视角卡死 |
| B-03 | 走到 4 号灯下 | 「世界方位」示意图与真实世界对得上（四盏灯的位置关系一致）；游戏内中文标注（若开）能认出 4 号灯/艾拉 | 图与真实场景对不上；找不到 4 号灯 |
| B-04 | 准星对准灯笼，右键 | 灯亮；工作台「轮到你」仍在；点「我已在游戏里点亮」后目标完成 | 点不亮却不知道为什么；分不清左右键 |
| B-05 | 故意走错/掉沟/弄乱方块，再按「重置本关」 | ≤2 秒恢复；代码不丢；有中文提示「已重置，回到起点」 | 代码被清空；只能重启 App |
| B-06 | 完成 L01 结算，进 L05 | 同 A-08：当前 L05 没有开场/目标/教练 | 同 A-08 |
| B-07 | 进 L09 | 同 L05：无开场/目标空/教练加载中；异步关的等待反馈不可见 | 记 P0-1/L09 |
| B-08 | 进 L10 | 只能是「未解锁」；世界内没有可操作对象 | 记 `BLOCKED（无运行时）` |

> B 的通过线不是「没卡住」，是「卡住后能靠屏幕自己恢复」：帮助文本、方位图、重置按钮三件套必须够用。若 B 需要按住鼠标转视角才能看灯，而说明只写「移动鼠标」，按 FAIL 记。

### 2.5 Persona C（会编程、不懂 MC）脚本

C 的代码部分会很快；验收重点放在「代码之外」和「抽象是否落到人话」。

| 步 | 操作 | 必须看到的可观察反馈 | 判 FAIL 的观察点 |
|---|---|---|---|
| C-00 | 启动 → 序章 → L01 开场（可跳） | 能跳过但手记可回看；开场三句仍能复述 | 跳过即丢设定 |
| C-01 | 读 starter + 注释，直接改 | 注释里首现名词有中文解释；API 名旁有中文说法；不出现「写死/循环边界/左栏」这类行话 | 必须靠猜/外部文档才知道参数顺序 |
| C-02 | 跑一次失败，读错误 | 行号 + 原因 + 可照抄写法；错误不指向不存在的「上一行/右侧面板」 | 报错假设屏幕上的东西不存在 |
| C-03 | 一次通过 L01 代码，到玩家节拍 | 「轮到你」明确告诉他：这不是代码，是去世界里做一个动作；给出切窗口/按键 | 以为点「运行」就能完成最后一步 |
| C-04 | 完成 L01 结算，进 L05 | 当前 L05 同样卡在缺 UI 文案；记录「代码层可做、产品层不可做」 | 把 L05 当代码题直接算过 |
| C-05 | 进 L09 异步关（待 L05–L09 文案修复后） | 顺序 await 比并行慢的对比能看见（计时/日志）；错时给 `deadlock/超时` 人话 | 抽象只写在 Codex，教练不提代价 |
| C-06 | 进 L10 | 双织偶 API 与消息/死锁提示必须可见；当前无运行时 | 记 `BLOCKED` |

### 2.6 Persona D（挑剔文学/教学评审）脚本

D 走同一条 A/B/C 路径，但每一步都要做「文字体检」并留原文。

| 步 | 操作 | 必须看到的可观察反馈 | 判 FAIL 的观察点 |
|---|---|---|---|
| D-00 | 通读序章 8 屏 + 第一幕开场 | 同一身份称呼自始至终（「新来的织者 / 老织者」）；生词首现即解释；每屏 ≤2 句 | 身份摇摆、术语堆叠、翻译腔 |
| D-01 | 读 L01 开场三句 + 目标 + 教练 | 有世界状态/任务/为什么是你；目标写清「谁做什么」；教练不点名拷问 | 三条主语打架、目标数不出 |
| D-02 | 故意写错，读错误与提示 | 错误 = 行号 + 原因 + 能照抄的写法；提示三级、不直接给答案；「不扣星」诚实 | 报错指代不清/无行号；提示=答案 |
| D-03 | 看结算页 | 星星按实得画；正文叙述结果不写字段前缀；织典首次出现有解释 | 失败也三星/星星含义不明 |
| D-04 | 按 Esc 看旅途手记 | 世界/我是谁/已解锁名词/上一关发生什么都能一屏找到；空态不是「—」 | 空态像没加载完；名词表缺关键项 |
| D-05 | 看地图墙 + 试符台 | 名字与 docs/22 一致；锁定条件明确；试符台示例能直接执行、按钮含义可区分 | 「地图墙/关卡墙」「清空对话/清空记录」两套词 |
| D-06 | 答五问（我是谁/世界怎么了/织偶是什么/现在做什么/做错会怎样） | 5 问至少 4 问答对；自然度、清楚度各 ≥4/5 | 任一 blocker 或 major；五问 <4 |
| D-07 | 进 L05 | 当前实际：没有关卡开场、目标为空、教练「加载中…」 | 任何一屏说不通都记 blocker |
| D-08 | 进 L09 | 同 L05；重点读异步关的「代价」说明是否存在 | 缺开场/目标/结算即 blocker |
| D-09 | 进 L10 | 设计上有双织偶与死锁演出；当前无运行时 | 记 `BLOCKED（无运行时）` |

> D 的「挑剔」不是找茬：他指出的每一处都要能落到文件/行号或屏幕位置，否则不算缺陷；但一旦是「看不懂/像翻译/AI 味/指代不明」，按 blocker 处理（与 docs/30 一致）。

---

## 3. 每个 persona 的 PASS/FAIL 判据

### 3.1 全局硬判据（任何一条 FAIL 即整轮 FAIL）

1. **不查外部文档也能知道下一步**：在 L01 的每一步（看开场→跑→错→改→玩家节拍→结算），玩家只需看屏幕就能说出「现在该做什么」。
2. **失败可恢复**：中文错误含「第几行/哪里错/怎么改」；按提示 ≤2 级、≤2 次能继续；重置 ≤2 秒且代码不丢。
3. **MC 操作不卡死**：零 MC 者能靠屏幕帮助完成「切窗口→WASD→准星→右键」；卡住有重置出口；不出现「视角锁死/按键无响应」。
4. **玩家节拍明确**：卡片必须说清「去世界做什么、怎么做、做完回来按哪个按钮」；不能只说「完成最后一步」。
5. **重开/重置不丢进度**：关 App 重开不重播序章；重置本关只重置世界与 starter，不清存档/解锁/星级记录。
6. **证据可追溯**：每步有截图/日志；失败有结构化记录；没有「重跑就过」的 flaky 结论。

### 3.2 分 persona 判据

| persona | 必须 PASS 的项 | 时间/次数上限 | 明确 FAIL 条件 |
|---|---|---|---|
| **A** | 代码改变 ←→ 世界变化能对上；3 级提示够用；结算后知道下一关 | L01 ≤15 min；提示 ≤2 级 | 靠世界试错代替读代码才过；重置后不知道代码从哪来 |
| **B** | 靠屏幕帮助完成 L01 玩家节拍；分得清编辑器和世界；卡住能重置 | L01 ≤20 min；求助（外部人）0 次 | 找不到 MC 窗口/不会右键/视角卡死；需要别人代操作 |
| **C** | 代码一次过；错误页不误导；玩家节拍不被 MC 卡住 | L01 ≤10 min；被 MC 卡住 ≤1 次且能自助恢复 | 因 MC 操作放弃；错误页让他改错方向 |
| **D** | 五问 ≥4；自然度/清楚度 ≥4；blocker=0、major=0 | 无时限 | 出现 AI 味/翻译腔/身份不一致/术语未解释/错误页说假话 |

### 3.3 不允许的「通过」写法

- ❌「L05–L09 真实 e2e PASS，所以玩家可玩」——`it/` 只验证协议与评分，不验证 Studio 有没有关卡文案（见 `it/README.md` 的「已知限制」）。
- ❌「Mock 全绿」当「全游戏跑通」——Mock 引擎只有 L01（`mockEngine.ts:55-60`）。
- ❌「D 说还不错」当 PASS——D 必须给出类别计数与原文；任何「看不懂/像翻译/AI 味/中英混排/指代不明」都算 blocker/major。
- ❌ 重跑一次就宣布通过（flaky 记录进 quarantine，不当成 PASS）。

---

## 4. 证据清单（路径、命名、真实输入、日志）

### 4.1 目录与命名

```
evidence/player-acceptance/<persona-A|B|C|D>/<UTC-时间戳>/
├── result.json            # 本 persona 的 PASS/FAIL、耗时、提示次数、卡点
├── failures.json          # 每条失败一条记录（格式见 §4.5）
├── manifest.sha256        # 所有截图/日志的 sha256
├── screens/               # 01-map.png, 02-prologue-01.png, ... 编号+阶段+序号
├── logs/                  # studio.log, engine.log, mc-console.log, network.trace
└── videos/                # 可选：L01-playerbeat.mp4 / L09-brew.mp4
```

- 截图命名：`<两位步骤号>-<阶段>-<两位序号>.png`，例：`03-prologue-02.png`、`07-l01-error-01.png`、`10-l05-opening-01.png`。**一张截图只证明一件事**。
- 关卡真实画面：`evidence/scene-shots/L0X-real.png`（`scripts/scene-shot.mjs` 固定机位），与玩家操作截图分开，避免「示意图当真实世界」。
- 复用现有证据时必须在 `result.json` 写清来源路径与日期；旧截图不得当本轮证据。
- 每个 run 开头记录：commit sha、engine 模式（mock/paper）、Paper 版本、Studio 构建时间、DISPLAY 值、persona。

### 4.2 真实客户端输入（硬规则）

- 自动化输入只允许 `DISPLAY=:98`（桌面壳）或 `:99`（MC 客户端）；**禁止 `DISPLAY=:0`**（`docs/34` §0；`scripts/isolated-x.sh` 会直接 exit 2）。
- 任何脚本先 `source scripts/isolated-x.sh`（或显式 `export DISPLAY=:99`），并确认 `ps -ef | grep 'DISPLAY=:0'` 为空。
- 鼠标/键盘：python-xlib `XTestFakeRelativeMotionEvent` / `FakeInput`（`docs/34`），或 xdotool（仅 `:98`）；不得把真实鼠标移出隔离显示器。
- 截图：`DISPLAY=:99 import -window root <path>`；录屏：`ffmpeg -f x11grab -video_size 1600x1000 -framerate 10 -i :99 -t <秒> <path>.mp4`（只在 `:99`）。
- MC 客户端中文/画质基线：`bash scripts/mc-client-baseline.sh`（一次性改 options.txt，已备份）；不改用户 `:0` 的任何设置。

### 4.3 评分/世界证据（WorldDigest）

- 真实 e2e 每次写：`evidence/<level>-real-latest.json` + `evidence/<level>-real-snapshot-<UTC>.json` + `.log`（由 `it/real-harness.ts` 生成；`it/README.md` §证据）。
- 每份报告必须含：`passed/stars`、`criteria`、`digest`、`mock digest`（同文件内对比）、`reset hash/ms`、`sessionId`。
- engine paper 运行写 `evidence/engine-paper-latest.json/log`；acceptance 汇总写 `evidence/acceptance-<UTC>.json`。
- 失败时附 `it/.mc-server/console.log` 的最后 100 行；不要截断成「失败」两个字。
- Studio/UOS 证据：`qa/evidence/ux-<suite>.json`、`qa/evidence/ux-screens.json`、`apps/studio/evidence/01–18*.png`（U6 视觉基线）。

### 4.4 每步证据表（填在 result.json 里）

| 字段 | 例 |
|---|---|
| `step` | `L05-opening` |
| `expected` | 「三句开场齐全，目标三条可见」 |
| `observed` | 「无开场弹层；目标面板 0 条；教练显示加载中…」 |
| `status` | `failed` |
| `severity` | `P0` |
| `evidence` | `screens/10-l05-opening-01.png`、`logs/studio.log#L…` |
| `repro` | 「P2 启动 → 地图墙点第 5 关 → 观察右栏」 |
| `owner` | `UI（Studio）` |

### 4.5 失败记录格式（failures.json）

```json
{
  "runId": "20261031T1910Z-personaB",
  "persona": "B",
  "level": "L05",
  "step": "L05-opening",
  "expected": "进入关卡后出现三句开场与目标面板",
  "observed": "无开场弹层；目标 0 条；教练卡长期显示「加载中…」",
  "severity": "P0",
  "category": "缺上下文/界面与文案不一致",
  "evidence": ["screens/10-l05-opening-01.png", "logs/studio.log"],
  "repro": ["P2 启动", "地图墙点第 5 关", "观察右栏与弹层"],
  "owner": "UI",
  "retryable": false
}
```

> 一条失败一条记录；不许把同一原因的 5 个现象合并成一条「体验差」。

---

## 5. 挑剔玩家 blocker 清单（只列当前仓库仍可验证的）

> 排序：P0 阻断「全游戏可玩」→ P1 阻断「读得下去/能恢复」→ P2 局部。每条都给了文件/行号或可复现步骤；**已修复项不再复述**。
> 快照：下列文件/行号基于 **2026-10-31 18:46 的工作树**（HEAD `2087a72` + 当时未提交改动）；并行修 UI/内容后行号可能位移，复验前用 `git diff` 重新核对，但「问题是否仍存在」以当时代码/屏幕为准。

### P0-1｜Studio 只有 L01–L04 的关卡文案，L05–L09 在界面上是「半空壳」

- 现象（可复现）：P2 启动，地图墙点**第 5 关**或**第 9 关**：
  - 没有关卡开场弹层（`onboarding.tsx:126` 在 `!copy` 时直接 `return null`）；
  - 目标面板为空（`httpEngine.ts:111-117` 在 `copy` 缺失时 objectives/hints 都返回 `[]`）；
  - 教练卡停在「加载中…」（`Workbench.tsx:312` 在 `!copy` 时 `return labels.loading`）；
  - 「提示」按钮不可用（`canHint: !!copy && …`）；
  - 通关后没有结算弹层（`Workbench.tsx:546` 要求 `copy` 非空）；
  - 手记「上一关」为空（`onboarding.tsx` 的 JournalOverlay 用 `levelCopy(lastCompletedLevelId)`，L05–L09 为 `null`）；挑战层没有入口（全仓库 `challenge` 只出现在 `copy/index.ts:70` 的类型里）。
- 根因定位：`apps/studio/src/copy/levels.json` 的顶层键只有 `global/L01/L02/L03/L04/_meta/prologue/acts/journal`；`levelCopy("L05")` 为 `null`。
- 影响：A/B/C/D 全部无法通过 L05–L09；协议 e2e PASS 不能替代。
- 责任线：**UI/文案（Studio + copy）**。必须先补 L05–L09 的 `LevelCopy`（开场/目标/教练/提示/错误/结算/手记回顾/玩家节拍/挑战），再谈全游戏验收。

### P0-2｜桌面安装包是 Mock-only，发布物上 L02–L10 不可玩（历史 finding，2026-11-01 已修复，见 §9）

- 可复现：按 §2.1 启动安装包（或 `npm run dev:studio` 的 Mock 模式）→ 地图墙只有 L01 可玩，L02 起全部「未解锁」。
- 定位：`apps/studio/src/engine/mockEngine.ts:55-60`（`listLevels` 只返回 L01；`loadLevel` 非 L01 直接抛错）；`STATUS.md` 当时也写明 App 默认 Mock-only、真实 Paper 用 `dev:engine:paper` 且未收进安装包（**历史，已修复**）。
- 影响：用户拿到的发布物跑不完全游戏；「全游戏验收」实际上只在开发者路径成立。
- 责任线：**桌面/集成**（把 engine paper 模式或等价真实运行时纳入发布物，或明确发布物范围并在 UI 上写清）。

### P0-3｜L10 没有任何运行时

- 可复现：`ls content/levels/L10.content.ts` 不存在；`ls it/l10-real.ts` 不存在；`apps/engine/src/catalog.ts:16` 的 CATALOG 只到 `L09Content`。
- 影响：终局关无法验收；地图墙若有 L10 卡片也只能是「未解锁」。
- 责任线：**content/engine/UI**。本矩阵的 L10 脚本按 `docs/12` 与 `content/levels/L10-two-weavers.md` 写成「待实现」，在此之前 L10 一律记 BLOCKED，不得写通过。

### P0-4｜L05–L09 的「挑战/加练」在 UI 中不存在

- 可复现：进入 L05/L09 工作台，找不到任何「加练/挑战」入口或说明；内容层的 `challenge` 已写在 `content/levels/L05–L09.content.ts`，但 Studio 的 `LevelView`（`apps/studio/src/types.ts:18-27`）没有 challenge 字段，也没有渲染。
- 影响：挑战层无法被验收，也无法向玩家兑现「可跳过、不计星」的说明。
- 责任线：**UI**。

### P1-1｜错误兜底句指向一个不存在的「下面的写法」

- 定位：`apps/studio/src/components/Workbench.tsx:176` 在关卡没有 `errors.syntax` 时用 `chrome.workbench.errorSyntax`；该句是「这一行还没写完。按下面的写法补齐括号和数字，再按一次「运行」。」，但界面只有 error-banner + 编辑器，下面并没有可照抄的写法。
- 可复现：L01 把第 1 行改成 `golem.moveTo(` → 运行 → 看错误条。
- 影响：D 直接判「说假话/指代不明」；A/B/C 会找「下面」找不到。
- 责任线：**文案/UI**（要么真给示例块，要么改说「查看第 1 行，补成 `golem.moveTo(-12, 10)` 这样」）。

### P1-2｜地图墙/试符台的文案与 `docs/22` 两套，未定哪套是准

- 定位：`apps/studio/src/copy/catalog.json` 与 `docs/22-copy-deck.md` §1.13–1.14 不一致，例：
  - `catalog.json:4` 「关卡墙」 vs docs/22「地图墙」；
  - `catalog.json:5` 「挑一关，进去」 vs docs/22「挑一关，从灰岩村的黄昏开始」；
  - `catalog.json:9` 在**地图墙**页写「工作台底部常驻『运行 / 停止 / 重置』」（该页根本没有工作台）；
  - `catalog.json:162-163` 试符台「清空对话 / 把现场恢复原样」 vs docs/22 控件「清空记录 / 重置试符台」。
- 影响：D 会在同一局里看到两套词；验收无法判定哪一个才是承诺。
- 责任线：**文案 + UI**（docs/22 为 v3.1 唯一文案源，把 catalog 对齐或反向合并后更新文档）。

### P1-3｜L09 标题在 spec 与内容/地图卡里不同

- 定位：`content/levels/L09-before-dawn.md:1,16` 写「破晓之前」，`content/levels/L09.content.ts:184` 与 `catalog.json` 地图卡写「入夜之前」。
- 影响：结算/织典/成就/地图卡可能各叫一名；D 会记「同一关两个名字」。
- 责任线：**content**（定一个名字并同步 4 处：spec、content meta、catalog、Codex/成就）。

### P1-4｜零 MC 玩家的「世界内中文标注」还没定稿

- 依据：`STATUS.md` 写明世界标注「2.2x 受控测试可见但过大；1.2x 在 L01 实际机位仍不易看到，字号/机位未定稿，未宣称可用」。
- 影响：persona B 可能站在 4 号灯旁却认不出；仅靠「世界方位」示意图不够。
- 责任线：**MC 视觉/UI**。验收前必须有 1 张真实客户端（`:99`）截图证明：在正常机位能同时看清 4 号灯编号与艾拉/灰崽标注。

### P2-1｜Fresh Reader/门禁记录仍是旧版，验收证据链会自相矛盾

- 定位：`qa/evidence/qa-gates.json` 的 G-FRESH-READER 仍是 Round 1 记录（旧修复追踪表已因全部过时由 `docs/47` 审计删除），而实际 UI/文案已经改过多轮。
- 影响：终验报告引用哪一份都会被问「和代码对得上吗」；不修追踪表就无法把 D 的结论落到门禁。
- 责任线：**QA/文档**（把 Round 2/3/4 结果与修复状态回填，再跑 Round 4；不要用旧表当证据）。

> 说明：§5 的 P0/P1 是「当前仓库能验证」的产品/证据问题，不包含 Round 1–3 已修的文案细节（如身份称呼、序章标题、目标裁切、错误 phase、试符台括号判定等），也不拿历史 Fresh Reader 结论冒充现状。

---

## 6. 全游戏一起验收：串行命令清单

> 原则：同一 Paper 不并发真实 e2e；Playwright/engine/Paper 各自串行；每条命令 exit 0 才算该项 PASS；失败立即落证据，不重跑到绿。

### 6.1 静态与构建（无服务端）

```bash
cd /home/yqh0919/Documents/deepseek-harness/default-workspace
git rev-parse --short HEAD
npm run typecheck
npm test
bash scripts/verify.sh
node scripts/check-copy.mjs --pure-zh
npm --prefix apps/studio run build
npm --prefix apps/studio run test:e2e
```

### 6.2 Studio/Mock 与 UOS（串行 suite，不要 `--suite all` 并发起多个 Chrome）

```bash
node qa/ux-sim.mjs --suite happy
node qa/ux-sim.mjs --suite error
node qa/ux-sim.mjs --suite fresh
node qa/ux-sim.mjs --suite desktop
bash qa/desktop-smoke.sh            # 桌面壳（:98）
```

### 6.3 真实 Paper 的协议级 e2e（L01→L09 逐个；L10 暂无）

```bash
bash scripts/mc-up.sh
for n in 1 2 3 4 5 6 7 8 9; do
  echo "===== L0$n ====="
  npx tsx it/l${n}-real.ts || { echo "L0$n FAIL：停在这里，不要继续堆绿"; break; }
done
bash scripts/mc-reset.sh
bash scripts/mc-down.sh
# 顺序说明：真实 e2e 按 L01→L04 后必须接着逐个跑 L05→L06→L07→L08→L09（上面循环已含）；
# L10 放在最后，但当前 BLOCKED —— content/levels/L10.content.ts 与 it/l10-real.ts 都不存在，不得写 PASS
```

### 6.4 Studio + 真实织机的 UI 验收（P2；另开端口，不和上面 e2e 同时跑）

```bash
bash scripts/mc-up.sh
PORT=4320 npm run dev:engine:paper &        # 记录 PID；结束 kill
VITE_ENGINE_URL=http://127.0.0.1:4320 npm --prefix apps/studio run dev &
# 浏览器里按 §2.3–2.6 跑 L01/L05/L09（玩家节拍切到 :99 的 MC 客户端）
# 证据：evidence/player-acceptance/<persona>/<UTC>/
kill %1 %2 2>/dev/null; bash scripts/mc-down.sh
```

### 6.5 真实客户端视觉（只在 `:99`，输入禁止 `:0`）

```bash
source scripts/isolated-x.sh                 # 桌面自动化用 :98；脚本会拒绝 :0
export DISPLAY=:99
bash scripts/mc-client-baseline.sh           # 一次性中文/画质基线
# Prism 启动 + 进服（见 docs/34 §2）
DISPLAY=:99 import -window root evidence/scene-shots/L01-real-hero.png
node scripts/scene-shot.mjs --level L05 --port 4320 --out evidence/scene-shots/L05-real.png
node qa/scene-quality.mjs evidence/scene-shots   # 场景质量门（传截图目录）
```

### 6.6 桌面壳与最终汇总

```bash
bash qa/desktop-smoke.sh                     # 内部用 :98；不得 :0
bash scripts/acceptance.sh --real --ux --desktop
# 注意：acceptance.sh 当前只编排 L1–L4 真实 e2e；L5–L10 用 §6.3 的串行循环补，
# 报告里必须写清「acceptance.sh 覆盖到哪、手动补了哪几关」。2026-11-01：L01–L10 均已通过串行 e2e，L10 不再记 BLOCKED。
```

### 6.7 收尾检查

- `ps -ef | grep -E "Paper|engine|vite"` 无残留；`ps -ef | grep DISPLAY=:0` 为空。
- 所有 evidence 目录有 `manifest.sha256`；失败记录都有 `repro`。
- 报告首行只允许两种：`G-FINAL-PLAYER: PASS`（四 persona 全过）或 `G-FINAL-PLAYER: FAIL/BLOCKED`（列剩余 P0/P1 与责任线）。**不许写「基本通过」「体验良好」这类无法复现的结论。**

---

## 7. 附：L10 的验收占位（待实现）

L10 目前只有设计（`content/levels/L10-two-weavers.md`）与 SDK 约定（`docs/12` §190-200），没有 `L10.content.ts`、没有 `it/l10-real.ts`、没有 Studio 文案。实现后按以下脚本验收（现在只能记 BLOCKED）：

| 步 | 操作 | 必须看到 |
|---|---|---|
| L10-1 | 地图墙第 10 关 → 开场 | 双织偶设定、桥面阶段、玩家最终合龙的动作说明 |
| L10-2 | 编辑器写 `agent("左织")/agent("右织")` + 消息 | 两只织偶分别在世界两侧执行；右侧「织线日志」逐条记消息与等待时间 |
| L10-3 | 故意让两边互相等 | 头顶「…」+ 倒计时条变紫「织线缠住了」；超时按原因码给中文人话（deadlock/over-take/starved） |
| L10-4 | 阶段二通过 | 份额谈妥、材料箱归零、桥面无缝、60 秒内完成、无死锁 |
| L10-5 | 玩家节拍 | 手持合龙石右键中央基座 → 合龙演出、村民过桥、结算 3 星 |

> 在这五步可复现之前，终验报告里 L10 一律写 `BLOCKED（无运行时）`，不得用设计文档代替证据。


## 8. 2026-10-31 最终状态（历史快照；最新见 §9）

- 已修：L05–L10 Studio 中文引导完整；L10 双织偶真实运行时 + Studio 会话注入；L01–L10 真实 Paper e2e 全 PASS。
- 已修：UOS U3 错误后重置、手记 replay 遮挡；主 Studio e2e 6/6。
- 仍开放：
  - U4「只读屏幕文字完成 L01」已修并通过：测试先等「最后一步」再 playerBeat；UOS 4/4 PASS。
  - ~~桌面安装包仍 Mock-only~~（**历史；2026-11-01 已改为内置真实运行时**，见 §9）；发布物不能直接连真实 Paper（**已解决**）；
  - 挑战层 UI 入口未接；
  - 真实人类键鼠/多背景玩家验收尚未执行（当前为 AI 自动化 + UOS 4/4 代理）。

## 9. 2026-11-01 试玩修复后的状态（覆盖 §8 剩余项）

- 已修：目标面板改为 `LevelDef.progress` 唯一真值（L01–L10 每关 2–3 条、按 id 更新、逐条打勾）；玩家节拍严格线性（`result.playerBeatReady` 门控 + 插件 `playerBeat.activate` 前拦截提前右键）；切关/reset sandbox 纯净（全区域 checkpoint + 背包/实体清理）；L01 第 4 盏灯容错右键（站地面、手持灯笼对柱子右键即可，不用看柱顶）。证据：`it/l1-real.ts`–`it/l10-real.ts` 全 PASS、`evidence/playtest-fix/report.md`。
- 已修（§8 旧边界）：桌面安装包已内置 Node/Java/Paper/插件/世界/真实引擎与织偶（不再 Mock-only）；L05–L10 Studio 中文引导完整；L10 双织偶真实运行时 + Studio 会话注入；UOS 4/4、Studio 主 e2e 6/6。
- 仍开放：挑战层是说明卡、未接可玩会话；真人多背景盲测未执行；部分关卡真实客户端截图未全部重拍；Fresh Reader Round 4 未清零（G-FRESH-READER tracked fail）。
- verifier 独立验收另发现两项真人体验遗留：L03 玩家出生点在钟楼结构内、L02 蛋糕目标格被塔基占用（`evidence/playtest-fix/report.md` §4）。
