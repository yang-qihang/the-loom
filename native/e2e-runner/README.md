# native/e2e-runner — 并行真实 Paper e2e 执行器（C++20）

> 状态：实施中｜负责人：api-runtime（native-core）｜上游：`docs/58-cpp-parallel-e2e-plan.md`
>
> 这层只重写「并行编排 / 进程 / 端口 / 超时 / 证据聚合」。测试脚本仍是 `it/lNN-real.ts`，
> Minecraft/Paper/插件/engine/mineflayer/评分真值全部不变。

## 1. 结构

```
native/e2e-runner/
  include/loom/
    config.hpp    RunConfig/StackConfig/CLI 解析/ExecutorFactory/build_jobs
    scheduler.hpp JobSpec/JobStatus/JobResult/JobExecutor/Scheduler（docs/58 §3 契约）
    ports.hpp     PortAllocator（worker 槽位 → MC/RPC 端口，并发安全、可回收）
    report.hpp    RunReport → 证据 JSON（含日志尾 4KB、UTF-8 安全截断）
    process.hpp   Process（POSIX fork/exec+pipe，RAII）/ TailBuffer / ProcessJobExecutor
  src/            上述 5 个 .cpp + main.cpp
  CMakeLists.txt  loom-core / loom-stack / loom-e2e 三层；tests/ 存在时自动接入
  Makefile        build/debug/sanitize/tsan/test/clean 快捷目标
```

`loom-stack`（真实 Paper 栈供给：复制模板、改端口、启停、进程组超时）由 native-stack 在
`src/factory.cpp` + `src/stack*.cpp` 实现，CMake 用 `file(GLOB CONFIGURE_DEPENDS)` 自动收编：
检测到这些文件时定义 `LOOM_HAS_STACK=1` 并链接进 `loom-e2e`；没有时仍可构建，`--dry-run` 可用。

## 2. 构建

> 本机 `g++` 是 ccache wrapper，`~/.cache/ccache` 只读：构建前请 `export CCACHE_DIR="$PWD/tmp/ccache"`
> （Makefile 已默认设置）；或 `CCACHE_DISABLE=1`。不设置会在 configure/build 阶段报
> `ccache: failed to create temporary file ... Read-only file system`。

```bash
# Release（默认）
cmake -S native/e2e-runner -B tmp/native-build-rel -DCMAKE_BUILD_TYPE=Release
cmake --build tmp/native-build-rel -j

# Debug + ASan/UBSan（本机 sanitizer 运行时库在 tmp/native-sanitizer-libs/，
# 运行时需要 LD_LIBRARY_PATH；链接时加 -L 让 g++ 找到对应 .so）
cmake -S native/e2e-runner -B tmp/native-build-asan -DCMAKE_BUILD_TYPE=Debug \
      -DLOOM_SANITIZE=address,undefined \
      -DCMAKE_EXE_LINKER_FLAGS="-L$PWD/tmp/native-sanitizer-libs"
cmake --build tmp/native-build-asan -j
LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs" ASAN_OPTIONS=detect_leaks=1 \
  ctest --test-dir tmp/native-build-asan --output-on-failure

# TSAN（同上；--fake 假栈集成会起真实子进程，TSAN 下会比 Release 慢）
cmake -S native/e2e-runner -B tmp/native-build-tsan -DCMAKE_BUILD_TYPE=Debug \
      -DLOOM_SANITIZE=thread -DCMAKE_EXE_LINKER_FLAGS="-L$PWD/tmp/native-sanitizer-libs"
cmake --build tmp/native-build-tsan -j
LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs" TSAN_OPTIONS=halt_on_error=1 \
  ctest --test-dir tmp/native-build-tsan --output-on-failure
```

CMake 选项：`-DLOOM_WITH_STACK=OFF` 可在不编译 native-stack 源（`src/factory.cpp|stack*.cpp`）时
只构建 core + `--dry-run`；`-DLOOM_BUILD_TESTS=OFF` 跳过 tests/ 接入。

编译选项：`-std=c++20 -Wall -Wextra -Wpedantic -Werror -D_GLIBCXX_ASSERTIONS
-fstack-protector-strong`（GCC/Clang；MSVC 用 `/W4 /WX`）。tests 目录里的目标请调用
CMake 导出的 `loom_apply_build_flags(<target>)` 获得同一套标志与 sanitizer 设置。

## 3. 用法

```bash
# 计划预览（不需要 Paper/native-stack；退出 0）
./tmp/native-build-rel/loom-e2e --levels L01,L02 --dry-run

# 真实并行（需要 native-stack 的 src/factory.cpp 已编译 + it/.mc-server 模板）
./tmp/native-build-rel/loom-e2e \
  --levels L01,L05,L06 --workers 2 \
  --paper-template it/.mc-server \
  --out evidence/native-e2e/run.json

# 假栈（真实子进程、不启动 Paper；用于 smoke）
./tmp/native-build-rel/loom-e2e --levels L01 --workers 1 --fake
```

### CLI

| 参数 | 默认 | 说明 |
|---|---|---|
| `--levels LIST` | `L01..L10` | 逗号分隔；接受 `l01`/`L1` 并规范化为 `L01`；只支持 L01–L10；空项（如 `L01,,L03`）、未知关（`L99`）、重复关（`L01,L01`）都会报错 |
| `--workers N` | `3` | 并行 worker 数（1–64）；实际并发 = min(N, job 数) |
| `--paper-template DIR` | `it/.mc-server` | Paper 服务端模板目录（native-stack 复制用） |
| `--work-root DIR` | `tmp/native-e2e/work` | 每个 worker 的工作目录根 |
| `--out FILE` | `evidence/native-e2e/run.json` | 证据 JSON（父目录自动创建） |
| `--timeout-ms N` | `900000` | 单 job 超时（毫秒）；超时 SIGKILL 整个进程组 |
| `--mc-base-port N` | `25565` | worker i 用 `base+i` |
| `--rpc-base-port N` | `8765` | worker i 用 `base+i`；两段区间不得重叠 |
| `--command-template STR` | `npx tsx it/l{level_num}-real.ts` | 占位符 `{level}`/`{level_num}`/`{id}` |
| `--dry-run` | 关 | 只打印 job/worker/端口计划，不执行、不写证据 |
| `--fake` | 关 | 用 native-stack 的 fake 执行器（真实子进程、不启 Paper） |
| `--verbose` | 关 | 打印每个 job 的完整命令与日志尾 |
| `-h/--help` | — | 打印中文用法并退出 0 |

### 退出码

| 码 | 含义 |
|---|---|
| `0` | 全部 job 通过（或 `--dry-run`/`--help` 正常结束） |
| `1` | 至少一个 job `fail`/`timeout`/`error` |
| `2` | 参数/配置错误（含缺少真实 Paper 栈实现、模板目录不存在） |
| `3` | 运行期内部错误（执行器创建失败、证据写入失败） |
| `130` | 收到 SIGINT（Ctrl-C）：终止所有 job 进程组、写部分证据后退出 |
| `143` | 收到 SIGTERM：同上 |

## 4. 执行语义（契约）

- **结果顺序**：`Scheduler::run_all` 返回的 `JobResult` 与输入 `jobs` 一一对应、顺序一致
  （每个 worker 线程只写自己拿到的下标，最后按输入序返回）。
- **失败隔离**：单个 job 失败/超时/执行器抛异常只影响该 job，其它 job 照常跑；异常被转成
  `JobStatus::Error` 并写入 `tail_log`。
- **worker 槽位**：并发 = `min(workers, job 数)`，每个 worker 占一个端口槽位；
  Scheduler 给每个 job 的 `env` 注入
  `LOOM_WORKER / MC_HOST / MC_PORT / MC_RPC_PORT / BOT_NAME=GolemP<slot>`；
  与 native-stack 的约定是：**以这些 env 为准**（栈启动端口与 it 脚本环境一致）。
- **超时与杀树**：`ProcessJobExecutor` 用 `/bin/sh -c` 起命令（`setsid` 新进程组），
  超时 `SIGKILL` 整个进程组（npx→tsx→bot 全部回收），`waitpid` 处理 `EINTR` 重试；
  退出码被信号杀死时记为 `128+signal`；**超时统一记 `exitCode=137`（128+SIGKILL）**，
  与 native-stack 的 StackExecutor 一致（见 `report.hpp` 的 exit_code 契约注释）。
  Scheduler 本身不抢占 executor 内部（超时在 executor 层）。
  **每个 job 结束后（成功也做）**对进程组 `SIGTERM`→100ms→`SIGKILL` 清尾，避免 `sleep 600 &`
  这类后台子进程成为孤儿。
- **中断/信号**：main 用「阻塞 SIGINT/SIGTERM + 专用线程 `sigtimedwait`」的 POSIX 模式
  （Windows 用 `SetConsoleCtrlHandler`）。收到信号后：置全局中断标志 → `Scheduler::request_stop()`
  → 各执行器在 ≤20ms 的等待切片里发现后杀自己的 job 进程组 → 不再启动新 job → 已完成的 job
  结果 + 未执行/被中断的 job 一起写进证据 JSON → 退出 130/143。`JobExecutor::shutdown()` 是
  可选虚函数（默认空操作），native-stack 的执行器应覆盖它（只置原子标志、由自身 run 循环轮询）
  以便同样清理 Paper 栈。
- **错误隔离防假绿**：`Process` 的 `waitpid` 只针对本对象已知 PID；`spawn` 在 fork 前失败时
  析构绝不 `waitpid(-1)`；`ECHILD`（子进程被意外回收）记为 Error(-1)，不会误报 PASS。
- **端口**：`PortAllocator` 并发唯一、`release()` 后可复用；Scheduler 只在 `run_all` 期间持租约。
- **空批次语义**：`RunReport::all_passed()` 对空 jobs 返回 false（没跑过就不能报「全绿」）。
- **证据 JSON**：每个 job 含 `id/level/command/status/exitCode/durationMs/worker/tailLog`，
  顶层含 `version/startedAt/finishedAt/totalDurationMs/workers/levels/commandTemplate/allPassed/jobs`；
  `tailLog` = 日志尾部最后 4KB；JSON 转义正确处理引号/反斜杠/控制字符，并**校验 UTF-8**：
  非法字节替换为 `\uFFFD`，保证证据文件永远是合法 UTF-8 JSON（job 日志可能混进 0xFF/半截中文）。

## 5. 测试与质量门

```bash
# 单测/假栈集成（native-test 提供 tests/）
ctest --test-dir tmp/native-build-rel --output-on-failure
ctest --test-dir tmp/native-build-asan --output-on-failure   # ASan/UBSan
ctest --test-dir tmp/native-build-tsan --output-on-failure   # TSAN
# 变异测试（native-test 的 tools/mutation.py）
python3 native/e2e-runner/tools/mutation.py --build-dir tmp/native-mutation --min-kill-rate 0.8 \
  --out evidence/native-e2e/mutation.json
```

## 6. 已知限制 / TODO

- Windows 分支：`process.cpp` 用 `CreateProcessW + Job Object` 实现（进程树 kill、
  stdin/合并 stdout pipe）；`ports.cpp` 的 `is_port_available` 有 `_WIN32` winsock2 分支且
  CMake 在 Windows 链接 `ws2_32`。两者本机（Linux）无法编译验证，需要 Windows CI 跑一次；
  若 CI 报错，优先修 Windows 分支而不是加 `-Wno-*` 绕过。
- 真实运行依赖 native-stack 的 `src/factory.cpp`（`create_stack_executor` / `create_fake_executor`）；
  缺省构建只有 `--dry-run` 与 core 单测。
- `Scheduler` 不实现「卡死的 executor 抢占」：单 job 超时由 `JobExecutor` 实现
  （`ProcessJobExecutor` 提供参考实现）。这是 docs/58 §3 的契约分工。
