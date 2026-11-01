# 40 — 开发历程、踩坑与经验教训（GitHub 交接版）

> 状态：交付总结（历史记录；当前状态见 `STATUS.md`、`docs/46`）｜负责人：Lead｜最后更新：2026-11-01
> 目的：让接手的人知道「为什么现在长这样」，避免重走 L05–L10 真实路径、桌面窗口、自动化隔离这些坑。
> 上游：STATUS.md、docs/46-playtest-fix-plan.md

## 0. 一句话

这是一套「Studio UI + 教学引擎 + Paper 插件 + mineflayer 织偶 + 10 关中文内容 + 自动验收」的教学游戏原型。核心关卡已在真实 Paper 上跑通；最新桌面包已内置真实运行时（见 §5）。

## 1. 时间线（实际发生了什么）

1. **设计冻结**：锁定 MC/Paper 26.1.2 build 74、Java 25、mineflayer 4.39.0；L10 双 bot 铺桥先做 spike，再决定运行时。
2. **垂直切片**：L01 真实 MC + Studio + 引擎 + 插件跑通，建立真实 e2e harness、WorldDigest、Mock 对照。
3. **Act I**（L02–L04）：教学文案、错误翻译、提示、玩家节拍、UOS。
4. **Act II/III**（L05–L09）：内容与场景美术；真实路径成为最大阻塞。
5. **L10**：双织偶协议、邮箱、合龙石、Studio 会话注入。
6. **桌面封装**：Tauri 自绘标题栏、拖动、置顶、伴玩、原生行为收口、字体/缩放。
7. **收口**：L01–L10 真实 e2e 全 PASS；Studio 6/6；UOS 4/4；桌面包内置真实运行时并经启动验证。
8. **试玩修复（2026-11-01）**：`LevelDef.progress` 目标真值、线性玩家节拍（`playerBeatReady` + 插件拦截）、切关/reset sandbox 纯净、L01 第 4 盏灯容错右键、世界布局版本迁移；详见 `docs/46-playtest-fix-plan.md`。

## 2. 最重要的 6 个教训

### 2.1 真实织偶不能直接 moveTo 地块中心

L05 的「Path was stopped」根因不是场景没路，而是参考解先把灰崽送到地块角落/脚手架旁；最后一段斜角节点贴着云杉柱，bot 卡在 `(3,64,18)`，7s 超时后 pathfinder 的 stopPathing 残留让重试立即失败。

**正确做法**：先走主路/外环，再走门口或工作点；参考解里不要站到容器/机关/农田格中心。L06/L07/L08/L09 的修复同理：
- 不站到木桶/箱子/工作台上；
- 不站到酿造台/材料架/拉杆/开关的格子上；
- 并发任务不要把 moveTo 放进 Promise.all（会互踩 pathfinder）；
- 目标不可站立时站到旁边，用 GoalNear 兜底；
- 每次改动后跑真实 e2e，不信 Mock。

### 2.2 插件自动支撑/物理方块会让 digest 不一致

插件曾经给 tracked 高点自动补石柱，堵路；逻辑平面 farmland/water 在真实 Paper 变成地板材质；MC 26.1 里 chain 需要用 `iron_chain`，铜会氧化成 exposed_cut_copper。

**做法**：内容自支撑；digest 对逻辑平面做归一化；铜管改蜡封；场景契约测试覆盖「不要往空走廊写 air」。

### 2.3 真实测试必须串行、必须隔离显示

- 同一个 Paper 同时跑两个 e2e 会 `STALE_SESSION`；一律 L01→L10 串行。
- 自动化只能用 `:98/:99`；任何 `DISPLAY=:0` 都可能把窗口/鼠标放到真实桌面。曾经真的泄漏过一次，已加脚本护栏。
- Prism 启动 Minecraft 必须显式 `DISPLAY=:0`（Wayland 下 GLFW 仍需 X11）；不要用 `env -u DISPLAY`。

### 2.4 桌面不是浏览器，最小窗口会放大所有布局问题

- 伴玩 420×620 下 footer/按钮/文字会挤；已做高度断点和直角紧凑样式。
- 「返回工作台」只换 iframe 不恢复窗口尺寸，会把 1280 宽工作台塞进小窗；现在会先 `set_mode(workbench)` 再切页。
- 桌面默认 WebView 缩放 80%，窗口不变、内容更多；设置里可调。
- Minecraft 失焦暂停：客户端 baseline 里 `pauseOnLostFocus:false`，并保持窗口化。

### 2.5 Mock 全绿不代表真实可玩

我们经历过 Mock 全绿但真实 L05–L09 全卡路径。真实验收门槛：
- `npx tsx it/lN-real.ts` PASS；
- 3 星 + failures 空；
- report/digest 与 Mock 一致；
- reset 稳定；
- 证据写入 `evidence/`。

### 2.6 引导不是「写一句提示」

真实新手需要的是：开场三句 → 目标 → 教练第一句 → 运行 → 失败后下一步 → 玩家节拍明确。UOS 4/4 是当前的自动化代理证据；真正人类盲测仍未执行。

## 3. 自动化命令

```bash
npm ci
npm test
npm run typecheck
bash scripts/verify.sh
npm --prefix apps/studio run test:e2e          # Studio 主套件
npx playwright test -c apps/studio/e2e/playwright.ux.config.ts   # UOS（cwd=apps/studio）

bash scripts/mc-up.sh
npx tsx it/l01-real.ts   # L01
...
npx tsx it/l10-real.ts   # L10
```

## 4. 关键文件索引

- `content/levels/L01–L10.content.ts`：关卡/场景/参考解/评分
- `packages/worldport/src/paper-port.ts`：真实世界/多 agent/移动
- `bot/manager.mjs`：mineflayer 织偶，含 GoalNear 兜底
- `plugin/src/main/java/dev/loomcraft/mc/SceneManager.java`：场景/评分真值
- `packages/session/src/session.ts`：Studio/引擎会话、L10 SDK 注入
- `apps/studio/src/components/Workbench.tsx`：代码→运行→玩家节拍
- `apps/desktop/shell/**`：桌面壳、伴玩、窗口/缩放/连接灯
- `it/*-real.ts`：真实 e2e

## 5. 当前交付边界（必须如实传达）

- 真实 Paper 链路已验证 L01–L10；最新桌面包已内置 Node/Java/Paper/插件/世界/真实引擎与织偶，启动时自动从包内资源拉起 Paper 和引擎。
- 挑战层目前是说明卡，不是可玩会话。
- 真人盲测未执行；UOS 是自动化代理。
- 2026-11-01 verifier 独立验收遗留：L03 真人出生点在钟楼结构内、L02 蛋糕目标格被塔基占用（`evidence/playtest-fix/report.md` §4）。
- 挑战层仍是说明卡；部分关卡真实客户端截图未全部重拍。
- 已修复的桌面事项：80% 内容缩放、伴玩引导、共享会话、返回工作台恢复尺寸、连接灯（织机/Paper/织偶/客户端）、Minecraft 失焦不暂停。

## 6. 给后续 AI 的提醒

不要先加功能，先复现；不要改测试变绿；不要用后端传送冒充玩家路径；不要并发跑真实 e2e；不要把 Mock 结果当真人验收；不要把未打包的真 Paper 说成「安装即玩」。
