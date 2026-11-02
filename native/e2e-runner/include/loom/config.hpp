// loom/config.hpp — CLI / RunConfig / StackConfig / ExecutorFactory（docs/58 §3）。
//
// 约定：
//   * 非法 CLI → 抛 loom::CliError（std::invalid_argument 子类，中文消息），main 捕获后
//     打印 "错误：…" + usage，退出码 2；
//   * --help → RunConfig.show_help = true（main 打印 usage 后退出 0）；
//   * 默认命令模板 `npx tsx it/l{level_num}-real.ts`（{level} / {level_num} / {id} 占位符）；
//   * StackConfig 由 --paper-template/--work-root/--out/--timeout-ms/--mc-base-port/
//     --rpc-base-port 派生，供 native-stack 的 create_stack_executor 使用。
#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

#include "loom/scheduler.hpp"

namespace loom {

/** CLI/配置错误（中文消息）；main 捕获后打印 usage 并以非 0 退出。 */
class CliError : public std::invalid_argument {
 public:
  explicit CliError(const std::string& message);
};

/** 默认关卡列表（e2e 全量）：L01..L10。 */
std::vector<std::string> default_levels();

/** CLI 解析结果（docs/58 §3 的 config.hpp）。 */
struct RunConfig {
  /** 关卡 id 列表（保持命令行顺序，已去重）。 */
  std::vector<std::string> levels = default_levels();
  int workers = 3;
  std::filesystem::path paper_template = "it/.mc-server";
  std::filesystem::path work_root = "tmp/native-e2e/work";
  std::filesystem::path out = "evidence/native-e2e/run.json";
  int timeout_ms = 900000;
  int mc_base_port = 25565;
  int rpc_base_port = 8765;
  std::string command_template = "npx tsx it/l{level_num}-real.ts";
  /** --dry-run：只列出 job 计划（不要求 native-stack 工厂存在）。 */
  bool dry_run = false;
  /** --fake：用 native-stack 的 fake executor（真实子进程、不启 Paper）。 */
  bool fake = false;
  /** --verbose：打印每个 job 的完整命令与 tail 摘要。 */
  bool verbose = false;
  /** --help：打印 usage 后退出 0。 */
  bool show_help = false;
};

/**
 * 真实 Paper 栈配置（native-stack 的 create_stack_executor 使用）。
 * 字段名与 native-stack 的 stack.hpp 约定一致；由 RunConfig 派生。
 */
struct StackConfig {
  std::filesystem::path paper_template = "it/.mc-server";
  std::filesystem::path java_bin = "java";
  std::filesystem::path work_root = "tmp/native-e2e/work";
  int mc_base_port = 25565;
  int rpc_base_port = 8765;
  int ready_timeout_ms = 90000;
  int ready_poll_ms = 150;
  int job_timeout_ms = 900000;
  std::filesystem::path log_dir = "tmp/native-e2e/logs";
  std::filesystem::path repo_root = ".";
  int workers = 3;
  std::string bot_prefix = "GolemP";
  std::string paper_jar = "paper.jar";
};

/** RunConfig → StackConfig（log_dir = out 的父目录/logs）。 */
StackConfig stack_config_from(const RunConfig& config);

/** 从 RunConfig 生成 job 列表（按关卡顺序；命令模板已展开）。 */
std::vector<JobSpec> build_jobs(const RunConfig& config);

/** 展开命令模板占位符：{level}=L05、{level_num}=5、{id}=同 level。 */
std::string expand_command_template(std::string_view command_template, std::string_view level);

/** 解析命令行（args 不含程序名）。非法 → CliError（中文）。 */
RunConfig parse_args(std::span<const std::string_view> args);

/** 便捷重载：parse_args(argc, argv)，内部跳过 argv[0]。 */
RunConfig parse_args(int argc, const char* const* argv);

/** 用法文本（中文；main --help 与错误提示共用）。 */
std::string_view usage_text();

// ---------------------------------------------------------------- 执行器工厂（native-stack 提供）

/**
 * 真实 Paper 栈执行器：由 native-stack 在 `src/factory.cpp` 实现（CMake 检测到该文件时
 * 定义 LOOM_HAS_STACK=1）。每个 job 通过 JobSpec.env 里的 LOOM_WORKER/MC_PORT/MC_RPC_PORT
 * 定位自己在哪个栈上执行；未提供时 main 只允许 --dry-run。
 */
std::unique_ptr<JobExecutor> create_stack_executor(const StackConfig& config);

/** 假栈执行器（真实子进程、不启 Paper）：native-stack 的 factory.cpp 实现；--fake 用。 */
std::unique_ptr<JobExecutor> create_fake_executor();

/**
 * 抽象工厂（docs/58 §3 / Lead 契约）：main 通过它拿到执行器，避免直接依赖 native-stack。
 * main.cpp 里的 StackExecutorFactory 适配 create_stack_executor()（实现于 native-stack 的
 * src/factory.cpp）；LOOM_HAS_STACK=0 时不编译真实执行路径，只允许 --dry-run。
 */
class ExecutorFactory {
 public:
  virtual ~ExecutorFactory() = default;
  virtual std::unique_ptr<JobExecutor> create(const RunConfig& config) = 0;
};

} // namespace loom
