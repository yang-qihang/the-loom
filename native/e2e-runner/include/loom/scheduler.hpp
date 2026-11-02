// loom/scheduler.hpp — 并行 e2e 调度核心接口（docs/58 §3 固定契约）。
//
// 契约要点：
//   * JobSpec / JobStatus / JobResult / JobExecutor / Scheduler 的字段与命名按 docs/58 §3；
//   * Scheduler 只负责「并行槽位 + 结果按输入顺序 + 失败隔离 + env 注入」，
//     单 job 的真实超时/SIGKILL 由 JobExecutor（ProcessJobExecutor / native-stack 的栈执行器）实现；
//   * 同一个 JobExecutor 会被多个 worker 线程并发调用，实现必须线程安全（或自行按 env 分区）。
#pragma once

#include <cstdint>
#include <map>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace loom {

/** 一个待执行的 e2e job（docs/58 §3）。timeout_ms <= 0 表示用调度器默认值。 */
struct JobSpec {
  std::string id;    // 稳定 id（默认同 level，如 "L01"）
  std::string level; // 关卡 id（如 "L01"）
  std::string command; // 命令行（由 /bin/sh -c 执行）
  int timeout_ms = 900000;
  std::map<std::string, std::string> env; // 额外环境变量（调度器会再注入 worker 槽位变量）
};

/** job 终态（docs/58 §3）。 */
enum class JobStatus { Pass, Fail, Timeout, Error };

/** JSON 证据里的稳定小写名字：pass / fail / timeout / error。 */
std::string_view job_status_name(JobStatus status) noexcept;

/** 一个 job 的执行结果；结果顺序与输入 jobs 一致（Scheduler 保证）。 */
struct JobResult {
  JobSpec job;
  JobStatus status = JobStatus::Error;
  int exit_code = -1;        // 正常退出码；被信号杀死或未执行时为 -1
  long long duration_ms = 0; // wall-clock 时长
  std::string tail_log;      // 日志尾部（默认最后 4KB，UTF-8 边界安全）
  /** 执行该 job 的 worker 槽位（证据 JSON 用；-1 = 未分配）。 */
  int worker = -1;

  [[nodiscard]] bool ok() const noexcept { return status == JobStatus::Pass; }
};

/** 全局中断标志：main 的信号处理路径（watchdog 线程 / handler）置位；
 *  实现是 lock-free atomic，可在信号处理上下文安全调用；进程内全局共享。 */
void request_shutdown() noexcept;
[[nodiscard]] bool shutdown_requested() noexcept;
/** 清空中断标志（进程内只用一次，测试里可复用）。 */
void reset_shutdown() noexcept;

/** job 执行器（docs/58 §3）。run() 必须返回结果而不是抛异常；
 *  允许抛 std::exception（Scheduler 会捕获并转成 Error 以保证失败隔离）。 */
class JobExecutor {
 public:
  virtual ~JobExecutor() = default;
  virtual JobResult run(const JobSpec& job) = 0;
  /** 可选：收到 SIGINT/SIGTERM 时立即请求终止正在跑的 job（杀进程组/停栈）。
   *  由 main 的 watchdog 线程调用，可能与 run() 并发；实现必须线程安全且 noexcept
   *  （推荐只置原子标志，run() 在等待循环里轮询后自行杀进程）。 */
  virtual void shutdown() noexcept {}
};

/** 调度器选项（docs/58 §3 的 workers + 端口/超时扩展；聚合初始化 {3} 仍可用）。 */
struct SchedulerOptions {
  int workers = 3;
  int mc_base_port = 25565;
  int rpc_base_port = 8765;
  int default_timeout_ms = 900000;
  /** 注入给 job 的 BOT_NAME 前缀：最终 BOT_NAME = prefix + worker_slot（默认 GolemP0…）。 */
  std::string bot_prefix = "GolemP";
  /** 注入 MC_HOST（默认 127.0.0.1）。 */
  std::string mc_host = "127.0.0.1";
};

/**
 * 并行调度器（docs/58 §3）：
 *   - 最多 options.workers 个 worker 线程并发执行；
 *   - 返回的 vector<JobResult> 与入参 jobs 一一对应且顺序一致；
 *   - 单个 job 失败/超时/抛异常不影响其它 job（失败隔离）；
 *   - 为每个 job 注入 env：LOOM_WORKER / MC_HOST / MC_PORT / MC_RPC_PORT / BOT_NAME；
 *   - 端口由内部 PortAllocator 按 worker 槽位从 base 起的连续端口分配（base+slot）。
 */
class Scheduler {
 public:
  Scheduler(SchedulerOptions options, std::unique_ptr<JobExecutor> executor);
  ~Scheduler();

  Scheduler(Scheduler&&) noexcept;
  Scheduler& operator=(Scheduler&&) noexcept;
  Scheduler(const Scheduler&) = delete;
  Scheduler& operator=(const Scheduler&) = delete;

  std::vector<JobResult> run_all(const std::vector<JobSpec>& jobs);

  /** 请求停止：置全局中断标志 + 调 executor->shutdown()（不再启动新 job）。线程安全、noexcept。 */
  void request_stop() noexcept;

  [[nodiscard]] int workers() const noexcept;

 private:
  class Impl;
  std::unique_ptr<Impl> impl_;
};

} // namespace loom
