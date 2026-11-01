# 16 — Foundation 备选：Luanti（原 Minetest）评估与裁决

> 状态：ADR（Rejected for 4-day scope，保留为 v2 选项）｜负责人：Lead｜最后更新：2026-10-31
> 触发：用户提出「用 Luanti 替代 Minecraft Java 会不会更好（接口透明、Lua 简洁）」。
> 结论：**4 天交付维持 Minecraft + TypeScript；Luanti 写入 v2 / 一学期版路线，不进本次 foundation。**
> 历史说明（2026-11-01 文档审计）：本文件是已拒绝的 ADR（Luanti 备选），保留作决策记录；当前基础仍是 Minecraft + TypeScript。
> 上游：BRIEF.md、docs/02-minecraft-stack.md

---

## 1. 先摆事实（2026-10-31 核实）

| 项 | 事实 | 来源 |
|---|---|---|
| 项目状态 | Luanti（原 Minetest）**5.18.0 于 2026-10-29 发布**，活跃维护 | GitHub Releases API |
| 脚本接口 | 服务端 Lua modding API：`core.register_entity`、`formspec` UI、`minetest.after` 调度、`core.safe_file_write`（原子写世界目录文件） | `doc/lua_api.md`（master，12991 行） |
| 无 socket | 服务端 Lua **没有 socket/HTTP 服务 API**（`socket` 0 处；`http` 仅为文档链接/客户端下载）；外部 UI 只能走文件轮询 / ModStorage / C++ 侧 | 同上 |
| 无原生 async | Lua 语言有 coroutine，但引擎未提供跨 tick 的协程调度；mod 惯用 `minetest.after`/globalstep | 同上 |
| 可 headless | 有 `luanti-server` 无头二进制，CI/自动化可行 | Debian manpage |
| 资产/许可 | 引擎开源（LGPL 系）；资产可自制或用 CC 系，**公开发布路径比 Minecraft 干净**（MC 不能分发官方资产、受 EULA 约束） | 项目仓库/许可文本（Day0 可再核） |
| 近似 MC 的 subgame | VoxeLibre / Mineclonia 等存在并维护（内容完整度需按版本核对） | 社区仓库 |
| 已有 AI 相关先例 | `LLM-Connect`：把 Luanti 接到各种 AI 服务的 mod 集合（2026-10 仍活跃，3★） | GitHub |
| 教学价值（原生） | Lua 是真实语言（Roblox、LÖVE、ComputerCraft），且**「写 mod 直接改引擎世界」是极好的语言/系统课** | 判断 |

## 2. 三维对比

| 维度 | A. Minecraft + TS（当前） | B. Luanti + Lua（学生写 Lua） | C. Luanti + TS（保留 TS，写 bridge） |
|---|---|---|---|
| 4 天可交付性 | ✅ M0 已实测 7/7、L10 10/10；风险已退役 | ⚠️ 场景/抽象/文档全重做，约 3 agent-days，吃掉全部余量 | ⚠️ 需 Lua 端 RPC 服务 + 文件/UDP bridge，工程量不小于 Paper+mineflayer |
| 抽象覆盖（A7/A8/A11/A12/A13） | ✅ 静态类型/ADT/接口/async/并发都能「用到」 | ❌ 动态语言：table 模拟记录、tag 模拟 ADT（无编译器穷举）、metatable 讲组合、coroutine/调度器讲并发；typeclass/trait 只能「读到」 | ✅ 保留 TS 抽象弧线 |
| 实体/世界逻辑透明度 | ✅ Paper 插件全权（MobGoals/display/评分真值）；但需双通道 | ✅✅ 单进程单 Lua API，学生代码可直接改写世界（最强项） | ✅ Lua 端同样透明，但 TS 侧隔一层 bridge |
| MC 地道/品牌 | ✅ 真 Minecraft（课程 demo 的核心钩子） | ◐ VoxeLibre/Mineclonia 像 MC 但不是 MC；13 关场景机制要重映射 | ◐ 同左 |
| 版本锁/协议风险 | ⚠️ 必须锁 26.1.2；26.2/26.3 会让 bot 被踢（已实测） | ✅ 无 bot 协议、无版本锁（引擎版本升级通常兼容 mod） | ✅ 同左 |
| 许可/公开发布 | ⚠️ 不能分发 MC 资产；EULA 限制 | ✅ 全开源路径干净 | ✅ 同左 |
| 学生代码执行/验收 | ✅ worker 沙箱 + 服务端真值 | ✅ 可做 `load` 受限环境 + debug hook 指令预算；评分直接读服务器状态（很干净） | ✅ 同现有 |
| UI/编辑器桥接 | ⚠️ 双通道（bot+插件 WS） | ⚠️ 无 socket → 文件轮询/ModStorage（需自建，约 0.5 天） | ⚠️ 同左 + 还要桥到 Node |
| AI 团队交付质量 | ✅ TS/Node/React 是 AI 母语；已写 22 份文档 + 3 个 spike | ❌ Luanti Lua 生态/API 对 AI 是新区；文档与 spec 全要重写 | ◐ 部分 |
| 叙事/教学法资产 | ✅ 已完成（3 Act/10 关/抽象地图/评审） | ❌ 抽象地图与 13 份 spec 的 MC 场景/机制全部重做 | ◐ 抽象可保留、场景重做 |

## 3. 裁决（D35）

**4 天交付维持 A（Minecraft + TypeScript）**。理由按权重：

1. **换 foundation 换不掉「抽象弧线 vs 语言」的核心冲突**。Luanti 的真正优势（透明 API、单进程、无版本锁）只有在「学生写 Lua、代码跑在服务器里」时才完全兑现；而 Lua 会直接砍掉 A7 记录/ADT、A8 变体穷举、A11 interface/trait/typeclass、A12 async/await 这些**你最初愿景的核心**（尤其 Haskell typeclass / Rust trait 的 composition 主题）。保留 TS 则仍需 bridge，优势只剩一半、成本却全付（C 方案）。
2. **我们最大的技术风险已经被实测退役**：M0 双通道 7/7、L10 铺桥 10/10、版本锁、bot 延迟数据都在。现在换是用「已验证」换「未验证」，而 4 天里最贵的是新 spike 风险。
3. **MC 地道与品牌是课程 demo 的核心钩子**：真 Minecraft 对老师/同学的说服力、以及 13 份 spec 里钟/村民/悦灵/酿造/僵尸治疗/advancement 等「真 MC 机制」的叙事，换成 subgame 要全部重映射（≈2–3 agent-days，正好是全部余量）。
4. **AI 交付质量**：团队（AI）对 TS/React/Node 的熟练度远高于 Luanti Lua API；4 天全 AI 项目的第一约束是「模型对栈的熟悉度」。
5. **换 foundation 不能消掉 UI bridge**：Luanti 服务端 Lua 无 socket/HTTP 服务 API，接我们的 Monaco 工作室仍要文件轮询/ModStorage/ C++ 侧；「接口透明」是对 mod 作者而言，对**外部 UI** 不成立。

**成本估计**（若现在切换）：B 方案 ≈ 2.5–3.5 agent-days（抽象重排 + 13 关场景重映射 + 文档重写 + 新 spike）；C 方案 ≈ 1.5–2.5 agent-days + 新 bridge 风险。4 天预算里不可接受。

## 4. Luanti 会赢的条件（写进「什么时候重新考虑」）

1. 课程从 4 天变成 **2 周–1 学期**；
2. 定位改成 **「教 Lua / 游戏 modding / 引擎扩展」**——那 Luanti 是极好的选择（学生写 mod 注册实体/节点/formspec，直接改世界；Lua 是真语言；全开源可发布）；
3. **公开发布/开源**成为硬需求（Luanti 许可路径远干净于 Minecraft）；
4. MC 客户端/演示环境不可用，且不愿用预录；
5. 接受「用 coroutine+调度器、metatable+table」替代「async/await/ADT/interface」的抽象重排。

## 5. 现在就可以从 Luanti 借的一件事（不改 foundation）

**「接口透明」的工程哲学**：把我们的每一个世界操作都做成一等、可枚举、可日志、可回放的 API——这正是 `docs/07` 的 WorldPort + WorldDigest + 事件流；评审/盲测/回放都吃这份「文本真值」。这一点我们已经在做，无需换引擎。

## 6. 如果用户坚持切换：最小行动清单（决策后执行）

1. `docs/02/02b/02c/07` 换成 Luanti 调研与 spike（headless 5.18 + 一个 subgame + Lua mod 学生沙箱 + 文件 bridge + 世界状态 JSON），约 0.5 天；
2. 抽象地图重排为 Lua 版（table/元表/闭包/协程/多实体消息），约 0.5 天；
3. 13 份 spec 场景/机制重映射 + 重跑 14/14b 评审，约 1.5–2 天；
4. 砍掉 A7/A8/A11/A12 的「用到」目标，改为「Codex 读到」；总范围回到約 7 关；
5. **必须在今天内拍板**；否则 4 天预算不成立。

## 7. 来源（2026-10-31 核实）

- Luanti 5.18.0：<https://github.com/luanti-org/luanti/releases>（Releases API 实测 `tag_name=5.18.0`，`published_at=2026-10-29`）
- Lua API：<https://github.com/luanti-org/luanti/blob/master/doc/lua_api.md>（`core.register_entity`、`formspec`、`core.safe_file_write`、`minetest.after`；无 socket）
- 无头服务器：<https://manpages.debian.org/unstable/luanti-server/luantiserver.6.en.html>
- LLM-Connect（AI×Luanti 先例）：<https://github.com/H5N3RG/LLM-Connect>
- 文档站：<https://docs.luanti.org/>（本次 web_fetch 被 DNS 拦截、用 curl 核验了一手 API 文件）
