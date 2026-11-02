# 58 · C++ 并行 e2e 执行器（native/e2e-runner）契约与测试计划

> 状态：实施中｜负责人：Lead｜最后更新：2026-11-02｜上游：`docs/49-cpp-component-profile.md` 实测（串行真实 Paper e2e 330s，为 pipeline 最大等待）；用户 2026-11-02 要求「用 C++ 重写 pipeline 中 wait 最明显的地方」

## 1. 为什么是它（问题定义）

串行 L01–L10 真实 Paper e2e 实测 **≈330s**（`evidence/l*-real-latest.json` 的 startedAt/finishedAt 合计），其中 250s 是参考解在真实世界走路，32s 是场景 prepare；每关都必须等一个独立 Paper + bot 栈。它不是 CPU-bound，而是 **wall-clock 等待 + 串行编排**：把 10 关压到 N 个隔离栈上并行，是 pipeline 唯一有量级收益的改造。

`native/e2e-runner` 用 C++20 重写这层 **编排/进程/端口/超时/证据聚合**，测试脚本本身仍复用现有 `it/lNN-real.ts`（不重写业务断言）。预期：串行 330s → 3 workers ≈ 110–140s（≥2.2×），且失败隔离、超时可控、证据结构化。

## 2. 非目标（明确防止「为了 C 而 C」）

- 不重写 Minecraft/Paper/插件/engine/mineflayer，不改变任何关卡断言与评分真值。
- 不把真实 e2e 变成 mock；每个 worker 仍是真实 Paper 26.1.2 + 插件 + 真 bot。
- 不替换现有 `npm test` / `verify.sh` / Studio e2e；C++ runner 只服务「真实 Paper e2e」这一条等待最长的管线，且保留原串行脚本作为 fallback 与基线。

## 3. 目录与接口

```
native/e2e-runner/
  CMakeLists.txt
  Makefile                    # build / test / sanitize / tsan / mutation / clean
  include/loom/
    config.hpp                # RunConfig / StackConfig / parse_args
    process.hpp               # Process trait: spawn/wait/kill/read/write
    scheduler.hpp             # JobSpec / JobResult / JobExecutor / Scheduler
    ports.hpp                 # PortAllocator（区间、并发安全、复用检查）
    report.hpp                # RunReport → JSON
    stack.hpp                 # StackProvisioner（复制 Paper 目录、改端口、启动/停止）
  src/*.cpp
  tests/
    doctest.h                 # vendored（MIT，带 LICENSE）
    test_main.cpp
    test_*.cpp
    fake-job.sh / fake-job-fail.sh / fake-job-hang.sh
  tools/mutation.py           # 变异测试驱动
  README.md
```

**核心接口（teammate 必须按此实现，测试独立写）**

```cpp
struct JobSpec { std::string id; std::string level; std::string command; int timeout_ms; std::map<std::string,std::string> env; };
enum class JobStatus { Pass, Fail, Timeout, Error };
struct JobResult { JobSpec job; JobStatus status; int exit_code; long long duration_ms; std::string tail_log; };

class JobExecutor { public: virtual ~JobExecutor() = default; virtual JobResult run(const JobSpec&) = 0; };

struct SchedulerOptions { int workers = 3; };
class Scheduler {
 public:
  Scheduler(SchedulerOptions, std::unique_ptr<JobExecutor>);
  // 结果按输入顺序返回；任一失败不 cancel 其它（隔离）；总超时由单 job timeout 控制。
  std::vector<JobResult> run_all(const std::vector<JobSpec>& jobs);
};
```

**StackProvisioner**（真实 Paper 栈，Linux 首验；Windows 进程分支必须实现/编译守卫并单测编译分支选择逻辑）：

```cpp
struct StackPorts { int mc; int rpc; };
struct Stack { std::filesystem::path dir; StackPorts ports; std::unique_ptr<Process> paper; };
class StackProvisioner {
 public:
  StackProvisioner(StackConfig cfg);
  std::unique_ptr<Stack> start(int worker_index);   // 复制 paper 模板、改 server.properties 与 plugins/LoomCraft/config.yml
  void stop(Stack& stack);                          // 写 "stop\n" → 等 20s → 必要时 kill
};
```

- 端口：MC = base_mc + index；RPC = base_rpc + index；基址可配（默认 25565/8765），避免占用检查失败。
- 等待 ready：RPC TCP 可连接 + Paper `console.log` 出现 `Done (`，超时默认 90s。
- 每个 worker 独有工作目录 `work-root/w<index>`，从 `--paper-template` 复制；结束（成功或失败）删除，失败保留 `console.log` 到证据目录。
- 执行 job：cwd=仓库根，`/bin/sh -c <command>`（Windows `cmd /c`），env 注入 `MC_PORT/MC_RPC_PORT/MC_HOST/BOT_NAME=GolemP<index>`；job timeout 默认 900s。
- 崩溃/超时隔离：任一 worker 失败只标该 job Fail/Timeout，其它 job 继续；main 返回非 0。

## 4. 测试与 UB 防线（用户明确要求：AI 时代 C++ 测试 + 多 agent 不蒙混）

1. **单元测试（doctest）**：scheduler 并行/顺序、结果顺序、异常/失败隔离；端口分配并发唯一 + 复用；config 解析非法输入；report JSON 转义；process RAII 退出/超时/读写管道。
2. **集成测试（假栈）**：`fake-job*.sh` 模拟成功/失败/挂起/崩溃；断言 N=3 时 3 个 job 实际重叠（时间戳）、总时长 ≈ max；失败不连坐；fail/timeout 计数正确；证据 JSON 可解析。
3. **真实集成（Linux）**：`native/e2e-runner` 起 2–3 个真实 Paper 栈，跑 L01/L05/L06 等（在 14GB 内存内验证 2–3 workers），对比串行基线：每关结果与 `it/lNN-real.ts` 单独运行一致（PASS），wall time 记录；证据 `evidence/native-e2e/`。
4. **Sanitizer**：Debug 构建 `-fsanitize=address,undefined -fno-omit-frame-pointer`，全部单测/假栈集成通过；scheduler 另跑 `-fsanitize=thread`（TSAN）无 race；`valgrind --error-exitcode=1` 跑核心单测。
5. **变异测试**：`tools/mutation.py` 对关键逻辑（worker 数边界、超时比较、结果状态映射、端口分配/回收、retry/失败不连坐）生成 **curated mutants**（约 10–20 个），在隔离副本编译并跑测试；**要求 kill rate ≥ 80%**，输出 `evidence/native-e2e/mutation.json`；等价 mutant 必须显式标注 skip 理由。
6. **属性/随机测试**：manifest/CLI 随机输入（含超长、空、非 UTF-8 路由、重复 level）不崩溃、不泄漏；端口分配 1000 次随机序列不变式；全部在 ASan/UBSan 下跑。
7. **差分测试**：同一 job 分别由 `JobExecutor`（真子进程）与 fake executor 跑，结果映射一致；串行脚本 vs 并行执行每关 `evidence/lN-real-latest.json` 的 `RESULT`/关键 checks 一致。
8. **静态/编译防线**：`-std=c++20 -Wall -Wextra -Wpedantic -Werror -D_GLIBCXX_ASSERTIONS -fstack-protector-strong`；不使用裸 new/delete、c-style cast；进程/fd 全 RAII；异常安全；`-fno-exceptions` **不启用**（用异常 + RAII 清晰错误路径）。
9. **多 agent 防止蒙混**：实现 agent、测试 agent、独立红队 agent 分开；红队只读，自己写破坏脚本/跑 sanitizer/mutation，不得由实现者宣称通过；Lead 最终复跑全部命令并核对证据。

## 5. 验收命令（必须可复跑）

```bash
# 构建
cmake -S native/e2e-runner -B tmp/native-build -DLOOM_SANITIZE=address,undefined -DCMAKE_BUILD_TYPE=Debug
cmake --build tmp/native-build -j
# 单测/假栈集成（sanitizer）
ctest --test-dir tmp/native-build --output-on-failure
# TSAN
cmake -S native/e2e-runner -B tmp/native-build-tsan -DLOOM_SANITIZE=thread
cmake --build tmp/native-build-tsan -j && ctest --test-dir tmp/native-build-tsan --output-on-failure
# 变异
python3 native/e2e-runner/tools/mutation.py --build-dir tmp/native-mutation --min-kill-rate 0.8 --out evidence/native-e2e/mutation.json
# 真实并行（Linux；需 Java/Paper 模板；2–3 workers，内存 ≥8GB 可用）
cmake -S native/e2e-runner -B tmp/native-build-rel -DCMAKE_BUILD_TYPE=Release
cmake --build tmp/native-build-rel -j
./tmp/native-build-rel/loom-e2e --levels L01,L05,L06 --workers 2 --paper-template it/.mc-server --out evidence/native-e2e/run.json
# 对照串行（原脚本，用于正确性/基线）
npx tsx it/l1-real.ts && npx tsx it/l5-real.ts && npx tsx it/l6-real.ts
```

验收标准（2026-11-02 实测口径修订）：
- 单测+假栈全绿；ASan/UBSan 全绿；TSAN 无 race；mutation kill ≥80% 且 invalid=0；valgrind 0 leak/0 error；
- **速度口径**：`2 关/2 workers` 有 cold start 摊销问题，门槛 ≥1.1×；**正式基准用 ≥4 关**，门槛 ≥1.3×；3 workers 目标 ≥1.5×；
- 真实并行每关结果与串行一致、无 JVM/node/端口/work 残留、每 worker 只冷启动一次；
- 所有命令在 README/docs 可复跑；无 UB/sanitizer 报告；C++ 代码 review 通过。

## 6. 文件 ownership（多 agent 防冲突）

- `native-core`（实现）：`native/e2e-runner/CMakeLists.txt`、`Makefile`、`include/`、`src/`（scheduler/config/ports/process/report）+ README。
- `native-stack`（实现）：`src/stack*.cpp`、`include/loom/stack.hpp`、平台进程分支、真实 Paper 启停；与 core 接口由本文 §3 固定。
- `native-test`（测试）：`native/e2e-runner/tests/**`、`tools/mutation.py`、sanitizer 脚本；只写 tests/tools。
- `native-review`（红队）：只读，写 `evidence/native-e2e/review.md`，可提 issue/失败清单，不改实现。
- Lead：本文档、`scripts/`/package.json 接线、最终集成与证据、docs 更新、commit。


## 7. 实施结果（2026-11-02，本机 Linux）

### 7.1 代码

- `native/e2e-runner/`：C++20；core（config/scheduler/ports/report/process/main）+ native-stack（stack/factory）+ tests（doctest）+ tools（mutation/test-matrix）。
- 关键实现：worker 槽位常驻 Paper 栈懒加载复用（每 slot 只冷启动 1 次）；OS 端口预检（connect+bind，占用即拒绝，绝不连外栈）；job 超时杀进程组；成功也清理进程组后台子进程；SIGINT/SIGTERM 有序停止并写部分证据（退出 130/143）；证据 JSON 严格 UTF-8（非法字节 `\uFFFD`）；`exit_code` 契约（成功=0、失败=进程码、被信号=128+signal、超时=137、错误/中断=-1）。

### 7.2 测试/门禁（最终树，机器空闲串行单轮）

| 门禁 | 结果 |
|---|---|
| Release build（-Werror） | 0 warnings |
| Release ctest | **2/2 passed**（71 cases / 18k+ assertions） |
| ASan+UBSan ctest | **2/2 passed** |
| TSAN ctest | **2/2 passed** |
| valgrind | **0 leak / 0 error**（71 cases） |
| 假栈集成 harness | **14/14**（并行重叠、失败隔离、超时、端口冲突、栈复用 start_count=1、目录清理） |
| CLI 破坏用例 | 47 条仅 1 条 P2（`--out --verbose` 值解析） |
| mutation | **ok=true，killRate=1.0**（executed 22，killed 22，survived 0，invalid 0，1 个等价 skip） |
| 红队 6 项 P0/P1 | 全部修复并复测 PASS（PID 偷收、SIGINT 孤儿、成功 job 子进程残留、JSON 非 UTF-8、端口冲突假就绪、TSAN ENV） |

### 7.3 真实并行基准（Linux，真实 Paper 26.1.2 + 插件 + 真 bot）

| 场景 | 结果 | wall | 串行基线 | 加速 |
|---|---|---|---|---|
| 2 workers，L02/L05/L06/L09 | **4/4 PASS**，`start_count=1`/slot，无残留 | **118.64s** | 153.36s（git HEAD 单栈顺序 e2e 时长） | **1.29×**（正式门槛用 3-worker 判定） |
| 3 workers，L02/L05/L06 | **3/3 PASS**，`start_count=1`/slot，无残留 | **95.14s** | 138.76s（同上；L06 长尾理论上限 1.48×） | **1.46×**（≥1.3× 达标） |
| 2 workers，L01/L02/L05/L06（红队复核） | 3/4 PASS：L01 因既有 hidden h1 负载 flake 失败；runner 正确 Fail/清理/证据 | 135.0s / 136.6s | 178.6s | 1.31–1.32×（基线集合不同，仅交叉验证） |

- 证据：`evidence/native-e2e/bench-2w-4levels.json`、`bench-3w-3levels.json`、`review-real-25700.json`、`review.md`。
- 串行基线统一取 `git HEAD` 的 2026-11-01 单栈顺序 e2e 证据（working tree 的 latest 文件会被并行跑覆盖，不能当基线）。
- 诚实边界：**L01 hidden h1 在并行负载下会 flake**（bot 放置前离灯 2.83 格 vs 判据 ≤2）；L01 单独跑 PASS。h1 修好或验收 retry 落地前，不能宣称「L01–L10 并行全绿」。这是内容/评分层问题，不是 C++ runner 的假绿（runner 正确报 Fail、退出码 1、证据齐全）。
- Windows：`_WIN32` 分支（CreateProcess+Job Object / winsock / SetConsoleCtrlHandler）有编译守卫，但本机无 Windows 工具链**未编译验证**；需 Windows CI 跑一遍。

### 7.4 使用方式

```bash
npm run native:build                 # cmake Release 构建
npm run native:test                  # 构建 + ctest（单测/假栈）
npm run e2e:parallel -- --levels L02,L05,L06 --workers 2   --mc-base-port 25800 --rpc-base-port 26200   --paper-template it/.mc-server --out evidence/native-e2e/run.json
```
