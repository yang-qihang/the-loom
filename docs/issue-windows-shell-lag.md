# [P0][Windows] Tauri 桌面壳每 8 秒卡顿 2–5 秒（PowerShell 进程扫描导致）

## 环境

- Windows 11 x64
- Tauri 2 / WebView2 156.0.4314.58
- 安装包：`Loomcraft_0.1.0_x64-setup.exe`（Windows NSIS 构建）
- 关联：Windows 桌面打包支持（HEAD `497172d` 及其后修复）

## 现象

桌面壳启动后：

1. 连续点击几下，延迟明显；
2. 约每 8 秒出现一次 1–5 秒卡顿，窗口短暂无响应；
3. 卡顿后恢复，再点又卡；
4. 没有浏览器地址栏/外置浏览器，Paper/engine/Studio 自身无崩溃。

## 复现

```powershell
Start-Process "$env:LOCALAPPDATA\Loomcraft\loomcraft-desktop.exe"
# 连续点击「设置」/「完成」或地图墙按钮，记录每次响应时间
```

## 根因

`apps/desktop/shell/shell.js` 每 8 秒调用：

```js
setInterval(refreshStatus, 8000);
```

`refreshStatus` 调用 Tauri 命令 `client_running`。旧 Windows 实现同步启动：

```rust
Command::new("powershell")
  .args(["-NoProfile", "-Command",
    "(Get-CimInstance Win32_Process ... net.minecraft.client.main.Main ...).Count"])
  .output()
```

实测 PowerShell 冷启动 **553–721ms**；同步命令阻塞 WebView IPC/主线程，且 GUI 启动 PowerShell 未设置 `CREATE_NO_WINDOW`，每 8 秒产生控制台窗口/焦点干扰。

修复前 UIA 点击延迟样本：

```text
2028, 3840, 2080, 3431, 2090, 2073, 5331, 8, 8, 10, 11, 2227 ms
max 5331ms, avg 1761ms
```

## 修复（已实现，待最终包复验）

1. Windows `client_running` 改为 `EnumWindows` 查 Minecraft 窗口；Linux 改为直接读 `/proc/*/cmdline`，不再 spawn 进程；
2. 所有后台子进程加 `CREATE_NO_WINDOW`（Paper/engine/taskkill/Prism cmd/probe）；
3. `save_window_geometry` 节流提前到窗口 API 前，关闭时强制保存；
4. 自动 pointer focus-follow 继续按 docs/45 禁用，仅保留 Alt+Z 显式切换。

修复后同机同操作：

```text
UIA invoke：169, 74, 42, 68, 72, 55, 41, 60, 53, 58 ms
max 169ms, avg 69ms
App 子进程 powershell=0
```

## 待完成

- 重新构建/静默安装 NSIS 后复测；
- Windows 11 不同 DPI（100/125/150/200%）和干净 profile；
- 长时教材/Monaco/滚动使用 30 分钟性能；
- 增加 Windows perf smoke：60 秒内无 PowerShell 子进程、UIA p95 < 300ms、无控制台窗口、退出无残留。

## 证据

- `docs/52-windows-shell-lag-investigation.md`
- `evidence/desktop-win/perf-lag-fix.json`
- `apps/desktop/EVIDENCE-WIN.md`
