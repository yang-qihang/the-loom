# 45 — 悬浮软件 / Minecraft 光标与焦点方案调研

> 最后更新：2026-10-31
> 结论：在**原版全屏 Minecraft** 里，游戏拿到焦点后会自己捕获并隐藏鼠标；任何外部悬浮窗都无法同时做到「鼠标在整个屏幕自由可见」和「鼠标在游戏里直接控制视角」。要完全达到目标，必须走 **Minecraft 客户端内嵌 UI（mod）**，或者接受「点进游戏后按一次释放键」。

## 同类方案的三种做法

1. **游戏外悬浮窗（ToolScreen 类）**
   - 让 Minecraft 以无边框/窗口化方式运行，外部窗口置顶，用热键切换尺寸/悬浮。
   - 参考：[ToolScreen](https://github.com/jojoe77777/Toolscreen)、[Borderless Fullscreen 指南](https://www.mado-hosting.com/en/minecraft-mods/borderless-fullscreen)。
   - 限制：外部程序无法阻止 Minecraft 在获得焦点时 `GLFW` 捕获鼠标；仍需要 Esc / 热键释放。

2. **游戏内 Web/面板（Web Window、CoScreen、MCEF 类）**
   - 在 Minecraft 客户端进程里渲染网页/UI，游戏自己管理鼠标：打开面板时释放 grab，关闭面板时重新 grab；面板内用游戏自己的 cursor。
   - 参考：[Web Window Mod](https://modrinth.com/mod/webwindowmod)、[CoScreen](https://modrinth.com/mod/coscreen)、[MCEF legacy](https://git.oxmc.me/oxmc/mcef-legacy/src/branch/main/README.md)。
   - 这是唯一能做到「面板内鼠标自由、游戏内鼠标控制」无缝切换的架构；需要 Fabric/Forge 客户端 mod，并针对 26.1.2 适配。

3. **Overlay/直播软件（OBS、Discord、Overwolf 类）**
   - 只负责画面叠加；输入仍由游戏抓取。OBS 在 Minecraft 全屏下也常见「光标不可见/不被捕获」问题。
   - 参考：[Microsoft Q&A: OBS 下 Minecraft 光标问题](https://learn.microsoft.com/es-es/answers/questions/4349574/problema-con-el-cursor-en-minecraft-java-edition-c)。

## 织界当前采用的折中

- 鼠标进入织界窗口 → 织界获得焦点；
- 鼠标离开织界 → **不自动把焦点交给 Minecraft**，避免游戏立刻 grab/隐藏鼠标；
- 玩家要点进 Minecraft 画面时才把焦点/鼠标交给游戏；
- 点进游戏后，`Ctrl+Shift+K` 会先向当前焦点窗口发 Escape（松开游戏鼠标/打开暂停菜单），再拉起织界；
- 顶栏「半屏」把织界固定为左半屏，Minecraft 建议用**无边框窗口化**，不要独占全屏。

## 下一步（若要 100% 目标）

需做 **Minecraft 客户端 mod**：
- 在游戏内渲染织界的代码面板（可复用现有 React/Studio 的 Web 资源，用 MCEF 或游戏内 GUI）；
- 面板获得焦点时主动 `MouseHandler.releaseMouse()`，关闭时 `grabMouse()`；
- 不依赖任何外部 X11/Wayland 焦点技巧。

在 26.1.2 的 Fabric/NeoForge 适配完成前，外部窗口方案只能做到当前折中，不能承诺「全屏自由光标 + 游戏内直接操作」同时成立。
