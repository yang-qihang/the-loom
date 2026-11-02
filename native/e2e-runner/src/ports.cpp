// loom/ports.cpp — 并发安全的 MC/RPC 端口槽位分配器。
#include "loom/ports.hpp"

#if defined(_WIN32)
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <cerrno>
#include <cstring>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>
#endif
#include <cstdint>
#include <stdexcept>
#include <string>

namespace loom {

namespace {

/** 构造参数错误的统一消息（中文）。 */
[[noreturn]] void throw_invalid(const std::string& message) { throw std::invalid_argument(message); }

} // namespace

PortAllocator::PortAllocator(int mc_base, int rpc_base, int capacity) {
  if (mc_base < 1 || mc_base > 65535) throw_invalid("MC 端口基址必须在 1–65535：" + std::to_string(mc_base));
  if (rpc_base < 1 || rpc_base > 65535) throw_invalid("RPC 端口基址必须在 1–65535：" + std::to_string(rpc_base));
  if (capacity < 1 || capacity > 1024) throw_invalid("端口槽位数量必须在 1–1024：" + std::to_string(capacity));
  if (mc_base + capacity - 1 > 65535) {
    throw_invalid("MC 端口区间越界：" + std::to_string(mc_base) + " + " + std::to_string(capacity) + " 越过了 65535");
  }
  if (rpc_base + capacity - 1 > 65535) {
    throw_invalid("RPC 端口区间越界：" + std::to_string(rpc_base) + " + " + std::to_string(capacity) + " 越过了 65535");
  }
  const bool overlap = mc_base <= rpc_base + capacity - 1 && rpc_base <= mc_base + capacity - 1;
  if (overlap) {
    throw_invalid("MC 端口区间与 RPC 端口区间重叠（MC=" + std::to_string(mc_base) + ".." +
                  std::to_string(mc_base + capacity - 1) + "，RPC=" + std::to_string(rpc_base) + ".." +
                  std::to_string(rpc_base + capacity - 1) + "）");
  }
  mc_base_ = mc_base;
  rpc_base_ = rpc_base;
  capacity_ = capacity;
  leased_.assign(static_cast<std::size_t>(capacity_), false);
}

std::optional<PortLease> PortAllocator::acquire() {
  std::lock_guard<std::mutex> lock(mutex_);
  for (int slot = 0; slot < capacity_; ++slot) {
    if (!leased_[static_cast<std::size_t>(slot)]) {
      leased_[static_cast<std::size_t>(slot)] = true;
      return PortLease{slot, mc_base_ + slot, rpc_base_ + slot};
    }
  }
  return std::nullopt;
}

PortLease PortAllocator::acquire_slot(int slot) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (slot < 0 || slot >= capacity_) {
    throw std::out_of_range("端口槽位越界：" + std::to_string(slot) + "（容量 " + std::to_string(capacity_) + "）");
  }
  if (leased_[static_cast<std::size_t>(slot)]) {
    throw std::out_of_range("端口槽位已被占用：" + std::to_string(slot));
  }
  leased_[static_cast<std::size_t>(slot)] = true;
  return PortLease{slot, mc_base_ + slot, rpc_base_ + slot};
}

void PortAllocator::release(int slot) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (slot < 0 || slot >= capacity_) {
    throw std::out_of_range("端口槽位越界：" + std::to_string(slot) + "（容量 " + std::to_string(capacity_) + "）");
  }
  if (!leased_[static_cast<std::size_t>(slot)]) {
    throw std::out_of_range("端口槽位未被租用，不能归还：" + std::to_string(slot));
  }
  leased_[static_cast<std::size_t>(slot)] = false;
}

bool PortAllocator::leased(int slot) const noexcept {
  if (slot < 0 || slot >= capacity_) return false;
  std::lock_guard<std::mutex> lock(mutex_);
  return leased_[static_cast<std::size_t>(slot)];
}

PortLease PortAllocator::ports(int slot) const {
  if (slot < 0 || slot >= capacity_) {
    throw std::out_of_range("端口槽位越界：" + std::to_string(slot) + "（容量 " + std::to_string(capacity_) + "）");
  }
  return PortLease{slot, mc_base_ + slot, rpc_base_ + slot};
}

int PortAllocator::capacity() const noexcept { return capacity_; }

int PortAllocator::leased_count() const noexcept {
  std::lock_guard<std::mutex> lock(mutex_);
  int count = 0;
  for (const bool used : leased_) {
    if (used) ++count;
  }
  return count;
}

bool PortAllocator::is_port_available(int port) noexcept {
  if (port < 1 || port > 65535) return false;
#if defined(_WIN32)
  // Windows：winsock 初始化一次（函数内 static，线程安全）；进程退出由系统回收。
  static const bool winsock_ready = []() noexcept {
    WSADATA data{};
    return ::WSAStartup(MAKEWORD(2, 2), &data) == 0;
  }();
  if (!winsock_ready) return false;
  SOCKET fd = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (fd == INVALID_SOCKET) return false;
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(static_cast<std::uint16_t>(port));
  const char enable = 1;
  (void)::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &enable, sizeof(enable));
  const int result = ::bind(fd, reinterpret_cast<const sockaddr*>(&address), static_cast<int>(sizeof(address)));
  (void)::closesocket(fd);
  return result == 0;
#else
  const int fd = ::socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return false;
  int result = 0;
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  address.sin_port = htons(static_cast<std::uint16_t>(port));
  const int enable = 1;
  (void)::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &enable, sizeof(enable));
  if (::bind(fd, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0) result = -1;
  (void)::close(fd);
  return result == 0;
#endif
}

} // namespace loom
