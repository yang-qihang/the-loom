// config 契约测试（native-core config.hpp）：
// 默认值、flags、异常（loom::CliError）、--help、level→job 展开、argc 重载、随机输入不崩溃。
#include <algorithm>
#include <cstdint>
#include <span>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

#include "doctest.h"
#include "loom/config.hpp"
#include "loom/scheduler.hpp"

namespace {
loom::RunConfig parse(std::vector<std::string> args) {
  std::vector<std::string_view> views;
  views.reserve(args.size());
  for (const auto& arg : args) views.emplace_back(arg);
  return loom::parse_args(std::span<const std::string_view>(views.data(), views.size()));
}
}  // namespace

TEST_CASE("config: 无参数时使用默认值") {
  const auto config = parse({});
  CHECK(config.workers == 3);
  CHECK(config.levels.size() == 10);
  CHECK(config.levels.front() == "L01");
  CHECK(config.levels.back() == "L10");
  CHECK(config.timeout_ms == 900000);
  CHECK(config.mc_base_port == 25565);
  CHECK(config.rpc_base_port == 8765);
  CHECK_FALSE(config.dry_run);
  CHECK_FALSE(config.fake);
  CHECK_FALSE(config.verbose);
  CHECK_FALSE(config.show_help);
  CHECK_FALSE(config.paper_template.empty());
  CHECK_FALSE(config.out.empty());
  CHECK_FALSE(config.command_template.empty());
}

TEST_CASE("config: 合法 flags 全部解析") {
  const auto config = parse({"--levels", "L01,L05,L10",
                             "--workers", "2",
                             "--paper-template", "tmp/fake-paper",
                             "--work-root", "tmp/work-x",
                             "--out", "tmp/out-x.json",
                             "--timeout-ms", "12345",
                             "--mc-base-port", "31000",
                             "--rpc-base-port", "32000",
                             "--command-template", "run {level} {level_num}",
                             "--dry-run",
                             "--fake",
                             "--verbose"});
  REQUIRE(config.levels.size() == 3);
  CHECK(config.levels[0] == "L01");
  CHECK(config.levels[1] == "L05");
  CHECK(config.levels[2] == "L10");
  CHECK(config.workers == 2);
  CHECK(config.paper_template == "tmp/fake-paper");
  CHECK(config.work_root == "tmp/work-x");
  CHECK(config.out == "tmp/out-x.json");
  CHECK(config.timeout_ms == 12345);
  CHECK(config.mc_base_port == 31000);
  CHECK(config.rpc_base_port == 32000);
  CHECK(config.command_template == "run {level} {level_num}");
  CHECK(config.dry_run);
  CHECK(config.fake);
  CHECK(config.verbose);
}

TEST_CASE("config: --help 设置 show_help 且不抛异常") {
  loom::RunConfig config;
  CHECK_NOTHROW(config = parse({"--help"}));
  CHECK(config.show_help);
  CHECK_FALSE(loom::usage_text().empty());
}

TEST_CASE("config: argc/argv 重载跳过 argv[0]") {
  const char* argv[] = {"loom-e2e", "--workers", "4", "--levels", "L02"};
  const auto config = loom::parse_args(5, argv);
  CHECK(config.workers == 4);
  REQUIRE(config.levels.size() == 1);
  CHECK(config.levels[0] == "L02");
}

TEST_CASE("config: 非法输入抛 loom::CliError（std::invalid_argument 子类）") {
  CHECK_THROWS_AS(parse({"--workers", "0"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--workers", "-3"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--workers", "abc"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--timeout-ms", "-1"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--timeout-ms", "10ms"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--mc-base-port", "70000"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--levels", ""}), std::invalid_argument);
  // Lead 2026-11-02 裁决：--levels 每段必须匹配 L01–L10；空段/未知关必须报错（CliError）。
  CHECK_THROWS_AS(parse({"--levels", "L01,,L03"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--levels", "L99"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--levels", "L00"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--levels", "L11"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--levels", "L01,L01"}), std::invalid_argument);  // 重复关卡拒绝
  CHECK_THROWS_AS(parse({"--levels", "L01, L01"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--unknown-flag"}), std::invalid_argument);
  CHECK_THROWS_AS(parse({"--workers"}), std::invalid_argument);  // 缺值
  try {
    parse({"--workers", "0"});
  } catch (const std::invalid_argument& error) {
    CHECK(std::string(error.what()).size() > 0);
  }
}

TEST_CASE("config: expand_command_template 替换 level 与 level_num") {
  CHECK(loom::expand_command_template("npx tsx it/l{level_num}-real.ts", "L05") == "npx tsx it/l5-real.ts");
  CHECK(loom::expand_command_template("npx tsx it/l{level_num}-real.ts", "L10") == "npx tsx it/l10-real.ts");
  CHECK(loom::expand_command_template("run --level {level} -n {level_num}", "L03") == "run --level L03 -n 3");
  CHECK(loom::expand_command_template("x {id} {level}", "L05") == "x L05 L05");
  CHECK(loom::expand_command_template("no-placeholder", "L01") == "no-placeholder");
}

TEST_CASE("config: build_jobs 按 levels 顺序生成 JobSpec（id/level/command/timeout）") {
  auto config = parse({"--levels", "L01,L05", "--timeout-ms", "4321", "--command-template", "npx tsx it/l{level_num}-real.ts"});
  const auto jobs = loom::build_jobs(config);
  REQUIRE(jobs.size() == 2);
  CHECK(jobs[0].id == "L01");
  CHECK(jobs[0].level == "L01");
  CHECK(jobs[0].command == "npx tsx it/l1-real.ts");
  CHECK(jobs[0].timeout_ms == 4321);
  CHECK(jobs[1].id == "L05");
  CHECK(jobs[1].command == "npx tsx it/l5-real.ts");
}

TEST_CASE("config: stack_config_from 映射端口/模板/工作目录") {
  const auto config = parse({"--paper-template", "tmp/tpl", "--work-root", "tmp/wr", "--timeout-ms", "777",
                             "--mc-base-port", "31111", "--rpc-base-port", "32222"});
  const auto stack = loom::stack_config_from(config);
  CHECK(stack.paper_template == "tmp/tpl");
  CHECK(stack.work_root == "tmp/wr");
  CHECK(stack.mc_base_port == 31111);
  CHECK(stack.rpc_base_port == 32222);
}

TEST_CASE("config: 随机/畸形参数 1000 例不崩溃（解析成功则配置自洽）") {
  std::vector<std::string> tokens = {
      "--levels", "L01,L02", "L01", "L10", "--workers", "2", "3", "0", "-1", "999",
      "--timeout-ms", "1000", "--mc-base-port", "31000", "--rpc-base-port", "32000",
      "--dry-run", "--fake", "--help", "--command-template", "x {level} {level_num}",
      "--paper-template", "", "--out", "--work-root", "--unknown", "", " ", "L99", "L0",
      "--levels=", "x", "--workers=", "--timeout-ms=abc", "--levels=L01,,L02",
      "中文参数", "--levels", "L01", "L02", "L03", "--workers", "32",
  };
  // 确定性伪随机（避免依赖平台 random_device）
  uint64_t state = 0x9e3779b97f4a7c15ULL;
  auto next = [&state]() {
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    return state;
  };
  for (int case_index = 0; case_index < 1000; ++case_index) {
    std::vector<std::string> args;
    const int count = static_cast<int>(next() % 7);
    for (int i = 0; i < count; ++i) {
      args.push_back(tokens[next() % tokens.size()]);
    }
    try {
      const auto config = parse(args);
      // 解析成功时不变式：workers >= 1；levels 非空；端口在合法区间
      CHECK(config.workers >= 1);
      CHECK_FALSE(config.levels.empty());
      CHECK(config.mc_base_port >= 1);
      CHECK(config.mc_base_port <= 65535);
      CHECK(config.rpc_base_port >= 1);
      CHECK(config.rpc_base_port <= 65535);
      const auto jobs = loom::build_jobs(config);
      CHECK(jobs.size() == config.levels.size());
    } catch (const std::invalid_argument&) {
      // 允许：非法输入 → 中文错误异常
    }
  }
}
