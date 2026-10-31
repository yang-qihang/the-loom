# spikes/mc-bot-paper — D2 双通道实证 spike（2026-10-31，全部通过）

配套文档：`docs/02-minecraft-stack.md`。本目录是「Day 1 可复现」的最小证据工程。

## 锁定组合（实测通过）

| 组件 | 版本 |
|---|---|
| Paper 服务端 | **26.1.2 build 74**（jar 在 `server/paper.jar`，sha256 `1d70b1da…e5f7`） |
| Java | **25**（本机 `/usr/lib/jvm/java-25-openjdk`） |
| mineflayer | **4.39.0** |
| minecraft-protocol | 1.68.0（mineflayer 依赖） |
| mineflayer-pathfinder | 2.4.5（npm） |
| Paper 插件 API | `io.papermc.paper:paper-api:26.1.2.build.74-stable` |
| Gradle | Wrapper **9.8.2**（`plugin/gradlew`，无需全局 gradle） |
| Java-WebSocket | 1.6.0（`plugin.yml` 的 `libraries:` 运行时下载） |

## 复现步骤

```bash
cd spikes/mc-bot-paper

# 1) 服务端（eula.txt / server.properties 已在 server/ 中配好：offline、flat、creative、view-distance=6）
cd server
(java -Xms1G -Xmx2G -jar paper.jar --nogui > server.log 2>&1 &)
# 等待日志出现 Done (…s)（实测 11.6s；首次会生成世界）
cd ..

# 2) 插件（已构建过可跳过）
cd plugin && ./gradlew build && cp build/libs/*.jar ../server/plugins/ && cd ..
# 重启服务端后再验证插件加载：grep -E "LoomSpike|WS listening" server/server.log

# 3) Spike 1：bot 连接/寻路/挖/放/实体/聊天
node bot.js
# 4) Spike 2：双通道（需插件已加载、WS 8765 可连）
node test2.js
```

预期输出：`bot.js` 末尾 `SPIKE_OK` + `checks {"spawned":true,"moved":true,"dug":true,"placed":true}`；`test2.js` 末尾 `SPIKE_OK` 且 7 个 `CHECK … PASS`（含 `server-truth-sees-bot-block`、`bot-observes-plugin-setblock`、`bot-observes-plugin-entity`、`plugin-to-bot-chat`）。

## 目录说明

| 路径 | 内容 |
|---|---|
| `bot.js` | Spike 1：mineflayer 能力主链路（端口可用 `MC_PORT` 覆盖） |
| `test2.js` | Spike 2：bot + 插件 WS JSON-RPC 双通道端到端 |
| `plugin/` | 最小 Paper 插件（`/loom` 命令 + `ws://127.0.0.1:8765` JSON-RPC + 世界快照） |
| `server/` | Paper 26.1.2 运行目录（`server.log` 是成功日志，`plugins/` 已装插件） |
| `docker-pull.log` | `itzg/minecraft-server:java25` 拉取记录 |

## Docker 跑法（服务端侧实测启动成功）

```bash
docker run -d --name loom-mc --network host \
  -e EULA=TRUE -e TYPE=PAPER -e VERSION=26.1.2 -e PAPER_BUILD=74 \
  -e ONLINE_MODE=false -e ENFORCE_SECURE_PROFILE=false -e MEMORY=2G \
  -v "$PWD/server:/data" itzg/minecraft-server:java25
```

注意：插件 WS 在 `127.0.0.1:8765`，容器内地址对宿主机不可见 → 用 `--network host`（或插件改成可配置 bind + token）。spike 结束后容器已删除，无残留进程。

## 已知坑（实测）

1. `pathfinder.goto(goal)` 不传 timeout 且 `canDig=false` 时，天然地形可能 90s 无进展 → 必须传 timeout 并按地形配置 `Movements`。
2. Paper 新下载 API 是 `fill.papermc.io/v3`，旧 `api.papermc.io/v2` 已 sunset。
3. 26.1 起 Paper API 依赖坐标格式变为 `26.1.2.build.74-stable`（旧 `-R0.1-SNAPSHOT` 不再用于新版本）。
4. 服务端必须 `online-mode=false` + `enforce-secure-profile=false`，否则 offline bot 可能无法 join。
5. 别用 `/reload`；改插件后重启进程（冷启动 11.6–12.3s）。

## L10 双 bot 铺桥 spike（task-17，`bridge-spike.js` + plugin v2）

```bash
# 需要 plugin v2（server/plugins 里的 jar 已含 v2：world.fill/player.teleport/events.drain/
# entity.mannequin/display.* 等 RPC + BlockPlaceEvent actorType 事件流）
cd spikes/mc-bot-paper && node bridge-spike.js
# 结果：bridge-spike-results.json（结构化）、bridge-run.log（完整 stdout）
# 文档：docs/02c-finale-spike.md
```

实测结论（2026-10-31）：路线 A 10/10、0 掉落、0 兜底 teleport 触发，单轮 6.77s；无兜底对照 5/5；路线 B 5/5（fills 750–850ms，可作预录/fallback）；actorType（bot vs player）区分通过；Mannequin 皮肤 + ItemDisplay 动画仅服务端/协议级验证（无 MC 客户端）。
