# 42 — 玩家怎么玩（真实模式）

> 最后更新：2026-10-31

## 1. 你需要的

- Linux + 能运行 Minecraft Java 的显卡/桌面。
- **Minecraft Java 26.1.2**，推荐 Prism Launcher（Flatpak 也可）。
- 一个正版/可登录的 Minecraft 账号。
- Java 25：Prism 的 Microsoft runtime 即可（26.1.2 需要 Java 25）。
- 本仓库的真实引擎 + Paper 服务端；当前由仓库脚本启动。

## 2. 启动真实世界

```bash
cd /home/yqh0919/Documents/deepseek-harness/default-workspace
bash scripts/mc-up.sh
```

等 `mc: ready`。

另开终端：

```bash
cd /home/yqh0919/Documents/deepseek-harness/default-workspace
PORT=4320 LOOM_WORLD=paper npm run dev:engine:paper
```

等：

```text
LOOM engine ready: http://127.0.0.1:4320 (port=4320, world=paper)
```

## 3. 启动桌面/Studio

桌面包路径：

```text
apps/desktop/src-tauri/target/release/bundle/appimage/Loomcraft_0.1.0_amd64.AppImage
```

打开向导，填真实引擎地址 `http://127.0.0.1:4320` → 保存 → 进入工坊。  
顶部四个连接灯能直接看状态：**织机 / Paper / 织偶 / 客户端**。

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

- Minecraft 用窗口模式，不要独占全屏；
- 客户端选项 `pauseOnLostFocus:false`（仓库 baseline 已设置），切到 Studio 时世界继续；
- Studio 点「伴玩」进入 420×620 小窗，置顶后和 Minecraft 并排；
- 伴玩与工作台共享当前会话，会显示三句开场/目标/织偶，不再另开一个 L01 假会话；
- 「返回工作台」会先恢复窗口尺寸，不会把工作台塞进小窗。

## 7. 常见问题

- **Minecraft 看不见**：检查 `DISPLAY` 是否 `:99`；用 `DISPLAY=:0 flatpak run org.prismlauncher.PrismLauncher` 重启 Prism，不要用 `env -u DISPLAY`。
- **点了 Studio 游戏暂停**：客户端设置 `pauseOnLostFocus:false`；跑 `bash scripts/mc-client-baseline.sh`，重启 Minecraft。
- **连接灯是橙/红**：织机/Paper/织偶对应后台没起来；看我给的终端输出。
- **挑战层**：目前是说明卡，尚未开放可玩会话。
