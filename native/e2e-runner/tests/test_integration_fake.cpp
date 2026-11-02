// 假栈集成（docs/58 §4.2）：Scheduler + create_fake_executor（真实子进程、不启 Paper）。
// 覆盖：N=3 真并行（marker 时间戳重叠，墙钟≈max）、失败/超时隔离、证据 JSON 字段完整、
// Scheduler env 注入 → 子进程（端到端）。
#include <algorithm>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <string>
#include <vector>

#include "doctest.h"
#include "loom/config.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"
#include "test_util.hpp"

using loom::JobResult;
using loom::JobSpec;
using loom::JobStatus;
using loom::Scheduler;
using loom::SchedulerOptions;

namespace {
std::string script(const std::string& name) { return std::string(LOOM_TEST_DIR) + "/" + name; }

long long read_ns(const std::filesystem::path& path) {
  std::ifstream in(path);
  long long value = 0;
  in >> value;
  return value;
}

JobSpec make_job_spec(const std::string& id, const std::string& script_name, int timeout_ms = 30000) {
  JobSpec job;
  job.id = id;
  job.level = id;
  job.command = script(script_name);
  job.timeout_ms = timeout_ms;
  return job;
}
}  // namespace

TEST_CASE("integration: N=3 fake job 真并行（marker 时间戳重叠、墙钟≈max）") {
  loom_test::TempDir dir("integration-parallel");
  auto executor = loom::create_fake_executor();
  REQUIRE(executor != nullptr);
  SchedulerOptions options;
  options.workers = 3;
  Scheduler scheduler(options, std::move(executor));

  std::vector<JobSpec> jobs;
  std::vector<std::filesystem::path> start_markers;
  std::vector<std::filesystem::path> end_markers;
  for (int i = 0; i < 3; ++i) {
    JobSpec job = make_job_spec("L0" + std::to_string(i + 1), "fake-job.sh");
    job.env["FAKE_JOB_SLEEP"] = "0.6";
    start_markers.push_back(dir.path / ("start-" + std::to_string(i)));
    end_markers.push_back(dir.path / ("end-" + std::to_string(i)));
    job.env["FAKE_JOB_START_MARKER"] = start_markers.back().string();
    job.env["FAKE_JOB_MARKER"] = end_markers.back().string();
    jobs.push_back(job);
  }

  const long long wall_start = loom_test::now_ms();
  const auto results = scheduler.run_all(jobs);
  const long long wall = loom_test::now_ms() - wall_start;

  REQUIRE(results.size() == 3);
  for (const auto& result : results) CHECK(result.status == JobStatus::Pass);
  // 串行应 ≥1.8s；并行墙钟应显著小（含进程启动开销，留足余量）
  CHECK(wall < 1500);
  for (const auto& marker : start_markers) REQUIRE(std::filesystem::exists(marker));
  for (const auto& marker : end_markers) REQUIRE(std::filesystem::exists(marker));

  // 三个 job 的时间区间两两有重叠（真并行）
  std::vector<std::pair<long long, long long>> spans;
  for (std::size_t i = 0; i < 3; ++i) {
    spans.emplace_back(read_ns(start_markers[i]), read_ns(end_markers[i]));
  }
  for (const auto& a : spans) {
    CHECK(a.second > a.first);
    int overlap = 0;
    for (const auto& b : spans) {
      if (a.first < b.second && b.first < a.second) ++overlap;
    }
    CHECK(overlap >= 2);
  }
}

TEST_CASE("integration: 失败/崩溃/超时不连坐，结果计数与状态正确") {
  auto executor = loom::create_fake_executor();
  REQUIRE(executor != nullptr);
  SchedulerOptions options;
  options.workers = 4;
  Scheduler scheduler(options, std::move(executor));

  std::vector<JobSpec> jobs = {
      make_job_spec("L01", "fake-job.sh"),
      make_job_spec("L02", "fake-job-fail.sh"),
      make_job_spec("L03", "fake-job-hang.sh", 300),
      make_job_spec("L04", "fake-job-crash.sh"),
  };
  jobs[0].env["FAKE_JOB_SLEEP"] = "0.05";
  const long long start = loom_test::now_ms();
  const auto results = scheduler.run_all(jobs);
  const long long wall = loom_test::now_ms() - start;

  REQUIRE(results.size() == 4);
  CHECK(results[0].status == JobStatus::Pass);
  CHECK(results[1].status == JobStatus::Fail);
  CHECK(results[2].status == JobStatus::Timeout);
  CHECK(results[2].exit_code == loom::kTimeoutExitCode);
  CHECK(results[3].status == JobStatus::Fail);
  for (std::size_t i = 0; i < results.size(); ++i) {
    CHECK(results[i].job.id == jobs[i].id);
    CHECK(results[i].duration_ms >= 0);
    CHECK(results[i].worker >= 0);
  }
  // L03 超时 300ms，整体不应被失败连坐拖长
  CHECK(wall < 5000);
}

TEST_CASE("integration: Scheduler env 注入端到端到达真实子进程") {
  auto executor = loom::create_fake_executor();
  REQUIRE(executor != nullptr);
  SchedulerOptions options;
  options.workers = 2;
  options.mc_base_port = 41000;
  options.rpc_base_port = 42000;
  options.bot_prefix = "ITGolem";
  Scheduler scheduler(options, std::move(executor));
  JobSpec job = make_job_spec("L05", "fake-job-env.sh");
  job.env["LOOM_TEST_CUSTOM"] = "from-job-spec";
  const auto results = scheduler.run_all({job});
  REQUIRE(results.size() == 1);
  CHECK(results[0].status == JobStatus::Pass);
  const auto& tail = results[0].tail_log;
  CHECK(tail.find("env MC_PORT=41") != std::string::npos);  // 41000 + 槽位
  CHECK(tail.find("env MC_RPC_PORT=42") != std::string::npos);
  CHECK(tail.find("env MC_HOST=127.0.0.1") != std::string::npos);
  CHECK(tail.find("env BOT_NAME=ITGolem") != std::string::npos);
  CHECK(tail.find("env CUSTOM=from-job-spec") != std::string::npos);
}

TEST_CASE("integration: 证据 JSON 字段完整、可解析、失败批次 allPassed=false") {
  loom_test::TempDir dir("integration-report");
  auto executor = loom::create_fake_executor();
  SchedulerOptions options;
  options.workers = 3;
  Scheduler scheduler(options, std::move(executor));
  std::vector<JobSpec> jobs = {
      make_job_spec("L01", "fake-job.sh"),
      make_job_spec("L02", "fake-job-fail.sh"),
      make_job_spec("L03", "fake-job-hang.sh", 300),
  };
  jobs[0].env["FAKE_JOB_SLEEP"] = "0.05";
  const auto results = scheduler.run_all(jobs);

  loom::RunConfig config;
  config.levels = {"L01", "L02", "L03"};
  config.workers = 3;
  config.command_template = "npx tsx it/l{level_num}-real.ts";
  const auto report = loom::build_report(config, results, loom::iso8601_now(), loom::iso8601_now(), 1234);
  CHECK_FALSE(report.all_passed());
  CHECK(report.jobs.size() == 3);

  const auto json_path = dir.path / "run.json";
  loom::write_report_json(report, json_path);
  REQUIRE(std::filesystem::exists(json_path));
  const auto json = loom_test::read_file(json_path);
  CHECK(json.size() > 100);
  for (const char* key : {"\"version\"", "\"startedAt\"", "\"finishedAt\"", "\"totalDurationMs\"",
                          "\"workers\"", "\"levels\"", "\"commandTemplate\"", "\"allPassed\"", "\"jobs\""}) {
    CHECK_MESSAGE(json.find(key) != std::string::npos, key);
  }
  for (const char* status : {"\"status\": \"pass\"", "\"status\": \"fail\"", "\"status\": \"timeout\""}) {
    CHECK_MESSAGE(json.find(status) != std::string::npos, status);
  }
  CHECK(json.find("\"exitCode\"") != std::string::npos);
  CHECK(json.find("\"durationMs\"") != std::string::npos);
  CHECK(json.find("\"tailLog\"") != std::string::npos);
  // 括号配平（粗校验，防止半截/坏 JSON）
  CHECK(std::count(json.begin(), json.end(), '{') == std::count(json.begin(), json.end(), '}'));
  CHECK(std::count(json.begin(), json.end(), '[') == std::count(json.begin(), json.end(), ']'));
}
