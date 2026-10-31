# @loom/studio — T1 Studio（关卡选择 + Monaco 工作台）

> 状态：T1 可用（Mock 模式自验收）｜owner：scout-prior-art｜最后更新：2026-10-31
> 契约：`docs/21-t1-contracts.md` §3（Engine HTTP API v1）；文案：`docs/22-copy-deck.md` §2.5（唯一来源）。

## 启动

```bash
cd apps/studio
npm install                      # 首次；Playwright 不下载浏览器（用系统 Chrome）
npm run dev:mock                 # Mock 模式（不连 Minecraft / 不需要引擎）→ http://127.0.0.1:5173
npm run dev                      # 真实模式 → 需要 apps/engine 在 127.0.0.1:4317
```

`VITE_MOCK=1` 决定是否启用 Mock 引擎；`VITE_ENGINE_URL` 可覆盖引擎地址。
根级 `npm run dev:studio` 需 Lead 在 root `package.json` 加一行（studio 写 scope 不含根文件）：

```json
"dev:studio": "npm --prefix apps/studio run dev:mock"
```

## 页与流程

1. **地图墙**：三幕 10 张卡。L01 可进入；L02/L03 可点开「剧本预览」（L03 有左栏三夜卡）；L04–L10 锁定。
2. **工作台**：左 Monaco（载入 `starterCode`，注入 SDK `.d.ts` 补全，Ctrl+Enter 运行）；右目标（≤3 条）/教练（deck `coachOpen`/`coachReact`）/运行结果（星数 + 每条判定 + 隐藏检验通过数）/世界日志。底部常驻「运行 / 停止 / 重置」，Mock 模式额外有验收工具（填入参考解/初始代码）。
3. **玩家节拍**：Mock 模式下参考解跑完后点「点亮 4 号灯」模拟玩家右键；真实模式走 `/api/player-beat` 或玩家在 MC 内操作。

## 文案来源（硬规则）

- `src/copy/levels.json` = docs/22 §2.5 交接 JSON **原样副本**（164 条）：按钮、目标、教练、提示、错误、结算、试炼 UI 全部从这里取。
- `src/copy/catalog.json` = Studio 结构性标签（地图墙、面板标题、日志模板、aria、状态徽标）。新增玩家文案必须先改 docs/22，再同步 JSON；组件里不写中文 UI 字符串。
- 校验：`node scripts/check-copy.mjs --json apps/studio/evidence/qa-copy.json --strict`（repo 根执行，0 命中）。

## Mock 引擎边界

- 复用 `packages/mockworld` + `packages/grading` + `packages/level-spec` 的 L01 定义，评分结果与 `npm run demo:l01` 同源。
- 浏览器内只解释 L01 需要的顺序指令 `golem.moveTo / place / say`（1–2 行）；循环/判断与真实执行走 apps/engine，Mock 会给出明确错误。
- 会话/事件按 docs/21 §3 的 `state/log/objective/result/error` 形状模拟，便于以后换真引擎不改 UI。

## 自验收（无人类参与）

```bash
cd apps/studio
npm run build                    # tsc --noEmit + vite build
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npx playwright test
```

- e2e：`e2e/mock-flow.spec.ts` 走「选关 → L03 三夜卡 → L01 参考解 → 运行 → 等待玩家 → 3 星 → 重置」，断言 console 0 error。
- 证据：`evidence/`（build.log、e2e-run.log、6 张截图、e2e-summary.json、qa-copy*.json、acceptance.md）。

## 已知限制

- 真实 Engine 尚未就绪：HTTP 分支按 docs/21 实现但未联调（会显示「连不上引擎」并提供 Mock 指引）。
- L02–L04 的引擎/场景未接入：只做剧本预览，不能运行。
- Mock 不执行 Monaco 里的任意 TS（无 esbuild）：只支持 L01 顺序指令；真实执行在 engine/runner。
- 未做 i18n；中文文案以 docs/22 为准。

## T2：真实织机联调（2026-10-31）

```bash
# 终端 1：本地织机（Engine，127.0.0.1:4317）
npm run dev:engine

# 终端 2：Studio 真实模式（默认连 4317）
npm --prefix apps/studio run dev        # http://127.0.0.1:5173

# 四关真实流程自验收（参考解 → 玩家节拍 → 3 星 → 重置）
npm --prefix apps/studio run verify:engine
```

- 真实 e2e：`npm --prefix apps/studio run test:e2e`（Playwright 会同时拉起 engine 与 Studio；含标题中线/单行/无横向滚动断言与结算页截图）。
- 本地演示兜底：`npm --prefix apps/studio run test:e2e:local`。
- 纯中文门禁：`npm --prefix apps/studio run check:copy`（copy JSON 中除反引号代码引用外不得出现连续拉丁字母）。
- 桌面壳：检测到 Tauri（`__TAURI_INTERNALS__.invoke`）时顶部显示「置顶 / 取消置顶」「伴玩 / 展开」；浏览器开发环境隐藏。点击调用 `set_always_on_top` / `set_companion_mode`；伴玩模式只留目标、艾拉一句、运行/停止/重置、世界日志。

## T2.5：文案 v3 + 序章/幕开场/关开场/旅途手记（2026-10-31）

- 文案：`src/copy/levels.json` = docs/22 v3 §2.5 JSON 原样（332 条；`{text, codeRefs}` 对象按反引号渲染）。
- 引导层：
  - **序章**（首次进入，8 屏；可跳过；跳过也算看过；每屏环境/织纹变化）；
  - **幕开场**（每幕首次进入 2–3 屏；可跳过；可在手记回看）；
  - **关开场**（3 句：世界状态 / 任务 / 为什么是你；可「再看一遍」）；
  - **旅途手记**（Esc 或顶部「打开旅途手记」；任何界面可开；世界/我/已解锁名词/上一关；回看序章与幕开场；关闭不丢进度）。
- 存档：`localStorage["loom.studio.progress.v1"]`（序章/幕/已进关卡/上一关；名词表按已进关卡动态解锁）。
- 纯中文门禁（v3 契约）：`node scripts/check-copy.mjs --pure-zh --json apps/studio/evidence/qa-copy-v3.json --strict`（0 violations）；Studio 侧 `npm run check:copy`。
- 真实 e2e 三条：`npm run test:e2e`（序章流程 / L01 全流程+标题对齐 / 桌面壳占位置顶·伴玩）。
- 截图：09 序章、10 关开场、11 旅途手记（+ 01–08 T2 截图）。

## T3：Fresh Reader Round 1 修复（task-43）

- 序章：身份统一「新来的织者」/「老织者」，标题改「织机断线的那一夜」，8 屏一屏只落一个新词（大织机/断线 → 织偶 → 散线 → 织者之印 → 符文 → 织典）。
- 第一幕开场拆掉「四样本事/归位一分」，改为完整因果句。
- 关卡墙：统一「关卡」，可玩卡不再写「可玩」，未解锁卡写「未解锁 · 先过第 N 关」。
- 关开场：三条加小标题「眼下的村子 / 你要做的事 / 为什么是你」，任务条高亮。
- 工作台：错误卡固定「第 N 行 + 原因 + 可照抄写法」；星星按实得画、进度只在目标卡；运行中日志至少一行；教练改陈述+动作；结算去掉「3 颗星：」并解释织典。
- 旅途手记空态「刚进村，还没有上一关」；伴玩态保留教练、提示与目标进度。
- 关卡卡的拉丁字母符文圈改为汉字数字纹章；全部 UI 叙述纯中文。
- 截图：01/02/05/06/08/09/09b/10/11/12/13（序章两屏、L01/L03/L02/L04 工作台、伴玩）。
- REPL（试符台）若落地，文案按 FR-026/027/028：示例 `golem.moveTo(-12, -2)`（中文小字「让灰崽走到 2 号灯下」）；标题「一次写一句，灰崽就照着走一步」；按钮「清空对话」「把现场恢复原样」。

### 桌面壳（apps/desktop）纯中文清理

- 品牌只保留「织界」；窗口标题、向导、伴玩、设置里的 THE LOOM/Minecraft/TypeScript/Java/Node/Prism/Paper/引擎等英文标签改为中文；`npm --prefix apps/desktop run build:assets`（`node scripts/build-assets.mjs`）重打包 `dist/`。
- 说明：`productName`/`identifier` 仍为内部英文标识，不显示在界面；启动器命令输入框是技术配置值，保留原命令。

## T3：试符台（REPL，task-36）与织典（task-47）

- **试符台**：地图墙底部「试符台」进入（手记里也有「去试一句」）；标题居中，示例直接可跑（含 `golem.moveTo(-12, -2)` + 中文小字），回车执行；按钮「试一句 / 清空对话 / 把现场恢复原样」；历史「你写的 / 灰崽」；错误中文红框。接口：`POST /api/repl`、`GET /api/repl/history`、`POST /api/repl/reset`（repl 会话 `mode:"repl"`）；MockEngine 提供等价四种结果。
- **织典**：`content/codex/codex.json`（17 页）→ 地图墙/工作台/手记入口；左侧目录、右侧问题/机制/代价/跨语言 tab/在我们游戏里/常见误解；按 `levelsStarted` 解锁，未解锁显示「继续织下去，这一页会亮起来」。
- **v3.1 文案接入**：`src/copy/levels.json` = docs/22 v3.1 §2.5 JSON；`copy/index.ts` 的 `normalizeCopyValue` 统一把字符串与 `{text, codeRefs}` 归一化成字符串（代码引用保留反引号）。
- E2E：`npm run test:e2e` 会先 `build:e2e` 构建静态 dist，再由 `scripts/serve-dist.mjs` 服务；引擎隔离端口 `PORT=4399`。截图：14/15/16 试符台，17/18 织典。
