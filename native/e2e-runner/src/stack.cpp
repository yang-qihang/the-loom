// loom/stack.cpp — 真实 Paper 栈供给的实现（docs/58 §3；native-stack）。
//
// 设计要点：
//   * 进程管理复用 native-core 的 `loom::Process`（POSIX fork/exec + setsid 进程组 +
//     stdout/stderr 合并 tee + RAII waitpid 回收）；这里只负责「准备目录 / 改端口配置 /
//     启动参数 / 就绪探测 / 失败证据」，不重复实现进程原语。
//   * 就绪判定（docs/58 §3）：RPC 端口 TCP 可连接 且 控制台出现 `Done (`；默认 90s 超时。
//   * stop 只停进程；删目录由 cleanup() 负责（JobExecutor 先 stop、必要时保存 console 尾、
//     再 cleanup），这样失败现场可以保留到证据写完。
//   * Windows：进程原语在 Process 内部按 _WIN32 分支，本文件的文件系统/端口改写代码是
//     跨平台的；RPC TCP 探测提供 Winsock 分支（编译守卫），保证 Windows 至少能编译。
#include "loom/stack.hpp"

#include <array>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <optional>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <utility>
#include <vector>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <fcntl.h>
#include <netdb.h>
#include <netinet/in.h>
#include <poll.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

namespace fs = std::filesystem;

namespace loom {
namespace {

using Clock = std::chrono::steady_clock;

/** stop 的优雅等待（docs/58 §3：等 20s）。 */
constexpr auto kStopTimeout = std::chrono::seconds(20);
/** SIGTERM 后到 SIGKILL 的宽限。 */
constexpr auto kTermGrace = std::chrono::seconds(5);
/** 就绪探测时读控制台的窗口（Paper 启动日志远小于这个值）。 */
constexpr std::size_t kConsoleScanBytes = 512 * 1024;
/** 失败证据里保留的 console 尾字节数（任务卡要求 20KB）。 */
constexpr std::size_t kFailureConsoleBytes = 20 * 1024;
/** 单次 RPC TCP 探测超时。 */
constexpr int kRpcProbeTimeoutMs = 250;

void sleep_ms(int milliseconds) {
  if (milliseconds > 0) {
    std::this_thread::sleep_for(std::chrono::milliseconds(milliseconds));
  }
}

/** 取字符串最后 max_bytes 字节，并跳过被切断的 UTF-8 续字节（中文日志不会半截）。 */
std::string tail_utf8(std::string_view bytes, std::size_t max_bytes) {
  if (bytes.size() <= max_bytes) return std::string(bytes);
  std::string_view tail = bytes.substr(bytes.size() - max_bytes);
  std::size_t start = 0;
  while (start < tail.size() &&
         (static_cast<unsigned char>(tail[start]) & 0xC0U) == 0x80U) {
    ++start;
  }
  return std::string(tail.substr(start));
}

bool contains_text(std::string_view haystack, std::string_view needle) {
  return haystack.find(needle) != std::string_view::npos;
}

bool starts_with(std::string_view text, std::string_view prefix) {
  return text.size() >= prefix.size() && text.substr(0, prefix.size()) == prefix;
}

std::string trim_copy(std::string_view text) {
  const auto begin = text.find_first_not_of(" \t\r\n");
  if (begin == std::string_view::npos) return {};
  const auto end = text.find_last_not_of(" \t\r\n");
  return std::string(text.substr(begin, end - begin + 1));
}

std::vector<std::string> read_lines(const fs::path& file) {
  std::ifstream in(file, std::ios::binary);
  if (!in) throw std::runtime_error("读取文件失败：" + file.string());
  std::vector<std::string> lines;
  std::string line;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    lines.push_back(std::move(line));
  }
  return lines;
}

void write_lines(const fs::path& file, const std::vector<std::string>& lines) {
  std::ofstream out(file, std::ios::binary | std::ios::trunc);
  if (!out) throw std::runtime_error("写入文件失败：" + file.string());
  for (const auto& line : lines) {
    out << line << '\n';
  }
  if (!out) throw std::runtime_error("写入文件失败：" + file.string());
}

/** 从文件的 since_offset 开始读，最多保留最后 max_bytes（用于复用栈时只取本 job 的日志）。 */
std::string read_file_since(const fs::path& file, std::size_t since_offset,
                            std::size_t max_bytes) {
  std::error_code ec;
  if (!fs::exists(file, ec)) return {};
  std::ifstream in(file, std::ios::binary);
  if (!in) return {};
  in.seekg(0, std::ios::end);
  const std::streamoff size = in.tellg();
  const std::streamoff begin_limit = static_cast<std::streamoff>(since_offset);
  if (size <= begin_limit) return {};
  const std::streamoff start =
      std::max(begin_limit, size - static_cast<std::streamoff>(max_bytes));
  in.seekg(start, std::ios::beg);
  std::string data(static_cast<std::size_t>(size - start), '\0');
  in.read(data.data(), static_cast<std::streamsize>(data.size()));
  return data;
}

std::string read_file_tail(const fs::path& file, std::size_t max_bytes) {
  std::error_code ec;
  if (!fs::exists(file, ec)) return {};
  std::ifstream in(file, std::ios::binary);
  if (!in) return {};
  in.seekg(0, std::ios::end);
  const std::streamoff size = in.tellg();
  if (size <= 0) return {};
  const auto want = static_cast<std::streamoff>(max_bytes);
  const std::streamoff start = size > want ? size - want : 0;
  in.seekg(start, std::ios::beg);
  std::string data(static_cast<std::size_t>(size - start), '\0');
  in.read(data.data(), static_cast<std::streamsize>(data.size()));
  return data;
}

// ---------------------------------------------------------------- 模板复制与配置改写

bool should_skip_entry(const fs::path& relative) {
  const std::string first = relative.begin() != relative.end() ? relative.begin()->string() : "";
  if (first == "logs") return true;
  const std::string name = relative.filename().string();
  if (starts_with(name, "console.")) return true;
  if (name == "session.lock") return true;
  return false;
}

void ensure_directory(const fs::path& dir) {
  std::error_code ec;
  fs::create_directories(dir, ec);
  if (ec) throw std::runtime_error("创建目录失败：" + dir.string() + "（" + ec.message() + "）");
}

/** 递归复制 Paper 模板目录（排除 logs/、console.*、session.lock；符号链接保留）。 */
void copy_template_tree(const fs::path& source, const fs::path& target) {
  std::error_code ec;
  if (!fs::exists(source, ec) || !fs::is_directory(source, ec)) {
    throw std::runtime_error("Paper 模板目录不存在或不是目录：" + source.string());
  }
  ensure_directory(target);
  fs::recursive_directory_iterator it(source, fs::directory_options::skip_permission_denied, ec);
  const fs::recursive_directory_iterator end;
  if (ec) throw std::runtime_error("遍历 Paper 模板失败：" + source.string() + "（" + ec.message() + "）");
  for (; it != end; it.increment(ec)) {
    if (ec) throw std::runtime_error("遍历 Paper 模板失败：" + source.string() + "（" + ec.message() + "）");
    const fs::path relative = fs::relative(it->path(), source, ec);
    if (ec) throw std::runtime_error("计算模板相对路径失败：" + it->path().string());
    if (should_skip_entry(relative)) {
      std::error_code dir_ec;
      if (it->is_directory(dir_ec)) it.disable_recursion_pending();
      continue;
    }
    const fs::path destination = target / relative;
    const fs::file_status status = it->symlink_status(ec);
    if (ec) throw std::runtime_error("读取模板条目失败：" + it->path().string());
    if (fs::is_directory(status)) {
      ensure_directory(destination);
    } else if (fs::is_regular_file(status)) {
      ensure_directory(destination.parent_path());
      fs::copy_file(it->path(), destination, fs::copy_options::overwrite_existing, ec);
      if (ec) {
        throw std::runtime_error("复制模板文件失败：" + it->path().string() + " → " +
                                 destination.string() + "（" + ec.message() + "）");
      }
    } else if (fs::is_symlink(status)) {
      ensure_directory(destination.parent_path());
      std::error_code link_ec;
      fs::copy_symlink(it->path(), destination, link_ec);
      // 模板里理论上没有符号链接；单个链接复制失败不阻断（Paper 不读它）。
      if (link_ec) {
        std::cerr << "[loom-stack] 警告：复制符号链接失败（跳过）：" << it->path() << '\n';
      }
    }
    // 其它特殊文件（socket/fifo/设备）跳过：Paper 模板不需要它们。
  }
}

/** 改写 server.properties 的 server-port（并保留/改写已存在的 query.port）。 */
void rewrite_server_properties(const fs::path& file, int mc_port) {
  std::vector<std::string> lines = read_lines(file);
  const std::string port_value = std::to_string(mc_port);
  bool saw_server_port = false;
  bool saw_query_port = false;
  for (auto& line : lines) {
    if (starts_with(line, "server-port=")) {
      line = "server-port=" + port_value;
      saw_server_port = true;
    } else if (starts_with(line, "query.port=")) {
      line = "query.port=" + port_value;
      saw_query_port = true;
    }
  }
  if (!saw_server_port) lines.push_back("server-port=" + port_value);
  if (!saw_query_port) {
    // 模板启用了 query 但没有 query.port 时补一行，避免仍在默认 25565 上开 query。
    const bool query_enabled = [&lines]() {
      for (const auto& line : lines) {
        if (line == "enable-query=true") return true;
      }
      return false;
    }();
    if (query_enabled) lines.push_back("query.port=" + port_value);
  }
  write_lines(file, lines);
}

/** 改写 plugins/LoomCraft/config.yml 里 ws 块的 port（模板结构：ws:\n  host:\n  port:）。 */
void rewrite_plugin_config(const fs::path& file, int rpc_port) {
  const std::string port_value = std::to_string(rpc_port);
  std::vector<std::string> lines;
  std::error_code ec;
  if (fs::exists(file, ec)) {
    lines = read_lines(file);
  }
  std::size_t ws_index = lines.size();
  std::size_t port_index = lines.size();
  for (std::size_t i = 0; i < lines.size(); ++i) {
    const std::string trimmed = trim_copy(lines[i]);
    if (ws_index == lines.size()) {
      if (trimmed == "ws:") ws_index = i;
      continue;
    }
    if (trimmed.empty() || trimmed[0] == '#') continue;
    const std::size_t indent = lines[i].find_first_not_of(" \t");
    if (indent == std::string::npos) continue;
    if (indent == 0) {
      // ws 块结束（顶层下一个 key，或文件结束）。
      break;
    }
    if (starts_with(trimmed, "port:")) {
      port_index = i;
      break;
    }
  }
  if (port_index != lines.size()) {
    const std::string prefix = lines[port_index].substr(0, lines[port_index].find("port:"));
    lines[port_index] = prefix + "port: " + port_value;
  } else if (ws_index != lines.size()) {
    const std::string inserted = "  port: " + port_value;
    lines.insert(lines.begin() + static_cast<std::ptrdiff_t>(ws_index) + 1, inserted);
  } else {
    lines.push_back("ws:");
    lines.push_back("  host: 127.0.0.1");
    lines.push_back("  port: " + port_value);
  }
  ensure_directory(file.parent_path());
  write_lines(file, lines);
}

// ---------------------------------------------------------------- RPC TCP 探测

#ifdef _WIN32

bool tcp_connect_ok(const std::string& host, int port, int /*timeout_ms*/) noexcept {
  static bool winsock_ready = []() {
    WSADATA data{};
    return WSAStartup(MAKEWORD(2, 2), &data) == 0;
  }();
  if (!winsock_ready) return false;
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* result = nullptr;
  const std::string port_text = std::to_string(port);
  if (getaddrinfo(host.c_str(), port_text.c_str(), &hints, &result) != 0) return false;
  bool ok = false;
  for (addrinfo* entry = result; entry != nullptr && !ok; entry = entry->ai_next) {
    SOCKET sock = ::socket(entry->ai_family, entry->ai_socktype, entry->ai_protocol);
    if (sock == INVALID_SOCKET) continue;
    if (::connect(sock, entry->ai_addr, static_cast<int>(entry->ai_addrlen)) == 0) ok = true;
    ::closesocket(sock);
  }
  freeaddrinfo(result);
  return ok;
}

#else

bool tcp_connect_ok(const std::string& host, int port, int timeout_ms) noexcept {
  addrinfo hints{};
  hints.ai_family = AF_UNSPEC;
  hints.ai_socktype = SOCK_STREAM;
  addrinfo* result = nullptr;
  const std::string port_text = std::to_string(port);
  if (::getaddrinfo(host.c_str(), port_text.c_str(), &hints, &result) != 0) return false;
  bool ok = false;
  for (addrinfo* entry = result; entry != nullptr && !ok; entry = entry->ai_next) {
    const int sock = ::socket(entry->ai_family, entry->ai_socktype | SOCK_CLOEXEC, entry->ai_protocol);
    if (sock < 0) continue;
    const int flags = ::fcntl(sock, F_GETFL, 0);
    if (flags >= 0) (void)::fcntl(sock, F_SETFL, flags | O_NONBLOCK);
    int rc = ::connect(sock, entry->ai_addr, entry->ai_addrlen);
    if (rc != 0) {
      const int connect_errno = errno;
      if (connect_errno == EINPROGRESS) {
        pollfd descriptor{};
        descriptor.fd = sock;
        descriptor.events = POLLOUT;
        const int polled = ::poll(&descriptor, 1, timeout_ms);
        if (polled > 0) {
          int socket_error = 0;
          socklen_t length = sizeof(socket_error);
          if (::getsockopt(sock, SOL_SOCKET, SO_ERROR, &socket_error, &length) == 0 &&
              socket_error == 0) {
            rc = 0;
          } else {
            rc = -1;
          }
        } else {
          rc = -1;
        }
      }
    }
    if (rc == 0) ok = true;
    ::close(sock);
  }
  if (result != nullptr) ::freeaddrinfo(result);
  return ok;
}

#endif

/** 端口是否可被新 Paper 使用：既没有人 listen（connect 探测），也能 bind 到通配地址。 */
#ifdef _WIN32

bool tcp_port_available(int port) noexcept {
  if (tcp_connect_ok("127.0.0.1", port, 120)) return false;
  WSADATA data{};
  if (WSAStartup(MAKEWORD(2, 2), &data) != 0) return true;
  const SOCKET sock = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
  if (sock == INVALID_SOCKET) return true;
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(static_cast<unsigned short>(port));
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  const int rc = ::bind(sock, reinterpret_cast<const sockaddr*>(&address), sizeof(address));
  ::closesocket(sock);
  return rc == 0;
}

#else

bool tcp_port_available(int port) noexcept {
  // 1) 已经有人在 listen（MC 监听 0.0.0.0 / [::]，connect 127.0.0.1 即可发现）。
  if (tcp_connect_ok("127.0.0.1", port, 120)) return false;
  // 2) bind 通配地址兜底：监听在其它地址/协议族上时 connect 探测可能漏，bind 会 EADDRINUSE。
  const int sock = ::socket(AF_INET, SOCK_STREAM, 0);
  if (sock < 0) return true;  // 无法探测时放行，由 Paper 自身报错（比误杀好）
  sockaddr_in address{};
  address.sin_family = AF_INET;
  address.sin_port = htons(static_cast<unsigned short>(port));
  address.sin_addr.s_addr = htonl(INADDR_ANY);
  const int rc = ::bind(sock, reinterpret_cast<sockaddr*>(&address), sizeof(address));
  ::close(sock);
  return rc == 0;
}

#endif

// ---------------------------------------------------------------- 目录准备

int checked_port(int port, const char* label) {
  if (port <= 0 || port > 65535) {
    throw std::runtime_error(std::string("非法端口（") + label + "=" + std::to_string(port) +
                             "），必须在 1..65535");
  }
  return port;
}

void validate_ports(StackPorts ports) {
  checked_port(ports.mc, "MC_PORT");
  checked_port(ports.rpc, "MC_RPC_PORT");
  if (ports.mc == ports.rpc) {
    throw std::runtime_error("MC 端口与 RPC 端口不能相同（都是 " + std::to_string(ports.mc) + "）");
  }
}

void prepare_worker_dir(const StackConfig& config, int worker_index, StackPorts ports,
                        const fs::path& dir) {
  if (worker_index < 0) {
    throw std::runtime_error("worker_index 不能为负数（收到 " + std::to_string(worker_index) + "）");
  }
  std::error_code ec;
  if (fs::exists(dir, ec)) {
    fs::remove_all(dir, ec);
    if (ec) throw std::runtime_error("清理旧 worker 目录失败：" + dir.string());
  }
  copy_template_tree(config.paper_template, dir);
  const fs::path server_properties = dir / "server.properties";
  if (!fs::exists(server_properties, ec)) {
    throw std::runtime_error("模板缺少 server.properties：" + server_properties.string());
  }
  rewrite_server_properties(server_properties, ports.mc);
  const fs::path plugin_config = dir / "plugins" / "LoomCraft" / "config.yml";
  rewrite_plugin_config(plugin_config, ports.rpc);
}

/** start() 失败时先把控制台尾部留到 evidence 目录（worker 目录随后会被删）。 */
fs::path preserve_startup_console(const StackConfig& config, const fs::path& console_log,
                                  int worker_index) {
  if (worker_index < 0) return {};
  return StackProvisioner::save_failure_console(
      config, console_log, "w" + std::to_string(worker_index) + "-startup");
}

/** 失败清理：删掉半成品 worker 目录（console 已在调用方另存到 evidence 目录）。 */
void remove_worker_dir_quietly(const fs::path& dir) noexcept {
  if (dir.empty()) return;
  if (const char* keep = std::getenv("LOOM_KEEP_WORK_DIR"); keep != nullptr && std::string_view(keep) == "1") {
    return;
  }
  std::error_code ec;
  fs::remove_all(dir, ec);
  if (ec) {
    std::cerr << "[loom-stack] 警告：清理 worker 目录失败：" << dir << "（" << ec.message() << "）\n";
  }
}

}  // namespace

// ---------------------------------------------------------------- StackStartError

StackStartError::StackStartError(std::string message, fs::path worker_dir, fs::path console_log,
                                 fs::path saved_console)
    : std::runtime_error(std::move(message)),
      worker_dir_(std::move(worker_dir)),
      console_log_(std::move(console_log)),
      saved_console_(std::move(saved_console)) {}

StackStartError::~StackStartError() = default;

const fs::path& StackStartError::worker_dir() const noexcept { return worker_dir_; }

const fs::path& StackStartError::console_log() const noexcept { return console_log_; }

const fs::path& StackStartError::saved_console() const noexcept { return saved_console_; }

// ---------------------------------------------------------------- Stack

bool Stack::running() const noexcept {
  return paper != nullptr && paper->running();
}

long long Stack::pid() const noexcept {
  return paper == nullptr ? 0 : paper->native_id();
}

fs::path Stack::console_log() const { return dir / "console.log"; }

// ---------------------------------------------------------------- StackProvisioner

StackProvisioner::StackProvisioner(StackConfig config) : config_(std::move(config)) {}

const StackConfig& StackProvisioner::config() const noexcept { return config_; }

std::unique_ptr<Stack> StackProvisioner::start(int worker_index) {
  if (worker_index < 0) {
    throw StackStartError("worker_index 不能为负数（收到 " + std::to_string(worker_index) + "）", {},
                          {});
  }
  const StackPorts ports{config_.mc_base_port + worker_index,
                         config_.rpc_base_port + worker_index};
  return start_with_ports(worker_index, ports);
}

std::unique_ptr<Stack> StackProvisioner::start_with_ports(int worker_index, StackPorts ports) {
  const fs::path dir = config_.work_root / ("w" + std::to_string(worker_index));
  const fs::path console = dir / "console.log";
  try {
    validate_ports(ports);
    // OS 级端口预检（重要）：端口被别的 Paper/e2e 占用时必须立刻失败，
    // 绝不能静默启动一个连到别人 Paper 的 e2e（会造成假绿）。
    const StackPorts checked = ports;
    struct PortProbe { int port; const char* env_name; };
    const PortProbe probes[2] = {{checked.mc, "MC_PORT"}, {checked.rpc, "MC_RPC_PORT"}};
    for (const PortProbe& probe : probes) {
      if (!tcp_port_available(probe.port)) {
        throw std::runtime_error(std::string("") + probe.env_name + "=" +
                                 std::to_string(probe.port) + " 已被占用");
      }
    }
    prepare_worker_dir(config_, worker_index, ports, dir);
  } catch (const StackStartError&) {
    throw;
  } catch (const std::exception& error) {
    const std::string detail = error.what();
    const fs::path saved = preserve_startup_console(config_, console, worker_index);
    remove_worker_dir_quietly(dir);
    if (detail.find("已被占用") != std::string::npos) {
      throw StackStartError(std::string("worker ") + std::to_string(worker_index) +
                                " 的端口被占用：" + detail +
                                "。可能有别的 Paper/e2e 在跑；请换 --mc-base-port/--rpc-base-port，"
                                "或先停掉占用进程（绝不能连到别人的 Paper）。",
                            dir, console, saved);
    }
    throw StackStartError(std::string("准备 worker ") + std::to_string(worker_index) +
                              " 的 Paper 目录失败：" + detail +
                              "（模板：" + config_.paper_template.string() + "）",
                          dir, console, saved);
  }

  std::string java = config_.java_bin.string();
  if (java.empty()) {
    const fs::path saved = preserve_startup_console(config_, console, worker_index);
    remove_worker_dir_quietly(dir);
    throw StackStartError("java_bin 为空：请通过 CLI/StackConfig 指定 Java 可执行文件", dir,
                          console, saved);
  }
  // 子进程会 chdir 到 worker 目录；带目录的相对 java（如 ./tools/fake-java.sh）必须先转绝对路径，
  // 否则 exec 相对 worker 目录找文件 → 127。纯 "java"（无目录）交给 PATH 查找。
  if (config_.java_bin.has_parent_path() && config_.java_bin.is_relative()) {
    std::error_code absolute_ec;
    const fs::path absolute_java = fs::absolute(config_.java_bin, absolute_ec);
    if (!absolute_ec) java = absolute_java.string();
  }

  std::unique_ptr<Process> paper;
  try {
    ProcessOptions options;
    options.program = java;
    options.args = {"-Xms1G", "-Xmx2G", "-jar", config_.paper_jar, "--nogui"};
    options.work_dir = dir;
    options.log_path = console;
    options.new_process_group = true;
    options.tail_capacity = kConsoleScanBytes;
    paper = Process::spawn(std::move(options));
  } catch (const std::exception& error) {
    const std::string console_tail = tail_utf8(read_file_tail(console, kFailureConsoleBytes), kFailureConsoleBytes);
    const fs::path saved = preserve_startup_console(config_, console, worker_index);
    remove_worker_dir_quietly(dir);
    throw StackStartError(std::string("启动 Paper 进程失败（worker ") + std::to_string(worker_index) +
                              "，java=" + java + "）：" + error.what() +
                              (console_tail.empty() ? "" : "\n控制台尾部：\n" + console_tail),
                          dir, console, saved);
  }

  const auto deadline = Clock::now() + std::chrono::milliseconds(config_.ready_timeout_ms);
  const std::string host = "127.0.0.1";
  for (;;) {
    if (const std::optional<int> exit_code = paper->wait_for(std::chrono::milliseconds(0))) {
      const std::string console_tail = tail_utf8(paper->tail(kConsoleScanBytes), kFailureConsoleBytes);
      const fs::path saved = preserve_startup_console(config_, console, worker_index);
      paper.reset();
      remove_worker_dir_quietly(dir);
      throw StackStartError(std::string("Paper 在就绪前退出（worker ") + std::to_string(worker_index) +
                                "，exit=" + std::to_string(*exit_code) +
                                "）。控制台尾部：\n" + console_tail,
                            dir, console, saved);
    }
    const bool rpc_ready = tcp_connect_ok(host, ports.rpc, kRpcProbeTimeoutMs);
    const std::string console_scan = paper->tail(kConsoleScanBytes);
    const bool console_done = contains_text(console_scan, "Done (");
    if (rpc_ready && console_done) {
      auto stack = std::make_unique<Stack>();
      stack->dir = dir;
      stack->ports = ports;
      stack->paper = std::move(paper);
      return stack;
    }
    if (Clock::now() >= deadline) {
      const std::string console_tail = tail_utf8(console_scan, kFailureConsoleBytes);
      paper->kill();
      (void)paper->wait();
      const fs::path saved = preserve_startup_console(config_, console, worker_index);
      paper.reset();
      remove_worker_dir_quietly(dir);
      throw StackStartError(
          std::string("等待 Paper 就绪超时（worker ") + std::to_string(worker_index) + "，" +
              std::to_string(config_.ready_timeout_ms) + "ms；RPC " + host + ":" +
              std::to_string(ports.rpc) + (rpc_ready ? " 可连" : " 不可连") +
              "，控制台 " + (console_done ? "已出现 Done (" : "未出现 Done (") +
              "）。控制台尾部：\n" + console_tail,
          dir, console, saved);
    }
    sleep_ms(config_.ready_poll_ms);
  }
}

void StackProvisioner::stop(Stack& stack) noexcept {
  if (stack.paper == nullptr) return;
  try {
    // 1) 正常停服：写 stop\n，Paper 会把世界存盘后退出。
    try {
      stack.paper->write("stop\n");
    } catch (const std::exception&) {
      // 进程已经退出 / stdin 不可写：直接进入回收路径。
    }
    if (stack.paper->wait_for(kStopTimeout)) {
      stack.paper.reset();
      return;
    }
    // 2) 20s 没退出：SIGTERM（进程组）→ 5s 宽限 → SIGKILL。
    stack.paper->terminate();
    if (stack.paper->wait_for(kTermGrace)) {
      stack.paper.reset();
      return;
    }
    stack.paper->kill();
    (void)stack.paper->wait();
    stack.paper.reset();
  } catch (const std::exception& error) {
    std::cerr << "[loom-stack] 警告：停止 Paper 时出错：" << error.what() << '\n';
    try {
      stack.paper->kill();
      (void)stack.paper->wait();
    } catch (const std::exception&) {
      // 兜底失败只保留 stderr 警告；Process 析构还会再尝试 kill/回收。
    }
    stack.paper.reset();
  }
}

void StackProvisioner::cleanup(Stack& stack) noexcept {
  if (stack.paper != nullptr) stop(stack);
  if (stack.dir.empty()) return;
  if (const char* keep = std::getenv("LOOM_KEEP_WORK_DIR"); keep != nullptr && std::string_view(keep) == "1") {
    return;
  }
  std::error_code ec;
  fs::remove_all(stack.dir, ec);
  if (ec) {
    std::cerr << "[loom-stack] 警告：删除 worker 目录失败：" << stack.dir << "（" << ec.message()
              << "）\n";
  }
}

fs::path StackProvisioner::save_failure_console_since(const StackConfig& config,
                                                       const fs::path& console_log,
                                                       std::size_t since_offset,
                                                       std::string_view name,
                                                       std::size_t max_bytes) {
  try {
    const fs::path output = console_evidence_path(config, name);
    if (output.empty()) return {};
    const std::string segment = tail_utf8(read_file_since(console_log, since_offset, max_bytes),
                                          max_bytes);
    if (segment.empty()) return {};
    ensure_directory(output.parent_path());
    std::ofstream out(output, std::ios::binary | std::ios::trunc);
    if (!out) return {};
    out.write(segment.data(), static_cast<std::streamsize>(segment.size()));
    if (!out) return {};
    return output;
  } catch (const std::exception&) {
    return {};
  }
}

fs::path StackProvisioner::console_evidence_path(const StackConfig& config,
                                                 std::string_view name) {
  if (config.log_dir.empty()) return {};
  std::string safe_name(name);
  for (auto& character : safe_name) {
    const unsigned char value = static_cast<unsigned char>(character);
    const bool allowed = (value >= '0' && value <= '9') || (value >= 'A' && value <= 'Z') ||
                         (value >= 'a' && value <= 'z') || character == '-' || character == '_';
    if (!allowed) character = '_';
  }
  if (safe_name.empty()) safe_name = "job";
  return config.log_dir / (safe_name + "-console.log");
}

fs::path StackProvisioner::save_failure_console(const StackConfig& config,
                                                const fs::path& console_log,
                                                std::string_view name, std::size_t max_bytes) {
  try {
    const fs::path output = console_evidence_path(config, name);
    if (output.empty()) return {};
    const std::string content = read_file_tail(console_log, max_bytes);
    if (content.empty()) return {};
    ensure_directory(output.parent_path());
    std::ofstream out(output, std::ios::binary | std::ios::trunc);
    if (!out) return {};
    out.write(content.data(), static_cast<std::streamsize>(content.size()));
    if (!out) return {};
    return output;
  } catch (const std::exception&) {
    return {};
  }
}

}  // namespace loom
