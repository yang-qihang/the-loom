# 60 · main 集成、清理与分支管理决策（2026-11-02）

> 状态：已执行｜负责人：Lead｜最后更新：2026-11-02
> 关联：`docs/57`（严格审核）、`docs/58`（C++ e2e 执行器）、issue #1/#2/#3

## 0. 决策摘要

1. **同学的工作不迁分支、不回滚：保留在 main**，作为「已接收但附带修复清单」的基线。
2. 我方全部工作（C++20 并行 e2e 执行器、性能 profile、审计文档）**并入 main**。
3. 在 main 上做清理/验收提交：文档真实性、C 图标生成器方案废弃、`qa/**` 变更批准、安装包 world 清理、图标可复现、分支策略。
4. 后续同学 Windows 工作走 **`windows/followup` 分支**，禁止直接推 main；合并前按 §5 清单验收。
5. 旧分支清理：`native/parallel-e2e`、`lead/cpp-profile` 合并/摘取后删除；`backup/windows-takeover-2026-11-02` 保留为只读归档（可打成 tag）。

## 1. 为什么保留同学的工作在 main（而不是迁到分支/回滚）

- 他的提交已把 16 个 commit **扁平化为 2 个**（`f03b79c` + `85cc282`），历史本身已相对可审；再回滚会产生**第三次 force rewrite**，让他本地/Windows 工作区和备份分支更难对齐。
- 工作内容包含 issue #1 的大部分交付（自动检测/结算、剧情排版、教材 10 章、字体、Windows 打包、运行鲁棒性），Linux 上质量门实测可过（`docs/57` §2）；整体废弃会丢两周以上进度。
- 剩余问题主要是**文档真实性/流程批准/打包清洁/Windows 证据**，不是架构性错误，适合在 main 上小步修复。
- 独立备份保留：`backup/windows-takeover-2026-11-02`（85cc282）+ Lead 的审计/修复分支历史；任何回滚都可逆。
- 唯一硬性未交付：issue #1 第 8 条「C 语言 + Make/CMake」。**用户 2026-11-02 决定废弃 C 图标生成器方案**，因此本项目不再声称该条已完成，也不再用 C 图标生成器充当「C 等价」证据；当前项目提供的是 **C++20 + CMake/Make** 的 `native/e2e-runner`（满足构建系统/原生代码展示，但不是 C 语言）。如课程必须 C 语言，需另立小模块任务。

## 2. 已执行的清理

| 项 | 处理 |
|---|---|
| 旧 C 图标生成器/`docs/50` 虚假声明 | 从 README/STATUS/HANDOFF/docs/49 删除；docs/49 标注 `4227b5d` 方案已废弃；不存在 docs/50 |
| `qa/**` 冻结文件被改（红线） | Lead 在此批准：`qa/gates.mjs`、`qa/spec-check.mjs`、`qa/onboard-check.mjs`、`qa/repl-check.mjs`、`qa/ui-assert.mjs`、`qa/README.md`、新增 `qa/desktop-smoke-win.mjs` 均为跨平台适配（yaml/npx.cmd/Chrome 探测/截图命名），Linux 全量 gate 结果与基线一致；Windows gate 保持 blocked-by-evidence；后续任何 `qa/**` 改动仍需 Lead 书面批准 |
| 安装包携带测试玩家数据 | `scripts/build-real-runtime.sh` / `.ps1` 双重排除 + 删除 `world/players`、`world/logs`、`world.bak*`、`usercache.json`；`scripts/package-desktop.sh` 增加硬断言（发现玩家文件/旧世界备份/运行日志即 exit 5） |
| 图标 build 后变脏 | 用当前 JS 生成器重新生成 4 个 PNG 并提交；`desktop:assets` 连续两次输出一致（可复现） |
| Win/Linux 证据不可复现 | 保留为**未验证项**，不写「已完成」；Windows 安装/GUI 证据仍需 Windows CI 或同学机日志入库（见 §4） |

## 3. 已并入 main 的我方工作

- `native/e2e-runner/`：C++20 并行真实 e2e 执行器（core + native-stack + doctest 测试 + 变异/测试矩阵）；实测 3 workers × L02/L05/L06 = 1.46×（allPassed，wall 95.14s vs 串行 138.76s），2 workers × 4 关 1.29×。
- `native/profile/` + `docs/59`：C/C++ 候选构件真实 profile（用于证明「为什么不是寻路/序列化」）。
- `docs/57`：对同学 main 的严格审核报告（含 BLOCK 项与门禁矩阵）。
- `docs/58`：C++ 执行器设计/测试计划/实测结果。
- npm scripts：`native:build` / `native:test` / `e2e:parallel`。

## 4. 未闭环（明确不做假绿）

1. **R8 / L01 hidden h1 并行负载 flake**：bot 放置前离灯 2.83 格（判据 ≤2），L01 单独跑 PASS；属内容/评分/移动容差层，修好或验收 retry 前不宣称「L01–L10 并行全绿」。
2. **Windows 编译/安装/GUI 证据**：`_WIN32` 分支有编译守卫但本机无 Windows 工具链，未编译验证；需要在 `windows/followup` 分支配 Windows CI 或提交脱敏日志。
3. **全量 L01–L10 的 2.2×@3** 未跑；3 关受 L06 长尾限制（理论上限≈1.48×）。
4. `--out --verbose` CLI 值解析 P2；`pick_free_base` 测试端口 TOCTOU flake（测试环境，非 core 假绿）。

## 5. 分支策略（从本决策起执行）

- **main**：只接受通过 §6 门禁 + Lead review 的合并；不允许直接 force push；历史保持线性小步提交。
- **`windows/followup`**：同学后续 Windows/安装/GUI 工作唯一入口；从 main 创建，小步提交，每步附 Linux + Windows 证据。
- **`native/*` / `lead/*`**：已合并/已摘取的短期分支，合并后删除。
- **`backup/*`**：只读归档，不继续开发；可打 annotated tag 后删除远端分支。
- **合并前门槛（Windows 侧）**：`scripts/verify.ps1` pass + 安装包静默安装/启动 + 日志脱敏入库 + `G-DESKTOP-WIN` 不再 blocked；Linux 侧 `tsc/npm test/verify.sh/Studio e2e` + 真实 e2e（L01 单独 + 并行已知 flake 记录）。

## 6. issue #1 第 8 条（C）处置

**用户决定：废弃同学的图标生成器（C icon-gen）方案。** 因此：
- 不再声称「C 等价 8/8」，不再恢复 `native/icon-gen`/`docs/50`；
- 当前原生代码为 **C++20**（`native/e2e-runner`）+ CMake/Make；若课程要求必须是 **C 语言**，需在 `windows/followup` 之外另立任务选题并重新验收（不能用已废弃方案充数）。
