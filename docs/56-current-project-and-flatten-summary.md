# 56 — 当前项目完整总结与扁平化 commit 说明

> 对应提交：`f03b79c`（已 force push 到 `origin/main`）
> 基线：`4b1d81c`
> 本文档用于补充该提交的完整中文说明；从本提交起，后续 commit message 以中文为主。

## 1. 当前项目是什么

《织界 / THE LOOM》是一个把「写代码」与「Minecraft 世界」连接起来的教学游戏：

- Studio：React + Monaco，负责关卡、代码编辑、运行/停止/重置、目标、结算、教材、旅途手记/织典、试符台。
- Engine：Node/TypeScript HTTP/SSE 服务，负责会话、运行、评分、玩家节拍、Paper 桥接。
- Paper：真实 Minecraft 服务端 + 插件，负责世界场景、实体、RPC、计分真值。
- bot：mineflayer「织偶」，扮演关卡中的 NPC/玩家任务目标。
- Desktop：Tauri 2 桌面壳，负责窗口、置顶、伴玩、启动/停止 Paper/engine/bot、Alt+Z、退出清理。
- 内容：L01–L10 关卡、教材、手记、织典、参考解、评分规则。

## 2. 接手前基线（`4b1d81c`）的问题

- Linux 桌面壳和 AppImage/RPM 有历史构建；Windows 没有原生构建/运行链路。
- 质量门禁主要在 Linux/bash；Windows 上 `verify`、qa gates、e2e 不可用。
- 桌面壳启动时只起 Paper/engine，客户端不会自动启动；向导只做 probe。
- L01 hidden h1 有真实 bot 到达抖动。
- 打包 world 可能包含测试玩家数据和备份。
- UI 有嵌套标题栏、底部空白、窄窗遮挡、默认滚动条、顶栏按钮冗余等。
- 没有 L0 四灯门控、L1 退出确认、L2 客户端丢失恢复。

## 3. 被扁平化的 16 个 commit 做了什么

### 3.1 原远程 10 个（`1345989` … `ccf23e8`）

1. `1345989` L10 多 agent bot、会话串行化、Studio timeout。
2. `cba285a` P0 修复独立复验（Windows 原生）+ 回归脚本与证据。
3. `56cb5eb` handoff 提交规范：Lead 直接提交 main，Windows 不得破坏 Linux。
4. `aee283c` 清理 Fedora VM/遗留进程，恢复 canonical 端口。
5. `4227b5d` 原生 C 图标生成器 + CMake/Make（**本次已删除**）。
6. `c1ba514` 教材 L01–L05 内容与构建校验。
7. `715b8e5` 剧情浮层重排、字体系统（Maple/Noto）。
8. `31580e3` 玩家任务自动检测/自动结算、运行状态鲁棒性。
9. `1d87085` 10 章完整教材 + 浮动窗口 + 首次进关自动打开。
10. `ccf23e8` Round 4 验收收尾（L01/L10 + 引擎回归 PASS，文案 strict 0）。

### 3.2 本地新增 6 个（`d90a2b4` … `47dab8e`）

1. `d90a2b4` Windows 跨平台构建/发布流水线：runtime、NSIS、PowerShell 脚本。
2. `497172d` Win32 焦点跟随；后续按 docs/45 移除自动跟随，仅保留 Alt+Z 显式切换。
3. `562705d` Windows 验证加固：单实例、路径、子进程、QA gate。
4. `2c7b635` Alt+Z/设置 GUI 证据。
5. `ee0142c` 修复每 8 秒 PowerShell 进程扫描导致的 2–5 秒卡顿（改 EnumWindows / `/proc`，无控制台窗口）。
6. `47dab8e` lag-fix 后 GUI 截图证据。

## 4. `f03b79c` 这个扁平化 commit 实际做了什么

### 4.1 Git 历史

- 从 `4b1d81c` 之后取 16 个 commit，压缩为 1 个 commit。
- 旧远程 10 个 commit 被 force push 替换；本地 `backup/pre-flatten-20261102` 保留完整历史。
- 远程 `main` 变为 `f03b79c`；旧 `ccf23e8` 不再在 main 历史中。
- issue #3 记录了 force rewrite，同学需要 `fetch + reset --hard origin/main`。

### 4.2 删除旧 C 模块

- 删除 `native/icon-gen/**`、CMake/Make、`scripts/build-native.mjs`、`scripts/test-native-icons.mjs`、`docs/50`、package scripts、README/HANDOFF/STATUS/docs49 中的 C 引用、`.gitignore` native 目录。
- `build-assets.mjs` 恢复纯 JS `makeIcon()`，npm/Tauri 不再依赖 C 工具链。
- 本轮不引入 world-check / runtime-manifest；C rewrite 留给后续同学任务。

### 4.3 Windows 桌面壳

- `build-real-runtime.ps1`：包内 Node 22、Java 25、Paper、插件、干净世界、engine、bot；带 cache。
- `package-desktop.ps1`：Studio/runtime/NSIS 打包、资源与 hash 校验。
- `verify.ps1`：Windows l0–l3 质量门禁。
- `main.rs`：
  - Win32 进程/窗口检测，单实例；
  - `CREATE_NO_WINDOW` 子进程；
  - `USERPROFILE`/verbatim 路径处理；
  - Paper 优雅 stop + 进程树清理；
  - 窗口几何节流保存；
  - 自动 focus follow 移除，保留 Alt+Z。
- 卡顿修复：不再每 8 秒启动 PowerShell 扫进程，改 Win32/`/proc`。
- QA：Windows gates、headless installed-runtime e2e、GUI 证据。

### 4.4 文档

- `docs/53`：L0/L1/L2 目标流程设计。
- `docs/54`：接手审计、任务拆分、决策、多 Agent 约束。
- `docs/55`：16 commits 扁平化接手审计报告。
- `docs/56`（本文）：当前项目完整总结与 commit 说明。

## 5. 当前验证状态

```text
typecheck PASS
npm test 251/251 PASS
verify.ps1 l0–l3 PASS
runtime 重建 PASS（1154 MB）
NSIS PASS（407.5 MB）
/s 安装 PASS
installed-runtime e2e PASS（42/42）
L01 本轮 attempt1 3 星，未出现 h1 flake
```

安装包：

```text
427,243,370 B
sha256 6D13DE7DF0C5E4F09FFFD5A52A7ACDDCF1B220ED1B0F5258A68B11926D497D7B
```

## 6. 仍未完成/不能假绿的遗留

1. L01 hidden h1 的真实 bot 到达抖动（本轮 e2e 通过不代表根治）。
2. L0 四灯、启动器自动适配、客户端复用/启动、L1 退出确认、L2 客户端丢失恢复。
3. UI：嵌套标题栏、底部空白、窄窗遮挡、默认滚动条、顶栏冗余、RichText/开场文本、教材独立窗、伴玩数据流。
4. 材料/手记/织典合并与知识入口整理。
5. 打包 world 干净化（测试玩家、备份、hash 漂移）。
6. 原生 Linux AppImage/RPM 验证（issue #2）。
7. 状态四灯与 Studio「织机在线」不同步；全屏后还原窗口问题（task-8）。
8. C rewrite 的后续方案（同学负责，本轮不引入）。

## 7. 后续阶段

```text
Phase 1  L0/L1/L2 + 启动器适配
Phase 2  UI P0/P1 修复
Phase 3  状态同步/窗口控制/教材独立窗
Phase 4  L01 h1 修复 + 干净 world 打包
Phase 5  Windows/Linux 全链路复验 + 最终中文 commit
```

每个阶段本地 commit；用户批量审查；通过后 push。

## 8. 为什么当前 commit message 看起来短

`f03b79c` 的提交对象是 16 段历史的压缩结果，为了尽快恢复可审基线，message 只写了摘要。本文件补齐完整说明。  
从本次文档提交开始，后续所有 commit message 采用中文为主，描述“改了什么、为什么、怎么验证、遗留什么”。
