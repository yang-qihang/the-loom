// native-stack factory 集成（create_stack_executor + fake-java 假 Paper，不启真 Paper）：
// - 每 slot 只冷启动一次 Paper（栈复用；红队 P1「每 job 冷启动」风险项的回归断言）
// - 两个 slot 各自独立栈/端口
// - job 失败不连坐其它 slot
#include <unistd.h>

#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "doctest.h"
#include "loom/config.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"
#include "loom/stack.hpp"
#include "test_stack_util.hpp"
#include "test_util.hpp"

namespace {
/** 生成「记录每次被启动」的 java 包装脚本，便于断言 Paper 冷启动次数。 */
std::filesystem::path make_counting_java(const std::filesystem::path& dir) {
  const auto log = dir / "paper-starts.log";
  const auto wrapper = dir / "counting-java.sh";
  std::ofstream out(wrapper);
  out << "#!/bin/sh\n";
  out << "echo \"start $$ $(date +%s%N)\" >> \"" << log.string() << "\"\n";
  out << "exec \"" << std::string(LOOM_TEST_DIR) << "/fake-java.sh\" \"$@\"\n";
  out.close();
  std::filesystem::permissions(wrapper, std::filesystem::perms::owner_exec | std::filesystem::perms::group_exec,
                               std::filesystem::perm_options::add);
  return wrapper;
}

int count_starts(const std::filesystem::path& log) {
  if (!std::filesystem::exists(log)) return 0;
  std::ifstream in(log);
  int lines = 0;
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty()) ++lines;
  }
  return lines;
}

loom::JobSpec stack_job(const std::string& id, int slot, int mc_port, int rpc_port, const std::string& command,
                        int timeout_ms = 20000) {
  loom::JobSpec job;
  job.id = id;
  job.level = id;
  job.command = command;
  job.timeout_ms = timeout_ms;
  job.env["LOOM_WORKER"] = std::to_string(slot);
  job.env["MC_PORT"] = std::to_string(mc_port);
  job.env["MC_RPC_PORT"] = std::to_string(rpc_port);
  return job;
}
}  // namespace

TEST_CASE("factory: 同一 slot 的两个 job 只冷启动一次 Paper（栈复用）") {
  loom_test::TempDir dir("factory-reuse");
  const auto template_dir = loom_test::write_fake_paper_template(dir.path / "template");
  const auto work_root = dir.path / "work";
  const auto log_dir = dir.path / "logs";
  std::filesystem::create_directories(work_root);
  std::filesystem::create_directories(log_dir);
  const int base = loom_test::pick_free_base(6);
  const auto counting_java = make_counting_java(dir.path);
  auto config = loom_test::make_stack_config(template_dir, work_root, log_dir, base, base + 3);
  config.java_bin = counting_java;
  config.workers = 3;

  auto executor = loom::create_stack_executor(config);
  REQUIRE(executor != nullptr);
  const auto command = std::string(LOOM_TEST_DIR) + "/fake-job.sh";
  const auto first = executor->run(stack_job("L01", 0, base + 0, base + 3 + 0, command));
  const auto second = executor->run(stack_job("L02", 0, base + 0, base + 3 + 0, command));
  CHECK(first.status == loom::JobStatus::Pass);
  CHECK(second.status == loom::JobStatus::Pass);
  CHECK(count_starts(dir.path / "paper-starts.log") == 1);  // 同 slot 复用，不重复冷启动

  // 另一个 slot 才需要第二份 Paper
  const auto third = executor->run(stack_job("L03", 1, base + 1, base + 3 + 1, command));
  CHECK(third.status == loom::JobStatus::Pass);
  CHECK(count_starts(dir.path / "paper-starts.log") == 2);
}

TEST_CASE("factory: 两个 slot 并发执行互不污染（端口/栈独立）") {
  loom_test::TempDir dir("factory-parallel");
  const auto template_dir = loom_test::write_fake_paper_template(dir.path / "template");
  const auto work_root = dir.path / "work";
  const auto log_dir = dir.path / "logs";
  std::filesystem::create_directories(work_root);
  std::filesystem::create_directories(log_dir);
  const int base = loom_test::pick_free_base(6);
  const auto counting_java = make_counting_java(dir.path);
  auto config = loom_test::make_stack_config(template_dir, work_root, log_dir, base, base + 3);
  config.java_bin = counting_java;
  config.workers = 2;

  auto executor = loom::create_stack_executor(config);
  REQUIRE(executor != nullptr);
  const auto command = std::string(LOOM_TEST_DIR) + "/fake-job-env.sh";
  std::vector<loom::JobSpec> jobs = {
      stack_job("L01", 0, base + 0, base + 3 + 0, command),
      stack_job("L02", 1, base + 1, base + 3 + 1, command),
  };
  loom::SchedulerOptions options;
  options.workers = 2;
  // Scheduler 会用 options.mc_base_port/rpc_base_port 注入 MC_PORT/MC_RPC_PORT → 与栈配置保持一致
  options.mc_base_port = base;
  options.rpc_base_port = base + 3;
  options.bot_prefix = "TestGolem";
  loom::Scheduler scheduler(options, std::move(executor));
  const auto results = scheduler.run_all(jobs);
  REQUIRE(results.size() == 2);
  for (const auto& result : results) CHECK(result.status == loom::JobStatus::Pass);
  // 两个 job 分别在各自栈上运行：各自 env 里的端口与所属 slot 一致
  const auto& first_tail = results[0].tail_log;
  const auto& second_tail = results[1].tail_log;
  INFO("first_tail=" << first_tail);
  INFO("second_tail=" << second_tail);
  INFO("starts=" << count_starts(dir.path / "paper-starts.log"));
  CHECK(first_tail.find("env MC_PORT=" + std::to_string(base + 0)) != std::string::npos);
  CHECK(second_tail.find("env MC_PORT=" + std::to_string(base + 1)) != std::string::npos);
  CHECK(first_tail.find("env MC_RPC_PORT=" + std::to_string(base + 3)) != std::string::npos);
  CHECK(second_tail.find("env MC_RPC_PORT=" + std::to_string(base + 3 + 1)) != std::string::npos);
  CHECK(first_tail.find("env BOT_NAME=TestGolem0") != std::string::npos);
  CHECK(second_tail.find("env BOT_NAME=TestGolem1") != std::string::npos);
  CHECK(count_starts(dir.path / "paper-starts.log") == 2);
}

TEST_CASE("factory: 一个 slot 的 job 失败/超时不影响其它 slot") {
  loom_test::TempDir dir("factory-isolation");
  const auto template_dir = loom_test::write_fake_paper_template(dir.path / "template");
  const auto work_root = dir.path / "work";
  const auto log_dir = dir.path / "logs";
  std::filesystem::create_directories(work_root);
  std::filesystem::create_directories(log_dir);
  const int base = loom_test::pick_free_base(6);
  auto config = loom_test::make_stack_config(template_dir, work_root, log_dir, base, base + 3);
  config.workers = 2;

  auto executor = loom::create_stack_executor(config);
  REQUIRE(executor != nullptr);
  std::vector<loom::JobSpec> jobs = {
      stack_job("L01", 0, base + 0, base + 3 + 0, std::string(LOOM_TEST_DIR) + "/fake-job-hang.sh", 400),
      stack_job("L02", 1, base + 1, base + 3 + 1, std::string(LOOM_TEST_DIR) + "/fake-job.sh"),
  };
  jobs[1].env["FAKE_JOB_SLEEP"] = "0.05";
  loom::SchedulerOptions options;
  options.workers = 2;
  options.mc_base_port = base;
  options.rpc_base_port = base + 3;
  loom::Scheduler scheduler(options, std::move(executor));
  const auto results = scheduler.run_all(jobs);
  REQUIRE(results.size() == 2);
  CHECK(results[0].status == loom::JobStatus::Timeout);
  CHECK(results[0].exit_code == loom::kTimeoutExitCode);  // 与 core 统一：超时 137
  CHECK(results[1].status == loom::JobStatus::Pass);
}
