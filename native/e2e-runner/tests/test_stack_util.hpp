// native-stack 假栈测试公共工具：用 fake-java.sh 模拟 Paper（python3 TCP listener + Done 行）。
#pragma once

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <string>
#include <thread>

#include "loom/config.hpp"
#include "loom/stack.hpp"
#include "test_util.hpp"

namespace loom_test {

inline bool tcp_connect_ok(int port, int timeout_ms = 300) {
  int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return false;
  timeval tv{};
  tv.tv_sec = 0;
  tv.tv_usec = timeout_ms * 1000;
  ::setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(static_cast<uint16_t>(port));
  ::inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
  const bool ok = ::connect(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0;
  ::close(fd);
  return ok;
}

/** 选一个空闲的端口基址：base..base+span 都可用（127.0.0.1）。 */
inline int pick_free_base(int span = 3) {
  for (int attempt = 0; attempt < 200; ++attempt) {
    const int base = 31000 + static_cast<int>((static_cast<std::uint64_t>(now_ms()) + attempt * 7919) % 20000);
    bool ok = true;
    for (int offset = 0; offset < span; ++offset) {
      if (!loom::PortAllocator::is_port_available(base + offset)) {
        ok = false;
        break;
      }
    }
    if (ok) return base;
  }
  return 31000;
}

/** 生成一个最小 paper 模板目录（fake-java.sh 作为 java_bin；不启真 Paper）。 */
inline std::filesystem::path write_fake_paper_template(const std::filesystem::path& root) {
  std::filesystem::create_directories(root / "plugins" / "LoomCraft");
  std::filesystem::create_directories(root / "logs");
  std::filesystem::create_directories(root / "world");
  write_file(root / "paper.jar", "fake-paper-jar");
  write_file(root / "eula.txt", "eula=true\n");
  write_file(root / "server.properties",
             "server-port=25565\nquery.port=25565\nmotd=LoomCraft Test\nonline-mode=false\n");
  write_file(root / "plugins" / "LoomCraft" / "config.yml",
             "ws:\n  host: 127.0.0.1\n  port: 8765\n");
  // 应被复制排除的内容
  write_file(root / "logs" / "old.log", "old log\n");
  write_file(root / "console.log", "OLD CONSOLE\n");
  write_file(root / "world" / "session.lock", "lock\n");
  return root;
}

inline std::string fake_java_bin() { return std::string(LOOM_TEST_DIR) + "/fake-java.sh"; }

inline loom::StackConfig make_stack_config(const std::filesystem::path& paper_template,
                                           const std::filesystem::path& work_root,
                                           const std::filesystem::path& log_dir, int mc_base,
                                           int rpc_base, int ready_timeout_ms = 8000) {
  loom::StackConfig config;
  config.paper_template = paper_template;
  config.java_bin = fake_java_bin();
  config.work_root = work_root;
  config.mc_base_port = mc_base;
  config.rpc_base_port = rpc_base;
  config.ready_timeout_ms = ready_timeout_ms;
  config.ready_poll_ms = 20;
  config.job_timeout_ms = 5000;
  config.log_dir = log_dir;
  config.repo_root = std::string(LOOM_REPO_ROOT);
  config.workers = 3;
  config.bot_prefix = "TestGolem";
  config.paper_jar = "paper.jar";
  return config;
}

inline std::string read_text(const std::filesystem::path& path) { return loom_test::read_file(path); }

}  // namespace loom_test
