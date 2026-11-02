# Windows 桌面壳验收证据（HEAD 497172d + 本轮修复）

> 平台：Windows 11 x64 / WebView2 156.0.4314.58
> 产物：NSIS `Loomcraft_0.1.0_x64-setup.exe`，407.4 MiB，sha256 `C823062DFDB5FCFC11C5F8D88DD20F2A82575C8EDDC09760092D76350CD569BD`
> Tauri release exe：`loomcraft-desktop.exe`，39.9 MB
> 安装：`/S` 静默安装 exit=0；安装目录 `%LOCALAPPDATA%\Loomcraft`；HKCU 卸载键存在
> 本轮 GUI 验收在桌面一执行；未切换虚拟桌面，未使用自动焦点跟随（按 docs/45 决策禁用）

## 1. 启动与无浏览器窗口

- 启动安装版 Tauri 桌面壳（不是浏览器），窗口标题「织界」，主窗口可见、Responding=True。
- 关闭前无浏览器地址栏；WebView2 只作为 Tauri 内嵌运行时，不存在外部浏览器页面。
- 启动截图：`evidence/desktop-win/01-wizard.png`（首启向导）。

## 2. 首启向导（中文）

- 向导四灯显示：运行环境（包内 Java 25）就绪；织机运行时（包内 Node v22.23.4）就绪；世界服务端（包内 Java + Paper）自动启动；《我的世界》客户端未检测到 Prism（本机未装 Prism，属环境缺失而非壳故障）。
- 截图：`evidence/desktop-win/01-wizard.png`。

## 3. Studio / 地图墙 / 工作台 / 伴玩

- 进入工坊后 Studio 地图墙、第一幕关卡、配套教材浮层均正常渲染。
- 截图：
  - `evidence/desktop-win/02-workbench.png`（工作台 + 教材浮层，同时说明 Studio iframe 正常）
  - `evidence/desktop-win/03-map.png`（关卡墙 + 织机在线）
  - `evidence/desktop-win/05-workbench.png`（工作台）
  - `evidence/desktop-win/04-companion.png`（伴玩模式，窗口变为窄布局）
- 置顶按钮切换后 `~/.loomcraft/settings.json` 记录 `alwaysOnTop`；伴玩模式窗口尺寸按 DPI 缩放为约 652×943 物理像素（逻辑 420×620）。

## 4. 包内 runtime

- 安装包内 `runtime/real`：1,198.8 MB；含 Node v22.23.4、Java 25.0.5、Paper 26.1.2-74、LoomCraft 插件、干净世界、真实 engine、mineflayer 织偶。
- `paper/cache/mojang_26.1.2.jar` 60,417,480 B 已打入包内；干净 profile 首启未尝试联网下载 Paper。
- 启动日志：`evidence/desktop-win/logs/lifecycle.log`、`paper.log`、`engine.log`；健康检查 `/api/health` ok=true，Paper MC 在线、Golem 在线。
- 包内 runtime 与 `apps/desktop/src-tauri/target/release/runtime/real` 关键文件 sha256 一致。

## 5. Alt+Z 焦点切换（Windows Win32）

- 未采用自动焦点跟随（遵循 docs/45：全屏 Minecraft 下不可靠，且会抢用户焦点）。
- 显式 Alt+Z 测试（前台窗口标题序列）：
  1. 起始前台：`Minecraft 26.1.2`
  2. 按 Alt+Z：`织界`
  3. 再按 Alt+Z：`Minecraft 26.1.2`
- JSON 证据：`evidence/desktop-win/altz-focus.json`；快捷键注册日志：`~/.loomcraft/logs/shortcut.log`（HEAD 之后，Alt+Z + Ctrl+Shift+L）。
- 实现：Win32 `EnumWindows` + `GetForegroundWindow` + `SetForegroundWindow` + `AttachThreadInput`；Escape 释放游戏鼠标。

## 6. 单实例

- App 运行中再次启动安装版 exe：第二个进程 3 秒内退出，`loomcraft-desktop.exe` 进程数保持 1，未产生第二个 Paper/engine。
- 证据：`evidence/desktop-win/altz-focus.json` 的 `singleInstance`（before=1/secondPidExited=true/after=1）。

## 7. 退出清理（clean close）

- 通过窗口 `WM_CLOSE` 正常关闭；关闭后：
  - App 进程退出；
  - lifecycle 出现「停止子进程 engine」「停止子进程 paper」两行；
  - Paper 日志出现 `Stopping server` / `All chunks are saved` / `All dimensions are saved`（优雅落盘，不是强杀）；
  - 25565 / 4317 端口释放；
  - `~/.loomcraft/desktop.lock` 已删除；
  - Minecraft 客户端进程未被误杀。
- 证据：`evidence/desktop-win/logs/lifecycle.log`、`paper.log`；原始 `~/.loomcraft/logs/*` 保留。

## 8. 未覆盖/已知限制

- 本机未安装 Prism Launcher，因此「自动拉起 Minecraft 客户端」只验证到 Prism 缺失提示；MC 客户端由验证脚本手动启动，Alt+Z 窗口切换正常。
- L01 真机 e2e 的 hidden h1 存在既有采样抖动（真实 bot GoalNear 落点 2.83 格，h1 要求 ≤2）；已在 `tmp/audit/l01-e2e-audit.md` 定为**真实可修产品缺陷**，本轮未改断言、未掩盖，验证报告标为 tracked FAIL，需下一轮修 bot 到达判定并做 L01–L10 串行真机回归。
- 本报告只覆盖 Windows 桌面壳；AppImage/RPM 仍由 Linux 构建验证。
