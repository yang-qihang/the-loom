# 52 — Windows 桌面壳周期性卡顿问题（P0 问题总结）

> 状态：已定位、已修复、待最终安装包复验
> 发现日期：2026-11-02
> 平台：Windows 11 x64 / WebView2 156.0.4314.58 / Tauri 2
> 关联 commit：`497172d`（Windows 桌面壳）→ `2c7b635`（证据）；修复 commit 见后续
> 复现命令：启动 `%LOCALAPPDATA%\Loomcraft\loomcraft-desktop.exe`，连续点击「设置/完成」或地图墙按钮

## 1. 现象

- 桌面壳启动后，点击几下就出现明显延迟；
- 每隔约 8 秒出现一次长卡顿（体感 1–5 秒），期间窗口几乎不响应；
- 卡顿后有时短暂恢复，再点击又卡；
- 引擎、Paper、Studio 本身没有崩溃；无浏览器窗口，Tauri 壳进程仍在。

不是“电脑性能不够”：同一台机器上 Paper/engine 正常，浏览器 Studio 也正常。

## 2. 根因（按影响排序）

### P0-1：每 8 秒同步启动 PowerShell 扫描进程

`apps/desktop/shell/shell.js`：

```js
setInterval(refreshStatus, 8000);
```

`refreshStatus()` 每次都会 `invoke("client_running")`。旧 Windows 实现（`apps/desktop/src-tauri/src/main.rs`）：

```rust
Command::new("powershell")
  .args(["-NoProfile", "-Command",
    "(Get-CimInstance Win32_Process ... net.minecraft.client.main.Main ...).Count"])
  .output()
```

问题：

1. PowerShell 冷启动 + CIM 查询实测 **553–721ms**；
2. 同步 Tauri 命令在 IPC/主线程路径上执行，期间 WebView 输入消息被阻塞；
3. 每 8 秒执行一次，造成周期性“点击几秒没反应”；
4. 由 GUI 进程创建 PowerShell 未加 `CREATE_NO_WINDOW`，会创建控制台窗口，产生闪窗/焦点干扰。

**实测（修复前）**：

```text
PowerShell 冷启动：721ms / 553ms / 561ms
UIA 点击 invoke 延迟：2028, 3840, 2080, 3431, 2090, 2073, 5331, 8, 8, 10, 11, 2227 ms
最大：5331ms；平均：1761ms
App 子进程抽样：每 8s 出现 1–2 个 powershell.exe
```

### P0-2：所有 Windows 后台子进程缺 `CREATE_NO_WINDOW`

Paper、engine、taskkill、Prism 的 `cmd` 等由 GUI 壳启动时没有创建标志：

- 可能弹控制台黑窗；
- 控制台窗口短暂激活会干扰鼠标/焦点；
- 与 P0-1 叠加，表现为“点几下就被抢一下”。

### P1：窗口移动/缩放事件里同步存盘

`save_window_geometry` 在每次 `Moved`/`Resized` 都调用窗口 API、加锁、写 settings；虽然已有 800ms 节流，但节流在窗口 API 之后，拖动/改变窗口尺寸仍可能造成 UI 抖动。

## 3. 修复

### 3.1 去掉每 8 秒 PowerShell

- Windows：用 `EnumWindows` 查找可见的 Minecraft 窗口，`client_running` 不再启动任何进程；
- Linux：直接读 `/proc/*/cmdline`，不 spawn `pgrep`；
- `refreshStatus` 保持 8 秒节流，但现在是纯内存/轻量 API。

### 3.2 所有后台子进程 `CREATE_NO_WINDOW`

新增 `no_console(&mut Command)`，对所有后台启动点设置：

```rust
creation_flags(0x0800_0000) // CREATE_NO_WINDOW
```

覆盖 Paper、engine、taskkill、Prism cmd、probe 的 `run_capture`。

### 3.3 窗口几何保存优化

- 节流判断提前到窗口 API 之前；
- 普通 `Moved`/`Resized` 只保存节流后的几何；
- 关闭时 `force=true` 保存最终几何，不丢位置。

### 3.4 保留行为

- Alt+Z 显式焦点切换保留（Win32 `SetForegroundWindow` + `AttachThreadInput`）；
- 自动 pointer focus-follow 仍按 docs/45 禁用；
- 伴玩/置顶/重启记忆行为不变。

## 4. 修复后实测

最终安装包（lag 修复后重建）：

```text
Loomcraft_0.1.0_x64-setup.exe
427,231,249 B
sha256 CF5DBD83...DF2473
安装 exe 39,937,536 B
```

同一台机器、同一安装版本、同一 UIA 操作（20 次「设置/完成」切换）：

```text
UIA invoke 延迟：266, 30, 51, 19, 136, 71, 43, 29, 70, 71, 24, 30, 27, 45, 21, 172, 27, 125, 44, 44 ms
最大：266ms；平均：67ms
App 的 PowerShell 子进程：0
java/node 控制台窗口：0
正常关闭：lifecycle 出现 engine/paper 停止；端口释放；desktop.lock 删除
```

结论：**周期性 2–5 秒卡顿消失**，点击延迟回到几十到两百毫秒级；无控制台闪窗。

### Linux 基线影响

Windows 改动均按平台 cfg 门控，Linux 侧保留原路径：

- `client_running` Linux 用 `/proc` 读进程，不再 spawn pgrep；
- `no_console` 在 Linux 是 no-op；
- `win_focus` 仍为 `#[cfg(windows)]`；
- Linux 打包脚本 `package-desktop.sh` / `build-real-runtime.sh` 未改动；
- WSL Ubuntu 上已跑 `cargo check`（webkit2gtk 2.52.6 / rustc 1.93.1）通过（仅 3 个原有 dead_code warning），但 WSL 不是原生 Linux，最终 Linux AppImage/RPM 仍需同学在原生 Fedora 复验。

## 5. 后续验证计划

1. 用 HEAD + 修复重新构建 NSIS；
2. `/S` 静默安装后，按同一 UIA 脚本复测 30 次点击，记录 p50/p95/max；
3. GUI 回归：向导、地图墙、工作台、伴玩、Alt+Z、单实例、退出清理；
4. 长时使用：教材浮层/Monaco/滚动 30 分钟，检查 WebView2 CPU 和内存；
5. 增加 Windows perf smoke 门禁：
   - 启动后 60 秒内 PowerShell 子进程 = 0；
   - UIA/invoke 延迟 p95 < 300ms；
   - 无控制台窗口；
   - 退出后 25565/4317 释放、无残留。
6. 如果仍出现内存/渲染卡顿，再单独 profile：
   - WebView2 GPU/软件渲染；
   - iframe `style.zoom = 0.8` 的 repaint 成本；
   - textbook/Monaco 的 React 渲染量。

## 6. 是否提 GitHub Issue

是，建议提 **P0 Windows desktop shell periodic freeze**，正文见 `docs/issue-windows-shell-lag.md`。包含：

- 影响版本/commit；
- 复现步骤；
- 修复前后数据；
- 已修内容；
- 仍需的回归验证（尤其干净机器/不同 DPI）。
