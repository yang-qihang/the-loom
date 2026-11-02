// loom/scheduler.cpp — 并行调度（结果按输入顺序、失败隔离、worker 槽位/env 注入）。
#include "loom/scheduler.hpp"

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <exception>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>
#include <vector>

#include "loom/ports.hpp"

namespace loom {

namespace {
/** 全局中断标志：主线程/信号 watchdog 置位；lock-free 才能从信号上下文安全 store。 */
std::atomic<bool> g_shutdown{false};
static_assert(std::atomic<bool>::is_always_lock_free, "中断标志必须是 lock-free atomic（信号上下文安全）");
} // namespace

void request_shutdown() noexcept { g_shutdown.store(true, std::memory_order_relaxed); }
bool shutdown_requested() noexcept { return g_shutdown.load(std::memory_order_relaxed); }
void reset_shutdown() noexcept { g_shutdown.store(false, std::memory_order_relaxed); }

std::string_view job_status_name(JobStatus status) noexcept {
  switch (status) {
    case JobStatus::Pass: return "pass";
    case JobStatus::Fail: return "fail";
    case JobStatus::Timeout: return "timeout";
    case JobStatus::Error: return "error";
  }
  return "error";
}

class Scheduler::Impl {
 public:
  Impl(SchedulerOptions options, std::unique_ptr<JobExecutor> executor)
      : options_(std::move(options)), executor_(std::move(executor)) {
    if (options_.workers < 1 || options_.workers > 1024) {
      throw std::invalid_argument("worker 数必须在 1–1024 之间（收到 " + std::to_string(options_.workers) + "）");
    }
    if (executor_ == nullptr) throw std::invalid_argument("JobExecutor 不能为空");
    if (options_.default_timeout_ms < 1) {
      throw std::invalid_argument("default_timeout_ms 必须为正数（收到 " +
                                  std::to_string(options_.default_timeout_ms) + "）");
    }
  }

  std::vector<JobResult> run_all(const std::vector<JobSpec>& jobs) {
    std::vector<JobResult> results(jobs.size());
    if (jobs.empty()) return results;

    const auto worker_count = static_cast<std::size_t>(options_.workers);
    const std::size_t active_workers = std::min(worker_count, jobs.size());
    PortAllocator ports(options_.mc_base_port, options_.rpc_base_port, options_.workers);
    std::vector<PortLease> leases;
    leases.reserve(active_workers);
    for (std::size_t index = 0; index < active_workers; ++index) {
      const auto lease = ports.acquire();
      if (!lease.has_value()) {
        throw std::runtime_error("端口槽位不足：需要 " + std::to_string(active_workers) + " 个 worker 槽位");
      }
      leases.push_back(*lease);
    }

    std::atomic<std::size_t> next_index{0};
    std::vector<std::thread> threads;
    threads.reserve(active_workers);
    try {
      for (std::size_t worker = 0; worker < active_workers; ++worker) {
        threads.emplace_back([this, &jobs, &results, &next_index, lease = leases[worker]]() {
          run_worker(jobs, results, next_index, lease);
        });
      }
      for (auto& thread : threads) thread.join();
    } catch (...) {
      for (auto& thread : threads) {
        if (thread.joinable()) thread.join();
      }
      for (const auto& lease : leases) ports.release(lease.slot);
      throw;
    }
    for (const auto& lease : leases) ports.release(lease.slot);
    return results;
  }

  int workers() const noexcept { return options_.workers; }

  void request_stop() noexcept {
    stop_.store(true, std::memory_order_relaxed);
    try {
      if (executor_ != nullptr) executor_->shutdown();
    } catch (...) {
      // 中断路径不允许抛：executor 的 shutdown 必须是 noexcept（这里只做最后防线）。
    }
  }

 private:
  void run_worker(const std::vector<JobSpec>& jobs, std::vector<JobResult>& results,
                  std::atomic<std::size_t>& next_index, const PortLease& lease) {
    for (;;) {
      const std::size_t index = next_index.fetch_add(1, std::memory_order_relaxed);
      if (index >= jobs.size()) return;
      if (stop_.load(std::memory_order_relaxed) || shutdown_requested()) {
        JobResult cancelled;
        cancelled.job = jobs[index];
        cancelled.worker = lease.slot;
        cancelled.status = JobStatus::Error;
        cancelled.exit_code = -1;
        cancelled.duration_ms = 0;
        cancelled.tail_log = "收到中断信号（SIGINT/SIGTERM）：本 job 未执行";
        results[index] = cancelled;
        continue;
      }
      results[index] = run_one(jobs[index], lease);
    }
  }

  JobResult run_one(const JobSpec& original, const PortLease& lease) {
    const auto started = std::chrono::steady_clock::now();
    JobSpec spec = original;
    if (spec.timeout_ms <= 0) spec.timeout_ms = options_.default_timeout_ms;
    // worker 槽位环境变量：native-stack 的执行器据此定位自己的 Paper 栈；
    // ProcessJobExecutor 会原样传给 it/lNN-real.ts（MC_HOST/MC_PORT/MC_RPC_PORT/BOT_NAME）。
    spec.env["LOOM_WORKER"] = std::to_string(lease.slot);
    spec.env["MC_HOST"] = options_.mc_host;
    spec.env["MC_PORT"] = std::to_string(lease.mc_port);
    spec.env["MC_RPC_PORT"] = std::to_string(lease.rpc_port);
    spec.env["BOT_NAME"] = options_.bot_prefix + std::to_string(lease.slot);

    JobResult result;
    result.job = original;
    result.worker = lease.slot;
    try {
      result = executor_->run(spec);
      // 契约：结果里的 job 保留调度器输入（不含注入的 env），便于证据与输入一一对照。
      result.job = original;
      result.worker = lease.slot;
    } catch (const std::exception& error) {
      result = JobResult{};
      result.job = original;
      result.worker = lease.slot;
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = std::string("调度器捕获执行器异常：") + error.what();
      const auto finished = std::chrono::steady_clock::now();
      result.duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
      return result;
    } catch (...) {
      result = JobResult{};
      result.job = original;
      result.worker = lease.slot;
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = "调度器捕获未知异常";
      const auto finished = std::chrono::steady_clock::now();
      result.duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
      return result;
    }
    return result;
  }

  SchedulerOptions options_;
  std::unique_ptr<JobExecutor> executor_;
  std::atomic<bool> stop_{false};
};

Scheduler::Scheduler(SchedulerOptions options, std::unique_ptr<JobExecutor> executor)
    : impl_(std::make_unique<Impl>(std::move(options), std::move(executor))) {}

Scheduler::~Scheduler() = default;
Scheduler::Scheduler(Scheduler&&) noexcept = default;
Scheduler& Scheduler::operator=(Scheduler&&) noexcept = default;

std::vector<JobResult> Scheduler::run_all(const std::vector<JobSpec>& jobs) { return impl_->run_all(jobs); }

void Scheduler::request_stop() noexcept { impl_->request_stop(); }

int Scheduler::workers() const noexcept { return impl_->workers(); }

} // namespace loom
