# 54 — 接手审计、提交扁平化与后续任务总表

> 状态：只梳理/给方案，不开始实现
> 日期：2026-11-02
> 当前本地 HEAD：`47dab8e`；远程 `origin/main`：`ccf23e8`；本地 6 个 Windows 相关 commit **尚未 push**
> 本文件不是验收结论；验收以实际构建/安装/运行证据为准

## 1. 当前项目状况

### 1.1 接手前基线（origin/main `ccf23e8`）

- 10 关内容、教材、Studio、engine、Paper 插件、mypy/TS/QA 基础已存在。
- 已有真实 Paper e2e 记录：L10 `ok=true`；L01 `ok=false`（hidden h1 采样失败，tracked）。
- Linux 桌面壳/AppImage/RPM 有历史构建，但没有 Windows 原生支持。
- 已知缺口：L01 h1、部分 UI/UX、Linux gate 证据、Windows runtime 无。

### 1.2 本地新增（6 commits，未 push）

| commit | 内容 |
|---|---|
| `d90a2b4` | Windows 跨平台构建/NSIS/runtime/QA 脚本 |
| `497172d` | Win32 pointer focus-follow（后续按 docs/45 移除自动跟随） |
| `562705d` | Windows 验证加固（lifecycle/cache/单实例/QA gate） |
| `2c7b635` | Alt+Z/设置证据 |
| `ee0142c` | 去掉每 8 秒 PowerShell 轮询，修复桌面壳卡顿 |
| `47dab8e` | lag-fix 后 GUI 截图证据 |

### 1.3 已验证

- `npm run typecheck` PASS
- `npm test` 251/251 PASS
- `verify.ps1 l0–l3` PASS
- 安装版 headless e2e：42/42 PASS（installed runtime、包内 cache、Paper/engine/bot/Studio/L01/3 星）
- Windows GUI：
  - 首启向导、地图墙、工作台、伴玩、教材浮层截图；
  - Alt+Z：Minecraft → 织界 → Minecraft；
  - 单实例：第二实例退出；
  - WM_CLOSE 后 Paper 优雅保存、engine/Paper 停止、端口释放、lock 删除。
- 卡顿修复：UIA 点击从 avg 1761ms/max 5331ms 降到 avg 67ms/max 266ms；App 的 PowerShell 子进程 0，控制台窗口 0。
- WSL Linux `cargo check` PASS（非原生，仅参考）。

### 1.4 未验证/未解决

- L01 hidden h1 真实 bot 到达抖动（真实产品缺陷，不只是测试问题）。
- 打包 world 污染：实测 shipped world 与干净备份 74 个同名文件中 47 个 hash 不同，带 29 个测试玩家数据文件，12MB `world.bak-fresh-p0` 被打进包。
- UI 问题（见 §5）。
- Launcher/客户端自动启动链路缺失。
- Windows G-DESKTOP-WIN 仅 D10 产物新鲜度 warn；G-TOP-WIN pass。
- 原生 Linux 打包/G-DESKTOP/G-TOP 未由同学验证。
- 长时 WebView2/教材/Monaco/zoom 性能未做 30 分钟压测。
- 本地 6 commits 未 push；远程没有被改动。

## 2. 任务 0：commit 回退/扁平化（最高优先级）

### 2.1 事实澄清

远程 `origin/main` 仍是 `ccf23e8`，本地 6 个 commit **没有推送**。所以：

- 不需要“从远程 force 撤回”；
- 如果按下面方案 reset 到 `origin/main` 再提交一个新 commit，**普通 push 就是 fast-forward，不需要 force**；
- 在任何验证完成前，push 保持阻塞。

### 2.2 建议流程

1. 建备份分支：`git branch backup/windows-takeover-20261102`
2. `git reset --soft origin/main`：保留全部改动为 staged，删除历史碎片。
3. 在一个干净的 worktree/checkout 上做完整验证（不是只验工作区）：
   - runtime 重建（cache 必须包内、world 必须干净）
   - NSIS 重建 + `/S` 安装
   - headless e2e 42 checks
   - GUI：向导、地图墙、工作台、伴玩、Alt+Z、单实例、退出清理
   - UI 修复后回归
   - Windows kill/lock/端口检查
   - 原生 Linux：同学跑 `package-desktop.sh` + `verify.sh` + gates
4. 生成接手审计报告：基线问题、6 commits 做了什么、修复/变化、验收、遗留。
5. 扁平化成一个 commit：用户可读的完整说明 + 证据路径。
6. push 阻塞，等用户按清单看安装包/UI/launcher 后确认；确认后普通 push（或按远端状态 force-with-lease）。
7. 如果远端在此期间有同学新提交，先 rebase/重新审计，不直接 force。

### 2.3 需要用户看的简洁清单（后续提供）

- 安装包能否启动，四灯/按钮是否合理；
- 点击是否仍卡；
- L1 退出确认是否完整关服/关客户端；
- 客户端丢失时红色阻断 + 一键重连；
- UI 嵌套标题栏/底部空白/遮挡/滚动条；
- launcher 自动检测/启动；
- Linux 原生包由同学确认。

## 3. 任务 1：L0/L1/L2 用户流程

详见 `docs/53-game-start-flow-design.md`，已确认：

- 保留「进入工坊」文案；
- 每次启动固定 L0；
- L1「退出游戏」= 完整退出桌面 App（客户端/Paper/engine/bot/壳）；
- L0 四卡：织机/Paper/织偶/客户端；卡内按钮；启动中禁用；失败可重试；
- 四灯全绿才启用 L0 中心「进入工坊」；
- L1 返回/退出；L2 客户端丢失红色阻断 + 一键重连当前进度；
- L0 下方「怎么开始」保留但精简。

## 4. 任务 1b：Minecraft 启动器适配

### 4.1 可靠性/自动化两条排序

建议实际采用混合顺序：

```text
已有运行中的 MC 窗口/进程（复用）
→ Prism（自动化最稳，有 CLI/实例）
→ HMCL（需实测 CLI）
→ 官方启动器（最正规，但快速进服能力弱）
→ 通用 .minecraft 版本启动（需要正确账号/版本）
→ PCL2（Windows 很流行，但 CLI 能力未确认，先做“拉起 + 引导”）
→ 一键安装/下载启动器 + 登录引导
```

- 官方启动器“可靠/合规”最高，但自动化 quick-play 最弱；
- Prism“自动化”最高，推荐作为默认自动适配器；
- PCL2 未确认 CLI，不承诺自动 quick-play；
- 一键安装只能装 launcher，不能替用户登录/绕过正版验证；
- 任何启动前先查已有客户端，全局锁防重复启动。

### 4.2 当前 MC 来源结论

不是 PCL。之前联调客户端由仓库工具 `D:\VScode_code\the-loom\.tools\launch_mc.py` 启动：

- `minecraft_launcher_lib`
- 本地 `.minecraft/versions/26.1.2`
- 离线用户名 `Alami`
- quickPlay `127.0.0.1:25567`

本机未找到 PCL/PCL2 目录或可执行文件；当前产品代码也没有管理这个客户端。

## 5. 任务 2/3：Windows 桌面壳 UI 问题（已定位根因，待实现）

详见 `tmp/audit/ui-issues.md`。

1. **嵌套标题栏（P0，低风险）**  
   Studio iframe 里再次渲染 `DesktopTitlebar`（`apps/studio/src/main.tsx:22`），壳本身已有标题栏。修：只在顶层渲染/删 Studio 内系统控件/去掉 `body.desktop-shell` 额外 36px。
2. **底部大空白（P0，中风险）**  
   CSS `zoom` 被壳和 Studio 各设一次 + 布局用 `100vh`；1280×840/scale0.8 实测底部空 168px（20%）。修：`100vh→100%` 链或改用已存在未调用的 Tauri `set_webview_zoom`；浮层 max-height 一起改。
3. **窄窗底栏遮挡（P1，低风险）**  
   底栏 sticky + 右侧 rail 只留 24px；1040×720/900×640 盖住目标/位置卡。修：预留底栏高度/rail 底部 padding 或改 dock。
4. **默认滚动条（P1）**  
   `.rail/.log-lines/.repl-history-list` 无滚动条样式；地图页文档滚动条未处理。修：统一游戏风滚动条 token/渐隐/首级不滚。
5. **顶栏按钮冗余（P1，需拍板）**  
   置顶/伴玩与系统壳重复（且 Rust 命令 `set_always_on_top`/`set_companion_mode` 不存在，静默失败）；重置本关 5 个入口；织机在线与壳灯重复；手记/织典/教材概念重叠。建议系统级移除、调试进 dev、功能分组菜单，内容合并（待报告 §5.3 选项）。
6. **REPL help / 开场文本（P1，极小改动）**  
   `RichText` 已 import 未用于 `ReplScreen` 的 help 文案；`opening-copy` 用 flex 把每段变 flex item 导致 L08 单行 345px。修：包 RichText、`display:block`。
7. **教材浮窗被 iframe 夹住（P1，需决策）**  
   当前 portal 到 Studio iframe body，只能小范围移动。选项：A 独立 Tauri 无边框置顶窗；B 同源 Studio + portal 到壳；C 短期修 z-index/语义。A 最满足“桌面自由拖动”，Wayland 风险大。
8. **伴玩模式（P1）**  
   设计是 420×620 观察/快捷运行窗，不编辑代码；实现有 lastSource 无人写、无玩家节拍确认、mock 自动 player-beat 等硬伤。需决定“只读伴玩”还是“迷你编辑器 + 节拍确认”。

## 6. 任务 4：其他 UI/内容问题

- 试符台 `help` 反引号未渲染（RichText 未使用）；
- 关卡开场文本/代码块大空白（opening-copy flex）；
- 教材窗口拖拽受限（iframe portal）；
- 地图/关卡页默认滚动条、响应式侧栏；
- `未运行`/`织机在线` 状态合并/区分；
- 手记/织典/教材三者定位与去重（待用户决定）；
- 系统级/关卡级按钮职责边界。

## 7. 任务 5：旧 C 模块删除（本轮不做新 C）

- 旧 `native/icon-gen`、CMake/Make、build-native/test-native、docs/50 全部删除；
- 不接 world-check / runtime-manifest，C rewrite 留给同学后续处理；
- 构建链必须恢复纯 JS 图标生成，npm/test/Tauri 不依赖 C；
- 后续 C rewrite 方向另开任务，不在本轮范围内。

## 8. 其他重要问题（用户未列但必须提）

1. **L01 hidden h1 是真实产品缺陷**：真实 bot 落点 2.83 格，h1 要求 ≤2；建议修 `bot/manager.mjs` 的 GoalNear 到达判定并做 L01–L10 真 Paper 回归，而不是改断言。
2. **打包 world 污染**：应在 flatten/发布前修；否则“干净世界”承诺不成立。
3. **UI 测试盲区**：现有 e2e 没跑桌面壳/zoom，导致嵌套标题栏/遮挡/空白全部漏过；需要真实壳截图/UIA 门禁。
4. **G-DESKTOP-WIN D10 产物新鲜度**：最终扁平化后必须从新 commit 重建安装包再验证。
5. **原生 Linux 基线未验证**：issue #2 已请同学做 Linux 原生回归后 close。
6. **一键安装/账号边界**：只能安装启动器，不能代替账号/正版验证。

## 9. 建议执行顺序（待用户确认）

```text
Phase 0  冻结/备份 commit → 扁平化 staging → 全面验证 → 接手审计报告
Phase 1  任务1 L0/L1/L2 + 启动器适配
Phase 2  UI 修复（嵌套标题栏/空白/滚动条/遮挡/顶栏/RichText/教材/伴玩）
Phase 3  任务5 C 替换 + world 干净包门禁
Phase 4  L01 h1 修复 + L01–L10 真 Paper 回归
Phase 5  Windows 安装包/GUI 全链路 + 同学 Linux 原生验收
Phase 6  用户 review → push（不提前 push）
```

## 10. 需要用户选择的方案

1. **扁平化时机**：A 先扁平化旧的 6 commits 再开发（推荐）；B 等新任务全部完成再合并成一个大 commit。
2. **启动器优先级**：A 官方优先（合规/稳定、自动化弱）；B Prism 优先（自动化强）；C 混合：已运行→Prism→HMCL→官方→`.minecraft`→PCL2/引导（推荐）。
3. **一键安装边界**：接受“只一键装 launcher，登录/账号由用户完成”，还是要求下载客户端本体（有 EULA/账号限制）。
4. **C 组件**：课程是否仍要求 C？若要求选 A runtime-manifest / B world-check（推荐）；若不要求，整体移除。
5. **UI 内容去重**：手记/织典/教材三者如何合并/保留；等 UI 报告对比后再定。
6. **伴玩模式**：A 保持只读监控；B 加迷你编辑器+运行；C 改名/隐藏。
7. **“退出游戏”确认**：确认就是退出整个桌面 App（当前理解）。
8. **push 审批**：本地先 commit 不 push，等你看安装包/UI/launcher 清单后按顺序 push。

## 11. 多 Agent 执行约束（后续）

- Lead 统一提交，teammate 不直接 push；
- 按 write scope 拆分：launcher 适配 / L0 UI / L1-L2 流程 / UI 修复 / C+world check / 测试；
- 每个任务必须带测试/证据，禁止用 GUI 截图替代单测；
- 每个阶段先 dry-run/静态检查，再全量构建；
- 构建/安装/UI 验证在用户允许的桌面阶段执行，避免干扰其他虚拟桌面；
- 所有新行为在 Windows 和 Linux 原生都验证后才算通过。
