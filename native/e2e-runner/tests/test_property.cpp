// 属性/随机测试（docs/58 §4.6）：
// - Scheduler 随机 job 数/并发度：结果数/顺序/并发上限/状态映射不变式
// - PortAllocator 随机操作序列：租约唯一/容量/端口公式
// 全部在 ASan/UBSan 下运行（ctest 全量）。
#include <algorithm>
#include <atomic>
#include <cstdint>
#include <random>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "doctest.h"
#include "loom/ports.hpp"
#include "loom/scheduler.hpp"
#include "test_util.hpp"

namespace {
struct XorShift {
  std::uint64_t state;
  explicit XorShift(std::uint64_t seed) : state(seed) {}
  std::uint64_t next() {
    state ^= state << 13;
    state ^= state >> 7;
    state ^= state << 17;
    return state;
  }
};
}  // namespace

TEST_CASE("property: scheduler 随机 jobs/workers 200 批不变式") {
  XorShift rng(0xC0FFEE20261102ULL);
  for (int round = 0; round < 200; ++round) {
    const int workers = 1 + static_cast<int>(rng.next() % 8);
    const int job_count = static_cast<int>(rng.next() % 13);
    std::vector<loom_test::FakeExecutor::Behavior> behaviors;
    behaviors.reserve(static_cast<std::size_t>(job_count));
    for (int i = 0; i < job_count; ++i) {
      const auto selector = rng.next() % 10;
      loom::JobStatus status = loom::JobStatus::Pass;
      if (selector == 3) status = loom::JobStatus::Fail;
      if (selector == 7) status = loom::JobStatus::Timeout;
      const long long sleep_ms = static_cast<long long>(rng.next() % 3);
      behaviors.push_back({sleep_ms, status, status == loom::JobStatus::Fail ? 1 : 0, false, "t"});
    }
    auto fake = std::make_unique<loom_test::FakeExecutor>(std::move(behaviors));
    loom_test::FakeExecutor* executor = fake.get();
    loom::SchedulerOptions options;
    options.workers = workers;
    loom::Scheduler scheduler(options, std::move(fake));

    std::vector<loom::JobSpec> jobs;
    for (int i = 0; i < job_count; ++i) jobs.push_back(loom_test::make_job("j" + std::to_string(i)));
    const auto results = scheduler.run_all(jobs);
    REQUIRE(results.size() == jobs.size());
    for (std::size_t i = 0; i < results.size(); ++i) {
      CHECK(results[i].job.id == jobs[i].id);
      CHECK(results[i].worker >= 0);
      CHECK(results[i].worker < workers);
    }
    CHECK(executor->max_active.load() <= workers);
  }
}

TEST_CASE("property: ports 随机操作序列 1000 步（含 acquire_slot）") {
  loom::PortAllocator allocator(33000, 34000, 8);
  XorShift rng(0xDEADBEEF2026ULL);
  std::set<int> leased;
  for (int step = 0; step < 1000; ++step) {
    const auto action = rng.next() % 100;
    if (action < 50) {
      const auto lease = allocator.acquire();
      if (lease) {
        CHECK(leased.insert(lease->slot).second);
        CHECK(lease->mc_port == 33000 + lease->slot);
        CHECK(lease->rpc_port == 34000 + lease->slot);
      }
    } else if (action < 75 && !leased.empty()) {
      auto it = leased.begin();
      std::advance(it, static_cast<long>(rng.next() % leased.size()));
      allocator.release(*it);
      leased.erase(it);
    } else if (action < 90) {
      const int slot = static_cast<int>(rng.next() % 8);
      if (leased.count(slot) == 0) {
        const auto lease = allocator.acquire_slot(slot);
        CHECK(lease.slot == slot);
        leased.insert(slot);
      }
    } else {
      CHECK(static_cast<int>(leased.size()) == allocator.leased_count());
    }
    CHECK(static_cast<int>(leased.size()) == allocator.leased_count());
    for (int slot : leased) {
      CHECK(allocator.leased(slot));
    }
  }
}

TEST_CASE("property: 随机失败/超时混合下每 job 独立映射") {
  XorShift rng(0x1234ABCDULL);
  for (int round = 0; round < 50; ++round) {
    const int job_count = 1 + static_cast<int>(rng.next() % 6);
    std::vector<loom_test::FakeExecutor::Behavior> behaviors;
    std::vector<loom::JobStatus> expected;
    for (int i = 0; i < job_count; ++i) {
      const auto selector = rng.next() % 4;
      loom::JobStatus status = loom::JobStatus::Pass;
      int exit_code = 0;
      if (selector == 1) { status = loom::JobStatus::Fail; exit_code = 2; }
      else if (selector == 2) { status = loom::JobStatus::Timeout; exit_code = -1; }
      else if (selector == 3) { status = loom::JobStatus::Error; exit_code = -1; }
      expected.push_back(status);
      behaviors.push_back({0, status, exit_code, false, "x"});
    }
    auto fake = std::make_unique<loom_test::FakeExecutor>(std::move(behaviors));
    loom::SchedulerOptions options;
    options.workers = 3;
    loom::Scheduler scheduler(options, std::move(fake));
    std::vector<loom::JobSpec> jobs;
    for (int i = 0; i < job_count; ++i) jobs.push_back(loom_test::make_job("p" + std::to_string(i)));
    const auto results = scheduler.run_all(jobs);
    REQUIRE(results.size() == expected.size());
    for (std::size_t i = 0; i < results.size(); ++i) {
      CHECK(results[i].status == expected[i]);
      CHECK(results[i].ok() == (expected[i] == loom::JobStatus::Pass));
    }
  }
}
