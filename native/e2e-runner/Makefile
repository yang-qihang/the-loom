# native/e2e-runner 常用目标（也可直接用 cmake；docs/58 §5 的验收命令）。
#
#   make build         Release 构建（默认）
#   make debug         Debug 构建
#   make sanitize      ASan+UBSan 构建（Debug）
#   make tsan          TSAN 构建（Debug）
#   make test          在 Release 构建上跑 ctest（tests/ 存在时）
#   make test-sanitize ASan+UBSan 下跑 ctest
#   make test-tsan     TSAN 下跑 ctest
#   make dry-run       用 Release 二进制做一个 L01,L02 的 --dry-run 冒烟
#   make clean         删除 tmp/ 下的构建目录

ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
# 本机 g++ 是 ccache wrapper；~/.cache 只读时必须把缓存指到工作区（否则 configure/build 失败）。
CCACHE_DIR ?= $(ROOT)/../../tmp/ccache
export CCACHE_DIR
BUILD_DIR ?= $(ROOT)/../../tmp/native-build
REL_DIR ?= $(ROOT)/../../tmp/native-build-rel
DEBUG_DIR ?= $(ROOT)/../../tmp/native-build-debug
SAN_DIR ?= $(ROOT)/../../tmp/native-build-asan
TSAN_DIR ?= $(ROOT)/../../tmp/native-build-tsan
# 本机 gcc 的 sanitizer 运行时 SONAME 在系统 ld 路径里缺失；用仓库内副本（链接 -L + 运行 LD_LIBRARY_PATH）。
SAN_LIBS ?= $(ROOT)/../../tmp/native-sanitizer-libs
SAN_LINK_FLAGS := -DCMAKE_EXE_LINKER_FLAGS=-L$(SAN_LIBS)

.PHONY: all build debug sanitize tsan test test-release test-sanitize test-tsan dry-run clean

all: build

build:
	cmake -S $(ROOT) -B $(REL_DIR) -DCMAKE_BUILD_TYPE=Release
	cmake --build $(REL_DIR) -j

debug:
	cmake -S $(ROOT) -B $(DEBUG_DIR) -DCMAKE_BUILD_TYPE=Debug
	cmake --build $(DEBUG_DIR) -j

sanitize:
	cmake -S $(ROOT) -B $(SAN_DIR) -DCMAKE_BUILD_TYPE=Debug -DLOOM_SANITIZE=address,undefined \
	  -DCMAKE_EXE_LINKER_FLAGS="-L$(SAN_LIBS)"
	cmake --build $(SAN_DIR) -j

tsan:
	cmake -S $(ROOT) -B $(TSAN_DIR) -DCMAKE_BUILD_TYPE=Debug -DLOOM_SANITIZE=thread \
	  -DCMAKE_EXE_LINKER_FLAGS="-L$(SAN_LIBS)"
	cmake --build $(TSAN_DIR) -j

test: build
	ctest --test-dir $(REL_DIR) --output-on-failure

test-release: test

test-sanitize: sanitize
	LD_LIBRARY_PATH=$(SAN_LIBS) ASAN_OPTIONS=detect_leaks=1 ctest --test-dir $(SAN_DIR) --output-on-failure

test-tsan: tsan
	LD_LIBRARY_PATH=$(SAN_LIBS) TSAN_OPTIONS=halt_on_error=1 ctest --test-dir $(TSAN_DIR) --output-on-failure

dry-run: build
	$(REL_DIR)/loom-e2e --levels L01,L02 --dry-run

clean:
	rm -rf $(REL_DIR) $(DEBUG_DIR) $(SAN_DIR) $(TSAN_DIR)
