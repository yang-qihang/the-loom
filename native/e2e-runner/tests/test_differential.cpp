// 差分测试（docs/58 §4.7）：同一批 job 串行（workers=1）vs 并行（workers=3）结果映射一致。
// 用真实子进程（ProcessJobExecutor / create_process_executor），不启 Paper。
#include <string>
#include <vector>

#include "doctest.h"
#include "loom/config.hpp"
#include "loom/process.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"
#include "test_util.hpp"

namespace {
struct Mapping {
  std::string id;
  std::string level;
  loom::JobStatus status;
  int exit_code;
  bool operator==(const Mapping& other) const {
    return id == other.id && level == other.level && status == other.status && exit_code == other.exit_code;
  }
};

std::vector<Mapping> to_mapping(const std::vector<loom::JobResult>& results) {
  std::vector<Mapping> out;
  out.reserve(results.size());
  for (const auto& result : results) {
    out.push_back({result.job.id, result.job.level, result.status, result.exit_code});
  }
  return out;
}

std::vector<loom::JobSpec> make_mixed_jobs() {
  const std::string dir = LOOM_TEST_DIR;
  std::vector<loom::JobSpec> jobs;
  auto add = [&](const std::string& id, const std::string& script, const std::string& sleep_s) {
    loom::JobSpec job = loom_test::make_job(id, id, 30000);
    job.command = dir + "/" + script;
    job.env["FAKE_JOB_SLEEP"] = sleep_s;
    jobs.push_back(job);
  };
  add("L01", "fake-job.sh", "0.10");
  add("L02", "fake-job-fail.sh", "0.05");
  add("L03", "fake-job.sh", "0.20");
  add("L04", "fake-job-crash.sh", "0.05");
  add("L05", "fake-job.sh", "0.05");
  return jobs;
}
}  // namespace

TEST_CASE("differential: 串行 workers=1 vs 并行 workers=3 每 job 结果映射一致") {
  auto serial_executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  auto parallel_executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  REQUIRE(serial_executor != nullptr);
  REQUIRE(parallel_executor != nullptr);

  loom::SchedulerOptions serial_options;
  serial_options.workers = 1;
  loom::Scheduler serial(serial_options, std::move(serial_executor));
  loom::SchedulerOptions parallel_options;
  parallel_options.workers = 3;
  loom::Scheduler parallel(parallel_options, std::move(parallel_executor));

  const auto jobs = make_mixed_jobs();
  const auto serial_results = serial.run_all(jobs);
  const auto parallel_results = parallel.run_all(jobs);

  REQUIRE(serial_results.size() == jobs.size());
  REQUIRE(parallel_results.size() == jobs.size());
  CHECK(to_mapping(serial_results) == to_mapping(parallel_results));
  // 逐项校验（失败信息更具体）
  for (std::size_t i = 0; i < jobs.size(); ++i) {
    CHECK(serial_results[i].job.id == jobs[i].id);
    CHECK(parallel_results[i].job.id == jobs[i].id);
    CHECK(serial_results[i].status == parallel_results[i].status);
    CHECK(serial_results[i].exit_code == parallel_results[i].exit_code);
  }
}

TEST_CASE("differential: 并行结果与「直接按输入顺序逐个 executor.run」一致") {
  auto direct_executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  auto scheduler_executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  const auto jobs = make_mixed_jobs();

  std::vector<loom::JobResult> direct;
  for (const auto& job : jobs) direct.push_back(direct_executor->run(job));

  loom::SchedulerOptions options;
  options.workers = 3;
  loom::Scheduler scheduler(options, std::move(scheduler_executor));
  const auto parallel = scheduler.run_all(jobs);

  CHECK(to_mapping(direct) == to_mapping(parallel));
}

TEST_CASE("differential: 全成功批次在串行/并行下 all_passed 一致") {
  const std::string dir = LOOM_TEST_DIR;
  std::vector<loom::JobSpec> jobs;
  for (int i = 0; i < 4; ++i) {
    loom::JobSpec job = loom_test::make_job("ok-" + std::to_string(i), "L0" + std::to_string(i + 1));
    job.command = dir + "/fake-job.sh";
    job.env["FAKE_JOB_SLEEP"] = "0.01";
    jobs.push_back(job);
  }
  auto run_with = [&](int workers) {
    auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
    loom::SchedulerOptions options;
    options.workers = workers;
    loom::Scheduler scheduler(options, std::move(executor));
    return scheduler.run_all(jobs);
  };
  const auto serial = run_with(1);
  const auto parallel = run_with(4);
  loom::RunConfig config;
  config.levels = {"L01", "L02", "L03", "L04"};
  const auto serial_report = loom::build_report(config, serial, "s", "f", 1);
  const auto parallel_report = loom::build_report(config, parallel, "s", "f", 1);
  CHECK(serial_report.all_passed());
  CHECK(parallel_report.all_passed());
  CHECK(loom::to_json(serial_report).size() > 0);
  CHECK(loom::job_status_name(serial[0].status) == loom::job_status_name(parallel[0].status));
}
