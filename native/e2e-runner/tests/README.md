# native/e2e-runner 测试体系（native-test）

独立于实现的测试层：doctest 单测 + 假栈集成 + sanitizer/TSAN + 变异测试。
测试只 include 公开头文件、只链接 `src/*.cpp`（排除 `main*.cpp`），**不修改实现**。

## 结构

```
tests/
  doctest.h / doctest.LICENSE.txt   # vendored doctest（MIT，见 LICENSE）
  test_main.cpp                     # doctest 主入口
  test_util.hpp                     # 临时目录/计时/FakeExecutor/进程观测工具
  test_scheduler.cpp                # 并行/顺序/失败隔离/超时/重复 id
  test_ports.cpp                    # 并发唯一/回收/越界/随机序列不变式
  test_config.cpp                   # 合法/非法/随机 CLI 与配置
  test_report.cpp                   # 证据 JSON 字段与转义
  test_process.cpp                  # 子进程成功/失败/超时/崩溃/挂起、无僵尸、fd 不泄漏
  test_stack_fake.cpp               # 假 Paper 栈（fake-java.sh）：ready/stop/端口/清理
  test_integration_fake.cpp         # fake job 假栈：真实并行重叠、失败隔离、证据字段
  test_differential.cpp             # 串行 vs 并行结果映射一致
  test_property.cpp                 # 属性/随机 1000 例（ASan 下）
  fake-job*.sh / fake-java.sh       # 假 job / 假 Paper 栈
tools/
  mutation.py                       # curated 变异测试（kill rate ≥ 80%）
  test-matrix.sh                    # plain / asan+ubsan / tsan / valgrind 矩阵
```

## 环境准备（本机 gcc 16 + ccache wrapper）

```bash
# ccache：本机 g++ 是 ccache wrapper，~/.cache/ccache 只读 → 必须指到工作区
export CCACHE_DIR="$PWD/tmp/ccache"
# gcc 16 的 sanitizer 运行时 .so 由 Lead 放在稳定路径（等价：dnf install libasan libtsan libubsan）
export LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs${LIBRARY_PATH:+:$LIBRARY_PATH}"
export LD_LIBRARY_PATH="$PWD/tmp/native-sanitizer-libs${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# 注意：gcc 自带 libasan.so 是带绝对路径的 linker script，链接期还需显式 -L
# （tools/test-matrix.sh 已自动传 -DCMAKE_CXX_FLAGS="-L$PWD/tmp/native-sanitizer-libs"）
```

## 复跑命令（仓库根目录）

```bash
# 1) 普通构建 + ctest
cmake -S native/e2e-runner -B tmp/native-build -DCMAKE_BUILD_TYPE=Release
cmake --build tmp/native-build -j
ctest --test-dir tmp/native-build --output-on-failure

# 2) ASan + UBSan（SAN_LIBS 如上；链接期显式 -L 见上面说明）
SAN_LIBS="$PWD/tmp/native-sanitizer-libs"
cmake -S native/e2e-runner -B tmp/native-build-asan -DCMAKE_BUILD_TYPE=Debug -DLOOM_SANITIZE=address,undefined \
  -DCMAKE_CXX_FLAGS="-L$SAN_LIBS" -DCMAKE_EXE_LINKER_FLAGS="-L$SAN_LIBS"
cmake --build tmp/native-build-asan -j
ctest --test-dir tmp/native-build-asan --output-on-failure

# 3) TSAN（scheduler/process 并发路径）
cmake -S native/e2e-runner -B tmp/native-build-tsan -DCMAKE_BUILD_TYPE=Debug -DLOOM_SANITIZE=thread \
  -DCMAKE_CXX_FLAGS="-L$SAN_LIBS" -DCMAKE_EXE_LINKER_FLAGS="-L$SAN_LIBS"
cmake --build tmp/native-build-tsan -j
ctest --test-dir tmp/native-build-tsan --output-on-failure

# 4) 一键矩阵（plain+asan+tsan，日志写 evidence/native-e2e/；自动处理 ccache/sanitizer libs）
bash native/e2e-runner/tools/test-matrix.sh all
bash native/e2e-runner/tools/test-matrix.sh valgrind

# 5) 变异测试（kill rate ≥ 0.8；输出 evidence/native-e2e/mutation.json）
python3 native/e2e-runner/tools/mutation.py --build-dir tmp/native-mutation \
  --min-kill-rate 0.8 --out evidence/native-e2e/mutation.json
```

## 当前验证结果（2026-11-02，native-test）

| 门禁 | 命令 | 结果 |
|---|---|---|
| Release ctest | `cmake -S native/e2e-runner -B tmp/native-clean-release -DCMAKE_BUILD_TYPE=Release && cmake --build … && ctest …` | **2/2 PASS**（71 个 doctest case；干净目录全新构建） |
| ASan+UBSan ctest | `bash tools/test-matrix.sh asan` | **2/2 PASS**（`evidence/native-e2e/ctest-asan.log`） |
| TSAN ctest | `bash tools/test-matrix.sh tsan` | **2/2 PASS**（`evidence/native-e2e/ctest-tsan.log`） |
| valgrind | `bash tools/test-matrix.sh valgrind` | **PASS**：0 errors / 0 leaks / 无 fd 泄漏（`evidence/native-e2e/valgrind.log`） |
| 变异测试 | `python3 tools/mutation.py --build-dir tmp/native-mutation-2 --out evidence/native-e2e/mutation.json` | 见 `evidence/native-e2e/mutation.json`（kill rate / killed / survived / invalid 分列） |

覆盖要点：
- Scheduler：N workers 时间戳真并行、结果严格输入序、Fail/异常不连坐、env 注入（MC_PORT/MC_RPC_PORT/BOT_NAME/LOOM_WORKER）、timeout_ms 透传与默认值、非法 workers 构造拒绝。
- PortAllocator：并发唯一、最低空闲复用、release 越界/未租、端口区间重叠拒绝、`is_port_available`、随机 1000 步不变式。
- config：默认值/全 flags/--help/argc 重载、非法输入（含 `--levels` 空段/重复/L00/L11/L99）、模板展开、随机 1000 例不崩溃。
- report：JSON 字段/转义（引号/换行/控制字符/中文）、tail UTF-8 安全截断、空批次 allPassed=false、写文件。
- Process/ProcessJobExecutor：成功/失败/信号退出码 128+sig/超时 Timeout/整进程树 kill/stdin/tail/无僵尸/fd 不泄漏。
- 假栈：fake-java StackProvisioner（复制/改端口/ready/stop/超时/并发 start/端口占用），fake executor 真实并行重叠、失败/超时隔离、证据 JSON 完整。
- factory 真实栈执行器（仍用 fake-java，不启真 Paper）：**每 slot 只冷启动一次 Paper 并复用**（回归红队 P1 风险）、两 slot 端口/栈独立、失败/超时不连坐。
- 差分：串行 workers=1 vs 并行 workers=3 每 job 状态/退出码映射一致。

## flake 与环境注意（R9，已定位非实现 bug）

- `test_stack_fake` / `test_factory_fake` 需要真实 TCP 端口：`pick_free_base()` 选到空闲端口后、fake Paper
  preflight 前存在被外部进程抢占的窗口。**不要并发跑本 ctest 与真实 Paper e2e/其他 agent 的 e2e**
  （串行/空闲机器单轮全绿；并发时可能出现 `StackStartError: worker N 的端口被占用` → 用例失败）。
  出现该类失败请重跑；后续可加「冲突换基址重试」或机器级端口锁。
- TSAN/ASan 需要本机 sanitizer 运行库（见上面环境准备），`tools/test-matrix.sh` 已自动处理 `-L` 与运行期 `LD_LIBRARY_PATH`。
- `loom-unit` 会跑全部用例，`loom-fake-integration` 再跑 `integration:*` 子集（重复执行，仅慢，不影响正确性）。

## 约定

- **测试不能为了让实现变绿而放宽断言**；发现实现 bug：记录复现命令 + 最小用例，报 Lead/native-core，
  等实现修复后复跑（测试文件里保留原始断言）。
- 假栈集成不启真 Paper（`fake-java.sh` 模拟 ready/stop，`fake-job*.sh` 模拟 job 行为）；
  真实 2–3 worker 集成由 native-stack/Lead 执行。
- ctest 测试名：`loom-unit`（全部单测）、`loom-fake-integration`（`integration:*` 用例）。
