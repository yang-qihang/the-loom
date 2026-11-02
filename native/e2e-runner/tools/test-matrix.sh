#!/bin/bash
# native-test：完整测试矩阵（普通 / ASan+UBSan / TSAN / valgrind）。
# 用法（仓库根目录）：
#   bash native/e2e-runner/tools/test-matrix.sh [all|plain|asan|tsan|valgrind]
# 产物：tmp/native-{build,asan,tsan,valgrind}；日志 tee 到 evidence/native-e2e/*.log
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
RUNNER="$ROOT/native/e2e-runner"
EVID="$ROOT/evidence/native-e2e"
mkdir -p "$EVID"
# 本机 g++ 是 ccache wrapper，~/.cache/ccache 只读 → 必须把 CCACHE_DIR 指到工作区。
export CCACHE_DIR="${CCACHE_DIR:-$ROOT/tmp/ccache}"
export CCACHE_BASEDIR="$ROOT"
mkdir -p "$CCACHE_DIR"
# 本机 gcc 16 的 sanitizer 运行时库由 Lead 放在稳定路径（Fedora 44 libasan/libtsan/libubsan）；
# 等价可 `dnf install libasan libtsan libubsan`。
SAN_LIBS="$ROOT/tmp/native-sanitizer-libs"
if [ -d "$SAN_LIBS" ]; then
  export LIBRARY_PATH="$SAN_LIBS${LIBRARY_PATH:+:$LIBRARY_PATH}"
  export LD_LIBRARY_PATH="$SAN_LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
MODE="${1:-all}"
FAIL=0

run_plain() {
  echo "== [plain] configure + build + ctest =="
  cmake -S "$RUNNER" -B "$ROOT/tmp/native-build" -DCMAKE_BUILD_TYPE=Release 2>&1 | tail -3 || return 1
  cmake --build "$ROOT/tmp/native-build" -j "$(nproc)" 2>&1 | tail -3 || return 1
  ctest --test-dir "$ROOT/tmp/native-build" --output-on-failure -j 2 2>&1 | tee "$EVID/ctest-plain.log" | tail -5
  return "${PIPESTATUS[0]}"
}

run_asan() {
  echo "== [asan+ubsan] configure + build + ctest =="
  cmake -S "$RUNNER" -B "$ROOT/tmp/native-build-asan" -DCMAKE_BUILD_TYPE=Debug \
    -DLOOM_SANITIZE=address,undefined \
    -DCMAKE_CXX_FLAGS="-L${SAN_LIBS}" \
    -DCMAKE_EXE_LINKER_FLAGS="-L${SAN_LIBS}" 2>&1 | tail -3 || return 1
  cmake --build "$ROOT/tmp/native-build-asan" -j "$(nproc)" 2>&1 | tail -3 || return 1
  ASAN_OPTIONS=detect_leaks=1:abort_on_error=1 UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
    ctest --test-dir "$ROOT/tmp/native-build-asan" --output-on-failure -j 1 2>&1 | tee "$EVID/ctest-asan.log" | tail -5
  return "${PIPESTATUS[0]}"
}

run_tsan() {
  echo "== [tsan] configure + build + ctest =="
  cmake -S "$RUNNER" -B "$ROOT/tmp/native-build-tsan" -DCMAKE_BUILD_TYPE=Debug \
    -DLOOM_SANITIZE=thread \
    -DCMAKE_CXX_FLAGS="-L${SAN_LIBS}" \
    -DCMAKE_EXE_LINKER_FLAGS="-L${SAN_LIBS}" 2>&1 | tail -3 || return 1
  cmake --build "$ROOT/tmp/native-build-tsan" -j "$(nproc)" 2>&1 | tail -3 || return 1
  TSAN_OPTIONS=halt_on_error=1:second_deadlock_stack=1 \
    ctest --test-dir "$ROOT/tmp/native-build-tsan" --output-on-failure -j 1 2>&1 | tee "$EVID/ctest-tsan.log" | tail -5
  return "${PIPESTATUS[0]}"
}

run_valgrind() {
  echo "== [valgrind] unit subset =="
  local bin="$ROOT/tmp/native-build/tests/loom-tests"
  [ -x "$bin" ] || { echo "缺少 $bin，先跑 plain"; return 1; }
  valgrind --error-exitcode=1 --leak-check=full --show-leak-kinds=definite,indirect \
    --errors-for-leak-kinds=definite,indirect --track-fds=yes \
    "$bin" --test-case="scheduler:*,ports:*,config:*,report:*,process:*" \
    2>&1 | tee "$EVID/valgrind.log" | tail -12
  return "${PIPESTATUS[0]}"
}

case "$MODE" in
  all) run_plain; FAIL=$((FAIL+$?)); run_asan; FAIL=$((FAIL+$?)); run_tsan; FAIL=$((FAIL+$?)) ;;
  plain) run_plain; FAIL=$? ;;
  asan) run_asan; FAIL=$? ;;
  tsan) run_tsan; FAIL=$? ;;
  valgrind) run_valgrind; FAIL=$? ;;
  *) echo "unknown mode: $MODE" >&2; exit 2 ;;
esac
if [ "$FAIL" -ne 0 ]; then echo "MATRIX FAIL"; exit 1; fi
echo "MATRIX PASS"
