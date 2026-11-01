# 42 — 玩家怎么玩（真实模式）

> 状态：玩家入口（2026-11-01 Round 2：指令手册/坐标/HUD/REPL/字体）｜负责人：Lead｜最后更新：2026-11-01｜上游：`README.md`、`docs/43-environment-and-bundling.md`、`docs/46-playtest-fix-plan.md`、`docs/48-round2-guidance-api-visual-plan.md`

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

## 3. Studio 里的辅助工具（Round 2 新增）

### 3.1 指令手册：不知道能写什么时先看它

- **入口**：工作台顶栏「指令手册」按钮；教练卡里的「查看指令手册」；试符台里的「手册」。三个入口打开的是同一份手册。
- **怎么关**：右上角 ×，或按 `Esc`。手册是浮层，关掉后代码和世界都不会变。
- **里面有什么**：本关可用的全部指令（按引入关卡排列），每条有「一句话说明 + 可照抄示例 + 从哪一关开始可用」；还有本关的**命名坐标点表**（艾拉、木桶、灯柱…的名字和坐标）。
- **为什么不是背 API**：手册数据与学生可见文档同源（`packages/sdk/src/api-registry.ts`），关卡新增指令会自动出现在手册里；不会出现「手册里有、实际跑不了」或反过来的情况。
- 指令搜索框可输入 `collect`、`木桶`、`报数` 等关键词过滤。

### 3.2 坐标从哪来：三个来源

1. **命名点（推荐）**：关卡把关键位置声明成名字，代码里直接写 `eira`、`barrel`、`perch1`、`lamp1`；不用背数字。手册的「本关命名点」和位置 HUD 都列出这些名字。
2. **位置 HUD**：工作台显示灰崽当前位置 `(x, z)` 与本关关键点坐标；页面在后台时暂停刷新，不会持续闪。
3. **`golem.pos`**：代码里读灰崽当前位置（`[x, y, z]`），配合 `console.log(golem.pos)` 可以在运行日志里看到坐标；也可以在表达式里用。

> 走位方法：`golem.moveTo(eira)` 或 `golem.goTo(eira)`；走到某格旁用命名点，不要用猜的坐标。

### 3.3 试符台（REPL）：在当前关卡里试一句

- 打开试符台时用的是**当前关卡**（不会再跳回第一关）；标题显示当前关卡名，场景/命名点/可用 API 都是这一关的。
- 一行一句，回车执行；`help` 列出本关可用指令，或点「打开指令手册」。
- 试符台不计星、不影响关卡进度；「把现场恢复原样」重置试符台场景。

### 3.4 代码字体与编辑器菜单

- 代码编辑器、运行日志、指令手册里的代码块统一使用嵌包的 **Maple Mono**（含中文回退），开启编程连字（ligature）；不再混用旧像素字体。
- 在编辑器里右键会弹出**不透明底色**的菜单（复制/粘贴/剪切/全选/格式化等），不会出现菜单文字和代码叠在一起看不清的问题。
- 若界面字体仍像旧版：确认启动的是最新安装包；升级后首次启动会替换旧运行时。

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

### 5.1 示例：L02「收蛋 → 倒进木桶 → 回艾拉报数」

L02 的目标是：从 6 个蛋窝收蛋，小筐一次最多装 4 枚，收满先去木桶倒一次，收完回艾拉身边报数。按新 API 可以这样写（点名为本关命名点，具体以本关指令手册为准）：

```ts
// 收第一趟（4 枚）：走到窝边，把蛋收进背包
golem.moveTo(perch1)
golem.collect("egg", perch1)

// 小筐满了：走到木桶边，把蛋倒进木桶（默认倒 1 枚，倒 4 次）
golem.moveTo(barrel)
golem.deposit("egg", barrel, 4)

// 收第二趟，再倒一次
golem.moveTo(perch5)
golem.collect("egg", perch5)
golem.moveTo(barrel)
golem.deposit("egg", barrel)

// 回艾拉身边报数：数字从桶里读，不靠背
golem.moveTo(eira)
const n = world.container(barrel).count("egg")
golem.say("木桶里有 " + n + " 枚蛋")
```

要点：

- **倒蛋** = `golem.deposit("egg", barrel)`，不是「在木桶位置放一个蛋方块」；
- **报数**的数字来自 `world.container(barrel).count("egg")` 或 `golem.count("egg")`，不要抄成固定数字；
- **回艾拉** = `golem.moveTo(eira)`（命名点）；不知道点在哪就开指令手册/看位置 HUD。

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
- **指令手册打不开/关不掉**：检查是否最新安装包；手册关闭用右上角 × 或 `Esc`。
- **打开试符台跳回第一关**：这是旧版问题，当前版本以当前关卡打开；若仍出现请更新安装包。
- **挑战层**：目前是说明卡，尚未开放可玩会话。
- **L03 看不到钟 / 在钟楼附近右键没反应**：钟本体在钟楼结构里，属于已知美术边界；站在钟楼外、手持本关道具对着钟楼右键即可完成节拍（不需要真的对准钟）。L03/L05 的出生点已在 2026-11-01 修正，不再落在钟格/墙边。
- **界面里怎么有英文术语**：`for`、`let`、`Promise.all`、`async/await`、`closure`、`higher-order function`、`interface` 这类计算机术语会保留英文原词（首次出现配中文解释），统一写成「中文名（English term）」；这是刻意的，方便之后查资料和看真实代码。政策见 `docs/20` §3b。
