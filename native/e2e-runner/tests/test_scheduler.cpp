// Scheduler 契约测试（docs/58 §3 + native-core 头文件契约）：
// - N workers 真并行（时间戳重叠）
// - 结果严格按输入顺序返回
// - 单个失败不连坐其它 job
// - 每 job 注入 env（LOOM_WORKER/MC_HOST/MC_PORT/MC_RPC_PORT/BOT_NAME），
//   JobResult.job 保留输入原 spec（不含注入 env），worker 字段是槽位
// - 超时语义在 JobExecutor 内部（Scheduler 原样传递 timeout_ms）
#include <algorithm>
#include <set>
#include <string>
#include <vector>

#include "doctest.h"
#include "loom/scheduler.hpp"
#include "test_util.hpp"

using loom::JobResult;
using loom::JobSpec;
using loom::JobStatus;
using loom::Scheduler;
using loom::SchedulerOptions;
using loom_test::FakeExecutor;

namespace {
std::unique_ptr<Scheduler> make_scheduler(int workers,
                                          std::vector<FakeExecutor::Behavior> behaviors,
                                          FakeExecutor** out_executor) {
  auto executor = std::make_unique<FakeExecutor>(std::move(behaviors));
  *out_executor = executor.get();
  SchedulerOptions options;
  options.workers = workers;
  return std::make_unique<Scheduler>(options, std::move(executor));
}

std::vector<JobSpec> make_jobs(int count, int timeout_ms = 5000) {
  std::vector<JobSpec> jobs;
  jobs.reserve(static_cast<std::size_t>(count));
  for (int i = 0; i < count; ++i) {
    jobs.push_back(loom_test::make_job("job-" + std::to_string(i), "L0" + std::to_string((i % 9) + 1), timeout_ms));
  }
  return jobs;
}
}  // namespace

TEST_CASE("scheduler: N=3 workers 真并行，墙钟≈max 而非 sum") {
  constexpr long long kSleepMs = 350;
  FakeExecutor* executor = nullptr;
  std::vector<FakeExecutor::Behavior> behaviors(3, FakeExecutor::Behavior{kSleepMs, JobStatus::Pass, 0, false, "ok"});
  auto scheduler = make_scheduler(3, std::move(behaviors), &executor);

  const auto jobs = make_jobs(3);
  const long long start = loom_test::now_ms();
  const auto results = scheduler->run_all(jobs);
  const long long wall = loom_test::now_ms() - start;

  REQUIRE(results.size() == 3);
  CHECK(executor->max_active.load() == 3);
  CHECK(wall < 2 * kSleepMs + 250);  // sum 是 1050ms
  auto spans = executor->all_spans();
  REQUIRE(spans.size() == 3);
  int max_overlap = 0;
  for (const auto& a : spans) {
    int overlap = 0;
    for (const auto& b : spans) {
      if (a.first < b.second && b.first < a.second) ++overlap;
    }
    max_overlap = std::max(max_overlap, overlap);
  }
  CHECK(max_overlap == 3);
  for (const auto& r : results) CHECK(r.status == JobStatus::Pass);
  for (const auto& r : results) CHECK(r.duration_ms >= kSleepMs - 20);
  CHECK(scheduler->workers() == 3);
}

TEST_CASE("scheduler: results 严格按输入顺序返回（与完成时间无关）") {
  std::vector<FakeExecutor::Behavior> behaviors;
  for (int i = 0; i < 6; ++i) {
    behaviors.push_back(FakeExecutor::Behavior{(6 - i) * 60, JobStatus::Pass, 0, false, "ok"});
  }
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(6, std::move(behaviors), &executor);
  const auto jobs = make_jobs(6);
  const auto results = scheduler->run_all(jobs);

  REQUIRE(results.size() == jobs.size());
  for (std::size_t i = 0; i < results.size(); ++i) {
    CHECK(results[i].job.id == jobs[i].id);
    CHECK(results[i].job.level == jobs[i].level);
    CHECK(results[i].job.command == jobs[i].command);
  }
}

TEST_CASE("scheduler: workers 上限生效（workers=2 时最大并发不超过 2）") {
  FakeExecutor* executor = nullptr;
  std::vector<FakeExecutor::Behavior> behaviors(4, FakeExecutor::Behavior{180, JobStatus::Pass, 0, false, "ok"});
  auto scheduler = make_scheduler(2, std::move(behaviors), &executor);
  const auto results = scheduler->run_all(make_jobs(4));
  REQUIRE(results.size() == 4);
  CHECK(executor->max_active.load() <= 2);
  CHECK(executor->max_active.load() >= 1);
}

TEST_CASE("scheduler: workers=1 时串行执行") {
  FakeExecutor* executor = nullptr;
  std::vector<FakeExecutor::Behavior> behaviors(3, FakeExecutor::Behavior{80, JobStatus::Pass, 0, false, "ok"});
  auto scheduler = make_scheduler(1, std::move(behaviors), &executor);
  const auto results = scheduler->run_all(make_jobs(3));
  REQUIRE(results.size() == 3);
  CHECK(executor->max_active.load() == 1);
}

TEST_CASE("scheduler: 失败隔离（Fail 不取消其它 job）") {
  std::vector<FakeExecutor::Behavior> behaviors = {
      FakeExecutor::Behavior{60, JobStatus::Pass, 0, false, "ok"},
      FakeExecutor::Behavior{60, JobStatus::Fail, 3, false, "failed"},
      FakeExecutor::Behavior{60, JobStatus::Pass, 0, false, "ok"},
  };
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(3, std::move(behaviors), &executor);
  const auto results = scheduler->run_all(make_jobs(3));

  REQUIRE(results.size() == 3);
  CHECK(results[0].status == JobStatus::Pass);
  CHECK(results[1].status == JobStatus::Fail);
  CHECK(results[1].exit_code == 3);
  CHECK(results[2].status == JobStatus::Pass);
  CHECK(executor->calls.load() == 3);
}

TEST_CASE("scheduler: executor 抛异常被捕获并记为 Error，其它 job 照常（失败隔离）") {
  std::vector<FakeExecutor::Behavior> behaviors = {
      FakeExecutor::Behavior{40, JobStatus::Pass, 0, false, "ok"},
      FakeExecutor::Behavior{40, JobStatus::Pass, 0, true, "boom"},
      FakeExecutor::Behavior{40, JobStatus::Pass, 0, false, "ok"},
  };
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(3, std::move(behaviors), &executor);
  const auto jobs = make_jobs(3);
  std::vector<JobResult> results;
  // scheduler.hpp 契约：run() 允许抛 std::exception，Scheduler 捕获并转成 Error（保证失败隔离）。
  REQUIRE_NOTHROW(results = scheduler->run_all(jobs));
  REQUIRE(results.size() == 3);
  CHECK(results[1].status == JobStatus::Error);
  CHECK(results[1].job.id == "job-1");
  CHECK(results[0].status == JobStatus::Pass);
  CHECK(results[2].status == JobStatus::Pass);
  CHECK(executor->calls.load() == 3);
}

TEST_CASE("scheduler: 每 job 注入 env、JobResult.job 保留输入原 spec、worker 槽位合法") {
  FakeExecutor* executor = nullptr;
  std::vector<FakeExecutor::Behavior> behaviors(4, FakeExecutor::Behavior{20, JobStatus::Pass, 0, false, "ok"});
  SchedulerOptions options;
  options.workers = 2;
  options.mc_base_port = 31000;
  options.rpc_base_port = 32000;
  options.mc_host = "127.0.0.1";
  options.bot_prefix = "TestGolem";
  auto fake = std::make_unique<FakeExecutor>(std::move(behaviors));
  executor = fake.get();
  Scheduler scheduler(options, std::move(fake));

  auto jobs = make_jobs(4);
  const auto results = scheduler.run_all(jobs);
  REQUIRE(results.size() == 4);

  auto specs = [&] {
    std::lock_guard<std::mutex> lock(executor->mu);
    return executor->seen_specs;
  }();
  REQUIRE(specs.size() == 4);
  std::set<int> slots;
  for (const auto& spec : specs) {
    // 注入的 env 必须存在且指向该槽位；MC_PORT/RPC_PORT 与槽位一致
    auto it = spec.env.find("MC_PORT");
    REQUIRE(it != spec.env.end());
    const int mc_port = std::stoi(it->second);
    CHECK(mc_port >= options.mc_base_port);
    CHECK(mc_port < options.mc_base_port + options.workers);
    REQUIRE(spec.env.count("MC_RPC_PORT") == 1);
    const int rpc_port = std::stoi(spec.env.at("MC_RPC_PORT"));
    CHECK(rpc_port >= options.rpc_base_port);
    CHECK(rpc_port < options.rpc_base_port + options.workers);
    CHECK(spec.env.count("MC_HOST") == 1);
    CHECK(spec.env.count("BOT_NAME") == 1);
    CHECK(spec.env.count("LOOM_WORKER") == 1);
    slots.insert(std::stoi(spec.env.at("LOOM_WORKER")));
  }
  // 每个结果保留输入原 spec（env 不应包含注入键）
  for (const auto& r : results) {
    CHECK(r.job.env.count("MC_PORT") == 0);
    CHECK(r.job.env.count("LOOM_WORKER") == 0);
    CHECK(r.worker >= 0);
    CHECK(r.worker < options.workers);
    CHECK(r.ok() == (r.status == JobStatus::Pass));
  }
  CHECK(!slots.empty());
  CHECK(slots.size() <= static_cast<std::size_t>(options.workers));
}

TEST_CASE("scheduler: 单 job timeout_ms 原样传给 executor（超时在 executor 内实现）") {
  std::vector<FakeExecutor::Behavior> behaviors(2, FakeExecutor::Behavior{20, JobStatus::Pass, 0, false, "ok"});
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(2, std::move(behaviors), &executor);
  auto jobs = make_jobs(2);
  jobs[0].timeout_ms = 123;
  jobs[1].timeout_ms = 456;
  const auto results = scheduler->run_all(jobs);
  REQUIRE(results.size() == 2);
  auto specs = [&] {
    std::lock_guard<std::mutex> lock(executor->mu);
    return executor->seen_specs;
  }();
  REQUIRE(specs.size() == 2);
  std::multiset<int> timeouts;
  for (const auto& spec : specs) timeouts.insert(spec.timeout_ms);
  CHECK(timeouts.count(123) == 1);
  CHECK(timeouts.count(456) == 1);
}

TEST_CASE("scheduler: 非法 workers 配置抛 std::invalid_argument") {
  auto executor_ok = []() { return std::make_unique<FakeExecutor>(std::vector<FakeExecutor::Behavior>{}); };
  loom::SchedulerOptions too_few;
  too_few.workers = 0;
  CHECK_THROWS_AS(Scheduler(too_few, executor_ok()), std::invalid_argument);
  loom::SchedulerOptions negative;
  negative.workers = -2;
  CHECK_THROWS_AS(Scheduler(negative, executor_ok()), std::invalid_argument);
  loom::SchedulerOptions huge;
  huge.workers = 100000;
  CHECK_THROWS_AS(Scheduler(huge, executor_ok()), std::invalid_argument);
  loom::SchedulerOptions bad_timeout;
  bad_timeout.default_timeout_ms = 0;
  CHECK_THROWS_AS(Scheduler(bad_timeout, executor_ok()), std::invalid_argument);
}

TEST_CASE("scheduler: job.timeout_ms<=0 时使用 default_timeout_ms") {
  std::vector<FakeExecutor::Behavior> behaviors(2, FakeExecutor::Behavior{5, JobStatus::Pass, 0, false, "ok"});
  auto fake = std::make_unique<FakeExecutor>(std::move(behaviors));
  FakeExecutor* executor = fake.get();
  loom::SchedulerOptions options;
  options.workers = 1;
  options.default_timeout_ms = 4242;
  Scheduler scheduler(options, std::move(fake));
  auto jobs = make_jobs(2);
  jobs[0].timeout_ms = 0;
  jobs[1].timeout_ms = -5;
  const auto results = scheduler.run_all(jobs);
  REQUIRE(results.size() == 2);
  auto specs = [&] {
    std::lock_guard<std::mutex> lock(executor->mu);
    return executor->seen_specs;
  }();
  REQUIRE(specs.size() == 2);
  CHECK(specs[0].timeout_ms == 4242);
  CHECK(specs[1].timeout_ms == 4242);
}

TEST_CASE("scheduler: 空 jobs 返回空结果") {
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(3, {}, &executor);
  const auto results = scheduler->run_all({});
  CHECK(results.empty());
  CHECK(executor->calls.load() == 0);
}

TEST_CASE("scheduler: 大量 job + 重复 id 全部执行且一一对应") {
  std::vector<FakeExecutor::Behavior> behaviors(20, FakeExecutor::Behavior{10, JobStatus::Pass, 0, false, "ok"});
  FakeExecutor* executor = nullptr;
  auto scheduler = make_scheduler(4, std::move(behaviors), &executor);
  std::vector<JobSpec> jobs;
  for (int i = 0; i < 10; ++i) {
    jobs.push_back(loom_test::make_job("dup", "L01"));
    jobs.push_back(loom_test::make_job("uniq-" + std::to_string(i), "L02"));
  }
  const auto results = scheduler->run_all(jobs);
  REQUIRE(results.size() == 20);
  CHECK(executor->calls.load() == 20);
  CHECK(executor->max_active.load() <= 4);
  for (std::size_t i = 0; i < results.size(); ++i) {
    CHECK(results[i].job.id == jobs[i].id);
  }
}
