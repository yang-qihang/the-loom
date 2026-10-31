# 44 — 性能与内存采样（当前桌面运行时）

> 状态：持续观察｜最后更新：2026-10-31
> 目的：记录真实运行时各进程占用、已做的低风险优化，以及下一步优化点；不改变关卡逻辑。

## 采样方法

```bash
bash scripts/profile-runtime.sh 3 2
```

同时看：`curl -s http://127.0.0.1:4317/api/health`，确认 `port=paper`、`mc.connected=true`、`bot.connected=true`。

## 实测（内置运行时，Fedora/KDE Wayland，Xvfb 无关）

| 进程 | 典型 RSS | 备注 |
|---|---:|---|
| Java / Paper | 约 1.0–1.2 GiB | JVM 上限 1536 MiB；启动世界后堆会接近上限 |
| Node / 真实引擎 + mineflayer | 约 200 MiB | 与织偶/关卡数量相关 |
| 桌面壳 (Tauri WebView) | 约 100–250 MiB | Monaco 编辑器占大头 |
| Minecraft 客户端 | 由 Prism/游戏本身决定 | 不在织界控制范围 |

## 已完成优化

1. **修掉 Paper 控制台忙循环**：手动启动时 stdin 继承终端会不断打印 `>`，实测可让 Java 空转约 150% CPU；桌面壳启动内置 Paper 时改为只读/保持管道 stdin，不再刷提示。
2. **Paper 世界参数**：`view-distance=4`、`simulation-distance=4`；JVM `-Xms512M -Xmx1536M -XX:+UseG1GC`。
3. **状态轮询**：连接灯从 4s 改为 8s，减少 WebView 无意义 IPC/进程查询。
4. **日志上限**：工作台日志保留最近 60 行，避免长跑无限增长。
5. **窄窗 UI**：折叠目标/世界说明、移除次要操作行、代码编辑器占首屏，减少 WebView 布局和重绘面积。
6. **焦点跟随**：X11 指针查询 140ms 一次，只做窗口内/外切换；不改游戏逻辑。

## 下一步

- 用 `WEBKIT_INSPECTOR_SERVER` 对窄窗 UI 做一次真实 WebKit 采样，确认 CSS zoom 与 Monaco 的 paint 占比。
- 评估把 Monaco 换为更轻量的 code editor（仅当不牺牲教学错误提示时）。
- 对 Paper 用 spark 采样一次真实会话的 tick 时间，再决定是否继续降 view-distance。
