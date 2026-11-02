# native/e2e-runner — 并行真实 Paper e2e 执行器（C++20；docs/58）
#
# 目标分层：
#   loom-core   静态库：config / scheduler / ports / report / process（可被 tests/ 直接链接）
#   loom-stack  静态库：native-stack 提供的 src/factory.cpp、src/stack*.cpp（存在才构建）
#   loom-e2e    可执行：src/main.cpp（无 stack 实现时仍可用 --dry-run）
#
# 约定：
#   * 默认 Release；`-DLOOM_SANITIZE=address,undefined` 或 `-DLOOM_SANITIZE=thread` 打开 sanitizer；
#   * tests/ 目录由 native-test 提供：存在 tests/CMakeLists.txt 时自动 add_subdirectory；
#   * tests 目标请调用本文件导出的 `loom_apply_build_flags(<target>)` 统一警告/sanitizer 标志。
cmake_minimum_required(VERSION 3.20)
project(loom_e2e LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "构建类型（默认 Release）" FORCE)
endif()

set(LOOM_SANITIZE "" CACHE STRING "sanitizer：address,undefined 或 thread（空=关闭）")
option(LOOM_WITH_STACK "编译 native-stack 的 src/factory.cpp|stack*.cpp（OFF=只构建 core，--dry-run 可用）" ON)
option(LOOM_BUILD_TESTS "自动接入 tests/（存在 tests/CMakeLists.txt 时）" ON)

find_package(Threads REQUIRED)

# 统一编译/链接标志：警告即错误 + 强化断言 + sanitizer。tests/ 也应调用它。
function(loom_apply_build_flags target)
  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /WX /permissive-)
  else()
    target_compile_options(${target} PRIVATE
      -Wall -Wextra -Wpedantic -Werror
      -D_GLIBCXX_ASSERTIONS
      -fstack-protector-strong
    )
    if(LOOM_SANITIZE)
      target_compile_options(${target} PRIVATE -fsanitize=${LOOM_SANITIZE} -fno-omit-frame-pointer -g)
      target_link_options(${target} PRIVATE -fsanitize=${LOOM_SANITIZE})
    endif()
  endif()
  target_link_libraries(${target} PRIVATE Threads::Threads)
endfunction()

# ---------------------------------------------------------------- core（可独立编译/测试）
add_library(loom-core STATIC
  src/config.cpp
  src/scheduler.cpp
  src/ports.cpp
  src/report.cpp
  src/process.cpp
)
target_include_directories(loom-core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
loom_apply_build_flags(loom-core)
if(WIN32)
  # ports.cpp 的 is_port_available 走 winsock；process.cpp 用 CreateProcessW/Job Object。
  target_link_libraries(loom-core PUBLIC ws2_32)
  target_compile_definitions(loom-core PRIVATE _WIN32_WINNT=0x0A00 NOMINMAX WIN32_LEAN_AND_MEAN)
endif()

# ---------------------------------------------------------------- stack（native-stack 提供；存在才构建）
set(LOOM_STACK_SOURCES "")
if(LOOM_WITH_STACK)
  file(GLOB LOOM_STACK_SOURCES CONFIGURE_DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/src/factory.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/stack.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/src/stack_*.cpp
  )
endif()
if(LOOM_STACK_SOURCES)
  add_library(loom-stack STATIC ${LOOM_STACK_SOURCES})
  target_link_libraries(loom-stack PUBLIC loom-core)
  loom_apply_build_flags(loom-stack)
  set(LOOM_HAS_STACK 1)
  message(STATUS "native/e2e-runner: 检测到 native-stack 源文件 → 启用真实执行路径")
else()
  set(LOOM_HAS_STACK 0)
  message(STATUS "native/e2e-runner: 未检测到 src/factory.cpp|stack*.cpp → 真实执行不可用（--dry-run 可用）")
endif()

# ---------------------------------------------------------------- 可执行
add_executable(loom-e2e src/main.cpp)
target_link_libraries(loom-e2e PRIVATE loom-core)
if(LOOM_HAS_STACK)
  target_link_libraries(loom-e2e PRIVATE loom-stack)
endif()
target_compile_definitions(loom-e2e PRIVATE LOOM_HAS_STACK=${LOOM_HAS_STACK})
loom_apply_build_flags(loom-e2e)

# ---------------------------------------------------------------- tests（native-test 提供）
if(LOOM_BUILD_TESTS AND EXISTS ${CMAKE_CURRENT_SOURCE_DIR}/tests/CMakeLists.txt)
  enable_testing()
  add_subdirectory(tests)
endif()
