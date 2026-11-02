// loom/stack.hpp — 真实 Paper 栈供给层（docs/58 §3；native-stack 实现）。
//
// 职责（只服务真实 Paper e2e，不改变任何关卡断言/评分真值）：
//   * 每个 worker 独享一份 Paper 数据目录：从 StackConfig.paper_template 复制到
//     work_root/w<worker_index>，排除 logs/、console.*、session.lock；
//   * 改 server.properties 的 server-port/query.port、改 plugins/LoomCraft/config.yml 的
//     ws.port（端口由 Scheduler 通过 JobSpec.env 注入，缺省时用 base + worker_index）；
//   * 以 `java -Xms1G -Xmx2G -jar paper.jar --nogui` 启动（cwd=worker 目录，stdout/stderr
//     合并 tee 到 worker/console.log，stdin 可写 `stop\n`）；
//   * 等待 ready：RPC TCP 可连接 + console 出现 `Done (`（默认 90s；超时杀整个进程组并抛中文错误）；
//   * stop：写 `stop\n` → 等 20s → SIGTERM → SIGKILL，wait 回收（不产生僵尸）；
//   * 失败证据：把 console.log 尾部写到 StackConfig.log_dir/<level>-console.log，再删 worker 目录。
//
// 线程模型：StackProvisioner 本身无状态（只读 StackConfig），不同 worker_index 的
// start/stop/cleanup 可并发调用；同一 worker_index 由 JobExecutor 保证串行（见 factory.cpp）。
#pragma once

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <memory>
#include <stdexcept>
#include <string>
#include <string_view>

#include "loom/config.hpp"   // StackConfig（native-core 定义，避免 ODR 冲突）
#include "loom/ports.hpp"    // StackPorts（native-core 定义，与 PortAllocator 同形）
#include "loom/process.hpp"  // Process（native-core 的 POSIX/Windows RAII 子进程）

namespace loom {

/**
 * 启动 Paper 栈失败（复制模板/改配置/端口被占/就绪超时/进程提前退出）。
 * 带上 worker 目录与 console.log 路径，调用方（factory.cpp）据此保存失败证据。
 */
class StackStartError : public std::runtime_error {
 public:
  StackStartError(std::string message, std::filesystem::path worker_dir,
                  std::filesystem::path console_log,
                  std::filesystem::path saved_console = {});
  ~StackStartError() override;

  [[nodiscard]] const std::filesystem::path& worker_dir() const noexcept;
  [[nodiscard]] const std::filesystem::path& console_log() const noexcept;
  /** start() 失败时已保存到 log_dir 的控制台证据（可能为空：模板准备阶段就失败）。 */
  [[nodiscard]] const std::filesystem::path& saved_console() const noexcept;

 private:
  std::filesystem::path worker_dir_;
  std::filesystem::path console_log_;
  std::filesystem::path saved_console_;
};

/** 一个已启动的真实 Paper 栈（docs/58 §3 的 Stack：目录 + 端口 + 进程句柄）。 */
struct Stack {
  std::filesystem::path dir;
  StackPorts ports;
  std::unique_ptr<Process> paper;

  /** Paper 进程是否仍在运行（已退出并回收 → false）。 */
  [[nodiscard]] bool running() const noexcept;
  /** Paper 的 pid（未启动为 0）。 */
  [[nodiscard]] long long pid() const noexcept;
  /** worker 目录里的 console.log 路径。 */
  [[nodiscard]] std::filesystem::path console_log() const;
};

/** 栈供给器：一个实例可服务多个 worker_index（start/stop/cleanup 并发安全）。 */
class StackProvisioner {
 public:
  explicit StackProvisioner(StackConfig config);

  /**
   * 启动 worker_index 的 Paper 栈；端口 = mc_base_port + worker_index /
   * rpc_base_port + worker_index。失败抛 StackStartError（进程已杀、目录已清）。
   */
  std::unique_ptr<Stack> start(int worker_index);

  /**
   * 指定端口的版本：Scheduler 已按 worker 槽位把 MC_PORT/MC_RPC_PORT 注入 JobSpec.env 时，
   * 栈执行器以 env 为准调用这个重载（docs/58 §3：端口分配归 Scheduler/PortAllocator）。
   */
  std::unique_ptr<Stack> start_with_ports(int worker_index, StackPorts ports);

  /** 优雅停止：写 `stop\n` → 等 20s → SIGTERM → SIGKILL，wait 回收。noexcept。 */
  void stop(Stack& stack) noexcept;

  /** 删除 worker 目录（stop 后调用；失败只打 stderr 警告，不抛）。 */
  void cleanup(Stack& stack) noexcept;

  [[nodiscard]] const StackConfig& config() const noexcept;

  /**
   * 把 console.log 尾部（默认 20KB，UTF-8 安全）写到 `log_dir/<name>-console.log`。
   * 返回写入路径；console 不存在或写失败返回空路径（不抛）。
   */
  static std::filesystem::path save_failure_console(
      const StackConfig& config, const std::filesystem::path& console_log,
      std::string_view name, std::size_t max_bytes = 20 * 1024);

  /**
   * 只保存「本次 job 产生的那段」控制台日志（容器复用同一个 Paper 栈时用）：
   * 从 since_offset 开始读到文件尾，取最后 max_bytes（默认 20KB），写到
   * `log_dir/<name>-console.log`。失败返回空路径（不抛）。
   */
  static std::filesystem::path save_failure_console_since(
      const StackConfig& config, const std::filesystem::path& console_log,
      std::size_t since_offset, std::string_view name, std::size_t max_bytes = 20 * 1024);

  /** 证据文件路径（`log_dir/<安全化 name>-console.log`）；log_dir 为空返回空路径。 */
  static std::filesystem::path console_evidence_path(const StackConfig& config,
                                                     std::string_view name);

 private:
  StackConfig config_;
};

}  // namespace loom
