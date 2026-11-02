// loom/config.cpp — CLI 解析 / RunConfig / StackConfig / job 构建。
#include "loom/config.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <sstream>
#include <string>
#include <unordered_set>
#include <utility>

namespace loom {

namespace {

std::string trim(std::string_view text) {
  std::size_t begin = 0;
  std::size_t end = text.size();
  while (begin < end && std::isspace(static_cast<unsigned char>(text[begin])) != 0) ++begin;
  while (end > begin && std::isspace(static_cast<unsigned char>(text[end - 1])) != 0) --end;
  return std::string(text.substr(begin, end - begin));
}

std::string to_upper(std::string text) {
  for (char& c : text) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
  return text;
}

/** 严格十进制整数解析（拒绝空、符号、尾随垃圾）。 */
int parse_int_strict(std::string_view text, std::string_view option) {
  if (text.empty()) throw CliError("参数 " + std::string(option) + " 需要一个整数，但没有给值");
  int value = 0;
  const char* first = text.data();
  const char* last = text.data() + text.size();
  const auto result = std::from_chars(first, last, value);
  if (result.ec != std::errc{} || result.ptr != last) {
    throw CliError("参数 " + std::string(option) + " 不是合法整数：" + std::string(text));
  }
  return value;
}

/** 关卡 id 规范化：l1/l01/L1/L01 → L01；非法 → CliError。 */
std::string normalize_level(std::string_view raw) {
  const std::string text = to_upper(trim(raw));
  if (text.size() < 2 || text.size() > 3 || text[0] != 'L') {
    throw CliError("关卡名不对：" + std::string(raw) + "（示例：L01、L10；多个用逗号分隔）");
  }
  for (std::size_t i = 1; i < text.size(); ++i) {
    if (std::isdigit(static_cast<unsigned char>(text[i])) == 0) {
      throw CliError("关卡名不对：" + std::string(raw) + "（示例：L01、L10；多个用逗号分隔）");
    }
  }
  const int number = parse_int_strict(std::string_view(text).substr(1), "--levels");
  if (number < 1 || number > 10) {
    throw CliError("关卡只支持 L01–L10（收到：" + std::string(raw) + "）");
  }
  std::string padded = "L";
  if (number < 10) padded += '0';
  padded += std::to_string(number);
  return padded;
}

std::filesystem::path parse_path(std::string_view value, std::string_view option) {
  if (trim(value).empty()) throw CliError("参数 " + std::string(option) + " 需要非空路径");
  return std::filesystem::path(std::string(value));
}

void validate_port_range(int mc_base, int rpc_base, int workers) {
  const auto check_base = [](int port, std::string_view which) {
    if (port < 1 || port > 65535) throw CliError(std::string(which) + " 端口必须在 1–65535：" + std::to_string(port));
  };
  check_base(mc_base, "--mc-base-port");
  check_base(rpc_base, "--rpc-base-port");
  if (mc_base + workers - 1 > 65535) throw CliError("MC 端口区间越界：基址 " + std::to_string(mc_base) + " + " + std::to_string(workers) + " 个 worker");
  if (rpc_base + workers - 1 > 65535) throw CliError("RPC 端口区间越界：基址 " + std::to_string(rpc_base) + " + " + std::to_string(workers) + " 个 worker");
  const bool overlap = mc_base <= rpc_base + workers - 1 && rpc_base <= mc_base + workers - 1;
  if (overlap) {
    throw CliError("MC 端口区间与 RPC 端口区间重叠：MC=" + std::to_string(mc_base) + ".." +
                   std::to_string(mc_base + workers - 1) + "，RPC=" + std::to_string(rpc_base) + ".." +
                   std::to_string(rpc_base + workers - 1) + "（用 --mc-base-port/--rpc-base-port 错开）");
  }
}

/** 取 `--name value` / `--name=value` 的值；返回是否有内联值，调用方负责推进索引。 */
struct OptionToken {
  std::string name;
  std::optional<std::string> inline_value;
};

OptionToken split_option(std::string_view arg) {
  const auto pos = arg.find('=');
  if (pos == std::string_view::npos) return {std::string(arg), std::nullopt};
  return {std::string(arg.substr(0, pos)), std::string(arg.substr(pos + 1))};
}

} // namespace

CliError::CliError(const std::string& message) : std::invalid_argument(message) {}

std::vector<std::string> default_levels() {
  std::vector<std::string> levels;
  levels.reserve(10);
  for (int number = 1; number <= 10; ++number) {
    std::string level = "L";
    if (number < 10) level += '0';
    level += std::to_string(number);
    levels.push_back(level);
  }
  return levels;
}

std::string expand_command_template(std::string_view command_template, std::string_view level) {
  const std::string level_text(level);
  std::string level_num = "0";
  if (level_text.size() > 1) {
    const int number = parse_int_strict(std::string_view(level_text).substr(1), "--levels");
    level_num = std::to_string(number);
  }
  std::string out(command_template);
  const std::array<std::pair<std::string_view, std::string>, 3> replacements = {
      std::pair<std::string_view, std::string>{"{level_num}", level_num},
      std::pair<std::string_view, std::string>{"{level}", level_text},
      std::pair<std::string_view, std::string>{"{id}", level_text},
  };
  for (const auto& [needle, replacement] : replacements) {
    std::size_t pos = 0;
    while ((pos = out.find(needle, pos)) != std::string::npos) {
      out.replace(pos, needle.size(), replacement);
      pos += replacement.size();
    }
  }
  return out;
}

std::vector<JobSpec> build_jobs(const RunConfig& config) {
  std::vector<JobSpec> jobs;
  jobs.reserve(config.levels.size());
  for (const auto& level : config.levels) {
    JobSpec job;
    job.id = level;
    job.level = level;
    job.command = expand_command_template(config.command_template, level);
    job.timeout_ms = config.timeout_ms;
    jobs.push_back(std::move(job));
  }
  return jobs;
}

StackConfig stack_config_from(const RunConfig& config) {
  StackConfig stack;
  stack.paper_template = config.paper_template;
  stack.work_root = config.work_root;
  stack.mc_base_port = config.mc_base_port;
  stack.rpc_base_port = config.rpc_base_port;
  stack.job_timeout_ms = config.timeout_ms;
  stack.workers = config.workers;
  const auto out_parent = config.out.parent_path();
  stack.log_dir = out_parent.empty() ? std::filesystem::path("logs") : out_parent / "logs";
  stack.repo_root = std::filesystem::current_path();
  return stack;
}

RunConfig parse_args(std::span<const std::string_view> args) {
  RunConfig config;
  bool levels_given = false;
  std::vector<std::string> levels;
  std::unordered_set<std::string> seen;

  std::size_t index = 0;
  while (index < args.size()) {
    const std::string raw = trim(args[index]);
    if (raw.empty()) {
      ++index;
      continue;
    }
    if (raw.rfind("--", 0) != 0) throw CliError("多余的位置参数：" + raw + "（用 --help 查看用法）");
    const OptionToken token = split_option(raw);
    const auto take_value = [&](std::string_view option) -> std::string {
      if (token.inline_value.has_value()) return *token.inline_value;
      if (index + 1 >= args.size()) throw CliError("参数 " + std::string(option) + " 缺少值");
      ++index;
      return std::string(args[index]);
    };
    const auto reject_value = [&](std::string_view option) {
      if (token.inline_value.has_value()) throw CliError("参数 " + std::string(option) + " 不接受值");
    };

    if (token.name == "--help" || token.name == "-h") {
      reject_value(token.name);
      config.show_help = true;
    } else if (token.name == "--dry-run") {
      reject_value(token.name);
      config.dry_run = true;
    } else if (token.name == "--fake") {
      reject_value(token.name);
      config.fake = true;
    } else if (token.name == "--verbose") {
      reject_value(token.name);
      config.verbose = true;
    } else if (token.name == "--levels") {
      const std::string value = take_value("--levels");
      std::stringstream stream(value);
      std::string item;
      bool any = false;
      while (std::getline(stream, item, ',')) {
        const std::string trimmed = trim(item);
        if (trimmed.empty()) {
          throw CliError("参数 --levels 里有空项：逗号之间必须有关卡名（示例：--levels L01,L05）");
        }
        any = true;
        const std::string normalized = normalize_level(trimmed);
        // 重复关卡按契约拒绝（Lead 2026-11-02 裁决：空段/重复/未知关都报错，避免同一关被并行跑两次抢端口）。
        if (!seen.insert(normalized).second) {
          throw CliError("参数 --levels 里重复了关卡：" + normalized + "（每个关卡只能写一次）");
        }
        levels.push_back(normalized);
      }
      if (!any) throw CliError("参数 --levels 至少需要一个关卡（示例：--levels L01,L05）");
      levels_given = true;
    } else if (token.name == "--workers") {
      config.workers = parse_int_strict(take_value("--workers"), "--workers");
      if (config.workers < 1 || config.workers > 64) {
        throw CliError("参数 --workers 必须在 1–64 之间（收到 " + std::to_string(config.workers) + "）");
      }
    } else if (token.name == "--paper-template") {
      config.paper_template = parse_path(take_value("--paper-template"), "--paper-template");
    } else if (token.name == "--work-root") {
      config.work_root = parse_path(take_value("--work-root"), "--work-root");
    } else if (token.name == "--out") {
      config.out = parse_path(take_value("--out"), "--out");
    } else if (token.name == "--timeout-ms") {
      config.timeout_ms = parse_int_strict(take_value("--timeout-ms"), "--timeout-ms");
      if (config.timeout_ms < 1 || config.timeout_ms > 86400000) {
        throw CliError("参数 --timeout-ms 必须在 1–86400000（24h）之间（收到 " + std::to_string(config.timeout_ms) + "）");
      }
    } else if (token.name == "--mc-base-port") {
      config.mc_base_port = parse_int_strict(take_value("--mc-base-port"), "--mc-base-port");
    } else if (token.name == "--rpc-base-port") {
      config.rpc_base_port = parse_int_strict(take_value("--rpc-base-port"), "--rpc-base-port");
    } else if (token.name == "--command-template") {
      const std::string value = take_value("--command-template");
      if (trim(value).empty()) throw CliError("参数 --command-template 不能为空");
      config.command_template = value;
    } else {
      throw CliError("未知参数：" + token.name + "（用 --help 查看用法）");
    }
    ++index;
  }

  if (levels_given) {
    if (levels.empty()) throw CliError("参数 --levels 至少需要一个关卡（示例：--levels L01,L05）");
    config.levels = std::move(levels);
  }
  validate_port_range(config.mc_base_port, config.rpc_base_port, config.workers);
  return config;
}

RunConfig parse_args(int argc, const char* const* argv) {
  std::vector<std::string_view> args;
  if (argc > 1) {
    args.reserve(static_cast<std::size_t>(argc - 1));
    for (int i = 1; i < argc; ++i) {
      if (argv[i] == nullptr) continue;
      args.emplace_back(argv[i]);
    }
  }
  return parse_args(std::span<const std::string_view>(args.data(), args.size()));
}

std::string_view usage_text() {
  return R"(loom-e2e — 并行真实 Paper e2e 执行器（docs/58）

用法：
  loom-e2e [选项]

选项：
  --levels LIST            关卡列表，逗号分隔（默认 L01..L10；示例 --levels L01,L05,L06）
  --workers N              并行 worker 数（默认 3，范围 1–64）
  --paper-template DIR     Paper 服务端模板目录（默认 it/.mc-server）
  --work-root DIR          每个 worker 的工作目录根（默认 tmp/native-e2e/work）
  --out FILE               证据 JSON 输出路径（默认 evidence/native-e2e/run.json）
  --timeout-ms N           单个 job 超时毫秒（默认 900000 = 15 分钟）
  --mc-base-port N         MC 端口基址（默认 25565；worker i 用 base+i）
  --rpc-base-port N        RPC 端口基址（默认 8765；worker i 用 base+i）
  --command-template STR   命令模板（默认 "npx tsx it/l{level_num}-real.ts"；
                           占位符 {level}=L05 {level_num}=5 {id}=L05）
  --dry-run                只打印 job/worker/端口计划，不执行（不需要 Paper 栈实现）
  --fake                   用假栈执行器（真实子进程、不启动 Paper；需要 native-stack 的 fake 实现）
  --verbose                打印每个 job 的完整命令与日志尾部
  -h, --help               打印本帮助并退出

退出码：
  0 全部 job 通过（或 --dry-run/--help 正常结束）
  1 至少一个 job 失败/超时/执行错误
  2 参数/配置错误（含缺少真实 Paper 栈实现）
  3 运行期内部错误（证据写入失败等）
)";
}

} // namespace loom
