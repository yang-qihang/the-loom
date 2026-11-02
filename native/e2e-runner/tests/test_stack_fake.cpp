// 假 Paper 栈集成（native-stack stack.hpp；不启真 Paper）：
// fake-java.sh 模拟 Paper：读 config.yml 起 TCP listener + 打印 Done 行 → StackProvisioner 就绪；
// 覆盖 复制模板/改端口/ready/stop/清理/端口唯一/失败路径/并发 start。
#include <algorithm>
#include <atomic>
#include <filesystem>
#include <string>
#include <thread>
#include <vector>

#include "doctest.h"
#include "loom/config.hpp"
#include "loom/stack.hpp"
#include "test_stack_util.hpp"
#include "test_util.hpp"

using loom::PortAllocator;
using loom::Stack;
using loom::StackConfig;
using loom::StackProvisioner;
using loom::StackStartError;

namespace {
struct StackFixture {
  loom_test::TempDir dir{"stack"};
  std::filesystem::path template_dir;
  std::filesystem::path work_root;
  std::filesystem::path log_dir;
  int mc_base = 0;
  int rpc_base = 0;
  StackConfig config;

  explicit StackFixture(bool with_template = true) {
    template_dir = dir.path / "paper-template";
    work_root = dir.path / "work";
    log_dir = dir.path / "logs";
    std::filesystem::create_directories(work_root);
    std::filesystem::create_directories(log_dir);
    if (with_template) loom_test::write_fake_paper_template(template_dir);
    mc_base = loom_test::pick_free_base(4);
    rpc_base = loom_test::pick_free_base(4);
    if (rpc_base == mc_base) rpc_base = mc_base + 100;
    config = loom_test::make_stack_config(template_dir, work_root, log_dir, mc_base, rpc_base);
  }
};
}  // namespace

TEST_CASE("stack: start 复制模板、改端口、ready（fake Paper）、stop 后进程/端口释放") {
  StackFixture fixture;
  StackProvisioner provisioner(fixture.config);
  std::unique_ptr<Stack> stack;
  REQUIRE_NOTHROW(stack = provisioner.start(0));
  REQUIRE(stack != nullptr);

  CHECK(stack->ports.mc == fixture.mc_base + 0);
  CHECK(stack->ports.rpc == fixture.rpc_base + 0);
  CHECK(stack->dir == fixture.work_root / "w0");
  CHECK(std::filesystem::exists(stack->dir / "paper.jar"));
  CHECK(std::filesystem::exists(stack->dir / "server.properties"));
  CHECK(stack->running());
  CHECK(stack->pid() > 0);
  CHECK(stack->paper != nullptr);

  // 端口改写
  const auto properties = loom_test::read_text(stack->dir / "server.properties");
  CHECK(properties.find("server-port=" + std::to_string(stack->ports.mc)) != std::string::npos);
  const auto plugin_config = loom_test::read_text(stack->dir / "plugins" / "LoomCraft" / "config.yml");
  CHECK(plugin_config.find("port: " + std::to_string(stack->ports.rpc)) != std::string::npos);

  // console.log 有 Done 行 + RPC 端口可连
  const auto console = loom_test::read_text(stack->console_log());
  CHECK(console.find("Done (") != std::string::npos);
  CHECK(loom_test::tcp_connect_ok(stack->ports.rpc));

  // 复制排除项：logs/、console.*、session.lock 不应出现在 worker 目录
  CHECK_FALSE(std::filesystem::exists(stack->dir / "logs" / "old.log"));
  CHECK_FALSE(std::filesystem::exists(stack->dir / "world" / "session.lock"));
  if (std::filesystem::exists(stack->dir / "console.log")) {
    const auto worker_console = loom_test::read_text(stack->dir / "console.log");
    CHECK(worker_console.find("OLD CONSOLE") == std::string::npos);
  }

  const int rpc_port = stack->ports.rpc;
  provisioner.stop(*stack);
  CHECK_FALSE(stack->running());
  // stop 后 RPC 端口应在短时间释放
  bool released = false;
  for (int i = 0; i < 20; ++i) {
    if (!loom_test::tcp_connect_ok(rpc_port)) {
      released = true;
      break;
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
  }
  CHECK(released);
  provisioner.cleanup(*stack);
  CHECK_FALSE(std::filesystem::exists(stack->dir));
}

TEST_CASE("stack: start_with_ports 使用 Scheduler 注入的端口") {
  StackFixture fixture;
  StackProvisioner provisioner(fixture.config);
  loom::StackPorts custom{fixture.mc_base + 2, fixture.rpc_base + 2};
  auto stack = provisioner.start_with_ports(1, custom);
  REQUIRE(stack != nullptr);
  CHECK(stack->ports.mc == custom.mc);
  CHECK(stack->ports.rpc == custom.rpc);
  CHECK(loom_test::tcp_connect_ok(custom.rpc));
  provisioner.stop(*stack);
  provisioner.cleanup(*stack);
}

TEST_CASE("stack: 两个 worker 目录/端口互不冲突（并发 start）") {
  StackFixture fixture;
  StackProvisioner provisioner(fixture.config);
  std::unique_ptr<Stack> stack0;
  std::unique_ptr<Stack> stack1;
  std::exception_ptr error0;
  std::exception_ptr error1;
  // 注意：线程里不能抛未捕获异常（std::terminate→SIGABRT），先捕获再在主线程判定。
  std::thread first([&] {
    try { stack0 = provisioner.start(0); } catch (...) { error0 = std::current_exception(); }
  });
  std::thread second([&] {
    try { stack1 = provisioner.start(1); } catch (...) { error1 = std::current_exception(); }
  });
  first.join();
  second.join();
  if (error0) std::rethrow_exception(error0);
  if (error1) std::rethrow_exception(error1);
  REQUIRE(stack0 != nullptr);
  REQUIRE(stack1 != nullptr);
  CHECK(stack0->dir != stack1->dir);
  CHECK(stack0->ports.mc != stack1->ports.mc);
  CHECK(stack0->ports.rpc != stack1->ports.rpc);
  CHECK(loom_test::tcp_connect_ok(stack0->ports.rpc));
  CHECK(loom_test::tcp_connect_ok(stack1->ports.rpc));
  provisioner.stop(*stack0);
  provisioner.stop(*stack1);
  provisioner.cleanup(*stack0);
  provisioner.cleanup(*stack1);
}

TEST_CASE("stack: 模板缺 server.properties → StackStartError（中文、带目录）") {
  StackFixture fixture(false);
  std::filesystem::create_directories(fixture.template_dir);
  loom_test::write_file(fixture.template_dir / "paper.jar", "x");
  StackProvisioner provisioner(fixture.config);
  bool caught = false;
  try {
    auto stack = provisioner.start(0);
    FAIL("expected StackStartError");
  } catch (const StackStartError& error) {
    caught = true;
    CHECK(std::string(error.what()).size() > 0);
    CHECK_FALSE(error.console_log().empty());
  }
  CHECK(caught);
}

TEST_CASE("stack: java_bin 不存在 → StackStartError 且不留进程") {
  StackFixture fixture;
  fixture.config.java_bin = fixture.dir.path / "no-such-java";
  StackProvisioner provisioner(fixture.config);
  CHECK_THROWS_AS(provisioner.start(0), StackStartError);
}

TEST_CASE("stack: ready 超时 → StackStartError（进程被杀、目录清理）") {
  StackFixture fixture;
  // 让 fake-java 延迟 5s 才打印 Done → ready_timeout 400ms 必超时
  loom_test::write_file(fixture.template_dir / ".fake-ready-delay", "5\n");
  fixture.config.ready_timeout_ms = 400;
  StackProvisioner provisioner(fixture.config);
  CHECK_THROWS_AS(provisioner.start(0), StackStartError);
  // 超时后 worker 端口必须释放（进程组被杀）
  std::this_thread::sleep_for(std::chrono::milliseconds(300));
  CHECK_FALSE(loom_test::tcp_connect_ok(fixture.rpc_base + 0));
}

TEST_CASE("stack: save_failure_console 写出 console 尾部到 log_dir") {
  StackFixture fixture;
  const auto console = fixture.dir.path / "console-src.log";
  loom_test::write_file(console, "line1\nline2\nDone (fake\n");
  const auto saved = loom::StackProvisioner::save_failure_console(fixture.config, console, "L01", 1024);
  CHECK_FALSE(saved.empty());
  CHECK(std::filesystem::exists(saved));
  CHECK(saved.filename().string().find("L01") != std::string::npos);
  CHECK(loom_test::read_text(saved).find("Done (") != std::string::npos);
}
