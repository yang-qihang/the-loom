# native-test：独立测试体系（doctest 单测 + 假栈集成 + sanitizer/TSAN 入口）
#
# 由 native/e2e-runner/CMakeLists.txt 在 if(EXISTS tests) 时 add_subdirectory(tests) 引入。
# 若核心头文件尚未落盘则安全跳过（实现/测试并行开发）。
# 约定（与 native-core 对齐）：链接 loom-core（若存在）+ doctest；调用 loom_apply_build_flags。

get_filename_component(LOOM_RUNNER_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(LOOM_INCLUDE_DIR "${LOOM_RUNNER_ROOT}/include")
set(LOOM_SRC_DIR "${LOOM_RUNNER_ROOT}/src")

if(NOT EXISTS "${LOOM_INCLUDE_DIR}/loom/scheduler.hpp")
  message(STATUS "native-test: ${LOOM_INCLUDE_DIR}/loom/scheduler.hpp 尚未就绪，跳过 tests")
  return()
endif()

file(GLOB LOOM_TEST_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp")
list(REMOVE_ITEM LOOM_TEST_SOURCES "${CMAKE_CURRENT_SOURCE_DIR}/test_main.cpp")

# 需要 native-stack 的测试（fake Paper / fake executor）在 loom-stack 目标存在时才编入
if(TARGET loom-stack)
  set(LOOM_HAVE_STACK TRUE)
else()
  set(LOOM_HAVE_STACK FALSE)
  list(FILTER LOOM_TEST_SOURCES EXCLUDE REGEX ".*/test_stack_fake\\.cpp$")
  list(FILTER LOOM_TEST_SOURCES EXCLUDE REGEX ".*/test_integration_fake\\.cpp$")
  list(FILTER LOOM_TEST_SOURCES EXCLUDE REGEX ".*/test_factory_fake\\.cpp$")
  message(STATUS "native-test: 无 loom-stack 目标，跳过 stack/fake 集成测试")
endif()

add_executable(loom-tests
  "${CMAKE_CURRENT_SOURCE_DIR}/test_main.cpp"
  ${LOOM_TEST_SOURCES}
)

# doctest 头目录按 SYSTEM 引入，避免第三方头触发 -Werror
target_include_directories(loom-tests SYSTEM PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")
target_include_directories(loom-tests PRIVATE "${LOOM_INCLUDE_DIR}" "${LOOM_RUNNER_ROOT}")
target_compile_features(loom-tests PRIVATE cxx_std_20)
target_compile_definitions(loom-tests PRIVATE
  LOOM_TEST_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
  LOOM_REPO_ROOT="${LOOM_RUNNER_ROOT}/../.."
  LOOM_HAVE_STACK=$<BOOL:${LOOM_HAVE_STACK}>
)

# 链接实现：优先 loom-core；若 core 的 CMakeLists 尚未接好，则退化为直接编译 src/*.cpp（排除 main）。
if(TARGET loom-core)
  target_link_libraries(loom-tests PRIVATE loom-core)
else()
  message(STATUS "native-test: 无 loom-core 目标，回退为直接编译 src/*.cpp 构建测试")
  file(GLOB LOOM_IMPL_SOURCES CONFIGURE_DEPENDS "${LOOM_SRC_DIR}/*.cpp")
  list(FILTER LOOM_IMPL_SOURCES EXCLUDE REGEX ".*/main[^/]*\\.cpp$")
  target_sources(loom-tests PRIVATE ${LOOM_IMPL_SOURCES})
endif()
if(TARGET loom-stack)
  target_link_libraries(loom-tests PRIVATE loom-stack)
endif()

# 与 core 统一的编译/告警/sanitizer 标志（函数由主 CMakeLists 定义；退化时本地补齐）
if(COMMAND loom_apply_build_flags)
  loom_apply_build_flags(loom-tests)
else()
  target_compile_options(loom-tests PRIVATE -Wall -Wextra -Wpedantic)
  if(DEFINED LOOM_SANITIZE AND NOT LOOM_SANITIZE STREQUAL "")
    if(LOOM_SANITIZE STREQUAL "thread")
      set(LOOM_SAN_FLAGS "-fsanitize=thread -fno-omit-frame-pointer -g")
    else()
      set(LOOM_SAN_FLAGS "-fsanitize=address,undefined -fno-omit-frame-pointer -g")
    endif()
    separate_arguments(LOOM_SAN_FLAGS UNIX_COMMAND "${LOOM_SAN_FLAGS}")
    target_compile_options(loom-tests PRIVATE ${LOOM_SAN_FLAGS})
    target_link_options(loom-tests PRIVATE ${LOOM_SAN_FLAGS})
  endif()
endif()

# ---- ctest 注册 -------------------------------------------------------------
set(LOOM_TEST_ENV "")
if(DEFINED LOOM_SANITIZE AND LOOM_SANITIZE MATCHES "address")
  list(APPEND LOOM_TEST_ENV
    "ASAN_OPTIONS=detect_leaks=1:abort_on_error=1:strict_string_checks=1:check_initialization_order=1"
    "UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1")
elseif(DEFINED LOOM_SANITIZE AND LOOM_SANITIZE STREQUAL "thread")
  list(APPEND LOOM_TEST_ENV "TSAN_OPTIONS=halt_on_error=1:second_deadlock_stack=1")
endif()

function(loom_configure_test name)
  set_tests_properties(${name} PROPERTIES
    TIMEOUT 600
    WORKING_DIRECTORY "${LOOM_RUNNER_ROOT}/../..")
  if(LOOM_TEST_ENV)
    set_tests_properties(${name} PROPERTIES ENVIRONMENT "${LOOM_TEST_ENV}")
  endif()
endfunction()

add_test(NAME loom-unit COMMAND loom-tests)
loom_configure_test(loom-unit)

if(LOOM_HAVE_STACK)
  add_test(NAME loom-fake-integration COMMAND loom-tests "--test-case=integration:*")
  loom_configure_test(loom-fake-integration)
endif()

message(STATUS "native-test: 已启用 loom-tests（stack=${LOOM_HAVE_STACK}, sanitize='${LOOM_SANITIZE}'）")
