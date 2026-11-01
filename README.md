# 织界 / THE LOOM

> 一款用 Minecraft 教程序语言核心抽象的教学游戏：玩家写 TypeScript 子集驱动「织偶」，在 3 幕、10 关里依次遇到顺序、分支、循环、函数、记录/联合、闭包、高阶函数/管道、接口/组合、异步与并发。
>
> **当前状态**：L01–L10 已全部通过真实 Paper e2e；Studio 有完整中文引导、挑战层说明与 UOS 用户操作模拟。**最新桌面包已内置 Node/Java/Paper/插件/世界/真实引擎与 mineflayer 织偶**：用户只需安装正确版本的 Minecraft，桌面应用会自己启动服务端与真实引擎。

## 一句话玩法

在 Studio 里写代码 → 灰崽（mineflayer 织偶）在世界里执行 → 出现「轮到你」时回 Minecraft 完成「织者之印」→ 结算星级。程序不是许愿，它只照字面执行；失败会被翻译成中文的下一步。

## 先看哪份文档

- **[当前事实源：试玩修复方案与结果](docs/46-playtest-fix-plan.md)**：2026-11-01 的进度/玩家节拍/sandbox/reset 修复与验收（新 agent 必读）。
- **[文档审计记录](docs/47-docs-audit-2026-11-01.md)**：各文档判定（更新/保留+标注/删除）、改动清单与遗留风险。
- **[玩家玩法与启动](docs/42-player-guide.md)**：怎么装 Minecraft、怎么启动真实模式、怎么释放鼠标、怎么同时看代码和游戏。
- **[环境与依赖边界](docs/43-environment-and-bundling.md)**：安装包内置了什么、用户只需要准备什么。
- **[光标/悬浮方案调研](docs/45-cursor-and-focus-research.md)**：为什么全屏 Minecraft 下需要游戏内 mod，当前外部窗口折中怎么用。
- **[开发历程与踩坑](docs/40-development-history.md)**：L05–L10 真实路径、桌面窗口、自动化隔离等经验教训。
- **[AI / 新开发者接手指南](docs/41-ai-contributor-guide.md)**：架构、红线、测试与添加关卡的方法。
- **[交接与复现](docs/36-github-handoff.md)**：GitHub 交接、真实环境复现、已知问题。
- **[玩家验收矩阵](docs/39-final-player-acceptance.md)**：多种背景玩家的操作脚本、判据与当前 blocker。
- **[项目状态](STATUS.md)**：最新交付快照。

## 需要什么环境

### 玩家只需要安装

- **Minecraft Java 26.1.2**（推荐 Prism Launcher；Flatpak 可用）
- 一个能登录的 Minecraft 账号
- 正常工作的 Linux 桌面与显卡驱动

### 安装包已内置

- Node 22 + Java 25 运行时
- Paper 26.1.2 build 74、LoomCraft 插件、世界/配置
- 真实引擎、mineflayer/minecraft-protocol 织偶依赖
- Studio、桌面壳、字体、Mock 演示引擎

用户不需要自己安装 Node/Java/Paper，也不需要另开终端启动引擎。

## 快速开始（玩家）

```bash
# 推荐：自动清理旧实例/残留 Paper/引擎，再启动并等待后端就绪
bash scripts/launch-desktop.sh

# 手动启动
./apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft-x86_64.AppImage
# 或 Fedora: sudo rpm -i apps/desktop/src-tauri/target/release/bundle/rpm/Loomcraft-0.1.0-1.x86_64.rpm
```

1. 打开桌面应用。它会自动启动包内 Paper 世界与真实引擎；顶部四个连接灯应显示：**织机 / Paper / 织偶 / 客户端**。
2. 打开 Prism Launcher，进入已安装的 **Minecraft Java 26.1.2** 实例。
   - 写代码和回游戏之间按 **Alt+Z** 切换焦点（不用 Alt+Tab）；游戏窗口失焦不会暂停。
3. 多人游戏 → 直连 `localhost:25565`。
4. 在 Studio 里选关、写代码、运行；出现「轮到你」时回 Minecraft 完成玩家节拍。

如果连接灯不是绿色，等待首次启动十几秒；仍不绿时看 `~/.loomcraft/logs/`。

## 开发者：从源码跑真实模式

```bash
bash scripts/mc-up.sh
PORT=4320 LOOM_WORLD=paper npm run dev:engine:paper
VITE_ENGINE_URL=http://127.0.0.1:4320 npm --prefix apps/studio run dev -- --host 127.0.0.1
```

## 仓库结构

```text
apps/studio        React + Monaco 教学界面
apps/engine        HTTP 引擎；mock / paper 两种世界运行时
apps/desktop       Tauri 桌面壳（自绘标题栏、伴玩、向导、状态灯）
packages/          level-spec / grading / worldport / session / runner / protocol
plugin/            Paper 插件：场景、实体、演出、评分真值、WebSocket RPC
content/levels     L01–L10 关卡、场景、参考解、评分、玩家节拍
content/codex      织典（跨语言对照）
bot/               mineflayer 织偶
it/                真实 Paper / Studio 集成验收脚本
evidence/          WorldDigest、真实 e2e、截图证据
docs/              设计、架构、质量、交接、玩法、历史
```

## 验证命令

```bash
npm ci
npm test
npm run typecheck
bash scripts/verify.sh

# Studio 主 e2e（需要引擎/Studio 测试服务）
npm --prefix apps/studio run test:e2e

# UOS 用户操作模拟
cd apps/studio && npx playwright test -c e2e/playwright.ux.config.ts

# 真实 Paper：同一服务端串行，不能并发
bash scripts/mc-up.sh
npx tsx it/l1-real.ts
# … l2-real.ts … l9-real.ts
npx tsx it/l10-real.ts
npx tsx it/l10-studio.ts
```

当前已验证：

- L01–L10 真实 Paper e2e 全 PASS
- L10 双织偶真实 19 项、Studio 会话注入 11 项 PASS
- Studio 主 e2e 6/6
- UOS 4/4
- `npm test` 25 files / 235 tests 全绿
- 纯中文门禁 0 违规

## 2026-11-01 试玩修复

- **任务逐条打勾**：L01–L10 每关 2–3 条目标由引擎真值驱动，完成一条勾一条（不再出现「点完灯目标不动」）。
- **严格线性玩家节拍**：只有灰崽部分完成后才出现「轮到你」和第 4 盏灯教程；提前右键会被拦下提示。
- **纯 sandbox**：切关会清理上一关场景/实体/背包；重置会彻底还原被改的方块、你的位置和背包。
- **第 4 盏灯更宽容**：站地面、手持灯笼、对着灯柱右键即可，**不用看见柱顶**。
- 老用户的 `~/.loomcraft/runtime/paper/world` 会在新桌面版首次启动时自动替换为干净世界（关卡进度/星级不存于世界，不受影响）。

## 已知边界

1. **挑战层目前是可阅读说明卡**，不是可玩挑战会话。
2. **真人多背景盲测未执行**；目前是真实 Paper e2e + Studio e2e + UOS 的 AI 自动化代理。
3. 自动化只能在隔离 `:98/:99`；不要在 `:0` 上跑测试，也不要让 Prism/Minecraft 继承 `:99`。
4. **部分关卡真实客户机截图未全部重拍**；视觉证据仍以固定机位截图为准（docs/34）。
5. **独立验收发现的真人体验问题已在 11-01 修复**：L03/L05 显式 playerSpawn（不再落在钟格/墙边）、L02 蛋糕与 L04 南瓜目标格改为塔顶/草人头顶空气格（会真的落块）；仅剩「L03 钟本体在钟楼结构内不可见」为已知美术边界，对着钟楼右键即可完成节拍。
6. **Fresh Reader Round 4 未清零**（G-FRESH-READER 仍 tracked fail），未清零前不写「完成」。

## 设计文档

`docs/00–18`、`docs/24` 是设计阶段历史记录（结论保留，当前实现以代码为准）；`docs/46` 是当前事实源。实现以 `content/`、`packages/`、`apps/`、`plugin/` 为准。接手请从 `docs/41-ai-contributor-guide.md` 开始，审计结论见 `docs/47`。
