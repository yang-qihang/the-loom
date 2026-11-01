# @loom/studio — 织界 Studio（关卡选择 + Monaco 工作台 + 试符台 + 织典）

> 状态：已交付（L01–L10 全部可玩；真实引擎联调完成）｜负责人：scout-prior-art / progress-pipeline｜最后更新：2026-11-01
> 上游契约：`docs/21-t1-contracts.md` §3（Engine HTTP API）、`docs/46-playtest-fix-plan.md`（progress/playerBeatReady 契约）、`docs/22-copy-deck.md`（文案）。

## 启动

```bash
cd apps/studio
npm install                      # 首次；Playwright 不下载浏览器（用系统 Chrome）
npm run dev:mock                 # Mock 模式（不连 Minecraft / 不需要引擎）→ http://127.0.0.1:5173
npm run dev                      # 真实模式 → 需要 apps/engine 在 127.0.0.1:4317
```

`VITE_MOCK=1` 决定是否启用 Mock 引擎；`VITE_ENGINE_URL` 可覆盖引擎地址。根目录 `npm run dev:studio` 等价于 `dev:mock`。

## 当前状态（2026-11-01）

- **10 关全部可玩**：地图墙 L01–L10 均可进入；桌面/浏览器都能跑「选关 → 运行 → 玩家节拍 → 3 星 → 重置」。
- **目标面板来自引擎真值**：`GET /api/levels/:id` 的 `progress: [{id,text,player}]` 与 `result.progress` 是唯一来源，Studio 按 `objective` 事件的 id 更新，不再按 criteria 下标猜。旧关卡未声明 `progress` 时回退 `copy.levels.json`（兼容路径）。
- **严格线性玩家节拍**：只有 `result.playerBeatReady === true` 才显示「轮到你」卡片 / playerBeatGuide / 游戏内 actionbar；paper 模式下 `/api/player-beat` 是 confirm-only（引擎不代玩家）。
- **纯 sandbox**：切关清上一关场景/实体/背包；「重置本关」由插件按全区域 checkpoint 还原（docs/46 §1.2）。
- **挑战层**：关卡页有「挑战层」说明卡（非可玩会话），目标面板仍是 2–3 条 progress。
- **引导**：序章 8 屏、三幕开场、关开场 3 句、旅途手记、零 MC 基础折叠帮助；`localStorage["loom.studio.progress.v1"]` 存档。

## 页与流程

1. **地图墙**：三幕 10 张卡（全部可进入）；底部「试符台」入口；织典入口；关卡进度与上一关回看。
2. **工作台**：左 Monaco（载入 `starterCode`，SDK `.d.ts` 补全，回车运行）；右目标（引擎 progress，≤3 条）/教练/运行结果/世界日志；底部「运行 / 停止 / 重置」。
3. **玩家节拍**：`playerBeatReady` 后出现「轮到你」+ 零基础分步说明；真人完成玩家动作后回 Studio 确认；重置常驻。
4. **试符台（REPL）**：一行一执行，`POST /api/repl`（docs/27）；不评分、不影响关卡。
5. **织典（Loom Codex）**：17 页，按 `levelsStarted` 解锁。

## 文案来源（硬规则）

- `src/copy/levels.json` = docs/22 v3.1 文案 + 当前进度/引导条目；`src/copy/catalog.json` = Studio 结构性标签。新增玩家文案先改 docs/22，再同步 JSON；组件里不写中文 UI 字符串。
- 纯中文校验：`npm run check:copy`（repo 根也可 `node scripts/check-copy.mjs --pure-zh --strict`，0 违规）。
- 目标文案优先级：`result.progress` > `copy.levels.json` > 旧兼容回退；2026-11-01 起 L01–L10 均由引擎 progress 提供。

## Mock 引擎边界

- 复用 `packages/mockworld` + `packages/grading` + `packages/level-spec` 的关卡定义；评分与 `npm run demo:l01` 同源。
- Mock 模式 `playerBeat` 自动模拟（与真引擎 mock 端口径一致）；真实模式必须真人操作。
- 浏览器内只解释 L01 顺序指令；循环/判断与真实执行走 apps/engine。
- Mock 不执行 Monaco 里的任意 TS（无 esbuild）；真实执行在 engine/runner。

## 自验收（无人类参与）

```bash
npm run build                    # tsc --noEmit + vite build

# 主 e2e（Playwright 自动起 engine:4399 + 静态 Studio:5186）：6 条
npm run test:e2e
# 本地演示兜底（不需要引擎）：2 条
npm run test:e2e:local
# 引擎四关 HTTP/SSE 自验收（需 apps/engine 在 4317）
npm run verify:engine
# 纯中文文案
npm run check:copy
```

2026-11-01 结果：`test:e2e` 6/6、`test:e2e:local` 2/2、`check:copy` 0 违规；证据 `apps/studio/evidence/`、`evidence/`。

## 桌面壳

- 检测到 Tauri（`__TAURI_INTERNALS__.invoke`）时显示「置顶 / 伴玩」；浏览器开发环境隐藏。
- 伴玩模式 420×620：只留目标、艾拉一句、运行/停止/重置、世界日志；返回工作台前先恢复窗口尺寸。
- 壳与 Studio 通过 `set_mode` / 会话消息协作；窗口尺寸、缩放、Alt+Z 见 `apps/desktop/README.md`。

## 历史记录（2026-10-31，保留）

T2 真实织机联调、T2.5 文案 v3 + 序章/幕/手记、T3 Fresh Reader 修复、T3 试符台/织典、v3.1 文案接入均已完成；当时的命令与本 README 当前命令一致。FR-026/027/028 的试符台文案已落地。历史截图见 `apps/studio/evidence/`。
