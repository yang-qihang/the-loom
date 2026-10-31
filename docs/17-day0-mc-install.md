# 17 — Day-0：Minecraft Java 客户端安装 Runbook（Fedora 44 KDE）

> 状态：v1｜负责人：Lead｜最后更新：2026-10-31
> 用途：CP0/Day-0 装好可进我们本地 Paper 服务端的 Minecraft 客户端。
> 关键结论：**版本必须锁 `26.1.2`**；不要用 `1.21.x`（旧），也不要用 `26.3`（最新正式版，但我们锁的 mineflayer 不支持，且客户端/服务端必须同版本）。

---

## 0. 版本事实（2026-10-31 核实，见 docs/02）

| 组件 | 锁定版本 | 说明 |
|---|---|---|
| Minecraft Java 客户端 | **26.1.2** | 与服务端同版本；Prism 里选 Vanilla 26.1.2 |
| Paper 服务端 | **26.1.2 build 74** | 我们脚本下载，Java 25 |
| Java（服务端） | **25** | 本机已装 openjdk 25.0.4.1 |
| Java（客户端） | Mojang 自动下载 | Prism 的 Auto-download Mojang Java 即可，不需要手动配 |
| Mineflayer（织偶） | 4.39.0 | 只支持到 MC 26.1；26.2/26.3 会 join 1.5s 被踢（issue #4189） |

> 「分版本吗？」——**分**。Minecraft Java 的客户端/服务端协议按版本匹配：用错版本会出现 “Incompatible client!” / “Outdated client” / “Outdated server”。本项目的版本是**刻意锁死**的，不是随便选的。

## 1. 购买（你愿意买正版，很好）

1. 官方商店购买 **Minecraft: Java & Bedrock Edition**（Java 版包含在内）：<https://www.minecraft.net/store>（或从 <https://www.minecraft.net/download> 入口）。
2. 用 **Microsoft 账号**登录购买；购买后用同一 Microsoft 账号在 Prism 里登录。
3. **不要买成「网易版/中国版」**：那是独立客户端与服务器生态，不能连国际版（我们）的服务器，也不支持 Prism/微软登录。
4. 若你有 **PC Game Pass**，它通常包含 Minecraft Java & Bedrock（以官方页面为准），可先确认再买。
5. 价格/支付方式以官方商店结算页为准；课程内部演示服是离线模式（为了织偶 bot 能连），所以**本地演示不校验账号**，但正版购买仍是合法使用与后续联机/皮肤的前提。

## 2. 安装 Prism Launcher（Fedora 44 KDE，Flatpak）

```bash
# 1) 加 Flathub（已加过可跳过）
flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo

# 2) 安装 Prism
flatpak install --user flathub org.prismlauncher.PrismLauncher

# 3) 启动
flatpak run org.prismlauncher.PrismLauncher
```

> 路径没问题；KDE 下从应用菜单启动也可。后续升级：`flatpak update --user org.prismlauncher.PrismLauncher`（Prism 版本太旧会看不到 26.1.2，见 §5）。

## 3. 登录与 Java 设置

1. Prism → **Accounts → Add Microsoft Account**，浏览器登录购买过 MC 的 Microsoft 账号。
2. **Settings → Java**：勾选 **Autodetect Java version** 与 **Auto-download Mojang Java**（客户端用 Mojang 自带运行时，不要手动指到系统 Java 25；系统 Java 25 是给 Paper 服务端用的）。
3. **Settings → Minecraft**：可把「Show game log / Keep launcher open」打开，方便排错。

## 4. 创建实例（关键：版本 26.1.2）

1. **Add Instance → Vanilla → 版本列表里选 `26.1.2`**（不是 1.21.4，也不是 26.3）。
2. 名字建议：`Village Development`（与 docs/09 Day0 一致）。
3. **Settings → Java → Memory**：建议 `-Xmx3G`（本机 14GB 内存，服务端 ~2G + 客户端 2–3G + Studio/浏览器，够用但别同时开太多）。
4. 启动一次，确认能进单人世界（首次会下载资源与 Java 运行时）。

> 如果你在 Prism 版本列表里**看不到 26.1.2**：先 `flatpak update --user org.prismlauncher.PrismLauncher`，再在 Add Instance 里刷新版本列表（Prism 从 Mojang 版本清单拉取）。仍没有则检查网络/DNS 是否能访问 `piston-meta.mojang.com`。

## 5. 进我们的本地服务器（演示日流程）

```bash
# 服务端由项目脚本启动（T1 会落地 scripts/mc-up.sh；当前 spike 版在 spikes/mc-bot-paper/server）
# 起好后：MC 客户端 → 多人游戏 → 添加服务器 → 地址：localhost:25565
```

验证清单：
- [ ] 客户端主菜单/F3 显示的版本是 **26.1.2**；
- [ ] 能连上 `localhost:25565`，出生在测试世界；
- [ ] 服务端日志 `Done (…)`，无 “Outdated client/server”；
- [ ] 能看见织偶（Mineflayer bot 连接后出现在玩家列表）；
- [ ] 画面流畅（Intel/AMD 核显/独显均可；NVIDIA 需装 RPM Fusion 驱动，见 §6）。

## 6. 常见坑

| 现象 | 原因 | 处理 |
|---|---|---|
| “Incompatible client! Please use 26.1.2” | 客户端版本不对（最多见：用了 1.21.4 或 26.3） | 在 Prism 里编辑实例 → Version → 选 26.1.2；或新建实例 |
| “Outdated client / server” | 同上，客户端与服务端不一致 | 统一到 26.1.2 |
| Prism 版本列表没有 26.1.2 | Prism/Flatpak 太旧或拿不到 Mojang 清单 | `flatpak update`；检查网络/DNS；看 Prism 里 Refresh version list |
| 启动黑屏/崩溃 | GPU 驱动/Wayland | Fedora KDE 下先试 X11 会话；Intel/AMD 用 Mesa 应正常；NVIDIA 装 RPM Fusion `akmod-nvidia` 后重启 |
| 内存不足/卡顿 | 客户端+服务端+浏览器同机 | 客户端 Xmx3G、服务端 2G、关掉多余标签页/应用；演示机推荐 16GB |
| 离线模式没有皮肤 | 服务端 `online-mode=false`（为织偶 bot） | 正常现象；织偶皮肤由插件注入；玩家皮肤不影响验收 |
| 进服被踢 “Invalid session” | 用了错误的账号/服务器开了 online-mode | 我们开发服是 offline-mode；确认 `server.properties: online-mode=false` |

## 7. 与项目其他部分的接口

- 版本锁：`docs/02` §1、`docs/07` §10、`docs/11` D8/D2；**不要升级客户端/服务端**。
- Day-0 检查清单：`docs/09` §9（本文件是其详细版）。
- 服务端下载/启动：`docs/02` §5 与 `docs/02b` §4 的 Day-1 Runbook（Fill API + sha256 + Paper 26.1.2 build 74）。
- 演示形态：MC 客户端窗口 + 浏览器 Studio 并排（`docs/10` demo 脚本）。
