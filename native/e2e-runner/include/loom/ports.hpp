// loom/ports.hpp — 并行的 MC/RPC 端口槽位分配器（docs/58 §3「PortAllocator」）。
//
// 语义：
//   * 槽位 slot = 0..capacity-1，MC 端口 = mc_base + slot，RPC 端口 = rpc_base + slot；
//   * acquire() 返回当前最小的空闲槽位（std::nullopt = 已满）；
//   * 同一槽位在 release() 之前不会被再次分配（并发安全，内部 mutex）；
//   * release() 之后可复用；
//   * 构造时校验端口范围/重叠，非法抛 std::invalid_argument（中文消息）。
#pragma once

#include <cstddef>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

namespace loom {

/** 一个 worker 的端口租约。 */
struct PortLease {
  int slot = -1;
  int mc_port = 0;
  int rpc_port = 0;
};

/** MC/RPC 端口对（与 StackProvisioner 的 StackPorts 同形，native-stack 可直接复用）。 */
struct StackPorts {
  int mc = 0;
  int rpc = 0;
};

class PortAllocator {
 public:
  /** @throws std::invalid_argument 中文错误：base 非法/端口越界/两段端口区间重叠。 */
  explicit PortAllocator(int mc_base = 25565, int rpc_base = 8765, int capacity = 64);

  PortAllocator(const PortAllocator&) = delete;
  PortAllocator& operator=(const PortAllocator&) = delete;
  PortAllocator(PortAllocator&&) = delete;
  PortAllocator& operator=(PortAllocator&&) = delete;

  /** 取最小空闲槽位；已满返回 std::nullopt（不抛异常）。线程安全。 */
  std::optional<PortLease> acquire();

  /** 指定槽位租用（越界/已租 → std::out_of_range，中文）。线程安全。 */
  PortLease acquire_slot(int slot);

  /** 归还槽位（越界/未租 → std::out_of_range，中文）。线程安全。 */
  void release(int slot);

  /** 槽位是否在租用中；越界返回 false。 */
  [[nodiscard]] bool leased(int slot) const noexcept;

  /** 槽位对应的端口（不改变租用状态；越界 → std::out_of_range）。 */
  PortLease ports(int slot) const;

  [[nodiscard]] int capacity() const noexcept;
  [[nodiscard]] int leased_count() const noexcept;

  /** 本机 127.0.0.1 上该端口当前是否可 bind（供预检/测试；不占端口）。 */
  static bool is_port_available(int port) noexcept;

 private:
  mutable std::mutex mutex_;
  int mc_base_ = 25565;
  int rpc_base_ = 8765;
  int capacity_ = 0;
  std::vector<bool> leased_;
};

} // namespace loom
