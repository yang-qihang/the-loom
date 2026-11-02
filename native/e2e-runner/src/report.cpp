// loom/report.cpp — 证据 JSON 生成（转义/tail/原子写入）。
#include "loom/report.hpp"

#include <chrono>
#include <cstdio>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>

namespace loom {

namespace {

std::string hex_escape(unsigned char value) {
  static const char* digits = "0123456789abcdef";
  std::string out = "\\u00";
  out += digits[(value >> 4U) & 0x0FU];
  out += digits[value & 0x0FU];
  return out;
}

bool is_continuation(unsigned char value) noexcept { return (value & 0xC0U) == 0x80U; }

/** 校验并返回 offset 处一个完整 UTF-8 序列的长度；非法返回 0（调用方用 U+FFFD 替换）。 */
std::size_t utf8_sequence_length(std::string_view input, std::size_t offset) noexcept {
  if (offset >= input.size()) return 0;
  const auto first = static_cast<unsigned char>(input[offset]);
  if (first < 0x80U) return 1;
  std::size_t length = 0;
  unsigned char second_min = 0x80U;
  unsigned char second_max = 0xBFU;
  if (first >= 0xC2U && first <= 0xDFU) {
    length = 2;
  } else if (first >= 0xE0U && first <= 0xEFU) {
    length = 3;
    if (first == 0xE0U) second_min = 0xA0U; // 排除 overlong
    if (first == 0xEDU) second_max = 0x9FU; // 排除 UTF-16 surrogate
  } else if (first >= 0xF0U && first <= 0xF4U) {
    length = 4;
    if (first == 0xF0U) second_min = 0x90U; // 排除 overlong
    if (first == 0xF4U) second_max = 0x8FU; // 排除 > U+10FFFF
  } else {
    return 0;
  }
  if (offset + length > input.size()) return 0;
  const auto second = static_cast<unsigned char>(input[offset + 1]);
  if (second < second_min || second > second_max) return 0;
  for (std::size_t i = 2; i < length; ++i) {
    if (!is_continuation(static_cast<unsigned char>(input[offset + i]))) return 0;
  }
  return length;
}

/**
 * JSON 字符串转义：引号/反斜杠/控制字符按 JSON 规则转义；**非法 UTF-8 字节替换为 \uFFFD**，
 * 保证输出永远是合法 UTF-8 JSON（job 日志里可能混进 0xFF/半截中文）。
 */
std::string escape_string(std::string_view input) {
  std::string out;
  out.reserve(input.size() + 8);
  for (std::size_t index = 0; index < input.size();) {
    const auto value = static_cast<unsigned char>(input[index]);
    if (value >= 0x80U) {
      const std::size_t length = utf8_sequence_length(input, index);
      if (length == 0) {
        out += "\\uFFFD";
        ++index;
      } else {
        out.append(input.substr(index, length));
        index += length;
      }
      continue;
    }
    switch (value) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\b': out += "\\b"; break;
      case '\f': out += "\\f"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (value < 0x20U) out += hex_escape(value);
        else out.push_back(static_cast<char>(value));
        break;
    }
    ++index;
  }
  return out;
}

void append_indent(std::string& out, int level) { out.append(static_cast<std::size_t>(level) * 2U, ' '); }

} // namespace

bool RunReport::all_passed() const noexcept {
  // 空批次不算通过：没有真的跑过任何 job 时不能报告「全绿」（防止假绿）。
  if (jobs.empty()) return false;
  for (const auto& job : jobs) {
    if (job.status != JobStatus::Pass) return false;
  }
  return true;
}

std::string tail_utf8(std::string_view bytes, std::size_t max_bytes) {
  if (bytes.size() <= max_bytes) return std::string(bytes);
  std::size_t start = bytes.size() - max_bytes;
  // 跳过被切断的 UTF-8 续字节（10xxxxxx），保证输出从完整字符开始。
  while (start < bytes.size()) {
    const auto value = static_cast<unsigned char>(bytes[start]);
    if ((value & 0xC0U) != 0x80U) break;
    ++start;
  }
  return std::string(bytes.substr(start));
}

std::string json_escape(std::string_view input) { return escape_string(input); }

std::string iso8601_now() {
  const auto now = std::chrono::system_clock::now();
  const auto millis = std::chrono::duration_cast<std::chrono::milliseconds>(now.time_since_epoch()) % 1000;
  const std::time_t seconds = std::chrono::system_clock::to_time_t(now);
  std::tm utc{};
#if defined(_WIN32)
  (void)gmtime_s(&utc, &seconds);
#else
  (void)gmtime_r(&seconds, &utc);
#endif
  const auto pad = [](long long value, std::size_t width) {
    std::string text = std::to_string(value);
    while (text.size() < width) text.insert(text.begin(), '0');
    return text;
  };
  return pad(static_cast<long long>(utc.tm_year) + 1900, 4) + "-" + pad(utc.tm_mon + 1, 2) + "-" +
         pad(utc.tm_mday, 2) + "T" + pad(utc.tm_hour, 2) + ":" + pad(utc.tm_min, 2) + ":" + pad(utc.tm_sec, 2) +
         "." + pad(millis.count(), 3) + "Z";
}

RunReport build_report(const RunConfig& config, const std::vector<JobResult>& results,
                       std::string started_at, std::string finished_at, long long total_duration_ms) {
  RunReport report;
  report.started_at = std::move(started_at);
  report.finished_at = std::move(finished_at);
  report.total_duration_ms = total_duration_ms;
  report.workers = config.workers;
  report.levels = config.levels;
  report.command_template = config.command_template;
  report.jobs = results;
  return report;
}

std::string to_json(const RunReport& report) {
  std::string out;
  out.reserve(4096);
  out += "{\n";
  append_indent(out, 1);
  out += "\"version\": " + std::to_string(report.version) + ",\n";
  append_indent(out, 1);
  out += "\"startedAt\": \"" + escape_string(report.started_at) + "\",\n";
  append_indent(out, 1);
  out += "\"finishedAt\": \"" + escape_string(report.finished_at) + "\",\n";
  append_indent(out, 1);
  out += "\"totalDurationMs\": " + std::to_string(report.total_duration_ms) + ",\n";
  append_indent(out, 1);
  out += "\"workers\": " + std::to_string(report.workers) + ",\n";
  append_indent(out, 1);
  out += "\"levels\": [";
  for (std::size_t i = 0; i < report.levels.size(); ++i) {
    if (i != 0) out += ", ";
    out += "\"" + escape_string(report.levels[i]) + "\"";
  }
  out += "],\n";
  append_indent(out, 1);
  out += "\"commandTemplate\": \"" + escape_string(report.command_template) + "\",\n";
  append_indent(out, 1);
  out += std::string("\"allPassed\": ") + (report.all_passed() ? "true" : "false") + ",\n";
  append_indent(out, 1);
  out += "\"jobs\": [";
  if (report.jobs.empty()) {
    out += "]\n";
  } else {
    out += "\n";
    for (std::size_t i = 0; i < report.jobs.size(); ++i) {
      const JobResult& job = report.jobs[i];
      append_indent(out, 2);
      out += "{\n";
      append_indent(out, 3);
      out += "\"id\": \"" + escape_string(job.job.id) + "\",\n";
      append_indent(out, 3);
      out += "\"level\": \"" + escape_string(job.job.level) + "\",\n";
      append_indent(out, 3);
      out += "\"command\": \"" + escape_string(job.job.command) + "\",\n";
      append_indent(out, 3);
      out += "\"status\": \"" + std::string(job_status_name(job.status)) + "\",\n";
      append_indent(out, 3);
      out += "\"exitCode\": " + std::to_string(job.exit_code) + ",\n";
      append_indent(out, 3);
      out += "\"durationMs\": " + std::to_string(job.duration_ms) + ",\n";
      append_indent(out, 3);
      out += "\"worker\": " + std::to_string(job.worker) + ",\n";
      append_indent(out, 3);
      out += "\"tailLog\": \"" + escape_string(tail_utf8(job.tail_log, kDefaultTailBytes)) + "\"\n";
      append_indent(out, 2);
      out += "}";
      if (i + 1 < report.jobs.size()) out += ",";
      out += "\n";
    }
    append_indent(out, 1);
    out += "]\n";
  }
  out += "}\n";
  return out;
}

void write_report_json(const RunReport& report, const std::filesystem::path& path) {
  const auto parent = path.parent_path();
  if (!parent.empty()) {
    std::error_code error;
    std::filesystem::create_directories(parent, error);
    if (error) {
      throw std::runtime_error("无法创建证据目录：" + parent.string() + "（" + error.message() + "）");
    }
  }
  const std::filesystem::path tmp = path.string() + ".tmp";
  {
    std::ofstream stream(tmp, std::ios::binary | std::ios::trunc);
    if (!stream) throw std::runtime_error("无法写入证据文件：" + tmp.string());
    stream << to_json(report);
    if (!stream) throw std::runtime_error("写证据文件失败：" + tmp.string());
  }
  std::error_code error;
  std::filesystem::rename(tmp, path, error);
  if (error) {
    std::filesystem::remove(path, error);
    error.clear();
    std::filesystem::rename(tmp, path, error);
    if (error) throw std::runtime_error("替换证据文件失败：" + path.string() + "（" + error.message() + "）");
  }
}

} // namespace loom
