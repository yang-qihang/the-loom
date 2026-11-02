// loom/process.hpp — POSIX fork/exec + pipe 的 RAII 子进程（docs/58 §3 Process trait）。
//
// 设计：
//   * stdout/stderr 合并到一条 pipe，reader 线程把输出写进线程安全的 TailBuffer（环形尾部），
//     可选同时 tee 到 log 文件（供 native-stack 的 Paper console.log 就绪检测）；
//   * stdin 是父进程可写 pipe（用于给服务器 `stop\n`）；
//   * new_process_group=true 时子进程 setsid()，kill() 会 SIGKILL 整个进程组（npx→tsx→bot 树）；
//   * 所有 waitpid 调用都处理 EINTR 重试；析构时若进程仍活则 SIGKILL + 回收，绝不留下僵尸；
//   * Windows 分支用 CreateProcessW + Job Object（#ifdef _WIN32），接口一致。
#pragma once

#include <atomic>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "loom/scheduler.hpp"

namespace loom {

/** 线程安全的尾部缓冲：只保留最近 capacity 字节（默认 256KiB），供日志 tail 使用。 */
class TailBuffer {
 public:
  explicit TailBuffer(std::size_t capacity = 256 * 1024);
  void append(std::string_view bytes);
  /** 取最后 max_bytes 字节（UTF-8 边界安全）。 */
  [[nodiscard]] std::string tail(std::size_t max_bytes = 4096) const;
  [[nodiscard]] std::size_t size() const;

 private:
  mutable std::mutex mutex_;
  std::string data_;
  std::size_t capacity_;
};

/** 子进程启动参数。 */
struct ProcessOptions {
  ProcessOptions() = default;
  /** 便捷构造：`ProcessOptions{"sh", {"-c", "echo hi"}}`（其余字段用默认值）。 */
  ProcessOptions(std::string program_value, std::vector<std::string> args_value)
      : program(std::move(program_value)), args(std::move(args_value)) {}

  /** 可执行文件：含 '/' 时按路径执行，否则在 PATH 里查找。 */
  std::string program;
  /** 参数列表（不含 argv[0]；argv[0] 自动为 program）。 */
  std::vector<std::string> args;
  /** 子进程工作目录；空 = 继承父进程。 */
  std::optional<std::filesystem::path> work_dir;
  /** 追加/覆盖到父进程环境的环境变量。 */
  std::map<std::string, std::string> env;
  /** 可选：把合并输出同时写到该文件（父进程 reader 线程写，自动 flush 到内核）。 */
  std::optional<std::filesystem::path> log_path;
  /** true → 子进程 setsid() 独立进程组；kill() 杀整组。 */
  bool new_process_group = false;
  /** 内存尾部缓冲容量（字节）。 */
  std::size_t tail_capacity = 256 * 1024;
};

/**
 * RAII 子进程句柄。
 *  - spawn() 失败抛 std::runtime_error（中文）；
 *  - 析构时若仍在运行：kill() + 阻塞回收（EINTR 重试），join reader，避免僵尸/泄漏；
 *  - 移动可、拷贝不可。
 */
class Process {
  class Impl;

 public:
  static std::unique_ptr<Process> spawn(ProcessOptions options);

  ~Process();
  Process(Process&&) noexcept;
  Process& operator=(Process&&) noexcept;
  Process(const Process&) = delete;
  Process& operator=(const Process&) = delete;

  /** 系统 pid（POSIX）；Windows 为 process id。未启动为 0。 */
  [[nodiscard]] std::int64_t native_id() const noexcept;

  /** 非阻塞检查是否还在运行；已退出并回收返回 false。 */
  [[nodiscard]] bool running();

  /**
   * 最多等 timeout：退出则回收并返回退出码（正常=进程码；被信号杀死=128+signal）；
   * 超时返回 std::nullopt（进程仍在运行，调用方决定 kill）。
   */
  std::optional<int> wait_for(std::chrono::milliseconds timeout);

  /** 阻塞直到退出并回收（EINTR 重试）；返回退出码（被信号杀死=128+signal）。 */
  int wait();

  /** 写 stdin；子进程已退出/管道不可写 → 抛 std::runtime_error（中文）。 */
  void write(std::string_view data);

  /** 关闭 stdin（幂等）。 */
  void close_stdin() noexcept;

  /** 向进程（或进程组）发信号；已退出为 no-op。 */
  void send_signal(int signal) noexcept;

  /** SIGTERM（Windows TerminateProcess）。 */
  void terminate() noexcept;

  /** SIGKILL（new_process_group 时杀整个进程组）。 */
  void kill() noexcept;

  /** 当前日志尾部（UTF-8 安全，默认最后 4KB）。 */
  [[nodiscard]] std::string tail(std::size_t max_bytes = 4096) const;

  /** 清尾：对整组 SIGTERM → 短宽限 → SIGKILL（主进程成功退出也调用，清掉后台子进程）。
   *  new_process_group=false 时为空操作；从不抛异常。 */
  void cleanup_process_group(std::chrono::milliseconds grace = std::chrono::milliseconds(100)) noexcept;

  /** 从 spawn 到退出（或现在）的毫秒数。 */
  [[nodiscard]] long long duration_ms() const noexcept;

  /** 内部构造用（只应由 Process::spawn / std::make_unique 调用）。 */
  explicit Process(std::unique_ptr<Impl> impl);

 private:
  std::unique_ptr<Impl> impl_;
};

// ---------------------------------------------------------------- 通用 JobExecutor

/** ProcessJobExecutor 的选项。 */
struct ProcessExecutorOptions {
  /** job 的 cwd（空 = 继承当前进程 cwd，main 从仓库根启动）。 */
  std::optional<std::filesystem::path> work_dir;
  std::size_t tail_capacity = 256 * 1024;
  /** job.timeout_ms <= 0 时使用。 */
  int default_timeout_ms = 900000;
};

/**
 * 用 Process 执行一条 shell 命令的通用 JobExecutor：
 *   * POSIX：/bin/sh -c <command>，新的进程组；超时 SIGKILL 整组，waitpid EINTR 重试；
 *   * Windows：cmd /c <command>，Job Object 杀进程树；
 *   * 状态映射：exit 0 → Pass；非 0 → Fail；超时 → Timeout；spawn 失败/异常 → Error；
 *   * tail_log = 合并输出最后 4KB；duration_ms = wall clock。
 * Scheduler 注入的 env（MC_PORT/MC_RPC_PORT/…）会原样传给子进程。
 */
class ProcessJobExecutor final : public JobExecutor {
 public:
  explicit ProcessJobExecutor(ProcessExecutorOptions options = {});
  JobResult run(const JobSpec& job) override;
  /** 中断请求：只置原子标志，由 run() 的等待循环轮询后自行杀进程组（不在其它线程碰 Process）。 */
  void shutdown() noexcept override;

 private:
  ProcessExecutorOptions options_;
  std::atomic<bool> stop_requested_{false};
};

/** 不需要 Paper 的 fake 执行器：等价 ProcessJobExecutor（供 --fake / 测试）。 */
std::unique_ptr<JobExecutor> create_process_executor(ProcessExecutorOptions options = {});

} // namespace loom
