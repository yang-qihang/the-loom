// loom-e2e main — CLI → job 计划 → 并行执行 → 证据 JSON。
//
// 退出码：0 全部通过（或 --dry-run/--help）；1 有 job 失败/超时/错误；
//         2 参数/配置错误（含缺少真实 Paper 栈实现）；3 运行期内部错误。
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdlib>
#include <exception>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#else
#include <cerrno>
#include <pthread.h>
#include <time.h>
#endif

#include "loom/config.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"

#ifndef LOOM_HAS_STACK
#define LOOM_HAS_STACK 0
#endif

namespace {

using namespace loom;

/** 最近一次收到的退出信号（0 = 没有）；证据/退出码用。 */
std::atomic<int> g_last_signal{0};
/** 当前 Scheduler（watchdog 线程据此 request_stop）。 */
std::atomic<Scheduler*> g_active_scheduler{nullptr};

/**
 * 信号处理：POSIX 用「阻塞 + 专用线程 sigtimedwait」模式（不在 handler 里做非 async-signal-safe
 * 的事情）；收到 SIGINT/SIGTERM 后置全局中断标志 + 请求 Scheduler 停止（杀 job 进程组、停栈）。
 * Windows 用 SetConsoleCtrlHandler。
 */
#if !defined(_WIN32)
sigset_t g_signal_set;
std::atomic<bool> g_watcher_stop{false};

void on_interrupt_signal(int signal_value) noexcept {
  g_last_signal.store(signal_value, std::memory_order_relaxed);
  request_shutdown();
  if (Scheduler* scheduler = g_active_scheduler.load(std::memory_order_acquire); scheduler != nullptr) {
    scheduler->request_stop();
  }
}

class SignalWatcher {
 public:
  SignalWatcher() {
    sigemptyset(&g_signal_set);
    sigaddset(&g_signal_set, SIGINT);
    sigaddset(&g_signal_set, SIGTERM);
    // 在主线程/后续 worker 线程里阻塞这两个信号，只由 watchdog 线程 sigtimedwait 接收。
    (void)::pthread_sigmask(SIG_BLOCK, &g_signal_set, &old_mask_);
    g_watcher_stop.store(false);
    thread_ = std::thread([this]() { watch_loop(); });
  }

  ~SignalWatcher() { stop(); }

  SignalWatcher(const SignalWatcher&) = delete;
  SignalWatcher& operator=(const SignalWatcher&) = delete;

  void stop() noexcept {
    g_watcher_stop.store(true);
    if (thread_.joinable()) thread_.join();
    if (!mask_restored_) {
      (void)::pthread_sigmask(SIG_SETMASK, &old_mask_, nullptr);
      mask_restored_ = true;
    }
  }

 private:
  void watch_loop() noexcept {
    while (!g_watcher_stop.load()) {
      timespec timeout{};
      timeout.tv_sec = 0;
      timeout.tv_nsec = 100 * 1000 * 1000; // 100ms
      const int received = ::sigtimedwait(&g_signal_set, nullptr, &timeout);
      if (received == SIGINT || received == SIGTERM) {
        on_interrupt_signal(received);
        return;
      }
      if (received < 0 && errno != EAGAIN && errno != EINTR) return;
    }
  }

  std::thread thread_;
  sigset_t old_mask_{};
  bool mask_restored_ = false;
};
#else
BOOL WINAPI console_control_handler(DWORD control_type) {
  if (control_type == CTRL_C_EVENT || control_type == CTRL_BREAK_EVENT) {
    g_last_signal.store(static_cast<int>(control_type) == static_cast<int>(CTRL_C_EVENT) ? SIGINT : SIGTERM);
    request_shutdown();
    if (Scheduler* scheduler = g_active_scheduler.load(std::memory_order_acquire); scheduler != nullptr) {
      scheduler->request_stop();
    }
    return TRUE;
  }
  return FALSE;
}

class SignalWatcher {
 public:
  SignalWatcher() { (void)::SetConsoleCtrlHandler(console_control_handler, TRUE); }
  ~SignalWatcher() { (void)::SetConsoleCtrlHandler(console_control_handler, FALSE); }
  void stop() noexcept { (void)::SetConsoleCtrlHandler(console_control_handler, FALSE); }
  SignalWatcher(const SignalWatcher&) = delete;
  SignalWatcher& operator=(const SignalWatcher&) = delete;
};
#endif

int interrupt_exit_code() {
  const int signal_value = g_last_signal.load();
  if (signal_value == SIGINT) return 130;
  if (signal_value == SIGTERM) return 143;
  return 0;
}

int fail_with_usage(const std::string& message) {
  std::cerr << "错误：" << message << "\n\n" << usage_text();
  return 2;
}

int run_dry_run(const RunConfig& config, const std::vector<JobSpec>& jobs) {
  std::cout << "[dry-run] 共 " << jobs.size() << " 个 job，workers=" << config.workers << "\n";
  for (std::size_t index = 0; index < jobs.size(); ++index) {
    const auto slot = static_cast<int>(index % static_cast<std::size_t>(config.workers));
    const int mc_port = config.mc_base_port + slot;
    const int rpc_port = config.rpc_base_port + slot;
    std::cout << "[dry-run] worker " << slot << "  端口 MC=" << mc_port << " RPC=" << rpc_port << "  "
              << jobs[index].level << "  " << jobs[index].command << "\n";
  }
  std::cout << "[dry-run] 证据输出：" << config.out.string() << "（dry-run 不写文件）\n";
  std::cout << "[dry-run] 模板：" << config.paper_template.string() << "  work-root：" << config.work_root.string()
            << "\n";
  return 0;
}

#if LOOM_HAS_STACK
/** ExecutorFactory 适配器：真实路径调 native-stack 的 create_stack_executor；--fake 调其 fake 实现。 */
class StackExecutorFactory final : public ExecutorFactory {
 public:
  explicit StackExecutorFactory(bool fake) : fake_(fake) {}

  std::unique_ptr<JobExecutor> create(const RunConfig& config) override {
    if (fake_) {
      auto executor = create_fake_executor();
      if (executor == nullptr) throw std::runtime_error("native-stack 未提供 fake 执行器实现");
      return executor;
    }
    auto executor = create_stack_executor(stack_config_from(config));
    if (executor == nullptr) throw std::runtime_error("native-stack 未提供真实 Paper 栈执行器实现");
    return executor;
  }

 private:
  bool fake_ = false;
};
#endif

#if LOOM_HAS_STACK
int print_summary(const RunReport& report) {
  int failed = 0;
  for (const auto& job : report.jobs) {
    const char* status = job.status == JobStatus::Pass ? "PASS" : "FAIL";
    if (job.status != JobStatus::Pass) ++failed;
    std::cout << "[" << status << "] worker=" << job.worker << "  " << job.job.level << "  " << job.duration_ms
              << "ms  exit=" << job.exit_code << "  status=" << job_status_name(job.status) << "\n";
  }
  std::cout << "总计：" << report.jobs.size() << " 个 job，失败 " << failed << " 个，wall="
            << report.total_duration_ms << "ms，workers=" << report.workers << "\n";
  std::cout << "证据：" << "(见 --out 指定的 JSON)" << "\n";
  return failed == 0 ? 0 : 1;
}
#endif

} // namespace

int main(int argc, char** argv) {
  using namespace loom;
  RunConfig config;
  try {
    config = parse_args(argc, argv);
  } catch (const CliError& error) {
    return fail_with_usage(error.what());
  } catch (const std::exception& error) {
    return fail_with_usage(error.what());
  }

  if (config.show_help) {
    std::cout << usage_text();
    return 0;
  }

  std::vector<JobSpec> jobs;
  try {
    jobs = build_jobs(config);
  } catch (const std::exception& error) {
    return fail_with_usage(error.what());
  }
  if (jobs.empty()) return fail_with_usage("没有可执行的 job（--levels 为空？）");

  if (config.dry_run) return run_dry_run(config, jobs);

#if !LOOM_HAS_STACK
  std::cerr << "错误：本次构建不包含真实 Paper 栈实现（native-stack 的 src/factory.cpp 未编译）。\n"
            << "      可以用 --dry-run 查看 job 计划；或等待 native-stack 实现/重新配置构建。\n";
  return 2;
#else
  if (!config.fake) {
    std::error_code error;
    if (!std::filesystem::is_directory(config.paper_template, error)) {
      return fail_with_usage("找不到 Paper 模板目录：" + config.paper_template.string() + "（用 --paper-template 指定）");
    }
  }

  const auto started_at = iso8601_now();
  const auto started = std::chrono::steady_clock::now();
  std::vector<JobResult> results;
  try {
    StackExecutorFactory factory(config.fake);
    auto executor = factory.create(config);
    SchedulerOptions options;
    options.workers = config.workers;
    options.mc_base_port = config.mc_base_port;
    options.rpc_base_port = config.rpc_base_port;
    options.default_timeout_ms = config.timeout_ms;
    Scheduler scheduler(options, std::move(executor));
    // 信号处理：SIGINT/SIGTERM → 中断所有 job 进程组、停栈、写部分证据、退出 130/143。
    SignalWatcher watcher;
    g_active_scheduler.store(&scheduler, std::memory_order_release);
    results = scheduler.run_all(jobs);
    g_active_scheduler.store(nullptr, std::memory_order_release);
    watcher.stop();
  } catch (const std::exception& error) {
    g_active_scheduler.store(nullptr, std::memory_order_release);
    std::cerr << "运行失败：" << error.what() << "\n";
    return 3;
  }
  const auto finished = std::chrono::steady_clock::now();
  const auto finished_at = iso8601_now();
  const auto total_ms = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
  const int signal_exit = interrupt_exit_code();
  if (signal_exit != 0) {
    std::cerr << "收到中断信号（SIGINT/SIGTERM），已终止所有 job 进程组；正在写部分证据…\n";
  }

  RunReport report = build_report(config, results, started_at, finished_at, total_ms);
  try {
    write_report_json(report, config.out);
  } catch (const std::exception& error) {
    std::cerr << "证据写入失败：" << error.what() << "\n";
    return 3;
  }
  if (config.verbose) {
    for (const auto& job : report.jobs) {
      std::cout << "----- " << job.job.level << " 命令：" << job.job.command << " -----\n";
      std::cout << job.tail_log << "\n";
    }
  }
  const int code = print_summary(report);
  std::cout << "证据：" << config.out.string() << "\n";
  if (signal_exit != 0) {
    std::cerr << "已中止（信号退出码 " << signal_exit << "）。\n";
    return signal_exit;
  }
  return code;
#endif
}
