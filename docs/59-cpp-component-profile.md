# 49 · C/C++ 重写候选构件 Profile（2026-11-02）

> 状态：选型依据（实测数据）｜负责人：Lead｜最后更新：2026-11-02｜上游：用户课程要求（项目需含 C/C++ 元素，优先性能关键构件）、`docs/48-round2-guidance-api-visual-plan.md`
>
> 方法：真实 Paper 26.1.2 + 最终插件/内容，Node 22.23；快照取 `evidence/l*-real-snapshot-*.json`（真实 e2e 产物）；C++ 原型在 `native/profile/`（可复现基准，不参与构建）。所有数字为本机单次测量（可复跑），不是估算。

## 1. 结论先行

**没有任何构件在 C++ 重写后能带来显著的端到端（整局游戏）提速**：游戏时间由 **Minecraft tick（每个 RPC 固定 ~50ms）、织偶移动（9 步 ≈ 1.95s）和网络** 主导，CPU 计算只占很小比例。

如果课程必须选一个「性能关键构件」做 C/C++ 重写，按**构件级收益**排序：

1. **寻路规划核心（mineflayer-pathfinder 的 A\*）**：单次规划 12–43ms，是唯一 CPU 密集的 JS 算法；C++ 同网格 A\* 实测 **7.6×**（2.529ms → 0.334ms），预期规划降到 ~1.6–5.6ms；端到端只省约 **0.3–2%**，但能消除每次 moveTo 的 40ms 事件循环卡顿。
2. **快照二进制编解码（HUD 数据通道）**：HUD 每秒 45–212KB 快照；gzip 12×、brotli 25×（不需要 C++），C++/WASM 编解码可把带宽降到 1/5–1/10、客户端解析快 2–4×；CPU 收益小，**带宽/延迟收益可量化**，集成风险中等。
3. **WorldDigest（规范化 + SHA-256）**：JS 2.43ms/次（212KB、5352 方块），C++ 原型从原始 JSON 到 digest 1.32ms（**2.4×**，digest 与 JS 逐字节一致）；每次 run 约 2 次 → 省 ~2ms，端到端 **<0.1%**，只适合「正确性/确定性」叙事。
4. **插件侧 checkpoint/reset/哈希**：Java 实测 8–22ms（2000–5500 方块），JNI 重写没有意义。

**推荐**：若课程看重「算法 + 性能关键」，选 **1（寻路 A\* C++ 内核）**，但必须保留 JS pathfinder 作为 fallback、只替换规划器并做路径等价测试；若追求低风险、可演示带宽收益，选 **2（快照二进制编解码）**；若只需要一个低风险 C/C++ 组件满足课程，选 **3（digest addon）** 并如实说明其性能收益很小。

## 2. 实测数据

### 2.1 快照规模与处理成本（真实 Paper 快照）

| 关卡 | 方块数 | 事件数 | JSON 大小 | 证据 |
|---|---|---|---|---|
| L03（最大） | 5352 | 40 | 212.4KB | `l3-real-snapshot-2026-11-01T05-42-59-535Z.json` |
| L05 | 3286 | 350 | 188–190KB | `l5-real-snapshot-*.json` |
| L09 | 2245 | 70 | ~76KB（实时 RPC 采样） | 本次 benchmark |
| L06 | 1768 | 636 | 175.6KB（e2e 证据）/ 59.9KB（reset 后实时采样） | `l6-real-snapshot-*.json` |
| L01 | 1358 | 0（reset 后） | 45.6KB | 本次 benchmark |

JS 操作单次耗时（212KB 快照，n=200）：

| 操作 | 耗时 |
|---|---|
| `JSON.parse(raw)` | 0.725ms |
| `JSON.stringify(obj)` | 0.975ms |
| canonical stringify（key 排序） | 2.168ms |
| SHA-256(canonical) | 0.263ms |
| **WorldDigest 合计（已有对象）** | **2.32ms** |
| **原始 JSON → canonical → digest** | **3.16ms** |

压缩（212.4KB 快照）：gzip **17.4KB（12.2×）**，brotli **8.3KB（25.6×）**。

### 2.2 插件 RPC 固定 tick 成本（关键发现）

真实 Paper 上所有 RPC 往返都约 **49–50ms**（20 TPS = 50ms/ tick）：

| RPC | 平均 | 最小 | 最大 |
|---|---|---|---|
| `health` | 49.19ms | 42.39ms | 50.13ms |
| `world.snapshot`（无效 session，仅测调度） | 49.95ms | 49.59ms | 50.05ms |
| `world.blocks`（1 格） | 49.99ms | 49.89ms | 50.03ms |

→ 快照/方块查询的延迟是 **tick 同步等待**，不是序列化 CPU；C++ 重写插件侧代码不会改变这个 ~50ms 下限。

### 2.3 prepare / reset / HUD 快照（真实 Paper）

| 关卡 | prepare | snapshot RPC 平均 | 快照 payload | reset（ms） | checkpoint 大小 / 恢复方块 |
|---|---|---|---|---|---|
| L01 | 994ms | 49.63ms | 45.6KB | 22 / 9ms | 3130 / 0 |
| L05 | 1753ms | 49.84ms | 107KB | 18 / 12ms | 4457 / 0 |
| L06 | 1751ms | 49.82ms | 59.9KB | 10 / 8ms | 2053 / 0 |
| L09 | 1702ms | 49.55ms | 76.1KB | 18 / 17ms | 5541 / 0 |

- prepare 1.0–1.8s：受 ~20–35 次 RPC × 50ms tick 下限 + bot 移动支配；C++ 无收益。
- reset 8–22ms（含几千方块 checkpoint 还原），Java 已足够快；C++/JNI 无收益。
- 评分 `grade()`：0.03–0.23ms/次（真实快照）——无需优化。

### 2.4 寻路（真实 Paper L06/L09，准备后的 bot）

| 场景 | 规划耗时 | 结果 | 路径步数 |
|---|---|---|---|
| L06 → (0,65,12) | 28.79ms | success | 14 |
| L06 → (0,65,0) | 42.27ms | partial | 20 |
| L06 → (0,65,6) | 42.76ms | partial | 18 |
| L06 → (20,65,0) | 40.17ms | partial | 20 |
| L09 → (0,65,14) | 12.04ms | success | 13 |
| L09 → (-10,65,-8) | 17.08ms | success | 9 |
| L09 → (10,65,7) | 41.00ms | partial | 8 |

实际移动对照（L09 从营地走到 (0,10)）：规划 **21.13ms**，移动 **1954ms**；规划只占“规划+移动”的 **1.1%**。

C++ vs JS 同网格 A\*（128×128、20% 障碍，各 100 次随机起终点，Heap 实现均手写）：

| 实现 | 单次 |
|---|---|
| JS A\* | 2.529ms |
| C++ A\* | 0.334ms |
| 构件级加速 | **7.6×** |

→ 若把 pathfinder 的 A\* 搜索换成 C++，单次规划 12–43ms → 约 1.6–5.6ms；对 L06 这类几十次 moveTo 的关卡，预计省 0.5–1.5s（整关几分钟 → **0.3–2%**），但每次 moveTo 的 JS 事件循环阻塞从 40ms 降到 5ms 级。

### 2.5 WorldDigest C++ 原型

- 原型：`native/profile/cpp/worlddigest.cpp`（自写 JSON 解析 + key 排序 + OpenSSL SHA-256）。
- 212.4KB 快照：**parse + canonical + sha = 1.318ms**（n=100），与 Node `digestSnapshot` 的 `sha256:` 值**逐字节一致**（已比对）。
- 对比：JS 仅对象→digest 2.32ms；若从原始 JSON 开始 JS 3.16ms vs C++ 1.32ms（2.4×）。
- 注意：engine 当前已经持有解析后的对象（JSON.parse 由 RPC 客户端完成），C++ addon 若接收对象需要 JS→C++ 转换，收益会被抵消；只有让 C++ 直接吃原始 JSON（改 RPC 链路）才能拿到 2.4×。

## 3. 方案对比

| 方案 | 构件级收益 | 端到端收益 | 集成风险 | 课程展示 | 建议 |
|---|---|---|---|---|---|
| 寻路 A\* C++ 内核 | 7.6×（12–43ms → 1.6–5.6ms） | 0.3–2%，消除 40ms 卡顿 | 高（要兼容 pathfinder 规则/路径格式） | 强（算法） | 课程要“性能关键算法”时选 |
| 快照二进制编解码 | 带宽 5–25×、解析 2–4× | HUD CPU 节省 ~2–4ms/s；带宽 110KB/s→~10–20KB/s | 中（协议 + Studio 解码/WASM） | 强（原生 + WASM） | 低风险、可量化时选 |
| WorldDigest addon | 2.4×（2.3ms → ~1.3ms） | <0.1% | 低（纯函数 + fallback） | 中（正确性） | 只满足“有 C/C++”时选 |
| 插件 reset/hash JNI | 无（8–22ms，Java 已快） | 0 | 高（JNI/打包） | 中 | 不选 |
| 场景 prepare | 无（tick 等待主导） | 0 | — | 弱 | 不选 |

## 4. 复现

```bash
# JS 快照/digest/压缩
node native/profile/bench-js.mjs
# 真实 Paper RPC 延迟
npx tsx native/profile/bench-rpc.ts        # 需 Paper 25565/RPC 8765
# 真实 Paper prepare/reset/pathfinding
npx tsx native/profile/bench-real.ts
# 评分耗时
npx tsx native/profile/bench-grade.ts
# C++ digest 原型
g++ -O2 -std=c++20 native/profile/cpp/worlddigest.cpp -lcrypto -o /tmp/worlddigest
/tmp/worlddigest evidence/l3-real-snapshot-2026-11-01T05-42-59-535Z.json 100
# C++ vs JS A*
g++ -O2 -std=c++20 native/profile/cpp/astar.cpp -o /tmp/astar && /tmp/astar 100
node native/profile/bench-astar.mjs
```

> 注意：`tmp/` 不入库，原型代码仅用于选型；确认方案后再落到 `native/` 并补 ADR/打包接入。
