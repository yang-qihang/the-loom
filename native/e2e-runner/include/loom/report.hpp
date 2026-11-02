// loom/report.hpp — 证据 JSON（docs/58 §3：RunReport → JSON）。
//
// JSON 结构（camelCase，UTF-8 原样输出；控制字符转义为 \u00XX）：
// {
//   "version": 1,
//   "startedAt": "2026-11-02T09:00:00.000Z",
//   "finishedAt": "...",
//   "totalDurationMs": 123456,
//   "workers": 3,
//   "levels": ["L01", "L05"],
//   "commandTemplate": "npx tsx it/l{level_num}-real.ts",
//   "allPassed": true,
//   "jobs": [
//     { "id":"L01", "level":"L01", "command":"...", "status":"pass",
//       "exitCode":0, "durationMs":61000, "worker":0, "tailLog":"…最后 4KB…" }
//   ]
// }
#pragma once

#include <cstddef>
#include <filesystem>
#include <string>
#include <string_view>
#include <vector>

#include "loom/config.hpp"
#include "loom/scheduler.hpp"

namespace loom {

/** 证据 JSON 的默认日志尾部字节数（docs/58 §4：4KB）。 */
inline constexpr std::size_t kDefaultTailBytes = 4096;

/**
 * JobResult.exit_code 统一语义（所有 JobExecutor 实现必须一致；证据/测试以此为准）：
 *   - 正常退出：进程真实退出码（0=成功）；
 *   - 被信号杀死：128 + signal（SIGKILL=9 → 137，SIGSEGV=11 → 139，…）；
 *   - 超时：固定 **137**（超时必然由 SIGKILL 终止；即使恰好拿到其它码也按超时=137 记，
 *           保证「超时」在两个 executor（ProcessJobExecutor / native-stack 的 StackExecutor）一致）；
 *   - 执行器错误（spawn 失败 / 捕获异常）：-1；
 *   - 被 SIGINT/SIGTERM 中断：-1，status=Error（job 未正常完成，不算 Fail）。
 */
inline constexpr int kTimeoutExitCode = 137;

/** 证据聚合结果。 */
struct RunReport {
  int version = 1;
  std::string started_at;  // ISO-8601 UTC（毫秒），如 2026-11-02T09:00:00.000Z
  std::string finished_at; // 同上
  long long total_duration_ms = 0;
  int workers = 0;
  std::vector<std::string> levels;
  std::string command_template;
  std::vector<JobResult> jobs; // 按输入顺序

  [[nodiscard]] bool all_passed() const noexcept;
};

/** UTF-8 安全截尾：取 bytes 的最后 max_bytes 字节，并去掉被切断的 UTF-8 前导/续字节。 */
std::string tail_utf8(std::string_view bytes, std::size_t max_bytes = kDefaultTailBytes);

/** JSON 字符串转义（含 " \\ 控制字符；保留 UTF-8 多字节）。 */
std::string json_escape(std::string_view input);

/** 当前 UTC 时间 ISO-8601（毫秒精度，以 Z 结尾）。 */
std::string iso8601_now();

/** 汇总 results 生成 RunReport（levels 取自 config，duration 由 started/finished 计算）。 */
RunReport build_report(const RunConfig& config, const std::vector<JobResult>& results,
                       std::string started_at, std::string finished_at, long long total_duration_ms);

/** RunReport → 证据 JSON 文本（带缩进，可解析；末尾换行）。 */
std::string to_json(const RunReport& report);

/** 写证据 JSON 文件（自动创建父目录；先写 tmp 再 rename，避免半截文件）。 */
void write_report_json(const RunReport& report, const std::filesystem::path& path);

} // namespace loom
