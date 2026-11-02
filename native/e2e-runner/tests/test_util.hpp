// native-test 公共测试工具：临时目录、计时、假 executor、进程/端口观测。
#pragma once

#include <unistd.h>

#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <memory>
#include <mutex>
#include <random>
#include <string>
#include <thread>
#include <vector>

#include "loom/scheduler.hpp"

namespace loom_test {

inline long long now_ms() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
             std::chrono::steady_clock::now().time_since_epoch())
      .count();
}

inline std::filesystem::path make_temp_dir(const std::string& tag) {
  auto dir = std::filesystem::temp_directory_path() /
             ("loom-test-" + tag + "-" + std::to_string(::getpid()) + "-" +
              std::to_string(now_ms()));
  std::filesystem::create_directories(dir);
  return dir;
}

struct TempDir {
  std::filesystem::path path;
  explicit TempDir(const std::string& tag) : path(make_temp_dir(tag)) {}
  ~TempDir() {
    std::error_code ec;
    std::filesystem::remove_all(path, ec);
  }
  TempDir(const TempDir&) = delete;
  TempDir& operator=(const TempDir&) = delete;
  std::string str() const { return path.string(); }
};

inline std::string read_file(const std::filesystem::path& p) {
  std::ifstream in(p, std::ios::binary);
  return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
}

inline void write_file(const std::filesystem::path& p, const std::string& content) {
  std::ofstream out(p, std::ios::binary | std::ios::trunc);
  out.write(content.data(), static_cast<std::streamsize>(content.size()));
}

/** 可编程假 executor：每个 job 按 id 决定 sleep/返回状态，并记录并发度。 */
class FakeExecutor : public loom::JobExecutor {
 public:
  struct Behavior {
    long long sleep_ms = 0;
    loom::JobStatus status = loom::JobStatus::Pass;
    int exit_code = 0;
    bool throw_exception = false;
    std::string tail = "fake";
  };

  std::mutex mu;
  std::vector<Behavior> behaviors;  // 按调用顺序消费（index=job 在 jobs 中的位置）
  std::atomic<int> active{0};
  std::atomic<int> max_active{0};
  std::atomic<int> calls{0};
  std::atomic<int> worker_slot{0};
  std::vector<std::string> seen_ids;  // 加锁写
  std::vector<loom::JobSpec> seen_specs;  // executor 实际收到的 spec（含注入 env）
  std::vector<std::pair<long long, long long>> spans;  // [start,end)

  explicit FakeExecutor(std::vector<Behavior> list) : behaviors(std::move(list)) {}

  loom::JobResult run(const loom::JobSpec& job) override {
    const int index = calls.fetch_add(1);
    {
      std::lock_guard<std::mutex> lock(mu);
      seen_ids.push_back(job.id);
      seen_specs.push_back(job);
    }
    int behavior_index = index;
    // 并发下调用顺序 != 输入顺序：优先按 job.id 末尾数字选 behavior（如 "job-3"/"p3"）。
    const std::string& id = job.id;
    std::size_t digit_start = id.size();
    while (digit_start > 0 && id[digit_start - 1] >= '0' && id[digit_start - 1] <= '9') --digit_start;
    if (digit_start < id.size()) {
      behavior_index = std::stoi(id.substr(digit_start));
    }
    const int current = active.fetch_add(1) + 1;
    int expected = max_active.load();
    while (current > expected && !max_active.compare_exchange_weak(expected, current)) {
    }
    const long long start = now_ms();
    Behavior behavior;
    {
      std::lock_guard<std::mutex> lock(mu);
      behavior = behavior_index >= 0 && behavior_index < static_cast<int>(behaviors.size())
                     ? behaviors[static_cast<std::size_t>(behavior_index)]
                     : Behavior{};
    }
    if (behavior.sleep_ms > 0) {
      std::this_thread::sleep_for(std::chrono::milliseconds(behavior.sleep_ms));
    }
    active.fetch_sub(1);
    const long long end = now_ms();
    {
      std::lock_guard<std::mutex> lock(mu);
      spans.emplace_back(start, end);
    }
    if (behavior.throw_exception) {
      throw std::runtime_error("fake executor boom");
    }
    loom::JobResult result;
    result.job = job;
    result.status = behavior.status;
    result.exit_code = behavior.exit_code;
    result.duration_ms = end - start;
    result.tail_log = behavior.tail;
    result.worker = worker_slot.fetch_add(1) % 8;
    return result;
  }

  std::vector<std::string> ids() {
    std::lock_guard<std::mutex> lock(mu);
    return seen_ids;
  }
  std::vector<std::pair<long long, long long>> all_spans() {
    std::lock_guard<std::mutex> lock(mu);
    return spans;
  }
};

inline loom::JobSpec make_job(const std::string& id, const std::string& level = "L01",
                              int timeout_ms = 5000) {
  loom::JobSpec job;
  job.id = id;
  job.level = level;
  job.command = "true";
  job.timeout_ms = timeout_ms;
  return job;
}

}  // namespace loom_test
