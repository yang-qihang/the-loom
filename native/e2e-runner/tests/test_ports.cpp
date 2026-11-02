// PortAllocator 契约测试（native-core ports.hpp）：
// 构造校验、并发唯一、最低空闲复用、越界/未租异常、端口可用性探测、随机序列不变式。
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

#include <algorithm>
#include <atomic>
#include <mutex>
#include <optional>
#include <random>
#include <set>
#include <stdexcept>
#include <thread>
#include <vector>

#include "doctest.h"
#include "loom/ports.hpp"

namespace {
int bind_free_port() {
  int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  REQUIRE(fd >= 0);
  int one = 1;
  ::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = 0;
  REQUIRE(::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0);
  socklen_t len = sizeof(addr);
  REQUIRE(::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len) == 0);
  const int port = ntohs(addr.sin_port);
  ::close(fd);
  return port;
}

}  // namespace

TEST_CASE("ports: 构造非法参数抛 std::invalid_argument") {
  CHECK_THROWS_AS(loom::PortAllocator(-1, 8765, 4), std::invalid_argument);
  CHECK_THROWS_AS(loom::PortAllocator(25565, -2, 4), std::invalid_argument);
  CHECK_THROWS_AS(loom::PortAllocator(25565, 8765, 0), std::invalid_argument);
  CHECK_THROWS_AS(loom::PortAllocator(25565, 8765, -3), std::invalid_argument);
  // 端口超过 65535 也应拒绝
  CHECK_THROWS_AS(loom::PortAllocator(70000, 8765, 2), std::invalid_argument);
  // MC/RPC 两段端口区间重叠也应拒绝（header 语义）
  CHECK_THROWS_AS(loom::PortAllocator(25565, 25500, 100), std::invalid_argument);
  // what() 要有可读信息（中文错误约定）
  try {
    loom::PortAllocator bad(-1, 8765, 2);
    FAIL("expected std::invalid_argument");
  } catch (const std::invalid_argument& error) {
    CHECK(std::string(error.what()).size() > 0);
  }
}

TEST_CASE("ports: capacity / 槽位端口公式 / leased 状态") {
  loom::PortAllocator allocator(31000, 32000, 4);
  CHECK(allocator.capacity() == 4);
  CHECK(allocator.leased_count() == 0);
  for (int slot = 0; slot < 4; ++slot) {
    CHECK_FALSE(allocator.leased(slot));
    const auto lease = allocator.ports(slot);
    CHECK(lease.slot == slot);
    CHECK(lease.mc_port == 31000 + slot);
    CHECK(lease.rpc_port == 32000 + slot);
  }
}

TEST_CASE("ports: acquire 分配唯一槽位，容量用尽返回 nullopt") {
  loom::PortAllocator allocator(31100, 32100, 3);
  std::set<int> slots;
  std::set<int> mc_ports;
  for (int i = 0; i < 3; ++i) {
    const auto lease = allocator.acquire();
    REQUIRE(lease.has_value());
    CHECK(slots.insert(lease->slot).second);
    CHECK(mc_ports.insert(lease->mc_port).second);
    CHECK(allocator.leased(lease->slot));
  }
  CHECK(allocator.leased_count() == 3);
  CHECK_FALSE(allocator.acquire().has_value());
}

TEST_CASE("ports: acquire_slot 固定槽位且可复用；release 后最低空闲优先") {
  loom::PortAllocator allocator(31200, 32200, 4);
  const auto lease2 = allocator.acquire_slot(2);
  CHECK(lease2.slot == 2);
  CHECK(lease2.mc_port == 31200 + 2);
  CHECK(lease2.rpc_port == 32200 + 2);
  CHECK_THROWS_AS(allocator.acquire_slot(2), std::out_of_range);  // 重复租用同槽
  allocator.release(2);
  CHECK_FALSE(allocator.leased(2));
  // 释放后应由最低空闲槽（这里是 0）开始分配
  const auto first = allocator.acquire();
  REQUIRE(first.has_value());
  CHECK(first->slot == 0);
  allocator.release(0);
  const auto reused = allocator.acquire_slot(2);
  CHECK(reused.slot == 2);
}

TEST_CASE("ports: 越界与未租 release/acquire_slot 抛 std::out_of_range") {
  loom::PortAllocator allocator(31300, 32300, 2);
  CHECK_THROWS_AS(allocator.acquire_slot(-1), std::out_of_range);
  CHECK_THROWS_AS(allocator.acquire_slot(2), std::out_of_range);
  CHECK_THROWS_AS(allocator.acquire_slot(100), std::out_of_range);
  CHECK_THROWS_AS(allocator.release(-1), std::out_of_range);
  CHECK_THROWS_AS(allocator.release(2), std::out_of_range);
  CHECK_THROWS_AS(allocator.release(0), std::out_of_range);  // 未租
  CHECK_THROWS_AS(allocator.ports(9), std::out_of_range);
}

TEST_CASE("ports: 并发 acquire 无重复（8 线程 × 64 次）") {
  constexpr int kCapacity = 8;
  loom::PortAllocator allocator(31400, 32400, kCapacity);
  std::mutex mu;
  std::vector<loom::PortLease> leases;
  std::atomic<int> failures{0};
  std::vector<std::thread> threads;
  for (int t = 0; t < 8; ++t) {
    threads.emplace_back([&] {
      for (int i = 0; i < 64; ++i) {
        auto lease = allocator.acquire();
        if (lease.has_value()) {
          std::lock_guard<std::mutex> lock(mu);
          leases.push_back(*lease);
        } else {
          failures.fetch_add(1);
        }
      }
    });
  }
  for (auto& thread : threads) thread.join();
  std::set<int> slots;
  for (const auto& lease : leases) CHECK(slots.insert(lease.slot).second);
  CHECK(slots.size() <= static_cast<std::size_t>(kCapacity));
  CHECK(allocator.leased_count() == static_cast<int>(slots.size()));
}

TEST_CASE("ports: 并发租还压力下不变式保持") {
  constexpr int kCapacity = 4;
  loom::PortAllocator allocator(31500, 32500, kCapacity);
  std::mutex mu;
  std::set<int> owned;
  std::vector<std::thread> threads;
  for (int t = 0; t < 6; ++t) {
    threads.emplace_back([&] {
      for (int i = 0; i < 200; ++i) {
        std::optional<loom::PortLease> lease = allocator.acquire();
        if (!lease) continue;
        {
          std::lock_guard<std::mutex> lock(mu);
          CHECK(owned.insert(lease->slot).second);  // 正在被两个线程同时持有 = 违约
        }
        std::this_thread::sleep_for(std::chrono::microseconds(200));
        {
          std::lock_guard<std::mutex> lock(mu);
          owned.erase(lease->slot);
        }
        allocator.release(lease->slot);
      }
    });
  }
  for (auto& thread : threads) thread.join();
  CHECK(allocator.leased_count() == 0);
}

TEST_CASE("ports: is_port_available 对监听/空闲端口判断正确") {
  const int free_port = bind_free_port();
  CHECK(loom::PortAllocator::is_port_available(free_port));
  // 占住端口后再探测应返回 false
  const int listen_fd = ::socket(AF_INET, SOCK_STREAM, 0);
  REQUIRE(listen_fd >= 0);
  int one = 1;
  ::setsockopt(listen_fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(static_cast<uint16_t>(free_port));
  REQUIRE(::bind(listen_fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0);
  REQUIRE(::listen(listen_fd, 1) == 0);
  CHECK_FALSE(loom::PortAllocator::is_port_available(free_port));
  ::close(listen_fd);
  CHECK(loom::PortAllocator::is_port_available(free_port));
}

TEST_CASE("ports: 随机租还序列 1000 步不变式") {
  loom::PortAllocator allocator(31600, 32600, 8);
  std::mt19937 rng(20261102u);
  std::vector<int> leased_slots;
  for (int step = 0; step < 1000; ++step) {
    const int action = static_cast<int>(rng() % 100);
    if (action < 55) {
      const auto lease = allocator.acquire();
      if (lease) {
        CHECK(std::find(leased_slots.begin(), leased_slots.end(), lease->slot) == leased_slots.end());
        leased_slots.push_back(lease->slot);
        CHECK(lease->mc_port == 31600 + lease->slot);
        CHECK(lease->rpc_port == 32600 + lease->slot);
      }
    } else if (!leased_slots.empty()) {
      std::uniform_int_distribution<std::size_t> dist(0, leased_slots.size() - 1);
      const std::size_t index = dist(rng);
      const int slot = leased_slots[index];
      leased_slots.erase(leased_slots.begin() + static_cast<std::ptrdiff_t>(index));
      allocator.release(slot);
    }
    CHECK(allocator.leased_count() == static_cast<int>(leased_slots.size()));
  }
}
