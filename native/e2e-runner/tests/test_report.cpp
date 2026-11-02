// report 契约测试（native-core report.hpp）：
// JSON 转义、tail 截断 UTF-8 安全、RunReport 字段/状态映射/写文件、证据字段完整性。
#include <unistd.h>

#include <algorithm>
#include <chrono>
#include <filesystem>
#include <regex>
#include <string>
#include <vector>

#include "doctest.h"
#include "loom/report.hpp"
#include "test_util.hpp"

namespace {
loom::JobResult make_result(const std::string& id, loom::JobStatus status, int exit_code,
                            const std::string& tail = "tail") {
  loom::JobResult result;
  result.job.id = id;
  result.job.level = id;
  result.job.command = "cmd " + id;
  result.job.timeout_ms = 1000;
  result.status = status;
  result.exit_code = exit_code;
  result.duration_ms = 12;
  result.worker = 0;
  result.tail_log = tail;
  return result;
}
}  // namespace

TEST_CASE("report: job_status_name 四种状态映射稳定") {
  CHECK(loom::job_status_name(loom::JobStatus::Pass) == "pass");
  CHECK(loom::job_status_name(loom::JobStatus::Fail) == "fail");
  CHECK(loom::job_status_name(loom::JobStatus::Timeout) == "timeout");
  CHECK(loom::job_status_name(loom::JobStatus::Error) == "error");
}

TEST_CASE("report: json_escape 转义引号/反斜杠/换行/控制字符，保留 UTF-8") {
  CHECK(loom::json_escape("plain") == "plain");
  CHECK(loom::json_escape("a\"b") == "a\\\"b");
  CHECK(loom::json_escape("a\\b") == "a\\\\b");
  CHECK(loom::json_escape("a\nb") == "a\\nb");
  CHECK(loom::json_escape("a\tb") == "a\\tb");
  CHECK(loom::json_escape("a\rb") == "a\\rb");
  const std::string control = std::string("a") + static_cast<char>(0x01) + "b";
  CHECK(loom::json_escape(control).find("\\u0001") != std::string::npos);
  // UTF-8 中文原样保留（JSON 规范允许 UTF-8 直出）
  const std::string chinese = "灯亮了吗";
  CHECK(loom::json_escape(chinese) == chinese);
}

TEST_CASE("report: tail_utf8 截断到上限且不切断多字节字符") {
  CHECK(loom::tail_utf8("hello", 10) == "hello");
  const std::string long_ascii(10000, 'x');
  const auto tail = loom::tail_utf8(long_ascii, 100);
  CHECK(tail.size() <= 100);
  CHECK(tail.size() >= 90);

  // 每个中文 3 字节；max 落在字符中间时不能留半个字符
  std::string chinese;
  for (int i = 0; i < 100; ++i) chinese += "灯";
  for (int max_len : {1, 2, 3, 5, 10, 32, 100}) {
    const auto result = loom::tail_utf8(chinese, max_len);
    CHECK(result.size() <= static_cast<std::size_t>(max_len));
    // 验证结果仍是合法 UTF-8（逐字符解析，不出现孤立续字节）
    std::size_t i = 0;
    while (i < result.size()) {
      const unsigned char c = static_cast<unsigned char>(result[i]);
      if (c < 0x80) {
        ++i;
      } else if ((c & 0xE0) == 0xC0) {
        REQUIRE(i + 1 < result.size());
        ++i;  // 2-byte seq: 只要不截断即可（这些字符是 3-byte，这里兜底）
        ++i;
      } else if ((c & 0xF0) == 0xE0) {
        REQUIRE(i + 2 < result.size());
        i += 3;
      } else if ((c & 0xF8) == 0xF0) {
        REQUIRE(i + 3 < result.size());
        i += 4;
      } else {
        FAIL("invalid UTF-8 leading byte");
        break;
      }
    }
  }
}

TEST_CASE("report: iso8601_now 形如 UTC 时间戳") {
  const auto now = loom::iso8601_now();
  const std::regex re(R"(^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$)");
  CHECK(std::regex_match(now, re));
}

TEST_CASE("report: to_json 字段完整、状态名准确、tail 已转义") {
  loom::RunConfig config;
  config.levels = {"L01", "L02"};
  config.workers = 2;
  config.command_template = "npx tsx it/l{level_num}-real.ts";
  std::vector<loom::JobResult> results = {
      make_result("L01", loom::JobStatus::Pass, 0, "ok \"quoted\"\nline2"),
      make_result("L02", loom::JobStatus::Fail, 3, "boom"),
  };
  const auto report = loom::build_report(config, results, "2026-11-02T00:00:00Z", "2026-11-02T00:01:00Z", 60000);
  CHECK(report.workers == 2);
  CHECK(report.levels.size() == 2);
  CHECK(report.jobs.size() == 2);
  CHECK_FALSE(report.all_passed());

  const auto json = loom::to_json(report);
  // 顶层键
  for (const char* key : {"version", "startedAt", "finishedAt", "totalDurationMs", "workers",
                          "levels", "commandTemplate", "allPassed", "jobs"}) {
    CHECK_MESSAGE(json.find(std::string("\"") + key + "\"") != std::string::npos, key);
  }
  // job 键
  for (const char* key : {"id", "level", "command", "status", "exitCode", "durationMs", "worker", "tailLog"}) {
    CHECK_MESSAGE(json.find(std::string("\"") + key + "\"") != std::string::npos, key);
  }
  CHECK(json.find("\"status\": \"pass\"") != std::string::npos);
  CHECK(json.find("\"status\": \"fail\"") != std::string::npos);
  CHECK(json.find("\"exitCode\": 3") != std::string::npos);
  // tail 中的引号/换行必须被转义（原始换行不应出现在字符串里造成非法 JSON）
  CHECK(json.find("\\\"quoted\\\"") != std::string::npos);
  CHECK(json.find("\\nline2") != std::string::npos);
  // JSON 结构基本配平：花括号/方括号数量一致
  CHECK(std::count(json.begin(), json.end(), '{') == std::count(json.begin(), json.end(), '}'));
  CHECK(std::count(json.begin(), json.end(), '[') == std::count(json.begin(), json.end(), ']'));
}

TEST_CASE("report: write_report_json 落盘且内容与 to_json 一致") {
  loom::RunConfig config;
  config.levels = {"L05"};
  config.workers = 1;
  std::vector<loom::JobResult> results = {make_result("L05", loom::JobStatus::Timeout, -1, "timeout tail")};
  const auto report = loom::build_report(config, results, "a", "b", 100);
  const auto path = std::filesystem::temp_directory_path() /
                    ("loom-report-" + std::to_string(::getpid()) + ".json");
  loom::write_report_json(report, path);
  CHECK(std::filesystem::exists(path));
  const std::string content = loom_test::read_file(path);
  CHECK(content.find("\"status\": \"timeout\"") != std::string::npos);
  CHECK(content.find("\"levels\"") != std::string::npos);
  std::filesystem::remove(path);
}

TEST_CASE("report: all_passed 仅在全 Pass 时为 true") {
  loom::RunConfig config;
  config.levels = {"L01", "L02", "L03"};
  config.workers = 3;
  CHECK(loom::build_report(config, {make_result("L01", loom::JobStatus::Pass, 0),
                                    make_result("L02", loom::JobStatus::Pass, 0),
                                    make_result("L03", loom::JobStatus::Pass, 0)},
                            "a", "b", 10)
            .all_passed());
  CHECK_FALSE(loom::build_report(config, {make_result("L01", loom::JobStatus::Pass, 0),
                                          make_result("L02", loom::JobStatus::Timeout, -1)},
                                 "a", "b", 10)
                  .all_passed());
  // Lead 2026-11-02 裁决：空批次不能算 pass（防「空批次假绿」）。
  CHECK_FALSE(loom::build_report(config, {}, "a", "b", 10).all_passed());
}
