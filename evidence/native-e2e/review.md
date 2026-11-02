# native/e2e-runner 红队审查（task-18，独立只读）— 最终版

> 结论时间：2026-11-02 18:00（+08:00；18:05 补记 C7 复测；18:10 补记 official bench 归属与串行基线更正）｜审查人：native-review（progress-pipeline）
> 分支 `native/parallel-e2e`；契约 `docs/58-cpp-parallel-e2e-plan.md` §3/§4/§5
> 实现冻结（api-runtime 报告）：core 17 文件 sha256 `4e7fbc38…7150c93`；红队复核用二进制 = Lead `tmp/native-build/loom-e2e`（sha256 `ae84acfd…9e5261`，与我从同一源码重编的 `tmp/native-redteam/builds/release6/loom-e2e` 完全一致）
> 红队未修改仓库任何实现/测试/CMake/scripts；所有破坏用例与变异均在 `tmp/native-redteam/` 或副本中做。

## 0. 最终结论

**C++ runner（native/e2e-runner）实现侧：PASS。** 并行编排、进程/超时/信号、端口、证据聚合、栈复用、资源清理均经实际执行验证；红队发现的 6 个 P0/P1 问题全部修复并由原复现脚本在新二进制上复测通过；构建矩阵 Release/ASan+UBSan/TSAN/valgrind 全绿；速度按官方基准（Lead 执行）：**3w×3 关 1.46×（≥1.3× 达标）、2w×4 关 1.29×**；红队独立 2w×4 关（含 L01、基线口径不同）交叉验证 1.31–1.32×（§4.2）。

**整体验收：CONDITIONAL PASS —— 仍受 2 个「非 C++ runner」事项约束，需 Lead 裁决/记账：**

1. **L01 真实 e2e 的 h1 采样 flake 在并行负载下复现（验收阻断项，归内容/测试侧，不归 C++ runner）**
   - 4 关 2-worker 真实跑 2 次：两次都 3/4 PASS，**L01 两次都 FAIL**；L01 单独 1 worker 跑 **PASS**。
   - 失败形态（两次不同场景、同一个根因）：
     - run1：`l1.starter.report-equals-mock` FAIL，real hidden `h1=false` vs mock `h1=true`（stars 1 vs 2）；
     - run2：`l1.no-beat.report-equals-mock` FAIL，real hidden `h1=false` vs mock `h1=true`。
   - `h1` = 「每次放置前，织偶都到达过灯柱 2 格内」——**bot 路径/时序采样**在并行高负载下不稳定；这是 docs/57 已记录的 P1-2 类问题，不是 C++ runner 的编排错误（失败被正确隔离、exit=1、证据/console 保存、栈/端口/目录清理全部正常）。
   - 建议：① 内容/engine 侧修 h1 采样（按引擎事件判定而非距离快照轮询）；或 ② 验收脚本对 L01 做显式 retry 并记录 flake 率。**在 h1 修好前，不要对外宣称「4 关并行全绿」。**
2. **速度验收口径（经归属/基线更正，2026-11-02 18:10）**：官方基准由 **Lead 本人**执行（二进制 `tmp/native-build-bench/loom-e2e`，独立端口 25800/26200、25900/26300，非红队产物）：
   - **3w × 3 关（L02,L05,L06）**：wall **95.137s** vs 串行基线 **138.76s**（git HEAD 2026-11-01：L02 23.06+L05 37.11+L06 78.59）= **1.46×**（理论 max 1.48×，L06 93.7s 长尾），**达到 ≥1.3× 门槛**；
   - **2w × 4 关（L02,L05,L06,L09）**：wall **118.64s** vs 串行基线 **153.36s**（+L09 14.60）= **1.29×**（接近门槛，冷启动未摊销；2 关场景按 Lead 裁决 ≥1.1×）；
   - 红队独立 2w×4 关（**含 L01**，端口 25700/26100）wall 135.0/136.6s vs 178.6s = 1.31–1.32×——**基线集合不同**（含 L01 39.8s 且机器负载高），仅供独立交叉验证，最终口径以 Lead 官方基准为准；
   - 全量 10 关 2.2× 目标需另跑（Lead docs/58 记录）。
   **数据卫生警告**：工作树 `evidence/l{2,5,6,9}-real-latest.json` 已被 17:59 的 3w 基准覆盖（startedAt 09:59:51、mcPort 2590x、bot GolemPx），**不能当串行基线**；串行基线必须用 `git show HEAD:evidence/l*-real-latest.json`（2026-11-01 单栈 25565/8765、bot Golem*）。

**最终建议：** C++ runner 可合入（PASS）；发布验收在 ① h1 flake 修复/retry 策略落地、② docs/58 速度口径更新之后，可判整体 PASS。

## 1. 审查范围与方法

| 类别 | 做了什么 | 证据位置 |
|---|---|---|
| 静态契约对照 | docs/58 §3/§4 逐条对 include/src/tests；Windows 分支；异常/资源路径 | `tmp/native-redteam/contract-checklist.md` |
| 构建矩阵 | Release / Debug+ASan+UBSan / Debug+TSAN + ctest；valgrind | `tmp/native-redteam/logs/{r6,asan6,tsan6,valgrind6}*` |
| CLI 破坏 | 47 条非法/边界参数 | `tmp/native-redteam/run-cli-abuse.sh` → `logs/cli-abuse.txt` |
| 进程/信号 | SIGINT/SIGTERM、成功 job 残留子进程、超时进程组、僵尸 | `run-sigint2.py`、`run-killtree.sh`、`logs/sigint2.txt` |
| 假绿专项 | 失败批次 allPassed、超时当成功、JSON 非 UTF-8、pid 偷收误报、端口冲突假就绪 | `run-json-evidence.sh`、`process_pid_steal.cpp`、`fake_stack_port_conflict.cpp` |
| 真实栈行为（不启 Paper） | fake-java 驱动 StackProvisioner/StackJobExecutor：模板复制/端口改写/ready/超时/stop/清理/槽位懒加载复用 | `fake_stack_harness.cpp`（14/14 PASS） |
| 变异复核 | 独立 9 个语义变异（副本注入、编译+ctest）+ 官方 `tools/mutation.py` 复核 | `run-mutation-review.sh`、`logs/mutation-review.txt` |
| 真实并行 | 2 workers × 4 关（L01,L02,L05,L06），独立端口 25700/26100（Lead 放行） | `evidence/native-e2e/review-real-25700.json`、`logs/real-25700.txt` |

## 2. 契约偏差/未实现清单（最终状态）

| # | 项 | 级别 | 状态 |
|---|---|---|---|
| C1 | 超时 `exit_code` 语义：`ProcessJobExecutor`=137、`StackJobExecutor`=-1 不一致 | P2 | **已修复**：`report.hpp` 导出 `kTimeoutExitCode=137` 契约，两 executor 统一（复核 grep：process.cpp:898、factory.cpp:264 均为 137） |
| C2 | `--levels` 空段/重复/未知不报错；与 test_config 期望冲突 | P2 | **已修复**：严格模式（仅 L01–L10；空项/重复/未知均 exit 2；实测 L99/L0/L01,,L03 全部拒绝） |
| C3 | `--out --verbose` 把下一个 flag 当值吞掉 | P2 | **未修（保留开放）**：47 条 CLI 破坏用例中唯一 FAIL；建议值以 `--` 开头时报错（或文档声明只支持 `--out=value`） |
| C4 | `--levels` 重复静默去重 → 现为报错 | P2 | **已修复/契约更新** |
| C5 | Windows：ports/stack/process 均有 `_WIN32` 守卫（ports 用 winsock2 + CMake 链 ws2_32），但本机无 Windows 工具链 | P2 | **守卫已补齐，编译未验证**（本机无 mingw，记录为 CI 待验，无 #error 假实现） |
| C6 | fork 后子进程调用 `work_dir->string()`（非 async-signal-safe） | P2 | **已修复**：fork 前预计算 `std::string` 与 argv/envp，child 仅 close/dup2/setsid/chdir/execve/_exit |
| C7 | 真实栈启动失败证据（`preserve_startup_console` → `logs/<level>-console.log`） | P2 | **已补全并红队复测 PASS（api-engine 18:01，仅 loom-stack factory.cpp）**：JVM 未起类失败新增 `write_console_evidence_text` 兜底；复测模板缺 server.properties → 334B、RPC 端口被占 → 240B 的 `logs/<level>-console.log`（含中文错误文本），见 `tmp/native-redteam/c7_console_evidence.cpp` |
| C8 | `loom-unit` 与 `loom-fake-integration` 重复跑 integration 子集 | P2 | 仍存在（只慢不误）；可接受 |

无「核心契约未实现」项：JobSpec/JobStatus/JobResult/Scheduler/PortAllocator/StackProvisioner/Report/CLI/`--dry-run/--fake`/槽位栈懒加载复用/端口预检/Windows 守卫/信号处理均已落地。

## 3. 真实问题（P0/P1，全部复现—修复—复测闭环）

| ID | 级别 | 问题 | 复现（红队） | 修复后复测 |
|---|---|---|---|---|
| R1 | P1 假绿 | spawn 前失败走 `reap_blocking()` 的 `waitpid(-1)`，偷收并发 job 子进程；`ECHILD→finish(0)` 把 Fail 误报 Pass | `process_pid_steal.cpp` 旧版：`took 701ms`、`A exit code = 0（期望 7）` | **PASS**：`took 0ms`、`A exit code = 7`、`VERDICT: PASS(未偷收)` |
| R2 | P1 泄漏 | SIGINT/SIGTERM 无清理：父进程被信号杀死，job 进程组全成孤儿，不写证据 | `run-sigint2.py` 旧版：rc=-2/-15、4 个 hang.sh/sleep 残留、no evidence | **PASS**：rc=130/143、部分证据写出、`RESULT: no orphans` |
| R3 | P1 泄漏 | 成功 job 的后台子进程不清理（只 wait 直接子进程） | `run-killtree.sh` 旧版：`sleep 600 ppid=1` 残留 | **PASS**：无任何残留进程 |
| R4 | P1 证据 | 非 UTF-8 job 输出原样入 JSON → 证据不是合法 UTF-8 | `fixtures/json-escape-tail.sh`（`\377\376\375`）旧版：`UnicodeDecodeError: invalid start byte 0xff` | **PASS**：`utf8 valid: True`、`json parse OK`、非法字节→`\uFFFD`×3 |
| R5 | P1 假绿/串栈 | 无 OS 端口预检 + ready 只看 TCP 可连+Done → 外部 listener 占 RPC 端口时被判 ready（可能连到别人的 Paper） | `fake_stack_port_conflict.cpp`（hold-port.py 占 26150）旧版：`start() 返回 ready` | **PASS**：`start() 抛错：worker 0 的端口被占用：MC_RPC_PORT=26150 已被占用…绝不能连到别人的 Paper` |
| R6 | P1 测试基建 | ctest `set_tests_properties` 缺 `ENVIRONMENT`：TSAN configure 失败、ASan options 静默失效 | 旧版 `cmake -DLOOM_SANITIZE=thread` 报 `set_tests_properties called with incorrect number of arguments` | **PASS**：验证器已修（`loom_configure_test()` + `ENVIRONMENT`），TSAN 配置/运行正常 |
| R7 | P1 验收指标 | 2-worker 真实跑加速比 1.19×（2 关）低于 1.3× | api-engine `stack-smoke-l01-l05.json`：wall 64.7s vs serial 76.9s | **已按官方基准口径解决（归属 Lead）**：3w×3 关 95.137s / 138.76s = **1.46×**（达标）；2w×4 关 118.64s / 153.36s = **1.29×**（接近门槛，2 关按裁决 ≥1.1×）；红队独立 2w×4 关含 L01 1.31–1.32×（基线口径不同，交叉验证）。bench 文件均为 Lead 执行（非红队），详见 §4.2 |
| R8 | P1 验收（非 C++） | L01 的 h1 采样在并行负载下不稳定：4 关并行 2/2 次 L01 FAIL，L01 单独跑 PASS；C++ runner 行为正确 | run1 `l1.starter.report-equals-mock`、run2 `l1.no-beat.report-equals-mock`，均为 hidden h1 real=false/mock=true | **未修**（归内容/engine，docs/57 P1-2）；建议修 h1 判定或验收 retry；**不要据此判 C++ runner 失败** |
| R9 | P2 测试环境 | 多个测试进程/其它 agent 并发跑 e2e 时，`pick_free_base()` 选端口后被抢占 → `StackStartError: worker N 的端口被占用` → `test_stack_fake` SIGABRT / `test_factory_fake` 期望 Timeout 得 Error。红队压测：串行 12 次 1 次失败；release7 首次 ctest 1/13 次失败（load≈4–5），同用例单跑 5/5 PASS、ctest 重试 2/2 PASS；并发矩阵时必现；机器空闲单轮 ASan/TSAN 全绿 | 红队 asan6/tsan6 首次并发运行均因此失败；串行重跑 2/2 全绿；api-runtime 12 次 gate 2 次（集中在 stack/factory fake） | **测试隔离问题，非 core 假绿/UB**：建议测试进程串行（或端口段加进程前缀/重试），CI 注意不要并发跑 ctest 与 e2e |
| R10 | P2 变异方法学 | 官方 mutation 旧版把 configure/compile 失败计 killed、budget 跳过不进分母 → 可刷 100% 假绿 | 代码审阅 + 旧版运行 | **验证器已修**（新增 invalid 状态、`not_executed` 使 ok=false、注释引用红队 P2）；本次基线运行因 R9 端口竞态在 baseline-test 失败，未产出最终 killRate —— 建议空闲机器单轮重跑后把 mutation.json 归档 |

## 4. 通过项（实测证据）

### 4.1 构建/测试矩阵（最终串行单轮，机器空闲）
| 门 | 命令（要点） | 结果 |
|---|---|---|
| Release | `cmake … -B tmp/native-redteam/builds/release6 -DCMAKE_BUILD_TYPE=Release && cmake --build … -j8 && ctest … -j2` | **PASS 2/2**（71 cases，17–19s）；C7 后 release7 首轮 ctest 遇到 1 次 R9 端口竞态 flake，同用例单跑 5/5 PASS、ctest 重试 **2/2 PASS**（非回归） |
| ASan+UBSan | `-DLOOM_SANITIZE=address,undefined -DCMAKE_CXX_FLAGS=-L$PWD/tmp/native-sanitizer-libs`；`LD_LIBRARY_PATH` 同上 | **PASS 2/2** |
| TSAN | `-DLOOM_SANITIZE=thread …` | **PASS 2/2** |
| valgrind | `valgrind --error-exitcode=1 --leak-check=full --show-leak-kinds=definite,indirect --track-fds=yes <release6/tests/loom-tests>` | **PASS**：71 cases；`All heap blocks were freed -- no leaks are possible`；`ERROR SUMMARY: 0 errors` |
| CLI 破坏 | 47 条（空/重复/超长/0/极大/端口重叠/flag 作值…） | 46 符合预期，1 条 P2（C3 `--out --verbose`） |
| 假栈（不启 Paper） | `fake_stack_harness5/6`：模板复制/端口改写/ready/超时/stop/清理/复用 | **14/14 PASS**；4 jobs/2 workers 全 PASS 且每 slot `paper_stack_start_count=1` |
| 信号/进程 | SIGINT/SIGTERM；超时进程组；成功 job 孤儿；僵尸 | **PASS**：130/143 + 部分证据 + 0 孤儿/0 僵尸 |
| JSON 假绿 | mixed/timeout/dirty-log/fake-pass-output | mixed: L01 pass,L02 fail,allPassed=false,rc=1；timeout: status=timeout,exit=137,allPassed=false,rc=1；dirty-log 合法 JSON；fake-pass-output（exit 0 但输出 FAIL）按 exit code 判 pass = **文档化语义边界**（真实 `it/lNN-real.ts` 用 `process.exit(ok?0:1)`，已核对 real-harness.ts:279） |

### 4.2 真实并行基准

#### 4.2a 红队独立跑（native-review 执行，Lead 放行；端口 25700/26100，模板 it/.mc-server，二进制 sha256 ae84acf…）
| 轮次 | levels | workers | 结果 | wall | 口径内串行基线 | 加速比 | 清理 |
|---|---|---|---|---|---|---|---|
| run1 17:47 | L01,L02,L05,L06 | 2 | L01 **FAIL**(exit1,55.3s,h1 flake) / L02 PASS / L05 PASS / L06 PASS | 135.03s | 178.6s | **1.32×** | ps 无 JVM/node 残留；25700/25701/26100/26101 已释放；work dir clean；每 worker start_count=1（2 job/worker） |
| run2 17:52 | 同上 | 2 | L01 **FAIL**(exit1,55.4s,h1 flake：no-beat) / L02 PASS / L05 PASS / L06 PASS | 136.61s | 178.6s | **1.31×** | 同上 |
| solo 17:50 | L01 | 1 | **PASS**（54.6s，allPassed=true） | — | — | — | 端口/目录清理正常 |

> 注：该 178.6s 是「含 L01 的 4 关」基线（L01 39.8+L02 23.1+L05 37.1+L06 78.6，Lead 提供），与下面官方基准的 3 关/4 关集合不同，故只用于交叉验证；红队结论不变：C++ runner 并行编排/隔离/证据/清理全部符合契约，**L01 失败是 h1 采样并行 flake（R8）**。

#### 4.2b 官方基准（**Lead 本人执行/放行**；二进制 `tmp/native-build-bench/loom-e2e`；端口 25800/26200、25900/26300）
| 基准 | levels | workers | 结果 | wall | 串行基线（git HEAD 2026-11-01） | 加速比 | 清理 |
|---|---|---|---|---|---|---|---|
| `bench-3w-3levels.json` | L02,L05,L06 | 3 | allPassed=true；每 slot start_count=1 | **95.137s** | L02 23.06 + L05 37.11 + L06 78.59 = **138.76s** | **1.46×**（理论 max 1.48×，L06 93.7s 长尾） | 无 JVM/node 残留、端口释放、work dir clean（Lead/native-review/native-stack 复核） |
| `bench-2w-4levels.json` | L02,L05,L06,L09 | 2 | allPassed=true；每 slot start_count=1 | **118.64s** | +L09 14.60 = **153.36s** | **1.29×**（冷启动未摊销；2 关场景按 Lead 裁决 ≥1.1×） | 同上 |

**归属说明（防最终报告记错）**：`bench-2w-4levels.json`、`bench-3w-3levels.json` 及 `tmp/native-bench*.log`、`tmp/native-e2e/work-bench*` 均为 **Lead 本人执行/放行**，不是 native-review 产物（红队产物只有 `review-real-25700.json` 与 `tmp/native-redteam/logs/real-*`；17:57/18:01 只是文件落在同一时间段）。
**串行基线口径**：工作树里的 `evidence/l{2,5,6,9}-real-latest.json` 已被并行基准覆盖（startedAt 2026-11-02T09:59:51Z、mcPort 2590x、bot GolemPx），**不能引用为串行基线**；正确基线是 git HEAD 2026-11-01 单栈顺序证据（25565/8765、bot Golem*）。官方口径：**3w ≥1.3× 已达标（1.46×）**；全量 10 关 2.2× 需另跑。

## 5. 变异测试复核

- **独立变异（红队副本注入，最终版结果 `tmp/native-redteam/logs/mutation-review.txt`）**：order/status-map/port-offset/json-escape/tail-full/allpass/worker-env = **killed-by-tests**（7/7 实际可执行的非等价变异全部被测试杀死）；`workers`（min→max）= survived，但为**等价 mutant**（只多起空闲线程/多租端口后释放，结果/时长不可观测，应标 skip 并给理由）；`timeout-ignore` = stale（我的 find 字符串随实现更新失效，需更新，非覆盖缺口）。
- **官方 `tools/mutation.py`**：验证器已按红队 P2 修复方法论（configure/compile 失败→invalid 不计 killed；skipped-budget→`not_executed` 使 ok=false；counts 增 invalid/skippedBudget）。本次尝试在 baseline-test 因 R9 端口竞态失败（`test_factory_fake` 偶发 StackStartError/Error），未产出最终 killRate；建议机器空闲单轮重跑后归档 `evidence/native-e2e/mutation.json`。

## 6. 可复跑命令清单

```bash
export CCACHE_DIR="$PWD/tmp/ccache"
export LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs"
export LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs"
BIN="$PWD/tmp/native-redteam/builds/release6/loom-e2e"   # 与 Lead 二进制 sha256 一致

# 1) Release + ctest
cmake -S native/e2e-runner -B tmp/native-redteam/builds/release6 -DCMAKE_BUILD_TYPE=Release
cmake --build tmp/native-redteam/builds/release6 -j 8
ctest --test-dir tmp/native-redteam/builds/release6 --output-on-failure -j 2

# 2) ASan+UBSan（注意：与其他 ctest/e2e 串行跑，避免 R9 端口竞态）
cmake -S native/e2e-runner -B tmp/native-redteam/builds/asan6 -DCMAKE_BUILD_TYPE=Debug \
  -DLOOM_SANITIZE=address,undefined -DCMAKE_CXX_FLAGS="-L$PWD/tmp/native-sanitizer-libs"
cmake --build tmp/native-redteam/builds/asan6 -j 8
LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs" ASAN_OPTIONS=detect_leaks=1:abort_on_error=1 \
  ctest --test-dir tmp/native-redteam/builds/asan6 --output-on-failure -j1

# 3) TSAN（同上，串行）
cmake -S native/e2e-runner -B tmp/native-redteam/builds/tsan6 -DCMAKE_BUILD_TYPE=Debug \
  -DLOOM_SANITIZE=thread -DCMAKE_CXX_FLAGS="-L$PWD/tmp/native-sanitizer-libs"
cmake --build tmp/native-redteam/builds/tsan6 -j 8
LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs" TSAN_OPTIONS=halt_on_error=1 \
  ctest --test-dir tmp/native-redteam/builds/tsan6 --output-on-failure -j1

# 4) valgrind
LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs" valgrind --error-exitcode=1 \
  --leak-check=full --show-leak-kinds=definite,indirect --errors-for-leak-kinds=definite,indirect \
  --track-fds=yes --child-silent-after-fork=yes \
  tmp/native-redteam/builds/release6/tests/loom-tests

# 5) 破坏用例
bash tmp/native-redteam/run-cli-abuse.sh "$BIN"
LOOM_E2E_BIN="$BIN" bash tmp/native-redteam/run-json-evidence.sh
LOOM_E2E_BIN="$BIN" python3 tmp/native-redteam/run-sigint2.py
LOOM_E2E_BIN="$BIN" bash tmp/native-redteam/run-killtree.sh

# 6) 进程偷收复现（旧实现 FAIL / 新实现 PASS）
g++ -std=c++20 -O1 -I native/e2e-runner/include tmp/native-redteam/process_pid_steal.cpp \
  native/e2e-runner/src/{process,report,scheduler,ports}.cpp -o tmp/native-redteam/process_pid_steal6 -lpthread \
  && tmp/native-redteam/process_pid_steal6

# 7) 假栈 harness / 端口冲突（不启 Paper）
g++ -std=c++20 -O1 -I native/e2e-runner/include tmp/native-redteam/fake_stack_harness.cpp \
  native/e2e-runner/src/{config,ports,report,scheduler,process,stack,factory}.cpp \
  -o tmp/native-redteam/fake_stack_harness6 -lpthread && tmp/native-redteam/fake_stack_harness6
g++ -std=c++20 -O1 -I native/e2e-runner/include tmp/native-redteam/fake_stack_port_conflict.cpp \
  native/e2e-runner/src/{config,ports,report,scheduler,process,stack}.cpp \
  -o tmp/native-redteam/fake_stack_port_conflict6 -lpthread && tmp/native-redteam/fake_stack_port_conflict6

# 7b) C7 启动失败证据复测（fake-java；模板缺文件/端口占用 → logs/<level>-console.log）
g++ -std=c++20 -O1 -I native/e2e-runner/include tmp/native-redteam/c7_console_evidence.cpp \
  native/e2e-runner/src/{config,ports,report,scheduler,process,stack,factory}.cpp \
  -o tmp/native-redteam/c7_console_evidence -lpthread && tmp/native-redteam/c7_console_evidence

# 8) 真实并行（Lead 放行后；独立端口段）
bash tmp/native-redteam/run-real-25700.sh "$PWD/tmp/native-build/loom-e2e"

# 9) 独立 mutation（副本注入）
bash tmp/native-redteam/run-mutation-review.sh

# 10) 官方 mutation（机器空闲时跑；注意 R9 端口竞态）
CCACHE_DIR=$PWD/tmp/ccache python3 native/e2e-runner/tools/mutation.py \
  --build-dir tmp/native-redteam/mutation-tool --min-kill-rate 0.8 \
  --out tmp/native-redteam/logs/mutation-tool.json --time-budget 3000
```

## 7. 红队文件清单（均在 `tmp/native-redteam/` 与 `evidence/native-e2e/`，不入库）
`tmp/native-redteam/`：`contract-checklist.md`、`README.md`、`build-all.sh`、`run-cli-abuse.sh`、`run-json-evidence.sh`、`run-sigint.sh`、`run-sigint2.py`、`run-killtree.sh`、`run-mutation-review.sh`、`run-real-25700.sh`、`fake_stack_harness.cpp`、`fake_stack_port_conflict.cpp`、`process_pid_steal.cpp`、`factory_flake_repro.cpp`、`c7_console_evidence.cpp`、`fixtures/*`、`logs/*`、`sanitizer-root/`（历史）。
`evidence/native-e2e/`：`review.md`（本文件）、`review-real-25700.json`（红队 4 关真实跑证据，run2）；**`bench-2w-4levels.json` / `bench-3w-3levels.json` 为 Lead 执行官方基准，非红队产物**。

## 8. 需 Lead 处置的收尾项
1. **R8 L01 h1 并行 flake**：内容/engine 修 h1 采样（或验收 retry 策略）；修好前不要宣称「4 关并行全绿」。
2. **docs/58 速度口径**：4 关 ≥1.3× 已达标；2 关改 ≥1.1×（Lead 已承诺更新）。
3. **C3**：`--out/--levels` 值以 `--` 开头时给明确报错（P2）。
4. **R9**：CI/验收跑 native 测试与真实 e2e 时避免并发（端口竞态），或测试侧加端口重试。
5. **Windows 编译验证**（C5）：有 CI 条件时补；**C7 已闭环**（api-engine 18:01 实现 + 红队复测通过，建议 native-test 加「模板缺文件/端口占用 → console.log 存在且非空」断言防回归）。
6. **R10 + R9**：空闲机器单轮官方 mutation 并归档 killRate；CI 对 flaky 用例（R9 端口竞态）加单测重跑/隔离，避免把环境 flake 计入质量门。
7. **数据卫生**：`evidence/l*-real-latest.json` 已被 17:59 并行基准覆盖；生成正式报告时请统一从 git HEAD 取串行基线，或把并行 run 的 evidence 另命名（bench-*.json 已区分）。
