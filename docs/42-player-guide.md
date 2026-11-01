# 42 — 玩家怎么玩（真实模式）

> 状态：玩家入口｜负责人：Lead｜最后更新：2026-11-01｜上游：`README.md`、`docs/43-environment-and-bundling.md`、`docs/46-playtest-fix-plan.md`

## 1. 你需要的

- Linux + 能运行 Minecraft Java 的显卡/桌面。
- **Minecraft Java 26.1.2**，推荐 Prism Launcher（Flatpak 也可）。
- 一个正版/可登录的 Minecraft 账号。
- Java 25：Prism 的 Microsoft runtime 即可（26.1.2 需要 Java 25）。
- 桌面安装包：已内置真实引擎 + Paper 服务端；源码开发时用 `bash scripts/mc-up.sh` + `npm run dev:engine:paper`（见 README）。

## 2. 启动游戏

双击/运行：

```text
apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft-x86_64.AppImage
```

或 Fedora 安装 RPM。应用会自动启动包内 Paper 与真实引擎；顶部四个连接灯显示 **织机 / Paper / 织偶 / 客户端**。不需要终端，也不需要外部引擎。

首次启动（或世界布局升级后）会自动把旧的 `~/.loomcraft/runtime/paper/world` 换成包内干净世界：这不会丢关卡进度或星级（它们存在 Studio，不在世界里）。

## 4. 启动 Minecraft

Prism → Village Development → 启动。  
多人游戏 → 直连 `localhost:25565`。

如果 Minecraft 窗口不可见，检查它是否被放到了 `:99`：
```bash
PID=$(pgrep -n -f 'net.minecraft.client.main.Main')
tr '\0' '\n' < /proc/$PID/environ | grep DISPLAY
```
必须是 `DISPLAY=:0`（或者正常 Wayland 会话），不能是 `:99`。

## 5. 玩法节奏

1. Studio 里读开场和目标；
2. 写代码，按回车/「运行」；
3. 灰崽在世界里执行；
4. 出现「轮到你」时，按 `Esc` 释放 Minecraft 鼠标，完成织者之印；
5. 回 Studio 点确认，看结算/星级；
6. 进入下一关。

## 6. 同时看两者

- **按 Alt+Z 在「织界」和「我的世界」窗口之间来回切换**（全局快捷键，不用 Alt+Tab；游戏失焦不会暂停）。
- Minecraft 用窗口模式，不要独占全屏；
- 客户端选项 `pauseOnLostFocus:false`（仓库 baseline 已设置），切到 Studio 时世界继续；
- Studio 点「伴玩」进入 420×620 小窗，置顶后和 Minecraft 并排；
- 伴玩与工作台共享当前会话，会显示三句开场/目标/织偶，不再另开一个 L01 假会话；
- 「返回工作台」会先恢复窗口尺寸，不会把工作台塞进小窗。

## 6.5 第 4 盏灯（L01）怎么放

第 4 盏灯在一根石柱顶上，但**你不需要看见柱顶**：

1. 走到村道尽头、灯柱前面（站在地面上就行，不用爬高）；
2. 按 `E` 打开物品栏，把「灯笼」拖到快捷栏，按对应数字键拿在手里；
3. 准星大致对着灯柱，按鼠标右键——系统会把灯笼挂到柱顶正确的位置；
4. 看到灯亮后切回 Studio，按「我已在游戏里点亮」。

提示：只有前面 1、2、3 号灯都亮了（灰崽跑完程序）才会轮到你；在此之前右键灯柱会被拦下并提示「先让灰崽完成它那部分」。如果弄乱了世界，按「重置本关」会把方块、你的位置和背包一起恢复到这一关开始时的样子。

## 7. 常见问题

- **Minecraft 看不见**：检查 `DISPLAY` 是否 `:99`；用 `DISPLAY=:0 flatpak run org.prismlauncher.PrismLauncher` 重启 Prism，不要用 `env -u DISPLAY`。
- **点了 Studio 游戏暂停**：客户端设置 `pauseOnLostFocus:false`；跑 `bash scripts/mc-client-baseline.sh`，重启 Minecraft。
- **连接灯是橙/红**：织机/Paper/织偶对应后台没起来；看 `~/.loomcraft/logs/` 或 `bash scripts/launch-desktop.sh` 的终端输出。
- **升级后世界变干净了/旧场景没了**：正常，见上文「首次启动」；进度/星级在 Studio 里。
- **挑战层**：目前是说明卡，尚未开放可玩会话。
- **L03 一开始被关在钟楼里 / L02 蛋糕看不到落块**：已知体验问题（等待内容/引擎线修复，见 `evidence/playtest-fix/report.md` §4）；可先在 Studio 点「重置本关」。
