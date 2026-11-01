# 48 — 试玩 Round 2：截图质量 / 指引与 API / 字体与 Monaco 集成

> 状态：实施中｜负责人：Lead｜最后更新：2026-11-01｜上游：用户 2026-11-01 第二轮试玩反馈
> 用户反馈（要点）：
> 1. Studio 里的关卡截图（第一关等）和 report 网页里的截图又老又糊（低分辨率），要高清重拍并替换素材。
> 2. 很多关卡的**引导机制**糟糕：L02「收满 4 枚先去木桶倒一次 / 最后回艾拉身边报数」完全没说怎么倒、怎么报、倒进木桶是什么意思；`golem.place("air", …)` 这种 API 反人类；作为编程教学游戏，API 必须语义清晰（如 `collect`/`deposit`）且更丰富；L01 让回艾拉身边，新手根本不知道艾拉坐标。要求：
>    - 像真实语言文档一样可随时查阅所有可用 command 的工具（点开看、关掉关）；
>    - 清晰引导（尤其「回到…去…」怎么拿坐标/怎么去；若要求探索要说明怎么探索）；更多机器人位置信息；REPL 是否可利用（现在打开 REPL 会跳回第一关，应基于当前关卡）；
>    - 真实面向零基础新手：足够的引导（不是象征性几句），可用游戏内消息 API 直接打到游戏里，按进度反复出现（不是一次就消失、也不是狂闪）。
> 3. 编辑器字体彻底换成 **Maple Mono**（嵌包）；不允许 Iosevka/更早像素字体残留（某些 UI 提示还是旧字体）；所有代码编辑器字体统一 Maple Mono。
> 4. 编辑器右键菜单应像 Windows 右键菜单一样有**不透明底色**；现在透明导致菜单文字和代码叠在一起。Monaco 集成细节要打磨好（"接头"不能有瑕疵）。
> 5. 加载进每一关时，**起始点必须合理**（用截图逐关验证）；L02 开局机器人直接怼脸艾拉，明显异常。

---

## 0. 设计原则

- **API 是教学语言的脸面**：学生可见 API 一律「动词 + 名词」语义化，禁止用底层方块操作模拟业务动作（`place("air")` 收蛋、`place("egg")` 倒蛋这类）。
- **零基础默认**：每一步都给出「做什么 + 怎么做（可照抄）+ 坐标从哪来」；引导按进度重复，控制节奏（run 失败 / 目标完成 / 轮到你 等节点各一次，不做每 tick 刷屏）。
- **坐标不用猜**：命名坐标点（艾拉/木桶/灯…）由关卡声明，SDK 注入为全局对象，文档面板与 HUD 同时展示；回程可写 `golem.moveTo(eira)`。
- **真值不变**：语义 API 在端口层映射到现有世界事件，评分/隐藏测试/Mock-vs-真实 digest 的语义保持，不改评分真值。
- **截图按玩家视角**：以每关 playerSpawn 的第一人称视角为准，同时用于「起始点是否合理」验收。

---

## 1. 契约

### 1.1 命名坐标点（LevelDef.world.points）

```ts
export interface NamedPoint { pos: [number, number, number]; name: string }
// LevelDef.world.points?: Record<string, NamedPoint>
// 例：L02 { eira: {pos:[0,65,6], name:"艾拉"}, barrel:{pos:[0,65,-6],name:"木桶"}, ... }
```

- `WorldPort` 暴露 `points`；`runStudentProgram` 把每个点注入沙箱为**同名全局常量**（`eira`、`barrel`…），同时 `world.points` 可访问。
- 点对象学生可见形状：`{ x, y, z, name }`（冻结）。
- `LevelDef.world.points` 缺失时，端口自动从 vars 派生常见点（eira/barrel/bucket/…），但关卡应显式声明以避免歧义。

### 1.2 语义化 AgentActions（端口层实现；旧方法保留兼容）

```ts
type PointLike = NamedPoint | { x:number; y:number; z:number } | [number,number,number];
interface AgentActions {
  // 兼容旧签名
  moveTo(x: number, z: number): Promise<void>;
  place(block: string, x: number, y: number, z: number): Promise<void>;
  // 新语义（PointLike 解析 x/z/y；place(block, point) 用 point.y）
  moveTo(target: PointLike): Promise<void>;
  goTo(target: PointLike): Promise<void>;           // moveTo 的别名（教学用词二选一，文档推荐 moveTo）
  place(block: string, target: PointLike): Promise<void>;
  collect(item: string, target: PointLike): Promise<void>;   // 从目标格收走 item（如 "egg"/"wheat"），加入身上背包；保留 legacy block.place(air) 事件
  deposit(item: string, target: PointLike, count?: number): Promise<void>; // 把身上的 item 放进目标容器（如 barrel），默认 1；保留 legacy block.place(item) 事件
  count(item: string): number;                     // 身上 item 数（同步）
  say(text: string): Promise<void>;
}
```

- `collect` 的 legacy 事件：在目标格 emit `block.place {block:"air", actorType:"agent"}` + 从世界移除该方块（评分兼容）。
- `deposit` 的 legacy 事件：在目标格上方空格 emit `block.place {block:item}` + 容器计数 + 背包扣减。
- `count` 读端口侧背包计数（collect/deposit 维护；reset/prepare 清零）。
- 后续关卡可扩展 `harvest(crop, point)`/`plant(crop, point)`/`use(point)`/`ringBell(point)` 等，按 docs/12 命名规则；本轮 Act I（L01–L04）必须完成。

### 1.3 World 扩展

```ts
interface World {
  readonly vars: Record<string, unknown>;
  readonly points: Record<string, NamedPoint>;
  container(point: PointLike): { count(item: string): number; items(): Array<{ item: string; count: number }> };
}
```

- 容器计数由端口维护（deposit 累加，reset/prepare 清零）；评分真值仍来自既有快照/事件。

### 1.4a world.playerSpawn（起始点合理性）

```ts
// LevelDef.world.playerSpawn?: [number, number, number]
// 引擎 deriveLayout 优先级：PAPER_SCENE_HINTS.playerSpawn > world.playerSpawn > arena 中心。
```

- 每关显式声明，要求：body/head 空气、脚下实心、**不与 agentSpawn 重合（≥3 格）**、不在方块/NPC 体内、默认朝向（插件 teleport yaw 180 / pitch 10 朝北）能看到主目标或艾拉。
- 复验：visual-capture 逐关截第一人称出生视角；异常报 Lead 修。

### 1.4b 代码要求（名实相符，codeRequirements）

```ts
// LevelDef.codeRequirements?: CodeRequirement[]
// 纯声明式（浏览器安全）：{ id, text, kind, min?, detail? }
// kind: calls|variables|mutable-variable|branch|loop|function|object|higher-order|async|promise-combinator|template|custom
```

- 判定：`packages/runner/src/analysis.ts` 的 `analyzeStudentCode` / `evaluateCodeRequirements`（TypeScript AST 统计，不靠正则猜）。
- 会话 verify 时把结果作为**额外可见 criteria** 并入 ResultEvent（`codeCriteria`）；不满足则本关不通过，并优先用该条 text 作为引导。
- 内容要求：每关至少 2 条，starter 不满足、参考解满足；参考解必须真的用该关抽象（审计见 `evidence/code-analysis.json`：L02 参考解变量数=0、L06 对象字面量=0、L07 数组方法=0 → 本轮必须改写）。

### 1.4c conceptReveal（不回避专业术语）

levels.json 每关新增：

```json
"conceptReveal": { "term": "变量", "en": "variable", "what": "把会变的值存进有名字的盒子", "why": "不用每步重数，也让别人看懂", "mapping": "你刚才用 let banked 记住已经收了几枚蛋" }
```

结算页/手记展示中文术语 + 英文原词 + 它解决什么问题。文案政策：**中文表达自然即可，必要英文术语保留英文**（`for` 循环、`let` 变量、`Promise.all`、`async/await`、`closure`、`higher-order function`、`interface` 等），术语统一「中文名（English term）」；见 `docs/20` §3b。copy 门禁已放宽并支持「中文（English）」并列豁免 + `TECHNICAL_TERMS` 白名单（`scripts/check-copy.mjs --self-test` 当前 14/14 通过）。

### 1.4 引导（ProgressStep.hint + 会话消息）

```ts
// LevelDef.progress[i].hint: string   // 这一步「怎样才算完成 + 可以照抄的写法 + 坐标从哪来」；2–4 句
```

- `/api/levels/:id` 的 progress 视图包含 `hint`。
- 会话 verify 失败时：把第一条未完成 progress 的 `hint` 作为游戏内 actionbar（`port.fx`，节流：每次 run 失败最多 1 条）+ SSE `hint` 事件（Studio 教练卡展示）。
- 目标完成时：下一次 run 结果里尚未完成的第一步 hint 同样展示；轮到你时 actionbar 用 `playerBeatHint`（已有）。
- Studio 教练卡：失败时优先显示「未完成目标 + 该步 hint」；按钮「查看指令手册」。
- 游戏内消息节奏：run 失败 1 条 / 目标完成 1 条 / 轮到你 1 条；每关进入时可发 1 条「目标」；不做定时刷屏。

### 1.5 指令手册（Studio）

- 入口：工作台顶栏「指令手册」按钮 + 教练卡链接 + REPL 内「手册」；模态面板，Esc/× 关闭，搜索框。
- 数据：`packages/sdk/src/api-registry.ts`（新文件）：按关卡引入顺序的条目 `{id, signature, summary, example, sinceLevel}`；再加当前关命名点表（名字/坐标/朝向说明）。
- 面板同时展示「本关可用 API」全部（apiAllowlist 级），每条给一句人话语义 + 可照抄示例；对 `moveTo/place/collect/deposit/count/say` 给出「这些坐标从哪来」（命名点 / `golem.pos`）。
- REPL 复用同源 registry。

### 1.6 位置 HUD 与 REPL 修复

- 新增 `GET /api/session/:id/snapshot`（返回 WorldSnapshot：agents/npcs/vars/points 可选）或 `inspect`：Studio 每秒轮询显示「灰崽 (x, z)」「本关关键点」；节流、页面隐藏时暂停。
- REPL：修复「打开 REPL 跳回 L01」——用**当前关卡**创建 repl 会话（engine `/api/session` mode=repl + levelId），REPL 头显示当前关卡名；SDK 注入同名命名点/`world.points`；`help` 命令返回本关 API 列表；REPL UI 提供「打开指令手册」。

### 1.7 字体与 Monaco

- 嵌入 **Maple Mono**（含中文的 CN 变体，OFL 许可文件随包）；`--mono` 全部指向 `"Maple Mono"`；代码编辑器 `fontFamily: "Maple Mono"`, ligatures 开启；日志/提示/按键/状态等代码感 UI 一并使用；移除 Iosevka / Departure Mono 引用与所有旧像素字体在提示类 UI 的残留（标题/叙事字体若要保留像素风必须在报告中明确，且不得用于代码/提示）。
- Monaco 右键菜单不透明：`menu.background` 为不透明色 + CSS 兜底（`.monaco-menu`/`.context-view` 背景与阴影、圆角、z-index）；验证计算样式 alpha=1。
- 其他 Monaco 集成打磨：主题与页面一致、建议/悬停/查找组件不透明、滚动条、括号配色、光标、自动布局、快捷键提示、中文化（若可行）、右键菜单只保留需要的项（复制/粘贴/剪切/全选/格式化?）并测试。

### 1.8 截图

- 真实 Minecraft 客户端、高分辨率（≥1920×1080，建议 2560×1440/3840×2160）、每关一张**玩家出生视角** + 必要的场景/交互图。
- 替换 `apps/studio/public/world/L0X.png`（含 L10），保持 16:9/合理裁切；替换 `report/evidence/*.png`；必要时更新 `report/index.html` 中图注/尺寸说明。
- 起始点验收：逐关截图后人工+模型视检（是否在方块里/贴脸 NPC/看墙/掉虚空/看不到目标），不合理的调整 `playerSpawn`（engine `PAPER_SCENE_HINTS`）或场景/agent spawn。

---

## 2. 文件归属（本轮）

| Owner | 文件 |
|---|---|
| Lead | `docs/48*`、`packages/level-spec/src/index.ts`（NamedPoint/points/hint/progressView）、spawn 修正与最终集成/打包 |
| api-sdk | `packages/sdk/**`、`packages/worldport/**`、`packages/runner/**`、`packages/session/**`、`apps/engine/**`（REPL/snapshot/api-registry 端点）、`content/levels/L01–L04.content.ts` |
| guidance-ui | `apps/studio/src/components/**`（除 CodeEditor）、`apps/studio/src/engine/**`、`apps/studio/src/copy/**`、`apps/studio/src/repl/**`、新增 `guidance.css`+`main.tsx` 引用、`content/levels/L05–L10.content.ts`（只加 points/hint） |
| monaco-font | `apps/studio/src/monaco/**`、`apps/studio/src/components/CodeEditor.tsx`、`apps/studio/src/styles.css`、`apps/studio/src/index.html`、`apps/studio/public/fonts/**`、`apps/desktop` 内字体引用 |
| visual-capture | `apps/studio/public/world/*.png`、`report/evidence/*.png`、`evidence/scene-shots/**`、`it/screenshots/**`、tmp 截图脚本 |

## 3. 验收

1. 10 关起始视角截图：无穿模/贴脸/卡墙/悬空/视野空；L02 机器人不再怼脸艾拉。
2. Studio 与 report 的截图全部为高清实机；无旧低分辨率图残留（grep/文件尺寸检查）。
3. L01–L04 参考解不再出现 `place("air")`/`place("egg")` 等反直觉调用；`collect/deposit/count/container/points` 生效；评分/隐藏测试/真实 e2e 与 Mock digest 仍一致。
4. 指令手册可开/关/搜索；L02 能照手册完成「倒蛋」「报数」；HUD 显示灰崽/艾拉/木桶坐标；REPL 打开后是当前关卡且显示当前关卡名。
5. 引导按节点出现、可重复、不刷屏；新手仅凭屏幕能完成 L02。
6. 代码编辑器 computed font-family 为 Maple Mono（含中文回退），无 Iosevka/Departure Mono；右键菜单背景 alpha=1，不再与代码重叠。
7. 回归：`npm test`、`verify.sh`、Studio e2e、L01–L10 真实 e2e、重新打包 AppImage。

## 6. 实施结果（2026-11-01 集成，Lead 终验）

### 6.1 落地内容

| 契约 | 结果 | 主要证据 |
|---|---|---|
| §1.1 命名坐标点 | `LevelDef.world.points` + `world.playerSpawn` + `pointsView`；沙箱注入同名全局（深冻结）；Mock/Paper 端口自动派生（vars 三元组/`lamps[]`→`lamp1..N`）；L01–L10 全部声明 | `packages/level-spec`、`packages/worldport`、`packages/session`；L01–L10 content |
| §1.2 语义 API | `moveTo(point)`/`goTo`/`place(block, point)`/`collect`/`deposit`/`count`/`world.container(point).count/items`/`harvest`/`plant`；legacy `place("air")` 保留兼容且评分事件语义完全一致（collect→air 事件、deposit→item 事件） | `packages/sdk`、`api-registry.ts`、`packages/{mockworld,worldport,runner,session}`；api-runtime 事件等价自测 |
| §1.4 引导 hint | 每关 progress 2–4 句 hint（做什么/怎么写/坐标从哪来）；失败时 1 条 SSE hint + 1 条 actionbar（节流、去重） | `packages/session`、`apps/engine`；L02 文案明确解释倒蛋/报数/回艾拉 |
| §1.5 指令手册/HUD/REPL | 顶栏/教练/REPL 三入口可开关（×/Esc/遮罩）+ 搜索；本关 API 签名/人话/示例 + 命名点坐标表；HUD 1s 轮询灰崽与关键点、L02 木桶计数；REPL 用当前关卡、显示关卡名、`help` 开手册 | `GuidanceManual.tsx`、`PositionHud.tsx`、`ReplScreen.tsx`、`guidance.css`、`guidance-data.ts`；Playwright 42/42 |
| §1.6 REPL 当前关卡 | `createReplSession(levelId)` + `POST /api/session {levelId,mode:"repl"}`；不再跳回 L01 | `httpEngine.ts`、`App.tsx`、`apps/engine` |
| §1.7 概念揭晓 | 结算/手记/织典显示「中文（English term）+ 是什么/为什么/刚才做了什么」；L01–L10 conceptReveal 全部落盘 | `ConceptRevealCard.tsx`、`levels.json`、docs/04 §11.5 |
| §1.8 起始点 | 10 关 `world.playerSpawn` 落盘；L02/L09 修复「玩家 spawn 与灰崽重合→镜头在模型体内糊屏」；每关真实客户端出生视角截图审计 | `evidence/playtest-fix/start-positions.md`、`birth-L01..L10.png` |
| §1.9 名实相符 | 每关 `codeRequirements`（声明式 kind/min/custom test）+ AST 分析器 `analyzeStudentCode/evaluateCodeRequirements`；starter 全不满足、参考解全满足；L02 变量、L06 记录/switch、L07 filter/map 流水线等重写为真正使用抽象 | `packages/runner/src/analysis.ts`、`evidence/code-analysis.json`、L01–L10 content |
| 字体 | 嵌包 **Maple Mono CN**（Regular/Italic/SemiBold，OFL 1.1）；代码/提示类 UI 统一；Zpix 只留装饰大标题；移除 Iosevka/Departure Mono | `apps/studio/public/fonts`、`styles.css`、`CodeEditor.tsx`；Playwright 22/22 + 桌面壳 8/8 |
| Monaco 菜单 | 真正根因是 Monaco 0.57 默认 `useShadowDOM: true`——菜单在 shadow root 内导致主题/CSS 隔离；设 `useShadowDOM:false` + 不透明主题色 + CSS 兜底；菜单中文化；suggest/hover/find 同修 | `CodeEditor.tsx`、`monaco/setup.ts`、`styles.css`；`evidence/monaco-font-verify.json` |
| 截图 | 真实 Minecraft 26.1.2 客户端（Docker Xvfb + Mesa llvmpipe，2560×1440）逐关出生视角；world strip 2560×990 ×10（含 L10）；report 证据图全部替换；Studio UI DPR2 2880×1920 | `apps/studio/public/world/`、`report/evidence/`、`evidence/scene-shots/hi-res/`、`evidence/ui-hires/` |
| 文案政策 | 自然中文 + 必要英文术语（`for` 循环、`let` 变量、`Promise.all`…），不硬翻译；`check-copy --pure-zh --strict` 0 违规（术语白名单 + 中英对照豁免） | `scripts/check-copy.mjs`、docs/20 §3b |

### 6.2 终验矩阵（Lead 在最终工作树 + 重新打包产物上执行）

- `npx tsc -p tsconfig.json --noEmit` = 0；`npx tsc -p apps/studio/tsconfig.json --noEmit` = 0
- `npm test` = 25 files / 235 tests 全绿（冻结测试零改动）；`npx vitest run content/levels` = 10 files / 162 tests 全绿
- `bash scripts/verify.sh` = pass（l0–l3 pass；lg 仅遗留 `G-FRESH-READER` tracked warning，Round 1 基线）
- Studio：`test:e2e` 6/6（真实配置）、`test:e2e:local` 2/2；guidance 隔离冒烟 42/42；monaco-font 22/22 + 桌面壳 8/8
- 真实 Paper e2e：`it/l1-real.ts`–`it/l10-real.ts` 全 PASS（含 L02 语义两趟、L04 harvest/plant、L10 双织偶玩家节拍）；插件补 `world.blocks`/`world.snapshot` 的 `baseAlias` 还原（虚拟方块 egg/wheat_sprout 以逻辑 id 报告，与 Mock digest 一致）
- 重新打包：`scripts/package-desktop.sh` 一条命令产出 AppImage + RPM（无 FUSE 环境自动 `APPIMAGE_EXTRACT_AND_RUN` + 手动封包）；包内断言 Maple Mono 存在、无 Iosevka、插件含 `playerGive`、世界 marker 存在

### 6.3 已知边界（不在本轮修）

1. 真实 Paper 模式仍「一个真实会话」：从工作台打开试符台会 dispose 当前关卡会话（mock 无感）；要无缝需引擎复用世界会话（ADR 级改动）。
2. L10 出生点可站立但默认朝向看不到双织偶桥；本轮截图素材用桥面机位（已注明仅截图），后续可加 `world.playerYaw` 契约。
3. `guard-tests --check` 的 manifest drift 为 Round 1 前既有基线，新测试未新增 `.test.ts`。
4. L03 钟本体仍在钟楼结构内不可见（Round 1 美术边界，对着钟楼右键可完成）。
