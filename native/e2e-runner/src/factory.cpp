// loom/factory.cpp — native-stack 提供给 main 的执行器工厂（docs/58 §3；native-stack）。
//
// 核心设计：**每个 worker 槽位一个常驻 Paper 栈，整个 worker 生命周期复用**。
//   * Scheduler 的 N 个 worker 线程各有固定槽位（LOOM_WORKER=slot），同一槽位串行处理多个 job；
//   * 第一次用到某槽位时才冷启动「一次」Paper（复制模板 + 改端口 + JVM 起服），之后同槽位
//     所有 job 复用同一个 JVM（真实 e2e 脚本每关自己 session.begin/prepare/reset 场景，
//     与串行基线复用一台 Paper 的行为一致）；
//   * 只有栈进程死亡（崩溃/被外部杀）才在下一个 job 前重启，其它失败只标该 job，不影响其它 job；
//   * StackJobExecutor 析构（Scheduler::run_all 之后）统一 stop + cleanup + 打印每槽位启动次数，
//     失败证据从对应栈的 console.log 里按「本 job 起始偏移」截最后 20KB，写 log_dir/<level>-console.log。
//
// 这样 10 关并行只冷启动 N 次 Paper（N=workers），而不是每关一次；否则 wall time 会比串行还慢。
//
// 只实现 config.hpp 声明的入口（不碰 native-core 的 main/scheduler）：
//   * create_stack_executor(StackConfig)：真实 Paper 栈执行器；
//   * create_fake_executor()：真实子进程、不启 Paper（--fake；复用 core 的 ProcessJobExecutor）；
//   * make_executor_factory()：抽象工厂入口（main 当前直接调用上面两个，保留无害）。
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstddef>
#include <exception>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#include "loom/config.hpp"
#include "loom/process.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"
#include "loom/stack.hpp"

namespace loom {
namespace {

using Clock = std::chrono::steady_clock;

/** 与 docs/58 §4 证据约定一致：tail_log 默认最后 4KB。 */
constexpr std::size_t kTailBytes = 4096;
/** job 合并输出的环形缓冲容量（足够覆盖失败前的上下文）。 */
constexpr std::size_t kJobTailCapacity = 256 * 1024;

long long elapsed_ms(Clock::time_point since) {
  return std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - since).count();
}

std::string env_value(const std::map<std::string, std::string>& env, const std::string& key,
                      const std::string& fallback) {
  const auto found = env.find(key);
  return found == env.end() || found->second.empty() ? fallback : found->second;
}

int parse_env_int(const std::string& text, int fallback) {
  if (text.empty()) return fallback;
  try {
    std::size_t consumed = 0;
    const long long value = std::stoll(text, &consumed);
    if (consumed != text.size() || value < 0 || value > 2'147'483'647LL) return fallback;
    return static_cast<int>(value);
  } catch (const std::exception&) {
    return fallback;
  }
}

int parse_env_port(const std::string& text, int fallback) {
  const int value = parse_env_int(text, fallback);
  return value >= 1 && value <= 65535 ? value : fallback;
}

/** 每个 job 的证据文件名：level 优先（Scheduler 会填），否则用 id。 */
std::string evidence_name(const JobSpec& job) {
  return !job.level.empty() ? job.level : (job.id.empty() ? std::string("job") : job.id);
}

std::size_t file_size_quietly(const std::filesystem::path& file) {
  std::error_code ec;
  const auto size = std::filesystem::file_size(file, ec);
  return ec ? 0 : static_cast<std::size_t>(size);
}

/** 真实 Paper 栈执行器（线程安全；每槽位懒加载并复用常驻栈）。 */
class StackJobExecutor final : public JobExecutor {
 public:
  explicit StackJobExecutor(StackConfig config)
      : config_(std::move(config)),
        provisioner_(config_),
        slot_locks_(static_cast<std::size_t>(std::max(1, config_.workers))) {
    for (auto& lock : slot_locks_) lock = std::make_unique<std::mutex>();
  }

  ~StackJobExecutor() override { shutdown_all(); }

  /**
   * SIGINT/SIGTERM（Scheduler::request_stop / watchdog 线程调用）：**只置原子标志**。
   * shutdown() 可能与 run() 并发；真正的「杀当前 job 进程组 → 停当前栈 → 清目录」由 run 线程
   * 轮询到标志后在自己线程里做，避免跨线程 kill/wait 竞态（红队要求）。
   */
  void shutdown() noexcept override { stop_flag_.store(true, std::memory_order_relaxed); }

  JobResult run(const JobSpec& job) override {
    const auto started = Clock::now();
    JobResult result;
    result.job = job;
    const int worker_index = worker_index_of(job);
    const StackPorts ports = ports_of(job, worker_index);
    result.worker = worker_index;

    // 同一槽位串行（Scheduler 每个槽位只有一个线程，这里加锁是防御性保证）。
    std::mutex& slot_mutex = *slot_locks_[static_cast<std::size_t>(worker_index) % slot_locks_.size()];
    std::unique_lock<std::mutex> slot_guard(slot_mutex);
    if (stop_requested()) return cancelled_result(job, worker_index, started);

    bool cold_start = false;
    Stack* stack = nullptr;
    try {
      stack = ensure_stack(worker_index, ports, cold_start);
    } catch (const StackStartError& error) {
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = std::string("Paper 栈启动失败（worker ") + std::to_string(worker_index) +
                        "）：\n" + error.what();
      // 有 JVM 起过的失败（ready 超时/提前退出/spawn 失败）用 console 尾做证据；
      // 预检/模板缺文件等「JVM 还没起」的失败没有 console，就用错误信息本身写证据文件，
      // 保证任何失败 job 都有 log_dir/<level>-console.log（红队 C7 契约）。
      if (!append_saved_console_file(result.tail_log, error.saved_console(), evidence_name(job))) {
        write_console_evidence_text(result.tail_log, evidence_name(job), result.tail_log);
      }
      result.duration_ms = elapsed_ms(started);
      return result;
    } catch (const std::exception& error) {
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = std::string("Paper 栈启动失败（worker ") + std::to_string(worker_index) +
                        "）：" + error.what();
      write_console_evidence_text(result.tail_log, evidence_name(job), result.tail_log);
      result.duration_ms = elapsed_ms(started);
      return result;
    }

    if (stop_requested()) {
      // 启动栈期间来了中断：不执行 job，立刻停栈清目录（不让残留留到进程退出）。
      drop_stack(worker_index);
      return cancelled_result(job, worker_index, started);
    }

    const std::size_t console_offset_before = file_size_quietly(stack->console_log());
    run_job_command(job, worker_index, ports, result);
    const bool stack_alive = stack->running();

    // 失败证据：只截「本 job 产生的」那段 console（复用栈时 console 会跨 job 累积）。
    bool console_evidence_written = false;
    if (result.status != JobStatus::Pass) {
      console_evidence_written = append_saved_console_since(
          result.tail_log, stack->console_log(), console_offset_before, evidence_name(job));
    }
    const int start_count = start_count_of(worker_index);
    result.tail_log += "\n[loom-stack] worker=" + std::to_string(worker_index) +
                       " paper_stack_start_count=" + std::to_string(start_count) +
                       (cold_start ? "（本 job 冷启动）" : "（复用常驻栈）");
    if (!stack_alive) {
      result.tail_log += "；检测到 Paper 已退出，下个 job 会重新起栈";
    }
    if (result.status != JobStatus::Pass && !console_evidence_written) {
      // 例如命令 spawn 失败/超时前没有任何 Paper 控制台输出：用 job 结果文本兜底写证据文件。
      write_console_evidence_text(result.tail_log, evidence_name(job), result.tail_log);
    }
    if (stop_requested()) {
      // 中断路径：不把栈留给下一 job，立刻停栈+清目录（其余 slot 由各自 run 线程/析构处理）。
      drop_stack(worker_index);
      result.tail_log += "\n[loom-stack] 收到中断信号：已停止本 worker 的 Paper 栈并清理工作目录";
    }
    result.duration_ms = elapsed_ms(started);
    return result;
  }

 private:
  int worker_index_of(const JobSpec& job) const {
    return std::max(0, parse_env_int(env_value(job.env, "LOOM_WORKER", ""), 0));
  }

  /** 端口权威：Scheduler 注入的 env 优先，缺省才回落到 StackConfig base + worker_index。 */
  StackPorts ports_of(const JobSpec& job, int worker_index) const {
    StackPorts ports{config_.mc_base_port + worker_index, config_.rpc_base_port + worker_index};
    ports.mc = parse_env_port(env_value(job.env, "MC_PORT", ""), ports.mc);
    ports.rpc = parse_env_port(env_value(job.env, "MC_RPC_PORT", ""), ports.rpc);
    return ports;
  }

  /** 取该槽位的常驻栈；没有（或已退出）时冷启动一次。cold_start 标记本次是否新起。 */
  Stack* ensure_stack(int worker_index, StackPorts ports, bool& cold_start) {
    std::unique_ptr<Stack> dead_stack;
    {
      std::lock_guard<std::mutex> guard(stacks_mutex_);
      const auto found = stacks_.find(worker_index);
      if (found != stacks_.end()) {
        if (found->second != nullptr && found->second->running()) return found->second.get();
        dead_stack = std::move(found->second);
        stacks_.erase(found);
      }
    }
    if (dead_stack != nullptr) {
      // 上一个 job 期间 Paper 崩了：先收尸 + 清目录，再重新起（失败隔离，不影响其它槽位）。
      provisioner_.stop(*dead_stack);
      provisioner_.cleanup(*dead_stack);
    }
    auto fresh = provisioner_.start_with_ports(worker_index, ports);
    cold_start = true;
    Stack* pointer = fresh.get();
    {
      std::lock_guard<std::mutex> guard(stacks_mutex_);
      ++start_counts_[worker_index];
      stacks_[worker_index] = std::move(fresh);
    }
    return pointer;
  }

  int start_count_of(int worker_index) {
    std::lock_guard<std::mutex> guard(stacks_mutex_);
    const auto found = start_counts_.find(worker_index);
    return found == start_counts_.end() ? 0 : found->second;
  }

  /** 跑 job 命令：/bin/sh -c（Windows cmd /c），新进程组，超时杀整棵树。 */
  void run_job_command(const JobSpec& job, int worker_index, StackPorts ports,
                       JobResult& result) const {
    std::map<std::string, std::string> env = job.env;
    // 用真实栈端口覆盖/补齐：保证 it/lNN-real.ts 连到本槽位的 Paper。
    env["LOOM_WORKER"] = std::to_string(worker_index);
    env["MC_HOST"] = env_value(job.env, "MC_HOST", "127.0.0.1");
    env["MC_PORT"] = std::to_string(ports.mc);
    env["MC_RPC_PORT"] = std::to_string(ports.rpc);
    if (env.find("BOT_NAME") == env.end() || env["BOT_NAME"].empty()) {
      env["BOT_NAME"] = config_.bot_prefix + std::to_string(worker_index);
    }
    const int timeout_ms = job.timeout_ms > 0 ? job.timeout_ms : config_.job_timeout_ms;
    try {
      ProcessOptions options;
#ifdef _WIN32
      options.program = "cmd.exe";
      options.args = {"/c", job.command};
#else
      options.program = "/bin/sh";
      options.args = {"-c", job.command};
#endif
      options.work_dir = config_.repo_root;
      options.env = std::move(env);
      options.new_process_group = true;
      options.tail_capacity = kJobTailCapacity;
      std::unique_ptr<Process> process = Process::spawn(std::move(options));
      const auto deadline = Clock::now() + std::chrono::milliseconds(std::max(1, timeout_ms));
      for (;;) {
        // 中断轮询（SIGINT/SIGTERM）：先杀本 job 进程组，再由 run() 收尾停栈。
        if (stop_requested()) {
          result.status = JobStatus::Error;
          result.exit_code = -1;
          process->kill();
          (void)process->wait();
          process->cleanup_process_group();
          result.tail_log = process->tail(kTailBytes);
          if (!result.tail_log.empty() && result.tail_log.back() != '\n') result.tail_log.push_back('\n');
          result.tail_log += "[loom] 收到中断信号（SIGINT/SIGTERM）：已终止当前 job 进程组";
          return;
        }
        const auto now = Clock::now();
        if (now >= deadline) {
          result.status = JobStatus::Timeout;
          // 冻结契约（report.hpp）：超时 = 137（与 128+SIGKILL 一致），执行器错误/中断才是 -1。
          result.exit_code = kTimeoutExitCode;
          result.tail_log = process->tail(kTailBytes);
          if (!result.tail_log.empty() && result.tail_log.back() != '\n') result.tail_log.push_back('\n');
          result.tail_log += "[loom] job 超时（" + std::to_string(timeout_ms) +
                             "ms），已杀整个进程组（shell/npx/tsx/bot）";
          process->kill();
          (void)process->wait();
          process->cleanup_process_group();
          return;
        }
        const auto remaining =
            std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now);
        const auto slice = std::min(remaining, std::chrono::milliseconds(100));
        const auto exit_code = process->wait_for(slice);
        if (exit_code.has_value()) {
          result.exit_code = *exit_code;
          result.status = (*exit_code == 0) ? JobStatus::Pass : JobStatus::Fail;
          result.tail_log = process->tail(kTailBytes);
          // 成功 job 也要清掉可能残留的后台子进程（红队 P1：`sleep 600 &` 孤儿）。
          process->cleanup_process_group();
          return;
        }
      }
    } catch (const std::exception& error) {
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = std::string("执行 job 命令失败：") + error.what();
    }
  }

  /** 失败证据（console 段）：成功后返回 true；没有可写内容/失败返回 false。 */
  bool append_saved_console_since(std::string& tail_log,
                                  const std::filesystem::path& console_log,
                                  std::size_t console_offset_before,
                                  const std::string& name) const {
    if (console_log.empty()) return false;
    const std::filesystem::path saved = StackProvisioner::save_failure_console_since(
        config_, console_log, console_offset_before, name);
    if (saved.empty()) return false;
    tail_log += "\n[loom] Paper 控制台尾部已保存：" + saved.string();
    return true;
  }

  /** 把 start() 失败时另存的 console 尾改名成 <level>-console.log；成功返回 true。 */
  bool append_saved_console_file(std::string& tail_log, const std::filesystem::path& saved,
                                 const std::string& name) const {
    if (saved.empty()) return false;
    std::error_code exists_ec;
    if (!std::filesystem::exists(saved, exists_ec)) return false;
    try {
      const std::filesystem::path target = StackProvisioner::console_evidence_path(config_, name);
      if (target.empty()) return false;
      if (!target.parent_path().empty()) {
        std::filesystem::create_directories(target.parent_path());
      }
      std::filesystem::copy_file(saved, target, std::filesystem::copy_options::overwrite_existing);
      std::error_code remove_ec;
      std::filesystem::remove(saved, remove_ec);
      tail_log += "\n[loom] Paper 控制台尾部已保存：" + target.string();
      return true;
    } catch (const std::exception&) {
      tail_log += "\n[loom] 警告：保存启动失败的控制台证据失败";
      return false;
    }
  }

  /**
   * 失败证据兜底：没有 Paper 控制台可截时（预检/模板缺文件/命令 spawn 失败），
   * 把 job 结果文本（中文错误）写进 log_dir/<level>-console.log，保证证据目录里每个失败
   * job 都有对应日志文件（红队 C7 契约：失败 job 必有 logs/<level>-console.log）。
   */
  void write_console_evidence_text(std::string& tail_log, const std::string& name,
                                   const std::string& text) const {
    try {
      const std::filesystem::path target = StackProvisioner::console_evidence_path(config_, name);
      if (target.empty()) return;
      if (!target.parent_path().empty()) {
        std::filesystem::create_directories(target.parent_path());
      }
      const std::string content = tail_utf8(text, 20 * 1024);
      std::ofstream out(target, std::ios::binary | std::ios::trunc);
      if (!out) return;
      out.write(content.data(), static_cast<std::streamsize>(content.size()));
      if (!out) return;
      tail_log += "\n[loom] 失败证据已保存（无 Paper 控制台输出，写错误文本）：" + target.string();
    } catch (const std::exception&) {
      // 证据写失败只影响可观测性，不影响 job 结果。
    }
  }

  /** 本执行器或全局中断标志（Scheduler::request_stop/SIGINT）任一置位。 */
  bool stop_requested() const noexcept {
    return stop_flag_.load(std::memory_order_relaxed) || shutdown_requested();
  }

  /** Scheduler 取消 job（未执行）时的统一结果。 */
  JobResult cancelled_result(const JobSpec& job, int worker_index,
                             Clock::time_point started) const {
    JobResult result;
    result.job = job;
    result.worker = worker_index;
    result.status = JobStatus::Error;
    result.exit_code = -1;
    result.tail_log = "收到中断信号（SIGINT/SIGTERM）：本 job 未执行";
    result.duration_ms = elapsed_ms(started);
    return result;
  }

  /** 停止并清理某槽位常驻栈（只由该槽位的 run 线程调用；正常收尾走 shutdown_all）。 */
  void drop_stack(int worker_index) {
    std::unique_ptr<Stack> stack;
    {
      std::lock_guard<std::mutex> guard(stacks_mutex_);
      const auto found = stacks_.find(worker_index);
      if (found == stacks_.end()) return;
      stack = std::move(found->second);
      stacks_.erase(found);
    }
    if (stack == nullptr) return;
    provisioner_.stop(*stack);
    provisioner_.cleanup(*stack);
  }

  /** 生命周期结束：并行停掉所有常驻栈（各自独立进程组，互不依赖），再删目录并打印启动次数。 */
  void shutdown_all() noexcept {
    std::map<int, std::unique_ptr<Stack>> stacks;
    std::map<int, int> start_counts;
    {
      std::lock_guard<std::mutex> guard(stacks_mutex_);
      stacks.swap(stacks_);
      start_counts.swap(start_counts_);
    }
    std::vector<std::thread> stoppers;
    stoppers.reserve(stacks.size());
    for (auto& [worker_index, stack] : stacks) {
      if (stack == nullptr) continue;
      Stack* raw = stack.get();
      stoppers.emplace_back([this, raw]() { provisioner_.stop(*raw); });
    }
    for (auto& stopper : stoppers) {
      if (stopper.joinable()) stopper.join();
    }
    for (auto& [worker_index, stack] : stacks) {
      if (stack == nullptr) continue;
      provisioner_.cleanup(*stack);
      int count = 0;
      const auto found = start_counts.find(worker_index);
      if (found != start_counts.end()) count = found->second;
      std::cerr << "[loom-stack] worker " << worker_index << " 生命周期结束：Paper 栈启动次数="
                << count << "（已停栈并清理工作目录）\n";
    }
  }

  std::atomic<bool> stop_flag_{false};
  StackConfig config_;
  StackProvisioner provisioner_;
  std::vector<std::unique_ptr<std::mutex>> slot_locks_;
  std::mutex stacks_mutex_;
  std::map<int, std::unique_ptr<Stack>> stacks_;
  std::map<int, int> start_counts_;
};

/** 抽象工厂（config.hpp 声明）：真实栈 / fake 二选一。 */
class DefaultExecutorFactory final : public ExecutorFactory {
 public:
  std::unique_ptr<JobExecutor> create(const RunConfig& config) override {
    if (config.fake) return create_fake_executor();
    return create_stack_executor(stack_config_from(config));
  }
};

}  // namespace

std::unique_ptr<JobExecutor> create_stack_executor(const StackConfig& config) {
  return std::make_unique<StackJobExecutor>(config);
}

std::unique_ptr<JobExecutor> create_fake_executor() {
  // 真实子进程、不启 Paper：复用 native-core 的 ProcessJobExecutor（同一套 fork/exec/
  // 进程组/超时/tail 语义），--fake 与差分测试用它。
  return create_process_executor(ProcessExecutorOptions{});
}

std::unique_ptr<ExecutorFactory> make_executor_factory() {
  return std::make_unique<DefaultExecutorFactory>();
}

}  // namespace loom
