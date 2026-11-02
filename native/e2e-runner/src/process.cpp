// loom/process.cpp — POSIX fork/exec + pipe 的 RAII 子进程（Windows 分支 CreateProcess 守卫）。
#include "loom/process.hpp"

#include <algorithm>
#include <array>
#include <atomic>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cwchar>
#include <chrono>
#include <cstring>
#include <stdexcept>
#include <string>
#include <system_error>
#include <thread>
#include <utility>

#include "loom/report.hpp"

#if defined(_WIN32)
#define NOMINMAX
#include <windows.h>
#else
#include <fcntl.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace loom {

namespace {

std::string errno_text(int code) {
#if defined(_WIN32)
  return std::system_category().message(code);
#else
  return std::strerror(code);
#endif
}

} // namespace

// ---------------------------------------------------------------- TailBuffer

TailBuffer::TailBuffer(std::size_t capacity) : capacity_(capacity == 0 ? 1 : capacity) {}

void TailBuffer::append(std::string_view bytes) {
  if (bytes.empty()) return;
  std::lock_guard<std::mutex> lock(mutex_);
  if (bytes.size() >= capacity_) {
    data_ = std::string(bytes.substr(bytes.size() - capacity_));
    return;
  }
  const std::size_t overflow = data_.size() + bytes.size() > capacity_ ? data_.size() + bytes.size() - capacity_ : 0;
  if (overflow > 0) data_.erase(0, overflow);
  data_.append(bytes);
}

std::string TailBuffer::tail(std::size_t max_bytes) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return tail_utf8(data_, max_bytes);
}

std::size_t TailBuffer::size() const {
  std::lock_guard<std::mutex> lock(mutex_);
  return data_.size();
}

// ---------------------------------------------------------------- Process::Impl

class Process::Impl {
 public:
  explicit Impl(ProcessOptions options) : options_(std::move(options)), tail_(options_.tail_capacity) {
    started_ = std::chrono::steady_clock::now();
  }

  ~Impl() {
    try {
      stop_and_reap();
    } catch (...) {
      // 析构绝不能抛异常：资源回收失败也只能吞掉（进程已尽力 SIGKILL）。
    }
    join_reader();
#if defined(_WIN32)
    close_handle(process_);
    close_handle(thread_);
    close_handle(job_);
    close_handle(stdin_write_);
    close_handle(stdout_read_);
    close_handle(log_file_);
#else
    if (stdin_fd_ >= 0) {
      (void)::close(stdin_fd_);
      stdin_fd_ = -1;
    }
    if (stdout_fd_ >= 0) {
      (void)::close(stdout_fd_);
      stdout_fd_ = -1;
    }
    if (log_fd_ >= 0) {
      (void)::close(log_fd_);
      log_fd_ = -1;
    }
#endif
  }

  Impl(const Impl&) = delete;
  Impl& operator=(const Impl&) = delete;

  void spawn() {
#if defined(_WIN32)
    spawn_windows();
#else
    spawn_posix();
#endif
  }

  [[nodiscard]] std::int64_t native_id() const noexcept {
#if defined(_WIN32)
    return static_cast<std::int64_t>(native_id_);
#else
    return static_cast<std::int64_t>(pid_);
#endif
  }

  [[nodiscard]] bool running() {
    refresh();
    return !reaped_;
  }

  std::optional<int> wait_for(std::chrono::milliseconds timeout) {
    const auto deadline = std::chrono::steady_clock::now() + timeout;
    for (;;) {
      refresh();
      if (reaped_) {
        join_reader();
        return exit_code_;
      }
      if (std::chrono::steady_clock::now() >= deadline) return std::nullopt;
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
  }

  int wait() {
    refresh();
    if (reaped_) {
      join_reader();
      return exit_code_;
    }
    reap_blocking();
    join_reader();
    return exit_code_;
  }

  void write(std::string_view data) {
    if (data.empty()) return;
#if defined(_WIN32)
    if (stdin_write_ == nullptr) throw std::runtime_error("子进程的 stdin 已关闭，无法写入");
    std::size_t offset = 0;
    while (offset < data.size()) {
      const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(data.size() - offset, 64 * 1024));
      DWORD written = 0;
      if (WriteFile(stdin_write_, data.data() + offset, chunk, &written, nullptr) == 0) {
        throw std::runtime_error("写子进程 stdin 失败：" + errno_text(static_cast<int>(GetLastError())));
      }
      if (written == 0) throw std::runtime_error("写子进程 stdin 失败：写入 0 字节");
      offset += written;
    }
#else
    if (stdin_fd_ < 0) throw std::runtime_error("子进程的 stdin 已关闭，无法写入");
    sigset_t block;
    sigset_t previous;
    sigemptyset(&block);
    sigaddset(&block, SIGPIPE);
    (void)::pthread_sigmask(SIG_BLOCK, &block, &previous);
    std::size_t offset = 0;
    bool broken = false;
    while (offset < data.size()) {
      const ssize_t written = ::write(stdin_fd_, data.data() + offset, data.size() - offset);
      if (written > 0) {
        offset += static_cast<std::size_t>(written);
        continue;
      }
      if (written < 0 && errno == EINTR) continue;
      broken = true;
      break;
    }
    (void)::pthread_sigmask(SIG_SETMASK, &previous, nullptr);
    if (broken) throw std::runtime_error("写子进程 stdin 失败（子进程可能已退出）");
#endif
  }

  void close_stdin() noexcept {
#if defined(_WIN32)
    if (stdin_write_ != nullptr) {
      (void)::CloseHandle(stdin_write_);
      stdin_write_ = nullptr;
    }
#else
    if (stdin_fd_ >= 0) {
      (void)::close(stdin_fd_);
      stdin_fd_ = -1;
    }
#endif
  }

  void send_signal(int signal) noexcept {
    if (reaped_) return;
#if defined(_WIN32)
    if (signal == 9 || signal == 15) terminate();
#else
    if (pid_ <= 0) return;
    // 组内信号覆盖后代进程；再对主 pid 直接补一发，消除「父进程先于子进程 setsid 发信号」的竞态。
    if (options_.new_process_group) (void)::kill(-pid_, signal);
    (void)::kill(pid_, signal);
#endif
  }

  void terminate() noexcept {
    if (reaped_) return;
#if defined(_WIN32)
    if (process_ != nullptr) (void)::TerminateProcess(process_, 1);
#else
    if (pid_ <= 0) return;
    if (options_.new_process_group) (void)::kill(-pid_, SIGTERM);
    (void)::kill(pid_, SIGTERM);
#endif
  }

  void kill() noexcept {
    if (reaped_) return;
    try {
#if defined(_WIN32)
      if (job_ != nullptr) {
        (void)::TerminateJobObject(job_, 1);
      } else if (process_ != nullptr) {
        (void)::TerminateProcess(process_, 1);
      }
#else
      if (pid_ > 0) {
        if (options_.new_process_group) (void)::kill(-pid_, SIGKILL);
        (void)::kill(pid_, SIGKILL);
      }
#endif
      (void)wait();
    } catch (...) {
      // kill 是 noexcept 的清理路径，吞掉回收异常。
    }
  }

  [[nodiscard]] std::string tail(std::size_t max_bytes) const { return tail_.tail(max_bytes); }

  void cleanup_process_group(std::chrono::milliseconds grace) noexcept {
    if (!options_.new_process_group || pid_ <= 0) return;
#if defined(_WIN32)
    // Windows：Job Object 在进程退出时已 KILL_ON_JOB_CLOSE；无进程组概念，空操作。
    (void)grace;
#else
    if (reaped_) {
      // 主进程已回收，但同组后台子进程可能还活着：对整组补两发。
      (void)::kill(-pid_, SIGTERM);
      std::this_thread::sleep_for(grace);
      (void)::kill(-pid_, SIGKILL);
      return;
    }
    (void)::kill(-pid_, SIGTERM);
    std::this_thread::sleep_for(grace);
    (void)::kill(-pid_, SIGKILL);
#endif
  }

  [[nodiscard]] long long duration_ms() const noexcept {
    const auto end = reaped_ ? reaped_at_ : std::chrono::steady_clock::now();
    return std::chrono::duration_cast<std::chrono::milliseconds>(end - started_).count();
  }

  void start_reader() {
    if (reader_.joinable()) return;
#if defined(_WIN32)
    reader_ = std::thread([this]() { reader_loop_windows(); });
#else
    const int read_fd = stdout_fd_;
    const int log_fd = log_fd_;
    reader_ = std::thread([this, read_fd, log_fd]() { reader_loop_posix(read_fd, log_fd); });
    log_fd_ = -1; // reader 线程接管 log fd（线程创建失败时析构仍负责关闭）
#endif
  }

 private:
#if defined(_WIN32)
  // ------------------------------------------------------------ Windows

  static void close_handle(HANDLE& handle) noexcept {
    if (handle != nullptr) {
      (void)::CloseHandle(handle);
      handle = nullptr;
    }
  }

  static std::wstring to_wide(const std::string& text) {
    if (text.empty()) return {};
    const int size = ::MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), nullptr, 0);
    if (size <= 0) throw std::runtime_error("UTF-8 → UTF-16 转换失败");
    std::wstring wide(static_cast<std::size_t>(size), L'\0');
    (void)::MultiByteToWideChar(CP_UTF8, 0, text.data(), static_cast<int>(text.size()), wide.data(), size);
    return wide;
  }

  static std::string to_utf8(const std::wstring& wide) {
    if (wide.empty()) return {};
    const int size = ::WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), nullptr, 0, nullptr, nullptr);
    if (size <= 0) throw std::runtime_error("UTF-16 → UTF-8 转换失败");
    std::string utf8(static_cast<std::size_t>(size), '\0');
    (void)::WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), utf8.data(), size, nullptr, nullptr);
    return utf8;
  }

  static std::string quote_windows_argument(const std::string& argument) {
    // Windows 命令行引用规则（MSVCRT 解析）：空格/引号需要引号包起来，反斜杠在引号前要成对。
    if (!argument.empty() && argument.find_first_of(" \t\"") == std::string::npos) return argument;
    std::string out = "\"";
    std::size_t backslashes = 0;
    for (const char c : argument) {
      if (c == '\\') {
        ++backslashes;
        continue;
      }
      if (c == '"') {
        out.append(backslashes * 2 + 1, '\\');
        out.push_back('"');
        backslashes = 0;
        continue;
      }
      out.append(backslashes, '\\');
      backslashes = 0;
      out.push_back(c);
    }
    out.append(backslashes * 2, '\\');
    out.push_back('"');
    return out;
  }

  static std::vector<wchar_t> build_environment_block(const std::map<std::string, std::string>& overrides) {
    std::map<std::wstring, std::wstring> merged;
    if (LPWCH block = ::GetEnvironmentStringsW(); block != nullptr) {
      for (const wchar_t* cursor = block; *cursor != L'\0'; cursor += std::wcslen(cursor) + 1) {
        const std::wstring entry(cursor);
        const auto equals = entry.find(L'=');
        if (equals == std::wstring::npos) continue;
        merged[entry.substr(0, equals)] = entry.substr(equals + 1);
      }
      (void)::FreeEnvironmentStringsW(block);
    }
    for (const auto& [key, value] : overrides) merged[to_wide(key)] = to_wide(value);
    std::vector<wchar_t> out;
    for (const auto& [key, value] : merged) {
      const std::wstring entry = key + L"=" + value;
      out.insert(out.end(), entry.begin(), entry.end());
      out.push_back(L'\0');
    }
    out.push_back(L'\0');
    return out;
  }

  void spawn_windows() {
    if (options_.program.empty()) throw std::runtime_error("Process::spawn 需要可执行文件（program 为空）");
    SECURITY_ATTRIBUTES attributes{};
    attributes.nLength = sizeof(attributes);
    attributes.bInheritHandle = TRUE;

    HANDLE stdin_read = nullptr;
    HANDLE stdout_write = nullptr;
    if (::CreatePipe(&stdin_read, &stdin_write_, &attributes, 0) == 0) {
      throw std::runtime_error("创建 stdin 管道失败：" + errno_text(static_cast<int>(GetLastError())));
    }
    if (::SetHandleInformation(stdin_write_, HANDLE_FLAG_INHERIT, 0) == 0) {
      throw std::runtime_error("设置 stdin 管道句柄失败");
    }
    if (::CreatePipe(&stdout_read_, &stdout_write, &attributes, 0) == 0) {
      throw std::runtime_error("创建 stdout 管道失败：" + errno_text(static_cast<int>(GetLastError())));
    }
    if (::SetHandleInformation(stdout_read_, HANDLE_FLAG_INHERIT, 0) == 0) {
      throw std::runtime_error("设置 stdout 管道句柄失败");
    }

    if (options_.log_path.has_value()) {
      const auto parent = options_.log_path->parent_path();
      if (!parent.empty()) std::filesystem::create_directories(parent);
      log_file_ = ::CreateFileW(options_.log_path->wstring().c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr,
                                CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
      if (log_file_ == INVALID_HANDLE_VALUE) {
        log_file_ = nullptr;
        throw std::runtime_error("无法创建日志文件：" + options_.log_path->string());
      }
    }

    std::string command_line;
    command_line += quote_windows_argument(options_.program);
    for (const auto& argument : options_.args) {
      command_line += ' ';
      command_line += quote_windows_argument(argument);
    }
    const std::wstring wide_command = to_wide(command_line);

    std::vector<wchar_t> environment = build_environment_block(options_.env);
    std::wstring working_directory;
    if (options_.work_dir.has_value()) working_directory = options_.work_dir->wstring();

    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    startup.dwFlags = STARTF_USESTDHANDLES;
    startup.hStdInput = stdin_read;
    startup.hStdOutput = stdout_write;
    startup.hStdError = stdout_write;
    PROCESS_INFORMATION process_info{};
    DWORD flags = CREATE_NO_WINDOW;
    if (options_.new_process_group) flags |= CREATE_NEW_PROCESS_GROUP;
    const BOOL created = ::CreateProcessW(nullptr, wide_command.data(), nullptr, nullptr, TRUE, flags,
                                          environment.data(),
                                          working_directory.empty() ? nullptr : working_directory.c_str(),
                                          &startup, &process_info);
    (void)::CloseHandle(stdin_read);
    (void)::CloseHandle(stdout_write);
    if (created == 0) {
      throw std::runtime_error("启动子进程失败（" + options_.program + "）：" +
                               errno_text(static_cast<int>(GetLastError())));
    }
    process_ = process_info.hProcess;
    thread_ = process_info.hThread;
    native_id_ = static_cast<std::uint32_t>(process_info.dwProcessId);
    // Job Object：kill 整棵进程树；JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE 保证父进程退出也不留孤儿。
    job_ = ::CreateJobObjectW(nullptr, nullptr);
    if (job_ != nullptr) {
      JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
      limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
      if (::SetInformationJobObject(job_, JobObjectExtendedLimitInformation, &limits, sizeof(limits)) != 0) {
        // 嵌套 Job 在旧 Windows 上可能失败：失败时退回 TerminateProcess，TODO 记录。
        (void)::AssignProcessToJobObject(job_, process_);
      }
    }
    start_reader();
  }

  void reader_loop_windows() {
    std::array<char, 8192> buffer{};
    for (;;) {
      DWORD read = 0;
      const BOOL ok = ::ReadFile(stdout_read_, buffer.data(), static_cast<DWORD>(buffer.size()), &read, nullptr);
      if (ok != 0 && read > 0) {
        tail_.append(std::string_view(buffer.data(), read));
        if (log_file_ != nullptr) {
          DWORD written = 0;
          (void)::WriteFile(log_file_, buffer.data(), read, &written, nullptr);
        }
        continue;
      }
      if (ok != 0 && read == 0) break;
      const DWORD error = ::GetLastError();
      if (error == ERROR_BROKEN_PIPE || error == ERROR_HANDLE_EOF) break;
      break;
    }
    if (log_file_ != nullptr) {
      (void)::CloseHandle(log_file_);
      log_file_ = nullptr;
    }
  }

  void refresh() {
    if (reaped_ || process_ == nullptr) return;
    const DWORD state = ::WaitForSingleObject(process_, 0);
    if (state == WAIT_OBJECT_0) {
      DWORD code = 0;
      (void)::GetExitCodeProcess(process_, &code);
      finish(static_cast<int>(code));
    } else if (state == WAIT_FAILED) {
      throw std::runtime_error("WaitForSingleObject 失败：" + errno_text(static_cast<int>(GetLastError())));
    }
  }

  void reap_blocking() {
    if (reaped_ || process_ == nullptr) return;
    const DWORD state = ::WaitForSingleObject(process_, INFINITE);
    if (state != WAIT_OBJECT_0) throw std::runtime_error("等待子进程退出失败");
    DWORD code = 0;
    (void)::GetExitCodeProcess(process_, &code);
    finish(static_cast<int>(code));
  }

  void finish(int code) {
    exit_code_ = code;
    reaped_ = true;
    reaped_at_ = std::chrono::steady_clock::now();
    reader_stop_.store(true, std::memory_order_relaxed);
  }

  void join_reader() {
    if (reader_.joinable()) reader_.join();
  }

  void stop_and_reap() {
    if (!reaped_ && (process_ != nullptr)) {
      close_stdin();
      if (job_ != nullptr) {
        (void)::TerminateJobObject(job_, 1);
      } else if (process_ != nullptr) {
        (void)::TerminateProcess(process_, 1);
      }
      reap_blocking();
    }
  }

  HANDLE process_ = nullptr;
  HANDLE thread_ = nullptr;
  HANDLE job_ = nullptr;
  HANDLE stdin_write_ = nullptr;
  HANDLE stdout_read_ = nullptr;
  HANDLE log_file_ = nullptr;
  DWORD native_id_ = 0;
#else
  // ------------------------------------------------------------ POSIX

  static void close_fd(int& fd) noexcept {
    if (fd >= 0) {
      (void)::close(fd);
      fd = -1;
    }
  }

  static int make_pipe(int fds[2]) {
#if defined(__linux__)
    return ::pipe2(fds, O_CLOEXEC);
#else
    if (::pipe(fds) != 0) return -1;
    for (int i = 0; i < 2; ++i) {
      (void)::fcntl(fds[i], F_SETFD, FD_CLOEXEC);
    }
    return 0;
#endif
  }

  static std::string resolve_executable(const std::string& program) {
    if (program.find('/') != std::string::npos) return program;
    const char* raw_path = ::getenv("PATH");
    if (raw_path == nullptr) throw std::runtime_error("找不到可执行文件：" + program + "（PATH 为空）");
    const std::string path(raw_path);
    std::size_t begin = 0;
    while (begin <= path.size()) {
      const std::size_t end = path.find(':', begin);
      const std::string directory = path.substr(begin, end == std::string::npos ? std::string::npos : end - begin);
      if (!directory.empty()) {
        const std::string candidate = directory + "/" + program;
        if (::access(candidate.c_str(), X_OK) == 0) return candidate;
      }
      if (end == std::string::npos) break;
      begin = end + 1;
    }
    throw std::runtime_error("找不到可执行文件：" + program + "（PATH 中不存在）");
  }

  static std::vector<std::string> build_environment(const std::map<std::string, std::string>& overrides) {
    std::vector<std::string> out;
    for (char** cursor = environ; cursor != nullptr && *cursor != nullptr; ++cursor) {
      std::string entry(*cursor);
      const auto equals = entry.find('=');
      if (equals == std::string::npos) continue;
      const std::string key = entry.substr(0, equals);
      if (overrides.contains(key)) continue;
      out.push_back(std::move(entry));
    }
    for (const auto& [key, value] : overrides) out.push_back(key + "=" + value);
    return out;
  }

  void spawn_posix() {
    if (options_.program.empty()) throw std::runtime_error("Process::spawn 需要可执行文件（program 为空）");
    const std::string executable = resolve_executable(options_.program);

    std::vector<std::string> argv_storage;
    argv_storage.reserve(options_.args.size() + 1);
    argv_storage.push_back(options_.program);
    for (const auto& argument : options_.args) argv_storage.push_back(argument);
    std::vector<char*> argv;
    argv.reserve(argv_storage.size() + 1);
    for (auto& argument : argv_storage) argv.push_back(argument.data());
    argv.push_back(nullptr);

    std::vector<std::string> env_storage = build_environment(options_.env);
    std::vector<char*> envp;
    envp.reserve(env_storage.size() + 1);
    for (auto& entry : env_storage) envp.push_back(entry.data());
    envp.push_back(nullptr);

    // fork 前把工作目录转成 std::string：child 里只读 c_str()，不做任何堆分配
    // （fork 后的子进程只允许 async-signal-safe 调用，std::filesystem::path::string() 不是）。
    std::string work_dir_text;
    if (options_.work_dir.has_value()) work_dir_text = options_.work_dir->string();

    int stdin_pipe[2] = {-1, -1};
    int stdout_pipe[2] = {-1, -1};
    if (make_pipe(stdin_pipe) != 0) throw std::runtime_error("创建 stdin 管道失败：" + errno_text(errno));
    if (make_pipe(stdout_pipe) != 0) {
      (void)::close(stdin_pipe[0]);
      (void)::close(stdin_pipe[1]);
      throw std::runtime_error("创建 stdout 管道失败：" + errno_text(errno));
    }

    if (options_.log_path.has_value()) {
      const auto parent = options_.log_path->parent_path();
      if (!parent.empty()) {
        std::error_code error;
        std::filesystem::create_directories(parent, error);
        if (error) throw std::runtime_error("无法创建日志目录：" + parent.string());
      }
      log_fd_ = ::open(options_.log_path->string().c_str(), O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0644);
      if (log_fd_ < 0) throw std::runtime_error("无法创建日志文件：" + options_.log_path->string());
    }

    started_ = std::chrono::steady_clock::now();
    const pid_t child = ::fork();
    if (child < 0) {
      const int code = errno;
      close_fd(log_fd_);
      (void)::close(stdin_pipe[0]);
      (void)::close(stdin_pipe[1]);
      (void)::close(stdout_pipe[0]);
      (void)::close(stdout_pipe[1]);
      throw std::runtime_error("fork 失败：" + errno_text(code));
    }
    if (child == 0) {
      // 子进程：只调用 async-signal-safe 函数；失败用 _exit 上报固定码。
      (void)::close(stdin_pipe[1]);
      (void)::close(stdout_pipe[0]);
      if (::dup2(stdin_pipe[0], STDIN_FILENO) < 0) _exit(126);
      (void)::close(stdin_pipe[0]);
      if (::dup2(stdout_pipe[1], STDOUT_FILENO) < 0) _exit(126);
      if (::dup2(stdout_pipe[1], STDERR_FILENO) < 0) _exit(126);
      (void)::close(stdout_pipe[1]);
      if (options_.new_process_group) (void)::setsid();
      if (!work_dir_text.empty()) {
        if (::chdir(work_dir_text.c_str()) != 0) _exit(126);
      }
      ::execve(executable.c_str(), argv.data(), envp.data());
      _exit(127);
    }

    // 父进程
    pid_ = child;
    (void)::close(stdin_pipe[0]);
    (void)::close(stdout_pipe[1]);
    stdin_fd_ = stdin_pipe[1];
    stdout_fd_ = stdout_pipe[0];
    const int flags = ::fcntl(stdout_fd_, F_GETFL, 0);
    if (flags >= 0) (void)::fcntl(stdout_fd_, F_SETFL, flags | O_NONBLOCK);
    start_reader();
  }

  void reader_loop_posix(int read_fd, int log_fd) {
    std::array<char, 8192> buffer{};
    auto last_data = std::chrono::steady_clock::now();
    for (;;) {
      pollfd descriptor{};
      descriptor.fd = read_fd;
      descriptor.events = POLLIN;
      const int ready = ::poll(&descriptor, 1, 50);
      if (ready < 0) {
        if (errno == EINTR) continue;
        break;
      }
      if (ready == 0) {
        // 进程已回收后，管道里可能还有残留数据；宽限 200ms 无数据就退出，
        // 避免后代进程占着写端导致 reader 永远阻塞（fd 由析构统一关闭）。
        if (reader_stop_.load(std::memory_order_relaxed) &&
            std::chrono::steady_clock::now() - last_data > std::chrono::milliseconds(200)) {
          break;
        }
        continue;
      }
      if ((descriptor.revents & (POLLIN | POLLHUP)) == 0) continue;
      const ssize_t bytes_read = ::read(read_fd, buffer.data(), buffer.size());
      if (bytes_read > 0) {
        tail_.append(std::string_view(buffer.data(), static_cast<std::size_t>(bytes_read)));
        last_data = std::chrono::steady_clock::now();
        if (log_fd >= 0) {
          std::size_t offset = 0;
          const auto total = static_cast<std::size_t>(bytes_read);
          while (offset < total) {
            const ssize_t written = ::write(log_fd, buffer.data() + offset, total - offset);
            if (written > 0) {
              offset += static_cast<std::size_t>(written);
              continue;
            }
            if (written < 0 && errno == EINTR) continue;
            break;
          }
        }
        continue;
      }
      if (bytes_read == 0) break;
      if (errno == EINTR || errno == EAGAIN || errno == EWOULDBLOCK) continue;
      break;
    }
    if (log_fd >= 0) (void)::close(log_fd);
  }

  void refresh() {
    // pid_ <= 0 = spawn 在 fork 前就失败（没有子进程）：绝不能 waitpid(-1)（会偷收别的并发 job 的子进程）。
    if (reaped_ || pid_ <= 0) return;
    int status = 0;
    for (;;) {
      const pid_t result = ::waitpid(pid_, &status, WNOHANG);
      if (result == pid_) {
        finish_posix(status);
        return;
      }
      if (result == 0) return;
      if (result < 0 && errno == EINTR) continue;
      if (result < 0 && errno == ECHILD) {
        // 子进程被外部/错误路径回收：不能当成成功（防止假绿），记 Error(-1)。
        finish(-1);
        return;
      }
      return;
    }
  }

  void reap_blocking() {
    // 仅回收本对象已知 PID；pid_ <= 0（fork 前失败）直接返回，禁止 waitpid(-1)。
    if (reaped_ || pid_ <= 0) return;
    int status = 0;
    for (;;) {
      const pid_t result = ::waitpid(pid_, &status, 0);
      if (result == pid_) {
        finish_posix(status);
        return;
      }
      if (result < 0 && errno == EINTR) continue;
      if (result < 0 && errno == ECHILD) {
        finish(-1);
        return;
      }
      throw std::runtime_error("waitpid 失败：" + errno_text(errno));
    }
  }

  static int exit_code_from_status(int status) {
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 128 + WTERMSIG(status);
    return -1;
  }

  void finish_posix(int status) {
    exit_code_ = exit_code_from_status(status);
    finish(exit_code_);
  }

  void finish(int code) {
    exit_code_ = code;
    reaped_ = true;
    reaped_at_ = std::chrono::steady_clock::now();
    reader_stop_.store(true, std::memory_order_relaxed);
  }

  void join_reader() {
    if (reader_.joinable()) reader_.join();
  }

  void stop_and_reap() {
    if (reaped_) {
      close_stdin();
      return;
    }
    close_stdin();
    if (pid_ > 0) {
      if (options_.new_process_group) (void)::kill(-pid_, SIGKILL);
      (void)::kill(pid_, SIGKILL);
    }
    reap_blocking();
  }

  pid_t pid_ = -1;
  int stdin_fd_ = -1;
  int stdout_fd_ = -1;
  int log_fd_ = -1;
#endif

  ProcessOptions options_;
  TailBuffer tail_;
  std::thread reader_;
  std::atomic<bool> reader_stop_{false};
  bool reaped_ = false;
  int exit_code_ = -1;
  std::chrono::steady_clock::time_point started_{};
  std::chrono::steady_clock::time_point reaped_at_{};
#if defined(_WIN32)
  std::uint32_t native_id_ = 0;
#endif
};

// ---------------------------------------------------------------- Process

Process::Process(std::unique_ptr<Impl> impl) : impl_(std::move(impl)) {}

std::unique_ptr<Process> Process::spawn(ProcessOptions options) {
  auto impl = std::make_unique<Impl>(std::move(options));
  impl->spawn();
  return std::make_unique<Process>(std::move(impl));
}

Process::~Process() = default;
Process::Process(Process&&) noexcept = default;
Process& Process::operator=(Process&&) noexcept = default;

std::int64_t Process::native_id() const noexcept { return impl_->native_id(); }
bool Process::running() { return impl_->running(); }
std::optional<int> Process::wait_for(std::chrono::milliseconds timeout) { return impl_->wait_for(timeout); }
int Process::wait() { return impl_->wait(); }
void Process::write(std::string_view data) { impl_->write(data); }
void Process::close_stdin() noexcept { impl_->close_stdin(); }
void Process::send_signal(int signal) noexcept { impl_->send_signal(signal); }
void Process::terminate() noexcept { impl_->terminate(); }
void Process::kill() noexcept { impl_->kill(); }
std::string Process::tail(std::size_t max_bytes) const { return impl_->tail(max_bytes); }
long long Process::duration_ms() const noexcept { return impl_->duration_ms(); }

void Process::cleanup_process_group(std::chrono::milliseconds grace) noexcept {
  impl_->cleanup_process_group(grace);
}

// ---------------------------------------------------------------- ProcessJobExecutor

ProcessJobExecutor::ProcessJobExecutor(ProcessExecutorOptions options) : options_(std::move(options)) {}

void ProcessJobExecutor::shutdown() noexcept { stop_requested_.store(true, std::memory_order_relaxed); }

JobResult ProcessJobExecutor::run(const JobSpec& job) {
  const auto started = std::chrono::steady_clock::now();
  JobResult result;
  result.job = job;
  result.worker = -1;
  const int timeout_ms = job.timeout_ms > 0 ? job.timeout_ms : std::max(1, options_.default_timeout_ms);

  try {
    ProcessOptions options;
#if defined(_WIN32)
    options.program = "cmd.exe";
    options.args = {"/c", job.command};
#else
    options.program = "/bin/sh";
    options.args = {"-c", job.command};
#endif
    options.work_dir = options_.work_dir;
    options.env = job.env;
    options.new_process_group = true;
    options.tail_capacity = options_.tail_capacity;
    auto process = Process::spawn(std::move(options));
    process->close_stdin();
    bool timed_out = false;
    bool interrupted = false;
    std::optional<int> code;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
    for (;;) {
      // 20ms 切片轮询：SIGINT/SIGTERM 或 executor.shutdown() 后能尽快杀整组。
      if (stop_requested_.load(std::memory_order_relaxed) || shutdown_requested()) {
        interrupted = true;
        process->kill();
        code = process->wait();
        break;
      }
      const auto now = std::chrono::steady_clock::now();
      if (now >= deadline) {
        timed_out = true;
        process->kill();
        code = process->wait();
        break;
      }
      code = process->wait_for(std::min<std::chrono::milliseconds>(
          std::chrono::duration_cast<std::chrono::milliseconds>(deadline - now),
          std::chrono::milliseconds(20)));
      if (code.has_value()) break;
    }
    // 收尾：成功也要清理同组后台子进程（sleep 600 之类），避免孤儿。
    process->cleanup_process_group();
    if (interrupted) {
      result.status = JobStatus::Error;
      result.exit_code = -1;
      result.tail_log = process->tail(kDefaultTailBytes);
      if (!result.tail_log.empty() && result.tail_log.back() != '\n') result.tail_log.push_back('\n');
      result.tail_log += "[loom] 收到中断信号（SIGINT/SIGTERM），已杀 job 进程组";
    } else if (timed_out) {
      // 超时统一 exitCode=137（128+SIGKILL），与 native-stack 的 StackExecutor 一致（见 report.hpp 契约）。
      result.status = JobStatus::Timeout;
      result.exit_code = kTimeoutExitCode;
      result.tail_log = process->tail(kDefaultTailBytes);
    } else {
      result.status = code.value_or(-1) == 0 ? JobStatus::Pass : JobStatus::Fail;
      result.exit_code = code.value_or(-1);
      result.tail_log = process->tail(kDefaultTailBytes);
    }
  } catch (const std::exception& error) {
    result.status = JobStatus::Error;
    result.exit_code = -1;
    result.tail_log = std::string("执行器错误：") + error.what();
  } catch (...) {
    result.status = JobStatus::Error;
    result.exit_code = -1;
    result.tail_log = "执行器错误：未知异常";
  }
  const auto finished = std::chrono::steady_clock::now();
  result.duration_ms = std::chrono::duration_cast<std::chrono::milliseconds>(finished - started).count();
  return result;
}

std::unique_ptr<JobExecutor> create_process_executor(ProcessExecutorOptions options) {
  return std::make_unique<ProcessJobExecutor>(std::move(options));
}

} // namespace loom
