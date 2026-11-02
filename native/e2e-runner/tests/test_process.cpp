// Process / TailBuffer / ProcessJobExecutor 契约测试（native-core process.hpp）：
// 成功/失败/崩溃/信号退出码、stdin 读写、超时、进程组整树 kill、RAII 无僵尸、fd 不泄漏、tail 截断。
#include <signal.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iterator>
#include <set>
#include <string>
#include <thread>
#include <vector>

#include "doctest.h"
#include "loom/process.hpp"
#include "loom/report.hpp"
#include "loom/scheduler.hpp"
#include "test_util.hpp"

namespace {
int count_open_fds() {
  int count = 0;
  std::error_code ec;
  for ([[maybe_unused]] const auto& entry : std::filesystem::directory_iterator("/proc/self/fd", ec)) {
    ++count;
  }
  return count;
}

long long wall_ms() { return loom_test::now_ms(); }

bool pid_alive(long long pid) { return ::kill(static_cast<pid_t>(pid), 0) == 0; }

std::string fake(const std::string& name) {
  return std::string(LOOM_TEST_DIR) + "/" + name;
}

long long read_pid(const std::filesystem::path& file) {
  std::ifstream in(file);
  long long pid = 0;
  in >> pid;
  return pid;
}
}  // namespace

TEST_CASE("process: TailBuffer 追加与 tail 截断（保留最后 cap）") {
  loom::TailBuffer buffer(16);
  buffer.append("0123456789");
  CHECK(buffer.size() == 10);
  CHECK(buffer.tail(4) == "6789");
  buffer.append("abcdefghijklmno");  // 超过 cap，只保留末尾 16 字节
  CHECK(buffer.size() == 16);
  const auto tail = buffer.tail(16);
  CHECK(tail.size() == 16);
  CHECK(tail == "9abcdefghijklmno");  // 保留最后 16 字节
  CHECK(buffer.tail(5) == "klmno");
}

TEST_CASE("process: spawn + wait 成功/失败退出码") {
  const auto ok = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "printf hello"}});
  REQUIRE(ok != nullptr);
  CHECK(ok->wait() == 0);
  CHECK_FALSE(ok->running());
  CHECK(ok->duration_ms() >= 0);
  CHECK(ok->tail(4096).find("hello") != std::string::npos);

  const auto fail = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "echo boom >&2; exit 3"}});
  REQUIRE(fail != nullptr);
  CHECK(fail->wait() == 3);
  CHECK(fail->tail(4096).find("boom") != std::string::npos);
}

TEST_CASE("process: 被信号杀死时退出码为 128+sig（SIGSEGV→139）") {
  const auto crashed = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "kill -SEGV $$"}});
  REQUIRE(crashed != nullptr);
  const int code = crashed->wait();
  CHECK(code == 128 + SIGSEGV);
}

TEST_CASE("process: stdin 写入 + close_stdin（cat 回显）") {
  const auto cat = loom::Process::spawn(loom::ProcessOptions{"cat", {}});
  REQUIRE(cat != nullptr);
  cat->write("hello-stdin\n");
  cat->close_stdin();
  CHECK(cat->wait() == 0);
  CHECK(cat->tail(4096).find("hello-stdin") != std::string::npos);
}

TEST_CASE("process: wait_for 超时返回 nullopt 且进程仍运行；kill 后回收") {
  const auto sleeper = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "sleep 5"}});
  REQUIRE(sleeper != nullptr);
  const long long pid = sleeper->native_id();
  CHECK(pid > 0);
  CHECK(sleeper->wait_for(std::chrono::milliseconds(120)) == std::nullopt);
  CHECK(sleeper->running());
  sleeper->kill();
  const int code = sleeper->wait();
  CHECK(code != 0);
  CHECK_FALSE(sleeper->running());
  CHECK_FALSE(pid_alive(pid));  // 已 wait 回收，无僵尸
}

TEST_CASE("process: RAII 析构会 kill+wait 回收（无僵尸）") {
  long long pid = 0;
  {
    const auto proc = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "sleep 30"}});
    REQUIRE(proc != nullptr);
    pid = proc->native_id();
    CHECK(pid_alive(pid));
  }  // 析构
  CHECK_FALSE(pid_alive(pid));
}

TEST_CASE("process: 连续 30 次 spawn/wait 无 fd 泄漏") {
  // 预热，避免首个进程的共享初始化影响计数基准
  { auto warm = loom::Process::spawn(loom::ProcessOptions{"true", {}}); warm->wait(); }
  const int before = count_open_fds();
  for (int i = 0; i < 30; ++i) {
    auto proc = loom::Process::spawn(loom::ProcessOptions{"sh", {"-c", "printf x"}});
    REQUIRE(proc != nullptr);
    CHECK(proc->wait() == 0);
  }
  const int after = count_open_fds();
  CHECK(after <= before + 2);
}

TEST_CASE("process: log_path tee 落盘（stdout+stderr 合并）") {
  loom_test::TempDir dir("process-log");
  const auto log = dir.path / "out.log";
  loom::ProcessOptions options{"sh", {"-c", "echo stdout-line; echo stderr-line >&2"}};
  options.log_path = log;
  auto proc = loom::Process::spawn(std::move(options));
  REQUIRE(proc != nullptr);
  CHECK(proc->wait() == 0);
  REQUIRE(std::filesystem::exists(log));
  const auto content = loom_test::read_file(log);
  CHECK(content.find("stdout-line") != std::string::npos);
  CHECK(content.find("stderr-line") != std::string::npos);
}

TEST_CASE("process: ProcessJobExecutor 成功/失败/崩溃状态映射") {
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  REQUIRE(executor != nullptr);

  loom::JobSpec ok = loom_test::make_job("ok");
  ok.command = fake("fake-job.sh");
  ok.env["FAKE_JOB_SLEEP"] = "0.05";
  const auto ok_result = executor->run(ok);
  CHECK(ok_result.status == loom::JobStatus::Pass);
  CHECK(ok_result.exit_code == 0);
  CHECK(ok_result.tail_log.find("FAKE_JOB_OK") != std::string::npos);
  CHECK(ok_result.ok());

  loom::JobSpec fail = loom_test::make_job("fail");
  fail.command = fake("fake-job-fail.sh");
  const auto fail_result = executor->run(fail);
  CHECK(fail_result.status == loom::JobStatus::Fail);
  CHECK(fail_result.exit_code == 3);
  CHECK_FALSE(fail_result.ok());

  loom::JobSpec crash = loom_test::make_job("crash");
  crash.command = fake("fake-job-crash.sh");
  const auto crash_result = executor->run(crash);
  CHECK(crash_result.status == loom::JobStatus::Fail);
  CHECK(crash_result.exit_code == 128 + SIGSEGV);
}

TEST_CASE("process: ProcessJobExecutor env 注入与 cwd") {
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  loom::JobSpec job = loom_test::make_job("env");
  job.command = fake("fake-job-env.sh");
  job.env["MC_PORT"] = "25599";
  job.env["MC_RPC_PORT"] = "27999";
  job.env["MC_HOST"] = "127.0.0.1";
  job.env["BOT_NAME"] = "GolemP7";
  job.env["LOOM_TEST_CUSTOM"] = "custom-value";
  const auto result = executor->run(job);
  CHECK(result.status == loom::JobStatus::Pass);
  CHECK(result.tail_log.find("env MC_PORT=25599") != std::string::npos);
  CHECK(result.tail_log.find("env MC_RPC_PORT=27999") != std::string::npos);
  CHECK(result.tail_log.find("env BOT_NAME=GolemP7") != std::string::npos);
  CHECK(result.tail_log.find("env CUSTOM=custom-value") != std::string::npos);
}

TEST_CASE("process: ProcessJobExecutor 超时 → Timeout，墙钟≈timeout 不被拖满") {
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  loom::JobSpec job = loom_test::make_job("hang");
  job.command = fake("fake-job-hang.sh");
  job.timeout_ms = 350;
  const long long start = wall_ms();
  const auto run_result = executor->run(job);
  const long long wall = wall_ms() - start;
  CHECK(run_result.status == loom::JobStatus::Timeout);
  CHECK(run_result.exit_code == loom::kTimeoutExitCode);  // 契约：超时统一 137
  CHECK(wall >= 300);
  CHECK(wall < 3000);
}

TEST_CASE("process: 超时会杀掉整棵进程树（子进程不残留）") {
  loom_test::TempDir dir("tree-kill");
  const auto child_file = dir.path / "child.pid";
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  loom::JobSpec job = loom_test::make_job("tree");
  job.command = fake("fake-job-tree.sh");
  job.timeout_ms = 400;
  job.env["FAKE_JOB_CHILD_FILE"] = child_file.string();
  const auto result = executor->run(job);
  CHECK(result.status == loom::JobStatus::Timeout);
  // 脚本会写两个子进程 pid；超时 kill 进程组后它们必须消失
  REQUIRE(std::filesystem::exists(child_file));
  const long long child1 = read_pid(child_file);
  CHECK(child1 > 0);
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  CHECK_FALSE(pid_alive(child1));
  const auto child_file2 = std::filesystem::path(child_file.string() + ".2");
  if (std::filesystem::exists(child_file2)) {
    const long long child2 = read_pid(child_file2);
    CHECK_FALSE(pid_alive(child2));
  }
}

TEST_CASE("process: tail_log 截断到 4KB 级别且保留最后一行") {
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  loom::JobSpec job = loom_test::make_job("spam");
  job.command = fake("fake-job-spam.sh");
  job.env["FAKE_JOB_LINES"] = "20000";
  const auto result = executor->run(job);
  CHECK(result.status == loom::JobStatus::Pass);
  CHECK(result.tail_log.size() <= 4096 + 64);
  CHECK(result.tail_log.find("SPAM_LAST_LINE") != std::string::npos);
}

TEST_CASE("process: 连续运行 20 个 job 无 fd 泄漏、无僵尸") {
  auto executor = loom::create_process_executor(loom::ProcessExecutorOptions{});
  { auto warm = executor->run(loom_test::make_job("warm")); (void)warm; }
  const int before = count_open_fds();
  for (int i = 0; i < 20; ++i) {
    loom::JobSpec job = loom_test::make_job("job-" + std::to_string(i));
    job.command = fake("fake-job.sh");
    job.env["FAKE_JOB_SLEEP"] = "0.01";
    const auto result = executor->run(job);
    CHECK(result.status == loom::JobStatus::Pass);
  }
  const int after = count_open_fds();
  CHECK(after <= before + 2);
}
