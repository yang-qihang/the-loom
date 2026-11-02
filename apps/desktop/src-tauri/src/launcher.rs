//! Minecraft 客户端启动器适配层（L0「客户端灯」与 L2「一键重启」共用）。
//!
//! 顺序（docs/54 §4.1 + Lead task-7）：
//!   已运行客户端（复用）→ Prism（自动实例/UI）→ HMCL（UI + 引导）
//!   → 直接启动 `.minecraft/26.1.2`（离线 profile，可选 quickPlay 进当前 Paper）
//!   → 官方启动器（UI + 引导）→ PCL2（UI + 引导）→ 一键安装/下载引导。
//!
//! 本模块不直接操作 AppState：调用方（main.rs）提供路径/命令，拿回
//! [`LaunchOutcome`] 后再把 `child` 放进自己的子进程表、把错误/引导写进环境状态。
//! 这样本文件可以在 `cargo test` 里对纯函数做单测（rules/参数替换/实例发现）。

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const DEFAULT_MC_VERSION: &str = "26.1.2";
pub const DEFAULT_SERVER: &str = "127.0.0.1:25565";
/// 内置 Paper 26.1.2 的协议号；26.1.x 族共用 775（docs/58 §1.3）。
pub const EXPECTED_PROTOCOL: u16 = 775;

/// task-16 P0 版本门控：检测到的客户端进程 + 版本（未知时 None）。
/// task-18：多客户端时优先 26.1.x；同时记录其 `--gameDir`（可直接复用该 .minecraft 启动产品客户端）
/// 以及其它版本（旧 1.21.1 只提示、不阻塞、不杀）。
#[derive(Clone, Debug, Default)]
pub struct ClientProbe {
    pub running: bool,
    pub version: Option<String>,
    /// 版本匹配客户端的 `--gameDir`（用于 direct 启动优先复用该 .minecraft）。
    pub game_dir: Option<std::path::PathBuf>,
    /// 同机其它版本客户端（如 1.21.1），仅提示用。
    pub other_versions: Vec<String>,
}

impl ClientProbe {
    /// 只有 26.1.x 同协议族才算兼容；未知版本一律不兼容（禁止误绿）。
    pub fn compatible(&self, expected: &str) -> bool {
        client_version_compatible(self.version.as_deref(), expected)
    }

    pub fn other_version(&self) -> Option<&str> {
        self.other_versions.first().map(String::as_str)
    }
}

pub fn client_version_compatible(found: Option<&str>, expected: &str) -> bool {
    let Some(found) = found.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let Some(found_parts) = version_family(found) else {
        return false;
    };
    match version_family(expected) {
        Some(expected_parts) => found_parts == expected_parts,
        None => found == expected.trim(),
    }
}

/// (major, minor)：26.1.2/26.1 → (26,1)；1.21.1 → (1,21)。
fn version_family(version: &str) -> Option<(u32, u32)> {
    let mut parts = version.trim().split('.');
    let major = parts.next()?.parse::<u32>().ok()?;
    let minor = parts.next()?.parse::<u32>().ok()?;
    Some((major, minor))
}

/// 已知版本的协议号（用于中文提示；未知版本返回 None，不猜）。
pub fn protocol_for_version(version: &str) -> Option<u16> {
    match version_family(version)? {
        (26, 1) => Some(EXPECTED_PROTOCOL),
        (1, 21) => Some(767),
        _ => None,
    }
}

/// 从 java 命令行解析 `--version <ver>`（PCL/官方/Prism 都会传；1.21.1 用户实测有该参数）。
pub fn parse_client_version(cmdline: &str) -> Option<String> {
    let cleaned = cmdline.replace(['"', '\''], "");
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();
    for (index, token) in tokens.iter().enumerate() {
        if *token == "--version" {
            if let Some(next) = tokens.get(index + 1) {
                let candidate = next.trim_matches(|ch: char| ch == ',' || ch == ';' || ch == ')');
                if version_family(candidate).is_some() {
                    return Some(candidate.to_string());
                }
            }
        }
        if let Some(value) = token.strip_prefix("--version=") {
            if version_family(value).is_some() {
                return Some(value.to_string());
            }
        }
    }
    // Prism/MultiMC 的 NewLaunch 包装器不一定把 --version 写进宿主命令行；
    // classpath 里始终带 minecraft-<version>-client.jar，作为跨启动器的稳定兜底。
    for token in cleaned.split_whitespace() {
        let segment = token.rsplit(['/', '\\']).next().unwrap_or(token);
        if let Some(version) = segment
            .strip_prefix("minecraft-")
            .and_then(|value| value.strip_suffix("-client.jar"))
        {
            if version_family(version).is_some() {
                return Some(version.to_string());
            }
        }
    }
    None
}

/// 从窗口标题兜底解析版本（如 "Minecraft 26.1.2" / "Minecraft 1.21.1 - ..."）。
pub fn parse_version_from_title(title: &str) -> Option<String> {
    let mut current = String::new();
    let mut candidates: Vec<String> = Vec::new();
    for ch in title.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            current.push(ch);
        } else if !current.is_empty() {
            candidates.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        candidates.push(current);
    }
    for candidate in candidates {
        let trimmed = candidate.trim_matches('.');
        if let Some((major, _)) = version_family(trimmed) {
            if (1..=99).contains(&major) {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

/// 从 java 命令行解析 `--gameDir <dir>`（task-18：26.1.2 已在跑时复用它的 .minecraft）。
pub fn parse_game_dir(cmdline: &str) -> Option<PathBuf> {
    let cleaned = cmdline.replace(['"', '\''], "");
    let tokens: Vec<&str> = cleaned.split_whitespace().collect();
    for (index, token) in tokens.iter().enumerate() {
        // Windows PEB 读出的命令行会被转小写（--gameDir → --gamedir），这里大小写不敏感。
        if token.eq_ignore_ascii_case("--gameDir") || token.eq_ignore_ascii_case("--game-dir") {
            if let Some(next) = tokens.get(index + 1) {
                let candidate = next.trim_matches(|ch: char| ch == ',' || ch == ';' || ch == ')');
                if !candidate.is_empty() {
                    return Some(PathBuf::from(candidate));
                }
            }
        }
    }
    None
}

/// task-18 纯逻辑：从已校验命令行/标题推导多客户端探测结果。
/// 优先 26.1.x（并带它的 gameDir），其它版本只记入 otherVersions。
pub fn probe_from_cmdlines(cmdlines: &[String], titles: &[String], fallback_running: bool) -> ClientProbe {
    let parsed: Vec<(String, Option<PathBuf>)> = cmdlines
        .iter()
        .filter_map(|cmdline| parse_client_version(cmdline).map(|version| (version, parse_game_dir(cmdline))))
        .collect();
    let parsed: Vec<(String, Option<PathBuf>)> = if parsed.is_empty() {
        titles
            .iter()
            .filter_map(|title| parse_version_from_title(title).map(|version| (version, None)))
            .collect()
    } else {
        parsed
    };
    let mut versions: Vec<String> = Vec::new();
    for (version, _) in &parsed {
        if !versions.contains(version) {
            versions.push(version.clone());
        }
    }
    if let Some((version, game_dir)) = parsed
        .iter()
        .find(|(version, _)| client_version_compatible(Some(version), DEFAULT_MC_VERSION))
    {
        let other_versions = versions
            .into_iter()
            .filter(|other| !client_version_compatible(Some(other), DEFAULT_MC_VERSION))
            .collect();
        return ClientProbe {
            running: true,
            version: Some(version.clone()),
            game_dir: game_dir.clone(),
            other_versions,
        };
    }
    if let Some((version, game_dir)) = parsed.into_iter().next() {
        let other_versions = versions.into_iter().filter(|other| other != &version).collect();
        return ClientProbe {
            running: true,
            version: Some(version),
            game_dir,
            other_versions,
        };
    }
    ClientProbe { running: fallback_running, version: None, game_dir: None, other_versions: Vec::new() }
}

/// 是否是真正的 Minecraft 游戏进程，而不是任意带 minecraft 字样的进程。
/// Prism/MultiMC 用 NewLaunch.jar 的 EntryPoint 包一层，宿主 /proc 里看到的是
/// `org.prismlauncher.EntryPoint`；必须同时看到 client jar，避免把启动器 UI 当成游戏。
fn is_minecraft_cmdline(lower: &str) -> bool {
    if lower.contains("net.minecraft.client.main.main") || lower.contains("org.lwjgl.glfw.glfw") {
        return true;
    }
    let wrapper = lower.contains("org.prismlauncher.entrypoint") || lower.contains("org.multimc.entrypoint");
    wrapper && lower.contains("minecraft-") && lower.contains("-client.jar")
}

/// 当前客户端进程 + 版本（命令行优先，窗口标题兜底；读不到版本时 version=None）。
/// 多个客户端同时运行（1.21.1 + 26.1.2）时优先取 26.1.x，避免误报旧版本。
pub fn client_probe() -> ClientProbe {
    probe_from_cmdlines(&validated_cmdlines(), &validated_titles(), client_process_running())
}

/// 所有 java/javaw 进程命令行（用于识别 25565 是否被旧 Paper 等占用）。
pub fn java_process_cmdlines() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        win32::java_cmdlines()
    }
    #[cfg(target_os = "linux")]
    {
        linux_java_cmdlines()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
}

fn validated_cmdlines() -> Vec<String> {
    validated_cmdline_pairs().into_iter().map(|(_, cmdline)| cmdline).collect()
}

fn validated_cmdline_pairs() -> Vec<(u32, String)> {
    #[cfg(target_os = "windows")]
    {
        win32::validated_cmdline_pairs()
    }
    #[cfg(target_os = "linux")]
    {
        linux_validated_cmdline_pairs()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
}

fn validated_titles() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        win32::validated_titles()
    }
    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
    }
}

/// 传给启动器的上下文（全部来自主进程的 AppState / 环境变量）。
#[derive(Clone, Debug, Default)]
pub struct LaunchContext {
    /// 显式配置的 .minecraft 目录（LOOM_MINECRAFT_DIR 或设置）；空则自动探测。
    pub minecraft_dir: Option<PathBuf>,
    /// task-18：额外候选（例如当前 26.1.2 客户端 `--gameDir` 指向的 .minecraft），优先于自动探测。
    pub extra_minecraft_dirs: Vec<PathBuf>,
    /// 期望版本，默认 26.1.2；可通过 LOOM_MC_VERSION 覆盖。
    pub version: String,
    /// 离线用户名（LOOM_MC_USERNAME > 系统用户名 > Player）。
    pub username: String,
    /// 要 quickPlay 进去的服务器；None 表示只打开主菜单。
    pub server: Option<String>,
    /// 设置里的自定义 Prism 启动命令（兼容旧设置）。
    pub prism_command: Option<String>,
    /// 随包的 Java（`runtime/real/java/bin/java[.exe]`）。
    pub bundled_java: Option<PathBuf>,
    pub repo_root: Option<PathBuf>,
    pub logs_dir: PathBuf,
    /// 上次成功的适配器：L2 一键重启优先复用它。
    pub prefer_adapter: Option<String>,
    /// 用户取消（env_cancel）：启动链/等待窗口在下一个检查点退出并 kill 已 spawn 的直启子进程。
    pub cancel: Option<Arc<AtomicBool>>,
}

impl LaunchContext {
    fn cancelled(&self) -> bool {
        self.cancel
            .as_ref()
            .map(|flag| flag.load(Ordering::SeqCst))
            .unwrap_or(false)
    }
}

#[derive(Debug)]
pub struct LaunchOutcome {
    pub ok: bool,
    /// running / prism / hmcl / direct / official / pcl2 / custom / install
    pub adapter: String,
    pub detail: String,
    pub hint: Option<String>,
    /// 需要引导用户安装/打开下载页时，给前端一个 guide key。
    pub guide: Option<String>,
    /// 需要用户手动操作（我们只负责把启动器 UI 拉起来并等待窗口）。
    pub needs_manual: bool,
    /// 直接启动/MC 进程（调用方负责收进子进程表，退出时回收）。
    pub child: Option<Child>,
}

impl LaunchOutcome {
    fn ok(adapter: &str, detail: impl Into<String>) -> Self {
        Self {
            ok: true,
            adapter: adapter.to_string(),
            detail: detail.into(),
            hint: None,
            guide: None,
            needs_manual: false,
            child: None,
        }
    }

    fn manual(adapter: &str, detail: impl Into<String>, hint: impl Into<String>, guide: Option<&str>) -> Self {
        Self {
            ok: true,
            adapter: adapter.to_string(),
            detail: detail.into(),
            hint: Some(hint.into()),
            guide: guide.map(str::to_string),
            needs_manual: true,
            child: None,
        }
    }

    fn fail(adapter: &str, detail: impl Into<String>, hint: Option<String>) -> Self {
        Self {
            ok: false,
            adapter: adapter.to_string(),
            detail: detail.into(),
            hint,
            guide: None,
            needs_manual: false,
            child: None,
        }
    }
}

// ---------------------------------------------------------------- 客户端检测（P0-3）
//
// 不能只看「可见窗口标题含 minecraft」：Chrome 的 "Minecraft Wiki"、官方启动器
// "Minecraft Launcher" 都会命中，导致四灯假绿、L1 退出误关浏览器。
// Windows：Toolhelp 枚举 java.exe/javaw.exe → 读进程命令行（PEB）→ 必须含
//          `net.minecraft.client.main.Main` 或 `org.lwjgl.glfw.GLFW`；
//          命令行读不到时退化为「java/javaw 进程 + 该进程窗口标题含 minecraft」。
// Linux：/proc/*/cmdline 必须含 Minecraft 主类，或 Prism/MultiMC 的 EntryPoint + client jar。

pub fn client_process_running() -> bool {
    !minecraft_pids().is_empty()
}

/// 校验过的 Minecraft 客户端进程 PID 列表。
pub fn minecraft_pids() -> Vec<u32> {
    #[cfg(target_os = "windows")]
    {
        win32::minecraft_pids()
    }
    #[cfg(target_os = "linux")]
    {
        linux_minecraft_pids()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        Vec::new()
    }
}

/// 请求关闭版本匹配的 Minecraft 客户端（L1「退出游戏」/退出 App）：
/// task-18：只关 26.1.x 产品客户端；用户自己的 1.21.1 旧客户端不杀。
pub fn close_client_window_for_version(expected: &str) -> bool {
    let pids = minecraft_pids_for_version(expected);
    if pids.is_empty() {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        return win32::close_windows_for_pids(&pids);
    }
    #[cfg(target_os = "linux")]
    {
        // 不引入 libc crate：直接声明 kill(2)（Linux 上 std 已链接 libc）。
        extern "C" {
            fn kill(pid: i32, sig: i32) -> i32;
        }
        let mut any = false;
        for pid in pids {
            if unsafe { kill(pid as i32, 15) } == 0 {
                any = true;
            }
        }
        return any;
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = pids;
        false
    }
}

/// 版本匹配的客户端 PID（多客户端时只挑 26.1.x）。
pub fn minecraft_pids_for_version(expected: &str) -> Vec<u32> {
    let mut pids: Vec<u32> = Vec::new();
    for (pid, cmdline) in validated_cmdline_pairs() {
        let compatible = parse_client_version(&cmdline)
            .map(|version| client_version_compatible(Some(&version), expected))
            .unwrap_or(false);
        if compatible && !pids.contains(&pid) {
            pids.push(pid);
        }
    }
    pids
}

#[cfg(target_os = "linux")]
fn linux_minecraft_pids() -> Vec<u32> {
    let mut pids = Vec::new();
    let Ok(entries) = fs::read_dir("/proc") else { return pids };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        let Ok(cmdline) = fs::read(entry.path().join("cmdline")) else { continue };
        let text = String::from_utf8_lossy(&cmdline).to_ascii_lowercase();
        // 必须是主类，不是任意带 minecraft 字样的进程。
        if is_minecraft_cmdline(&text) {
            if let Ok(pid) = name.parse::<u32>() {
                pids.push(pid);
            }
        }
    }
    pids
}

#[cfg(target_os = "linux")]
fn linux_validated_cmdline_pairs() -> Vec<(u32, String)> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir("/proc") else { return found };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_text = name.to_string_lossy();
        if !name_text.chars().all(|ch| ch.is_ascii_digit()) {
            continue;
        }
        let Ok(cmdline) = fs::read(entry.path().join("cmdline")) else { continue };
        let text = String::from_utf8_lossy(&cmdline).replace('\0', " ");
        let lower = text.to_ascii_lowercase();
        if is_minecraft_cmdline(&lower) {
            if let Ok(pid) = name_text.parse::<u32>() {
                found.push((pid, text));
            }
        }
    }
    found
}

#[cfg(target_os = "linux")]
fn linux_java_cmdlines() -> Vec<String> {
    let mut found = Vec::new();
    let Ok(entries) = fs::read_dir("/proc") else { return found };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(exe) = fs::read_link(path.join("exe")) else { continue };
        let exe_name = exe.file_name().map(|name| name.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
        if exe_name != "java" && exe_name != "javaw" {
            continue;
        }
        if let Ok(cmdline) = fs::read(path.join("cmdline")) {
            found.push(String::from_utf8_lossy(&cmdline).replace('\0', " "));
        }
    }
    found
}

#[cfg(target_os = "windows")]
mod win32 {
    use std::ffi::c_void;
    use std::mem::size_of;

    type Handle = *mut c_void;
    type Hwnd = *mut c_void;
    type Bool = i32;
    type Dword = u32;

    const TH32CS_SNAPPROCESS: u32 = 0x0000_0002;
    const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
    const PROCESS_VM_READ: u32 = 0x0010;
    const WM_CLOSE: u32 = 0x0010;
    const INVALID_HANDLE_VALUE: Handle = -1isize as Handle;

    #[repr(C)]
    struct ProcessEntry32W {
        dw_size: u32,
        cnt_usage: u32,
        th32_process_id: u32,
        th32_default_heap_id: usize,
        th32_module_id: u32,
        cnt_threads: u32,
        th32_parent_process_id: u32,
        pc_pri_class_base: i32,
        dw_flags: u32,
        sz_exe_file: [u16; 260],
    }

    #[repr(C)]
    struct ProcessBasicInformation {
        reserved1: usize,
        peb_base_address: usize,
        reserved2: [usize; 2],
        unique_process_id: usize,
        reserved3: usize,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Process32FirstW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
        fn Process32NextW(snapshot: Handle, entry: *mut ProcessEntry32W) -> Bool;
        fn CloseHandle(handle: Handle) -> Bool;
        fn OpenProcess(access: u32, inherit: Bool, pid: u32) -> Handle;
        fn ReadProcessMemory(process: Handle, base: *const c_void, buffer: *mut c_void, size: usize, read: *mut usize) -> Bool;
    }

    #[link(name = "ntdll")]
    extern "system" {
        fn NtQueryInformationProcess(process: Handle, class: u32, info: *mut c_void, len: u32, ret: *mut u32) -> i32;
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(callback: Option<unsafe extern "system" fn(Hwnd, isize) -> Bool>, lparam: isize) -> Bool;
        fn IsWindowVisible(hwnd: Hwnd) -> Bool;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut Dword) -> Dword;
        fn PostMessageW(hwnd: Hwnd, msg: u32, wparam: usize, lparam: isize) -> Bool;
        fn GetWindowTextLengthW(hwnd: Hwnd) -> i32;
        fn GetWindowTextW(hwnd: Hwnd, buffer: *mut u16, max: i32) -> i32;
    }

    fn exe_name(entry: &ProcessEntry32W) -> String {
        let len = entry.sz_exe_file.iter().position(|&ch| ch == 0).unwrap_or(entry.sz_exe_file.len());
        String::from_utf16_lossy(&entry.sz_exe_file[..len])
    }

    fn is_java(name: &str) -> bool {
        let lower = name.to_ascii_lowercase();
        lower == "java.exe" || lower == "javaw.exe"
    }

    fn java_pids() -> Vec<u32> {
        let mut pids = Vec::new();
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
                return pids;
            }
            let mut entry: ProcessEntry32W = std::mem::zeroed();
            entry.dw_size = size_of::<ProcessEntry32W>() as u32;
            let mut ok = Process32FirstW(snapshot, &mut entry);
            while ok != 0 {
                if is_java(&exe_name(&entry)) {
                    pids.push(entry.th32_process_id);
                }
                ok = Process32NextW(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
        }
        pids
    }

    /// 通过 PEB 读 64 位 java 进程的命令行；任何一步失败返回 None（调用方退回窗口标题证据）。
    fn process_cmdline(pid: u32) -> Option<String> {
        #[cfg(target_pointer_width = "32")]
        {
            let _ = pid;
            return None;
        }
        #[cfg(target_pointer_width = "64")]
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
            if handle.is_null() {
                return None;
            }
            let mut info: ProcessBasicInformation = std::mem::zeroed();
            let mut ret = 0u32;
            let status = NtQueryInformationProcess(
                handle,
                0,
                &mut info as *mut _ as *mut c_void,
                size_of::<ProcessBasicInformation>() as u32,
                &mut ret,
            );
            if status != 0 || info.peb_base_address == 0 {
                CloseHandle(handle);
                return None;
            }
            let mut params: usize = 0;
            let mut read = 0usize;
            // 64 位 PEB：ProcessParameters 在偏移 0x20。
            let ok = ReadProcessMemory(
                handle,
                (info.peb_base_address + 0x20) as *const c_void,
                &mut params as *mut usize as *mut c_void,
                size_of::<usize>(),
                &mut read,
            );
            if ok == 0 || params == 0 {
                CloseHandle(handle);
                return None;
            }
            // RTL_USER_PROCESS_PARAMETERS（64 位）：CommandLine UNICODE_STRING 在 0x70。
            let mut unicode: [u8; 16] = [0; 16];
            let ok = ReadProcessMemory(
                handle,
                (params + 0x70) as *const c_void,
                unicode.as_mut_ptr() as *mut c_void,
                unicode.len(),
                &mut read,
            );
            if ok == 0 {
                CloseHandle(handle);
                return None;
            }
            let len = u16::from_le_bytes([unicode[0], unicode[1]]) as usize;
            let buffer = usize::from_le_bytes([
                unicode[8], unicode[9], unicode[10], unicode[11], unicode[12], unicode[13], unicode[14], unicode[15],
            ]);
            if len == 0 || len > 64 * 1024 || buffer == 0 {
                CloseHandle(handle);
                return None;
            }
            let mut text = vec![0u16; len / 2];
            let ok = ReadProcessMemory(
                handle,
                buffer as *const c_void,
                text.as_mut_ptr() as *mut c_void,
                len,
                &mut read,
            );
            CloseHandle(handle);
            if ok == 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&text).to_ascii_lowercase())
        }
    }

    struct TitleSearch {
        pid: u32,
        title: Option<String>,
    }

    unsafe extern "system" fn title_enum_proc(hwnd: Hwnd, lparam: isize) -> Bool {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let context = &mut *(lparam as *mut TitleSearch);
        let mut pid: Dword = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if pid != context.pid {
            return 1;
        }
        let len = GetWindowTextLengthW(hwnd);
        if len <= 0 || len > 512 {
            return 0;
        }
        let mut buffer = vec![0u16; (len + 1) as usize];
        let got = GetWindowTextW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
        if got > 0 {
            context.title = Some(String::from_utf16_lossy(&buffer[..got as usize]));
        }
        0
    }

    fn window_title_for_pid(pid: u32) -> Option<String> {
        let mut search = TitleSearch { pid, title: None };
        unsafe {
            EnumWindows(Some(title_enum_proc), &mut search as *mut TitleSearch as isize);
        }
        search.title
    }

    pub fn minecraft_pids() -> Vec<u32> {
        let mut validated = Vec::new();
        for pid in java_pids() {
            if let Some(cmdline) = process_cmdline(pid) {
                if is_minecraft_cmdline(&cmdline.to_ascii_lowercase()) {
                    validated.push(pid);
                }
                continue;
            }
            // 读不到命令行（权限/32 位 java）：退化为「java 进程的窗口标题含 minecraft」。
            if window_title_for_pid(pid)
                .map(|title| title.to_ascii_lowercase().contains("minecraft"))
                .unwrap_or(false)
            {
                validated.push(pid);
            }
        }
        validated
    }

    struct CloseSearch<'a> {
        pids: &'a [u32],
        found: bool,
    }

    unsafe extern "system" fn close_enum_proc(hwnd: Hwnd, lparam: isize) -> Bool {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let context = &mut *(lparam as *mut CloseSearch);
        let mut pid: Dword = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if !context.pids.contains(&pid) {
            return 1;
        }
        PostMessageW(hwnd, WM_CLOSE, 0, 0);
        context.found = true;
        1
    }

    pub fn close_windows_for_pids(pids: &[u32]) -> bool {
        let mut search = CloseSearch { pids, found: false };
        unsafe {
            EnumWindows(Some(close_enum_proc), &mut search as *mut CloseSearch as isize);
        }
        search.found
    }

    /// 校验过的 MC 客户端命令行 + PID（task-16/18 版本门控与“只关产品客户端”用）。
    pub fn validated_cmdline_pairs() -> Vec<(u32, String)> {
        let mut found = Vec::new();
        for pid in java_pids() {
            let Some(cmdline) = process_cmdline(pid) else { continue };
            if is_minecraft_cmdline(&cmdline.to_ascii_lowercase()) {
                found.push((pid, cmdline));
            }
        }
        found
    }

    /// 校验过 PID 的窗口标题（命令行读不到版本时兜底解析 "Minecraft 26.1.2"）。
    pub fn validated_titles() -> Vec<String> {
        let mut found = Vec::new();
        for pid in minecraft_pids() {
            if let Some(title) = window_title_for_pid(pid) {
                found.push(title);
            }
        }
        found
    }

    /// 所有 java/javaw 进程命令行（识别 25565 是否被旧 Paper 等占用）。
    pub fn java_cmdlines() -> Vec<String> {
        let mut found = Vec::new();
        for pid in java_pids() {
            if let Some(cmdline) = process_cmdline(pid) {
                found.push(cmdline);
            }
        }
        found
    }
}

// ---------------------------------------------------------------- 启动链

/// 启动链总预算：避免 Prism+HMC+direct+官方+PCL2 串行累计 ~7.5 分钟。
const CLIENT_CHAIN_BUDGET: Duration = Duration::from_secs(150);

/// task-18/20：启动顺序。旧的不兼容客户端（如 1.21.1）在跑时不杀不阻塞；
/// **默认第一选择永远是产品自管 26.1.2 直启**（官方 version JSON + 包内 Java + 离线账号 + quickPlay），
/// 外部启动器（Prism/HMCL/官方/PCL2）只作后备，且启动后仍要过 26.1.x 版本校验。
pub fn launch_adapter_order(prefer: Option<&str>, _old_incompatible_running: bool) -> Vec<String> {
    let mut order: Vec<String> = vec!["direct".to_string()];
    if let Some(prefer) = prefer {
        if prefer != "direct" && matches!(prefer, "prism" | "hmcl" | "official" | "pcl2" | "custom") {
            order.push(prefer.to_string());
        }
    }
    for adapter in ["prism", "hmcl", "official", "pcl2"] {
        if !order.iter().any(|item| item == adapter) {
            order.push(adapter.to_string());
        }
    }
    order
}

pub fn launch_client(ctx: &LaunchContext) -> LaunchOutcome {
    if ctx.cancelled() {
        return LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None);
    }
    // task-16/18 复用分支：已运行且版本匹配 → 直接复用，绝不重复启动；
    // 已运行但不兼容（如 1.21.1）→ 不杀它，继续启动产品 26.1.2（direct 优先）。
    let probe = client_probe();
    let mut old_note: Option<String> = None;
    if probe.running {
        if probe.compatible(&ctx.version) {
            let found = probe.version.clone().unwrap_or_else(|| ctx.version.clone());
            let extra = probe
                .other_version()
                .map(|other| format!("（另有 {other} 在运行，不重复启动、不关闭）"))
                .unwrap_or_default();
            return LaunchOutcome::ok("reuse", format!("检测到《我的世界》{found} 已在运行，直接使用{extra}"));
        }
        let found = probe.version.clone().unwrap_or_else(|| "未知版本".to_string());
        old_note = Some(found);
    }
    let old_incompatible = old_note.is_some();
    let order = launch_adapter_order(ctx.prefer_adapter.as_deref(), old_incompatible);

    let deadline = Instant::now() + CLIENT_CHAIN_BUDGET;
    let mut attempts: Vec<String> = Vec::new();
    for adapter in order {
        if ctx.cancelled() {
            return LaunchOutcome::fail("cancelled", format!("已取消启动（已尝试：{}）", attempts.join("；")), None);
        }
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining < Duration::from_secs(8) {
            attempts.push("启动总超时".to_string());
            break;
        }
        let Some(outcome) = try_adapter(ctx, &adapter, remaining.min(Duration::from_secs(120))) else {
            if adapter == "direct" {
                let (dir, versions) = detect_minecraft_dir(ctx);
                let detail = match dir {
                    Some(dir) => format!(
                        "direct：没有找到 versions/{}（{}；现有版本：{}）",
                        ctx.version,
                        dir.display(),
                        if versions.is_empty() { "无".to_string() } else { versions.join(",") }
                    ),
                    None => format!("direct：没有找到含 versions/{} 的 .minecraft 目录", ctx.version),
                };
                attempts.push(detail);
            }
            continue;
        };
        attempts.push(format!("{}：{}", adapter, outcome.detail));
        let mut outcome = outcome;
        if let Some(note) = old_note.as_deref() {
            outcome.detail = if outcome.ok {
                format!("{}（另有 {note} 在运行，未关闭）", outcome.detail)
            } else {
                format!("{}（{note} 仍在运行，未关闭）", outcome.detail)
            };
        }
        if outcome.ok {
            return outcome;
        }
        if outcome.needs_manual || outcome.adapter == "cancelled" {
            // 已拉起启动器 UI / 已取消：继续拉别的只会造成多客户端/孤儿进程，停止链路。
            return outcome;
        }
    }
    let detail = if attempts.is_empty() {
        "没有找到可用的《我的世界》启动器".to_string()
    } else {
        attempts.join("；")
    };
    let hint = match old_note.as_deref() {
        Some(note) => format!(
            "检测到《我的世界》{note} 仍在运行（织界不会关闭它），但没能自动启动 26.1.2。请确认 .minecraft/versions/26.1.2 存在（可在设置里指定 .minecraft，或设置 LOOM_MINECRAFT_DIR）；也可以点 L0 的「准备 26.1.2」一键采用本机现有客户端或打开官方下载。"
        ),
        None => "本机没有找到可用的 26.1.2 客户端路径。点 L0 的「准备 26.1.2」可一键采用本机现有 .minecraft（也可在设置里指定或设置 LOOM_MINECRAFT_DIR）；没有现有资产时会打开官方下载页。安装 26.1.2 后重试即可。".to_string(),
    };
    LaunchOutcome {
        ok: false,
        adapter: "install".to_string(),
        detail,
        hint: Some(hint),
        guide: Some("install".to_string()),
        needs_manual: true,
        child: None,
    }
}

fn try_adapter(ctx: &LaunchContext, adapter: &str, timeout: Duration) -> Option<LaunchOutcome> {
    match adapter {
        "prism" => try_prism(ctx, timeout),
        "hmcl" => try_hmcl(ctx, timeout),
        "direct" => try_direct(ctx, timeout),
        "official" => try_official(ctx, timeout),
        "pcl2" => try_pcl2(ctx, timeout),
        _ => None,
    }
}

/// task-20：外部启动器（Prism/HMCL/PCL2/官方）的结果只在检测到 26.1.x 时接受；
/// 版本不匹配或读不到版本一律不接受（不进入游戏/不点亮客户端灯）。
pub fn external_client_accepted(probe: &ClientProbe, expected: &str) -> bool {
    probe.running && probe.compatible(expected)
}

/// task-16 P0：启动器/直启成功检测到客户端后，必须再校验版本；
/// 1.21.1 等不兼容版本 → manual（明确中文提示），绝不让上层点亮客户端灯。
fn finish_launch(
    adapter: &str,
    ctx: &LaunchContext,
    ok_detail: String,
    manual_hint: &str,
    guide: Option<&str>,
) -> LaunchOutcome {
    let probe = client_probe();
    if external_client_accepted(&probe, &ctx.version) {
        let found = probe.version.unwrap_or_else(|| ctx.version.clone());
        return LaunchOutcome::ok(adapter, format!("{ok_detail}（客户端 {found}）"));
    }
    if probe.running {
        let found = probe.version.unwrap_or_else(|| "未知版本".to_string());
        return LaunchOutcome::manual(
            adapter,
            format!("已拉起启动器，但检测到《我的世界》{found}，本作需要 {}", ctx.version),
            manual_hint,
            guide,
        );
    }
    LaunchOutcome::manual(adapter, ok_detail, manual_hint, guide)
}

/// 兼容旧命令 `launch_prism`：只拉起 Prism（自定义命令走直启 exe；否则自动探测）。
/// 不做完整启动链，也不再经过 cmd/sh。
pub fn launch_prism_only(ctx: &LaunchContext) -> LaunchOutcome {
    if ctx.cancelled() {
        return LaunchOutcome::fail("cancelled", "已取消启动 Prism", None);
    }
    match try_prism(ctx, Duration::from_secs(8)) {
        Some(outcome) => outcome,
        None => LaunchOutcome {
            ok: false,
            adapter: "prism".to_string(),
            detail: "没有找到 Prism Launcher（也没有配置自定义启动器路径）".to_string(),
            hint: Some("安装 Prism 后点「重试」，或在 L0 用「启动《我的世界》」自动选择可用启动器。".into()),
            guide: Some("prism".to_string()),
            needs_manual: true,
            child: None,
        },
    }
}

// ---------------------------------------------------------------- Prism

#[derive(Clone, Debug)]
struct PrismInfo {
    /// 命令行前缀（exe 或 flatpak run ...）。
    program: PathBuf,
    args_prefix: Vec<String>,
    instances_dir: Option<PathBuf>,
}

fn try_prism(ctx: &LaunchContext, timeout: Duration) -> Option<LaunchOutcome> {
    if ctx.cancelled() {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    if let Some(command) = ctx.prism_command.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        // P0-4：自定义命令只允许「可执行文件路径/名称」，直启，不经 cmd/sh。
        if let Err(error) = spawn_validated_exe(command) {
            return Some(LaunchOutcome::fail(
                "custom",
                format!("自定义启动器不可用：{error}"),
                Some("设置里只接受可执行文件路径（不接受命令行参数或 shell 语法；例如 C:\\Program Files\\PrismLauncher\\prismlauncher.exe），也可以清空它改回自动探测。".into()),
            ));
        }
        let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
        if ready.cancelled {
            return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
        }
        if ready.ready {
            return Some(finish_launch(
                "custom",
                ctx,
                "已通过自定义启动器启动《我的世界》".into(),
                "若启动器没有自动进入 26.1.2，请在启动器里选择并启动它。",
                None,
            ));
        }
        return Some(LaunchOutcome::manual(
            "custom",
            "已直启自定义启动器",
            "若启动器没有自动进入 26.1.2，请在启动器里选择并启动它；织界会继续等待游戏窗口。",
            None,
        ));
    }
    let info = find_prism()?;
    let Some(instances_dir) = info.instances_dir.as_deref() else {
        launch_prism_program(&info);
        return Some(LaunchOutcome::manual(
            "prism",
            "已找到 Prism Launcher，但没有定位到实例目录",
            "请在 Prism 里手动启动 26.1.2；织界检测到游戏窗口后会自动点亮客户端灯。",
            Some("prism"),
        ));
    };
    let instance = prism_instance_for(instances_dir, &ctx.version);
    match instance {
        Some(instance) => {
            let mut command = Command::new(&info.program);
            command.args(&info.args_prefix).arg("--launch").arg(&instance);
            quiet(&mut command);
            detach_command(&mut command);
            if command.spawn().is_err() {
                return Some(LaunchOutcome::fail("prism", "Prism 实例启动命令失败", Some("打开「日志目录」查看；也可以在 Prism 里手动启动 26.1.2。".into())));
            }
            let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
            if ready.cancelled {
                return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
            }
            if ready.ready {
                Some(finish_launch(
                    "prism",
                    ctx,
                    format!("已通过 Prism 启动实例「{instance}」"),
                    "在 Prism 里确认实例版本是 26.1.2 且 Java 可用；或在 Prism 里安装 26.1.2 后重试。",
                    Some("prism"),
                ))
            } else {
                // 已 spawn：窗口超时不应继续拉起下一个启动器（避免双客户端），转为人工引导。
                Some(LaunchOutcome::manual(
                    "prism",
                    format!("Prism 已启动实例「{instance}」，但暂时没检测到游戏窗口"),
                    "在 Prism 里确认实例版本是 26.1.2 且 Java 可用；窗口出现后客户端灯会自动点亮。",
                    Some("prism"),
                ))
            }
        }
        None => {
            launch_prism_program(&info);
            Some(LaunchOutcome::manual(
                "prism",
                format!("已拉起 Prism Launcher（未找到 {} 实例，已打开界面）", ctx.version),
                format!("请在 Prism 里选 {} 实例点启动；织界会等待窗口，检测到后自动点亮客户端灯。", ctx.version),
                Some("prism"),
            ))
        }
    }
}

fn find_prism() -> Option<PrismInfo> {
    #[cfg(target_os = "windows")]
    {
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            candidates.push(Path::new(&local).join("Programs/PrismLauncher/prismlauncher.exe"));
            candidates.push(Path::new(&local).join("PrismLauncher/prismlauncher.exe"));
        }
        if let Ok(program_files) = std::env::var("PROGRAMFILES") {
            candidates.push(Path::new(&program_files).join("PrismLauncher/prismlauncher.exe"));
        }
        if let Ok(program_files) = std::env::var("PROGRAMFILES(X86)") {
            candidates.push(Path::new(&program_files).join("PrismLauncher/prismlauncher.exe"));
        }
        for candidate in candidates {
            if candidate.exists() {
                let instances_dir = std::env::var("APPDATA")
                    .ok()
                    .map(|appdata| Path::new(&appdata).join("PrismLauncher/instances"))
                    .filter(|dir| dir.exists());
                return Some(PrismInfo { program: candidate, args_prefix: vec![], instances_dir });
            }
        }
        if let Some(program) = find_in_path("prismlauncher.exe") {
            let instances_dir = std::env::var("APPDATA")
                .ok()
                .map(|appdata| Path::new(&appdata).join("PrismLauncher/instances"))
                .filter(|dir| dir.exists());
            return Some(PrismInfo { program, args_prefix: vec![], instances_dir });
        }
        None
    }
    #[cfg(target_os = "linux")]
    {
        let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
        let mut instances_dirs: Vec<PathBuf> = vec![
            Path::new(&home).join(".local/share/PrismLauncher/instances"),
            Path::new(&home).join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher/instances"),
        ];
        instances_dirs.retain(|dir| dir.exists());
        let instances_dir = instances_dirs.into_iter().next();
        if run_capture("flatpak", &["info", "org.prismlauncher.PrismLauncher"]).is_some() {
            return Some(PrismInfo {
                program: PathBuf::from("flatpak"),
                args_prefix: vec!["run".into(), "org.prismlauncher.PrismLauncher".into()],
                instances_dir,
            });
        }
        for name in ["prismlauncher", "PrismLauncher"] {
            if let Some(program) = find_in_path(name) {
                return Some(PrismInfo { program, args_prefix: vec![], instances_dir });
            }
        }
        None
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        None
    }
}

fn launch_prism_program(info: &PrismInfo) {
    let mut command = Command::new(&info.program);
    command.args(&info.args_prefix);
    quiet(&mut command);
    detach_command(&mut command);
    let _ = command.spawn();
}

/// 从 Prism 实例目录里找 `mmc-pack.json` 声明了目标版本的那个实例。
pub fn prism_instance_for(instances_dir: &Path, version: &str) -> Option<String> {
    let entries = fs::read_dir(instances_dir).ok()?;
    let mut fallback: Option<String> = None;
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let pack = entry.path().join("mmc-pack.json");
        let Ok(text) = fs::read_to_string(&pack) else { continue };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else { continue };
        if pack_declares_version(&value, version) {
            return Some(name);
        }
        if fallback.is_none() && pack_declares_any_minecraft(&value) {
            fallback = Some(name);
        }
    }
    // 找不到精确版本时不要瞎启动别的版本：返回 None，让 Prism 打开 UI 由人选择。
    let _ = fallback;
    None
}

fn pack_declares_version(pack: &serde_json::Value, version: &str) -> bool {
    let Some(components) = pack.get("components").and_then(|value| value.as_array()) else {
        return false;
    };
    components.iter().any(|component| {
        let uid = component.get("uid").and_then(|value| value.as_str()).unwrap_or("");
        let declared = component.get("version").and_then(|value| value.as_str()).unwrap_or("");
        uid == "net.minecraft" && (declared == version || declared.starts_with(&format!("{version}.")))
    })
}

fn pack_declares_any_minecraft(pack: &serde_json::Value) -> bool {
    pack.get("components")
        .and_then(|value| value.as_array())
        .map(|components| {
            components.iter().any(|component| {
                component.get("uid").and_then(|value| value.as_str()) == Some("net.minecraft")
            })
        })
        .unwrap_or(false)
}

// ---------------------------------------------------------------- HMCL

fn try_hmcl(ctx: &LaunchContext, timeout: Duration) -> Option<LaunchOutcome> {
    if ctx.cancelled() {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    let home = home_dir();
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        vec![
            home.join(".minecraft/HMCL.jar"),
            PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join(".minecraft/HMCL.jar"),
            home.join("Desktop/HMCL.jar"),
        ]
    } else {
        vec![home.join(".minecraft/HMCL.jar"), home.join("HMCL.jar")]
    };
    let found = candidates.into_iter().find(|path| path.exists());
    if let Some(jar) = found {
        let Some(java) = resolve_java(ctx, ctx.minecraft_dir.as_deref()) else {
            return Some(LaunchOutcome::fail("hmcl", "找到 HMCL 但找不到可用的 Java", Some("安装 Java 21+ 或使用官方/Prism 启动器。".into())));
        };
        let mut command = Command::new(java);
        command.arg("-jar").arg(&jar);
        quiet(&mut command);
        detach_command(&mut command);
        let _ = command.spawn();
        let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
        if ready.cancelled {
            return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
        }
        if ready.ready {
            return Some(finish_launch(
                "hmcl",
                ctx,
                "已通过 HMCL 启动《我的世界》".into(),
                "请在 HMCL 里确认/安装 26.1.2 后重试。",
                Some("hmcl"),
            ));
        }
        return Some(LaunchOutcome::manual(
            "hmcl",
            "已拉起 HMCL",
            format!("HMCL 的命令行启动能力未确认，请在 HMCL 里启动 {}；检测到游戏窗口后会自动点亮客户端灯。", ctx.version),
            Some("hmcl"),
        ));
    }
    let found = if cfg!(target_os = "windows") {
        find_in_path("hmcl.exe")
    } else {
        find_in_path("hmcl")
    };
    if let Some(exe) = found {
        let mut command = Command::new(exe);
        quiet(&mut command);
        detach_command(&mut command);
        let _ = command.spawn();
        let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
        if ready.cancelled {
            return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
        }
        if ready.ready {
            return Some(finish_launch(
                "hmcl",
                ctx,
                "已通过 HMCL 启动《我的世界》".into(),
                "请在 HMCL 里确认/安装 26.1.2 后重试。",
                Some("hmcl"),
            ));
        }
        return Some(LaunchOutcome::manual(
            "hmcl",
            "已拉起 HMCL",
            format!("请在 HMCL 里启动 {}；织界会继续等待游戏窗口。", ctx.version),
            Some("hmcl"),
        ));
    }
    None
}

// ---------------------------------------------------------------- 官方 / PCL2

fn try_official(ctx: &LaunchContext, timeout: Duration) -> Option<LaunchOutcome> {
    if ctx.cancelled() {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    let candidates: Vec<PathBuf> = if cfg!(target_os = "windows") {
        let mut list = Vec::new();
        for base in ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"] {
            if let Ok(root) = std::env::var(base) {
                list.push(Path::new(&root).join("Minecraft Launcher/MinecraftLauncher.exe"));
                list.push(Path::new(&root).join("Programs/Minecraft Launcher/MinecraftLauncher.exe"));
            }
        }
        list
    } else {
        Vec::new()
    };
    let exe = candidates.into_iter().find(|path| path.exists())?;
    let mut command = Command::new(exe);
    quiet(&mut command);
    detach_command(&mut command);
    let _ = command.spawn();
    let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
    if ready.cancelled {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    if ready.ready {
        return Some(finish_launch(
            "official",
            ctx,
            "已通过官方启动器启动《我的世界》".into(),
            "请在官方启动器里安装/启动 26.1.2 后重试。",
            Some("official"),
        ));
    }
    Some(LaunchOutcome::manual(
        "official",
        "已拉起官方 Minecraft Launcher",
        format!("请在官方启动器里选择 {} 并点「开始游戏」；织界会等待游戏窗口。", ctx.version),
        Some("official"),
    ))
}

fn try_pcl2(ctx: &LaunchContext, timeout: Duration) -> Option<LaunchOutcome> {
    if ctx.cancelled() {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    if !cfg!(target_os = "windows") {
        return None;
    }
    let home = home_dir();
    let mut candidates: Vec<PathBuf> = vec![
        home.join("Desktop/Plain Craft Launcher 2.exe"),
        home.join("Desktop/PCL2.exe"),
        home.join("Downloads/Plain Craft Launcher 2.exe"),
        home.join("Downloads/PCL2.exe"),
    ];
    // task-16：用户实际把 PCL2 放在 D:\Prograft（docs/58 §1.2），补常见便携目录。
    for base in ["D:\\Prograft", "C:\\Prograft", "E:\\Prograft", "D:\\PCL2", "D:\\PCL"] {
        let base = Path::new(base);
        candidates.push(base.join("Plain Craft Launcher 2.exe"));
        candidates.push(base.join("PCL2.exe"));
        candidates.push(base.join("tools/pcl/launcher-2.14/Plain Craft Launcher 2.exe"));
        candidates.push(base.join("tools/pcl/launcher-2.14/PCL2.exe"));
        candidates.push(base.join("tools/pcl/launcher-2.14/PCL.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(Path::new(&local).join("Programs/PCL2/Plain Craft Launcher 2.exe"));
        candidates.push(Path::new(&local).join("Programs/Plain Craft Launcher 2/Plain Craft Launcher 2.exe"));
        candidates.push(Path::new(&local).join("Programs/PCL/Plain Craft Launcher 2.exe"));
    }
    let exe = candidates.into_iter().find(|path| path.exists())?;
    let mut command = Command::new(exe);
    quiet(&mut command);
    detach_command(&mut command);
    let _ = command.spawn();
    let ready = wait_for_client(None, timeout, &ctx.version, ctx.cancel.as_deref());
    if ready.cancelled {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    if ready.ready {
        return Some(finish_launch(
            "pcl2",
            ctx,
            "已通过 PCL2 启动《我的世界》".into(),
            "请在 PCL2 里安装/启动 26.1.2 后重试。",
            Some("pcl2"),
        ));
    }
    Some(LaunchOutcome::manual(
        "pcl2",
        "已拉起 PCL2",
        format!("PCL2 的命令行能力未确认：请在 PCL2 里选择 {} 并启动；织界会继续等待游戏窗口。", ctx.version),
        Some("pcl2"),
    ))
}

// ---------------------------------------------------------------- 直接启动

fn try_direct(ctx: &LaunchContext, timeout: Duration) -> Option<LaunchOutcome> {
    if ctx.cancelled() {
        return Some(LaunchOutcome::fail("cancelled", "已取消启动《我的世界》", None));
    }
    let (mc_dir, version_dir) = match find_version_dir(ctx) {
        Some((dir, version_dir)) => (dir, version_dir),
        None => return None,
    };
    let version_json_path = version_dir.join(format!("{}.json", ctx.version));
    let text = fs::read_to_string(&version_json_path).ok()?;
    let version_json: serde_json::Value = serde_json::from_str(&text).ok()?;
    // task-20：直启默认路径必须完整；缺少 client jar 时给可操作错误，而不是启动后才 ClassNotFound。
    let client_jar = version_dir.join(format!("{}.jar", ctx.version));
    if !client_jar.is_file() {
        return Some(LaunchOutcome::fail(
            "direct",
            format!("找到 versions/{} 但缺少客户端 jar：{}", ctx.version, client_jar.display()),
            Some("26.1.2 文件不完整：请用「准备 26.1.2」/重装或 PCL/Prism 补齐该版本后重试。".into()),
        ));
    }
    let Some(java) = resolve_java(ctx, Some(&mc_dir)) else {
        return Some(LaunchOutcome::fail(
            "direct",
            "找到 .minecraft 与 26.1.2，但找不到可用的 Java",
            Some("安装 Java 21+，或设置环境变量 LOOM_JAVA 指向 java.exe。".into()),
        ));
    };
    let natives_dir = ctx.logs_dir.parent().map(|dir| dir.join("runtime/natives").join(&ctx.version)).unwrap_or_else(|| PathBuf::from("natives"));
    let _ = fs::create_dir_all(&natives_dir);
    let uuid = offline_uuid(&ctx.username);
    let config = DirectConfig {
        java: java.clone(),
        mc_dir: mc_dir.clone(),
        version: ctx.version.clone(),
        username: ctx.username.clone(),
        uuid,
        natives_dir,
        server: ctx.server.clone(),
        launcher_name: "LoomCraft".to_string(),
        launcher_version: env!("CARGO_PKG_VERSION").to_string(),
    };
    let argv = match build_direct_command(&version_json, &config) {
        Ok(argv) => argv,
        Err(error) => {
            return Some(LaunchOutcome::fail("direct", format!("拼装直接启动命令失败：{error}"), Some("把这条错误发给维护者。".into())));
        }
    };
    let _ = fs::create_dir_all(&ctx.logs_dir);
    let log_path = ctx.logs_dir.join("minecraft.log");
    let stdout = File::create(&log_path).ok();
    let stderr = stdout.as_ref().and_then(|file| file.try_clone().ok());
    let mut command = Command::new(&config.java);
    command.args(&argv).current_dir(&mc_dir);
    quiet(&mut command);
    if let Some(file) = stdout {
        command.stdout(Stdio::from(file));
    }
    if let Some(file) = stderr {
        command.stderr(Stdio::from(file));
    }
    detach_command(&mut command);
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return Some(LaunchOutcome::fail(
                "direct",
                format!("直接启动 26.1.2 失败：{error}"),
                Some("确认 Java 可用、.minecraft 完整；也可以改用 Prism/官方启动器。".into()),
            ));
        }
    };
    let ready = wait_for_client(Some(&mut child), timeout, &ctx.version, ctx.cancel.as_deref());
    if ready.ready {
        // task-16 P0：直启成功也要校验版本；不是 26.1.x 时结束本次 java，给出中文提示。
        let probe = client_probe();
        if probe.running && probe.compatible(&ctx.version) {
            let mut outcome = LaunchOutcome::ok("direct", format!("已直接启动 {}（离线 profile：{}）", ctx.version, ctx.username));
            outcome.child = Some(child);
            return Some(outcome);
        }
        let found = probe.version.unwrap_or_else(|| "未知版本".to_string());
        let _ = child.kill();
        let _ = child.wait();
        return Some(LaunchOutcome::manual(
            "direct",
            format!("直接启动后检测到《我的世界》{found}，本作需要 {}", ctx.version),
            "请确认 .minecraft/versions 里实际是 26.1.2（不是 1.21.x）；修正后重试，或改用 Prism/PCL 安装 26.1.2。",
            Some("direct"),
        ));
    }
    // 超时/取消/提前退出：kill 我们 spawn 的 java，避免孤儿进程继续占客户端（P1-3）。
    let _ = child.kill();
    let _ = child.wait();
    let tail = read_log_tail(&log_path, 900);
    if ready.cancelled {
        return Some(LaunchOutcome::fail(
            "cancelled",
            "已取消启动，直接启动的 java 进程已结束",
            if tail.is_empty() { None } else { Some(tail) },
        ));
    }
    let detail = if let Some(status) = ready.exited {
        format!("直接启动的进程已退出（{status}）：{tail}")
    } else {
        format!(
            "直接启动后 {} 秒内没有检测到游戏窗口（已结束本次 java）：{tail}",
            timeout.as_secs()
        )
    };
    Some(LaunchOutcome {
        ok: false,
        adapter: "direct".to_string(),
        detail,
        hint: Some("日志在「打开日志目录」的 minecraft.log；常见原因：正版登录/资源文件缺失/Java 版本不符。".into()),
        guide: Some("direct".to_string()),
        needs_manual: false,
        child: None,
    })
}

/// 直接启动所需的纯数据（方便单测拼命令）。
#[derive(Clone, Debug)]
pub struct DirectConfig {
    pub java: PathBuf,
    pub mc_dir: PathBuf,
    pub version: String,
    pub username: String,
    pub uuid: String,
    pub natives_dir: PathBuf,
    pub server: Option<String>,
    pub launcher_name: String,
    pub launcher_version: String,
}

/// 从 version JSON 拼出 java 命令行（不含可执行文件本身）。规则/占位符/vm 参数全部按 Mojang 语义处理。
pub fn build_direct_command(version_json: &serde_json::Value, config: &DirectConfig) -> Result<Vec<String>, String> {
    let assets_dir = config.mc_dir.join("assets");
    let game_dir = config.mc_dir.clone();
    let main_class = version_json
        .get("mainClass")
        .and_then(|value| value.as_str())
        .ok_or_else(|| "客户端版本文件缺少启动入口".to_string())?;
    let asset_index = version_json
        .get("assetIndex")
        .and_then(|value| value.get("id"))
        .and_then(|value| value.as_str())
        .or_else(|| version_json.get("assets").and_then(|value| value.as_str()))
        .unwrap_or("legacy");
    let libraries = version_json
        .get("libraries")
        .and_then(|value| value.as_array())
        .ok_or_else(|| "客户端版本文件缺少运行库".to_string())?;
    let os = os_name();
    let arch = host_arch();
    let features = default_features();
    let mut classpath: Vec<String> = Vec::new();
    // task-20：官方启动器会把 versions/<ver>/<ver>.jar（client jar）放进 classpath；
    // 只有 libraries 会导致 ClassNotFoundException（product 直启默认路径必须可用）。
    let client_jar = game_dir
        .join("versions")
        .join(&config.version)
        .join(format!("{}.jar", config.version));
    if client_jar.is_file() {
        classpath.push(client_jar.to_string_lossy().to_string());
    }
    for library in libraries {
        if !library_allowed(library, os, arch, &features) {
            continue;
        }
        let Some(path) = library_artifact_path(library) else { continue };
        classpath.push(game_dir.join("libraries").join(path).to_string_lossy().to_string());
    }
    if classpath.is_empty() {
        return Err("客户端运行库为空，无法启动".to_string());
    }
    let classpath_separator = if cfg!(target_os = "windows") { ";" } else { ":" };
    let classpath_text = classpath.join(classpath_separator);

    let mut replacements: HashMap<&str, String> = HashMap::new();
    replacements.insert("natives_directory", config.natives_dir.to_string_lossy().to_string());
    replacements.insert("launcher_name", config.launcher_name.clone());
    replacements.insert("launcher_version", config.launcher_version.clone());
    replacements.insert("classpath", classpath_text);
    replacements.insert("classpath_separator", classpath_separator.to_string());
    replacements.insert("library_directory", game_dir.join("libraries").to_string_lossy().to_string());
    replacements.insert("auth_player_name", config.username.clone());
    replacements.insert("version_name", config.version.clone());
    replacements.insert("game_directory", game_dir.to_string_lossy().to_string());
    replacements.insert("assets_root", assets_dir.to_string_lossy().to_string());
    replacements.insert("assets_index_name", asset_index.to_string());
    replacements.insert("auth_uuid", config.uuid.clone());
    replacements.insert("auth_access_token", "0".to_string());
    replacements.insert("clientid", String::new());
    replacements.insert("auth_xuid", String::new());
    replacements.insert("user_type", "legacy".to_string());
    replacements.insert("version_type", "release".to_string());
    replacements.insert("resolution_width", "1280".to_string());
    replacements.insert("resolution_height", "720".to_string());
    replacements.insert("game_assets", game_dir.join("assets/virtual/legacy").to_string_lossy().to_string());
    replacements.insert("auth_session", "0".to_string());
    // P1-2：quickPlay 占位符也要有定义；默认 features 不会展开这些规则，真正进服只由下方手工参数负责。
    replacements.insert("quickPlayPath", String::new());
    replacements.insert(
        "quickPlayMultiplayer",
        config.server.as_deref().map(str::trim).unwrap_or("").to_string(),
    );

    let mut argv: Vec<String> = Vec::new();
    if let Some(jvm) = version_json.get("arguments").and_then(|value| value.get("jvm")).and_then(|value| value.as_array()) {
        for argument in jvm {
            collect_argument(argument, os, arch, &features, &replacements, &mut argv);
        }
    }
    argv.push(main_class.to_string());
    let mut game_args: Vec<String> = Vec::new();
    if let Some(game) = version_json.get("arguments").and_then(|value| value.get("game")).and_then(|value| value.as_array()) {
        for argument in game {
            collect_argument(argument, os, arch, &features, &replacements, &mut game_args);
        }
    } else if let Some(legacy) = version_json.get("minecraftArguments").and_then(|value| value.as_str()) {
        for token in legacy.split_whitespace() {
            game_args.push(substitute(token, &replacements));
        }
    }
    // 离线/教学统一：1280×720 窗口；有服务端就用 quickPlay 直接进服（L2 重连也靠它）。
    // 先去掉 version JSON 已展开的同名参数，保证命令行只有一份（P1-2）。
    if !game_args.iter().any(|arg| arg == "--width") {
        game_args.push("--width".into());
        game_args.push("1280".into());
    }
    if !game_args.iter().any(|arg| arg == "--height") {
        game_args.push("--height".into());
        game_args.push("720".into());
    }
    if let Some(server) = config.server.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        if !game_args.iter().any(|arg| arg == "--quickPlayMultiplayer") {
            game_args.push("--quickPlayMultiplayer".into());
            game_args.push(server.to_string());
        }
    }
    argv.extend(game_args);
    // 最后兜底：任何仍未替换的 ${...} 一律清空，绝不把占位符塞进 java 命令行。
    for arg in argv.iter_mut() {
        if arg.contains("${") {
            *arg = String::new();
        }
    }
    Ok(argv)
}

fn collect_argument(
    argument: &serde_json::Value,
    os: &str,
    arch: &str,
    features: &HashMap<String, bool>,
    replacements: &HashMap<&str, String>,
    out: &mut Vec<String>,
) {
    match argument {
        serde_json::Value::String(text) => out.push(substitute(text, replacements)),
        serde_json::Value::Object(map) => {
            let rules = map.get("rules");
            if !rules_allowed(rules, os, arch, features) {
                return;
            }
            match map.get("value") {
                Some(serde_json::Value::String(text)) => out.push(substitute(text, replacements)),
                Some(serde_json::Value::Array(values)) => {
                    for value in values {
                        if let Some(text) = value.as_str() {
                            out.push(substitute(text, replacements));
                        }
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn substitute(text: &str, replacements: &HashMap<&str, String>) -> String {
    let mut output = text.to_string();
    for (key, value) in replacements {
        output = output.replace(&format!("${{{key}}}"), value);
    }
    output
}

fn library_allowed(library: &serde_json::Value, os: &str, arch: &str, features: &HashMap<String, bool>) -> bool {
    let rules = library.get("rules");
    if rules.is_none() {
        return true;
    }
    rules_allowed(rules, os, arch, features)
}

fn rules_allowed(rules: Option<&serde_json::Value>, os: &str, arch: &str, features: &HashMap<String, bool>) -> bool {
    let Some(rules) = rules.and_then(|value| value.as_array()) else {
        return true;
    };
    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(|value| value.as_str()).unwrap_or("allow");
        let matches = rule_matches(rule, os, arch, features);
        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

fn rule_matches(rule: &serde_json::Value, os: &str, arch: &str, features: &HashMap<String, bool>) -> bool {
    if let Some(rule_os) = rule.get("os") {
        if let Some(name) = rule_os.get("name").and_then(|value| value.as_str()) {
            if name != os {
                return false;
            }
        }
        if let Some(rule_arch) = rule_os.get("arch").and_then(|value| value.as_str()) {
            if rule_arch != arch {
                return false;
            }
        }
        if let Some(version) = rule_os.get("version").and_then(|value| value.as_str()) {
            let _ = version; // 不处理系统版本正则：26.1.2 的 jvm 参数里只有 osx 的 XstartOnFirstThread 用到，忽略即可。
        }
    }
    if let Some(rules_features) = rule.get("features").and_then(|value| value.as_object()) {
        for (key, expected) in rules_features {
            let actual = features.get(key.as_str()).copied().unwrap_or(false);
            if actual != expected.as_bool().unwrap_or(false) {
                return false;
            }
        }
    }
    true
}

fn library_artifact_path(library: &serde_json::Value) -> Option<String> {
    if let Some(path) = library
        .get("downloads")
        .and_then(|value| value.get("artifact"))
        .and_then(|value| value.get("path"))
        .and_then(|value| value.as_str())
    {
        return Some(path.to_string());
    }
    // 回退：从 Maven 坐标推导 group/artifact/version 路径（classifier 也拼上）。
    let name = library.get("name").and_then(|value| value.as_str())?;
    let parts: Vec<&str> = name.split(':').collect();
    if parts.len() < 3 {
        return None;
    }
    let (group, artifact, version) = (parts[0], parts[1], parts[2]);
    let classifier = parts.get(3).map(|value| format!("-{value}")).unwrap_or_default();
    Some(format!(
        "{}/{}/{}/{}-{}{}.jar",
        group.replace('.', "/"),
        artifact,
        version,
        artifact,
        version,
        classifier
    ))
}

pub fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub fn host_arch() -> &'static str {
    match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "x86" => "x86",
        "aarch64" => "arm64",
        other => other,
    }
}

fn default_features() -> HashMap<String, bool> {
    // P1-2：quickPlay 相关 features 一律 false，不让 version JSON 展开「半成品」quickPlay 规则
    // （那些规则引用 ${quickPlayPath} 等占位符，且会与我们手工追加的 --quickPlayMultiplayer 重复）。
    HashMap::from([
        ("is_demo_user".to_string(), false),
        ("has_custom_resolution".to_string(), false),
        ("has_quick_plays_support".to_string(), false),
        ("is_quick_play_singleplayer".to_string(), false),
        ("is_quick_play_multiplayer".to_string(), false),
        ("is_quick_play_realms".to_string(), false),
    ])
}

// ---------------------------------------------------------------- 路径/进程工具

/// task-16：.minecraft 候选目录（不是「第一个存在的」）。
/// 顺序：显式配置 → LOOM_MINECRAFT_DIR(S) → APPDATA/用户目录 → 仓库 dev 目录 →
/// PCL2 常见便携目录（D:\Prograft 等）→ Downloads/桌面/文档。
/// 每个根同时尝试自身与 `<root>/.minecraft`。
pub fn minecraft_dir_candidates(ctx: &LaunchContext) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    if let Some(dir) = ctx.minecraft_dir.clone() {
        roots.push(dir);
    }
    roots.extend(ctx.extra_minecraft_dirs.iter().cloned());
    if let Ok(dir) = std::env::var("LOOM_MINECRAFT_DIR") {
        if !dir.trim().is_empty() {
            roots.push(PathBuf::from(dir));
        }
    }
    if let Ok(dirs) = std::env::var("LOOM_MINECRAFT_DIRS") {
        for dir in dirs.split(';').map(str::trim).filter(|value| !value.is_empty()) {
            roots.push(PathBuf::from(dir));
        }
    }
    // task-20：产品自管客户端目录（与 ~/.loomcraft/runtime 并列）。
    roots.push(home_dir().join(".loomcraft").join("minecraft"));
    if let Ok(appdata) = std::env::var("APPDATA") {
        roots.push(Path::new(&appdata).join(".minecraft"));
    }
    if let Ok(profile) = std::env::var("USERPROFILE") {
        let profile = Path::new(&profile);
        roots.push(profile.join(".minecraft"));
        roots.push(profile.join("Desktop/.minecraft"));
        roots.push(profile.join("Documents/.minecraft"));
        roots.push(profile.join("Downloads/.minecraft"));
        roots.push(profile.join("Downloads/PCL"));
    }
    if let Some(root) = ctx.repo_root.as_ref() {
        roots.push(root.join(".minecraft"));
    }
    #[cfg(target_os = "windows")]
    {
        // 用户常用 PCL2 便携目录（docs/58 §1.2：D:\Prograft\tools\pcl\launcher-2.14）。
        for base in ["D:\\Prograft", "C:\\Prograft", "E:\\Prograft", "D:\\PCL2", "D:\\PCL"] {
            let base = Path::new(base);
            roots.push(base.to_path_buf());
            roots.push(base.join(".minecraft"));
            roots.push(base.join("tools/pcl"));
            roots.push(base.join("tools/pcl/launcher-2.14"));
            roots.push(base.join("tools/pcl/launcher-2.14/.minecraft"));
        }
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            roots.push(Path::new(&local).join("Programs/PCL2"));
            roots.push(Path::new(&local).join("Programs/Plain Craft Launcher 2"));
        }
    }
    #[cfg(target_os = "linux")]
    {
        let home = home_dir();
        roots.push(home.join(".minecraft"));
        roots.push(home.join(".var/app/org.prismlauncher.PrismLauncher/data/PrismLauncher"));
    }
    let mut candidates: Vec<PathBuf> = Vec::new();
    let mut push = |dir: PathBuf| {
        if !dir.as_os_str().is_empty() && !candidates.contains(&dir) {
            candidates.push(dir);
        }
    };
    for root in roots {
        let name = root.file_name().map(|value| value.to_string_lossy().to_string()).unwrap_or_default();
        if name == ".minecraft" {
            push(root);
        } else {
            push(root.clone());
            push(root.join(".minecraft"));
        }
    }
    candidates
}

/// 优先含 `versions/<version>/<version>.json` 的目录；其次含 `versions/` 的；
/// 最后才回退第一个存在的目录。空 `%APPDATA%\.minecraft` 不会挡住 repo/PCL 的真实 26.1.2。
pub fn pick_minecraft_dir(candidates: &[PathBuf], version: &str) -> Option<PathBuf> {
    candidates
        .iter()
        .find(|dir| dir.join("versions").join(version).join(format!("{version}.json")).exists())
        .or_else(|| candidates.iter().find(|dir| dir.join("versions").is_dir()))
        .or_else(|| candidates.iter().find(|dir| dir.exists()))
        .cloned()
}

pub fn resolve_minecraft_dir(ctx: &LaunchContext) -> Option<PathBuf> {
    pick_minecraft_dir(&minecraft_dir_candidates(ctx), &ctx.version)
}

/// task-20：本机已存在的可用客户端安装（「一键准备」直接采用现有资产）。
#[derive(Clone, Debug)]
pub struct ExistingClientInstall {
    pub dir: PathBuf,
    pub version: String,
    /// 候选来源（settings/detected-gameDir/product/scan），日志/UI 用。
    pub source: String,
}

/// 纯函数：在候选目录里找 `versions/<version>/<version>.json` 存在的安装。
pub fn find_install_in_dirs(dirs: &[PathBuf], version: &str) -> Option<PathBuf> {
    dirs.iter()
        .find(|dir| dir.join("versions").join(version).join(format!("{version}.json")).is_file())
        .cloned()
}

pub fn find_existing_client_install(ctx: &LaunchContext) -> Option<ExistingClientInstall> {
    let candidates = minecraft_dir_candidates(ctx);
    let dir = find_install_in_dirs(&candidates, &ctx.version)?;
    let source = if ctx.minecraft_dir.as_ref() == Some(&dir) {
        "settings".to_string()
    } else if ctx.extra_minecraft_dirs.iter().any(|extra| extra == &dir) {
        "detected-gameDir".to_string()
    } else if dir.to_string_lossy().contains(".loomcraft") {
        "product".to_string()
    } else {
        "scan".to_string()
    };
    Some(ExistingClientInstall { dir, version: ctx.version.clone(), source })
}

/// 给 EnvState/诊断用：实际使用的 .minecraft 路径与可用版本。
pub fn detect_minecraft_dir(ctx: &LaunchContext) -> (Option<PathBuf>, Vec<String>) {
    let dir = resolve_minecraft_dir(ctx);
    let versions = dir.as_deref().map(available_versions).unwrap_or_default();
    (dir, versions)
}

fn find_version_dir(ctx: &LaunchContext) -> Option<(PathBuf, PathBuf)> {
    let mc_dir = resolve_minecraft_dir(ctx)?;
    let version_dir = mc_dir.join("versions").join(&ctx.version);
    if version_dir.join(format!("{}.json", ctx.version)).exists() {
        return Some((mc_dir, version_dir));
    }
    None
}

/// 可用版本列表（排查 .minecraft/版本门控提示用）。
pub fn available_versions(mc_dir: &Path) -> Vec<String> {
    let mut versions: Vec<String> = fs::read_dir(mc_dir.join("versions"))
        .map(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .map(|entry| entry.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    versions.sort();
    versions
}

pub fn resolve_java(ctx: &LaunchContext, mc_dir: Option<&Path>) -> Option<PathBuf> {
    if let Ok(java) = std::env::var("LOOM_JAVA") {
        let path = PathBuf::from(java.trim());
        if path.exists() {
            return Some(path);
        }
    }
    if let Some(bundled) = ctx.bundled_java.as_ref().filter(|path| path.exists()) {
        return Some(bundled.clone());
    }
    if let Some(mc_dir) = mc_dir {
        // 官方启动器管理的 Java runtime 目录：runtime/java-runtime-*/<platform>/<arch>/bin/java
        if let Ok(runtimes) = fs::read_dir(mc_dir.join("runtime")) {
            for entry in runtimes.flatten() {
                let bin = entry.path();
                if let Some(java) = find_java_bin(&bin) {
                    return Some(java);
                }
            }
        }
    }
    let name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    find_in_path(name)
}

/// 不经过 shell 的 PATH 查找（Windows 用 `;` + PATHEXT 追加，Unix 用 `:`）。
fn find_in_path(name: &str) -> Option<PathBuf> {
    let paths = std::env::var_os("PATH")?;
    let exts: Vec<String> = if cfg!(target_os = "windows") && !name.to_ascii_lowercase().contains('.') {
        std::env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .filter(|ext| !ext.trim().is_empty())
            .map(|ext| ext.trim().to_ascii_lowercase())
            .collect()
    } else {
        Vec::new()
    };
    for dir in std::env::split_paths(&paths) {
        if dir.as_os_str().is_empty() {
            continue;
        }
        let direct = dir.join(name);
        if direct.is_file() {
            return Some(direct);
        }
        for ext in &exts {
            let candidate = dir.join(format!("{name}{ext}"));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn find_java_bin(root: &Path) -> Option<PathBuf> {
    let name = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let direct = dir.join("bin").join(name);
        if direct.exists() {
            return Some(direct);
        }
        if let Ok(entries) = fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                    let path = entry.path();
                    if path.components().count() <= root.components().count() + 5 {
                        stack.push(path);
                    }
                }
            }
        }
    }
    None
}

fn home_dir() -> PathBuf {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("."))
}

fn read_log_tail(path: &Path, max_chars: usize) -> String {
    let Ok(mut file) = File::open(path) else { return String::new() };
    let mut text = String::new();
    let _ = file.read_to_string(&mut text);
    let text = text.trim();
    if text.chars().count() <= max_chars {
        return text.to_string();
    }
    let tail: String = text.chars().skip(text.chars().count() - max_chars).collect();
    format!("…{tail}")
}

/// 离线 UUID：用两次标准哈希拼出稳定的 v3 形状 UUID（Paper 离线模式最终会按名字自己分配，这里只需合法）。
pub fn offline_uuid(username: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut first = std::collections::hash_map::DefaultHasher::new();
    "OfflinePlayer:".hash(&mut first);
    username.hash(&mut first);
    let mut second = std::collections::hash_map::DefaultHasher::new();
    username.hash(&mut second);
    "loomcraft".hash(&mut second);
    let high = first.finish();
    let low = second.finish();
    format!(
        "{:08x}-{:04x}-{:04x}-{:04x}-{:012x}",
        (high >> 32) as u32,
        (high >> 16) as u16,
        ((high as u16) & 0x0fff) | 0x3000,
        ((low >> 48) as u16 & 0x3fff) | 0x8000,
        low & 0xffff_ffff_ffff
    )
}

pub struct WaitResult {
    pub ready: bool,
    pub exited: Option<String>,
    pub cancelled: bool,
}

/// 等待**版本匹配**的客户端出现（task-18：旧 1.21.1 在跑不能算 ready）；
/// Windows 用校验过的进程列表，Linux 用 /proc cmdline；同时监控直启 child 是否退出。
/// `cancel` 置位时立刻返回 cancelled（调用方负责 kill 已 spawn 的 child）。
pub fn wait_for_client(
    mut child: Option<&mut Child>,
    timeout: Duration,
    expected_version: &str,
    cancel: Option<&AtomicBool>,
) -> WaitResult {
    let deadline = Instant::now() + timeout;
    loop {
        if cancel.map(|flag| flag.load(Ordering::SeqCst)).unwrap_or(false) {
            return WaitResult { ready: false, exited: None, cancelled: true };
        }
        if client_probe().compatible(expected_version) {
            return WaitResult { ready: true, exited: None, cancelled: false };
        }
        if let Some(child) = child.as_deref_mut() {
            if let Ok(Some(status)) = child.try_wait() {
                return WaitResult { ready: false, exited: Some(status.to_string()), cancelled: false };
            }
        }
        if Instant::now() >= deadline {
            return WaitResult { ready: false, exited: None, cancelled: false };
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

fn quiet(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = command;
    }
}

/// Linux：把外部启动器/客户端放到独立进程组，避免被桌面任务栏当成织界的子窗口，
/// 也避免 Ctrl+C/退出信号沿默认进程组误伤游戏；仍保留 Child 句柄用于取消与回收。
#[cfg(target_os = "linux")]
fn detach_command(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    let _ = command.process_group(0);
    // 不要继承织界的桌面启动令牌：否则 KWin 会把启动器/游戏窗口当成织界的一次启动，
    // 任务栏合并到织界图标下，游戏也可能以 parent 的 activation 状态打开。
    for key in ["DESKTOP_STARTUP_ID", "XDG_ACTIVATION_TOKEN", "GIO_LAUNCHED_DESKTOP_FILE", "GIO_LAUNCHED_DESKTOP_FILE_PID"] {
        command.env_remove(key);
    }
}
#[cfg(not(target_os = "linux"))]
fn detach_command(_command: &mut Command) {}

#[cfg(target_os = "linux")]
fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

/// 设置层校验（不要求文件此刻存在，只拒绝空/shell 元字符）：save_settings 用它落盘，
/// 真正启动时再由 [`validate_program`] 做「文件存在/直启」校验。
pub fn sanitize_program_setting(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.chars().any(|ch| SHELL_META.contains(&ch) || ch.is_control()) {
        return None;
    }
    Some(trimmed.to_string())
}

/// P0-4：自定义启动器命令加固。
/// 只接受「可执行文件路径/名称」，**不经过 cmd/sh**，也不接受命令行参数；
/// 含 shell 元字符/控制字符一律拒绝，防止 `save_settings{prismCommand}` + `launch_prism` 命令注入。
const SHELL_META: &[char] = &['&', '|', '<', '>', '^', '`', '"', '\'', ';', '\n', '\r', '\t', '\0', '%', '!', '$'];

pub fn validate_program(raw: &str) -> Result<PathBuf, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("命令为空".to_string());
    }
    let unquoted = if trimmed.len() >= 2 && trimmed.starts_with('"') && trimmed.ends_with('"') {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    };
    if unquoted.is_empty() {
        return Err("命令为空".to_string());
    }
    if let Some(bad) = unquoted.chars().find(|ch| SHELL_META.contains(ch) || ch.is_control()) {
        return Err(format!("包含不允许的 shell 元字符「{bad}」；只接受可执行文件路径"));
    }
    let path = PathBuf::from(unquoted);
    if path.exists() {
        return if path.is_file() {
            Ok(path)
        } else {
            Err(format!("不是文件：{}", path.display()))
        };
    }
    if unquoted.contains([' ', '\t']) {
        return Err(format!("路径不存在：{unquoted}（不接受命令行参数）"));
    }
    // 不带路径分隔符时允许交给 PATH 解析（例如记事本/启动器已在 PATH 中）。
    Ok(path)
}

/// 直启自定义启动器（无 shell、无参数）。
fn spawn_validated_exe(command: &str) -> Result<(), String> {
    let program = validate_program(command)?;
    let mut cmd = Command::new(&program);
    quiet(&mut cmd);
    detach_command(&mut cmd);
    cmd.spawn()
        .map(|_| ())
        .map_err(|error| format!("无法启动 {}：{error}", program.display()))
}

/// 引导下载页（只打开浏览器，不替用户登录/安装）。
pub fn download_guide(kind: &str) -> (&'static str, &'static str) {
    match kind {
        "prism" => ("https://prismlauncher.org/download/", "下载 Prism Launcher"),
        "hmcl" => ("https://hmcl.huangyuhui.net/download/", "下载 HMCL"),
        "official" => ("https://www.minecraft.net/en-us/download", "打开《我的世界》官方下载"),
        "pcl2" => ("https://github.com/Hex-Dragon/PCL2", "打开 PCL2 发布页"),
        _ => ("https://prismlauncher.org/download/", "下载 Prism Launcher（推荐）"),
    }
}

pub fn open_url(url: &str) -> bool {
    // 只允许 http(s)；下载页是常量，这里再做一次字符白名单，避免任何拼接型注入。
    let url = url.trim();
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return false;
    }
    if url
        .chars()
        .any(|ch| ch.is_control() || matches!(ch, '"' | '\'' | '`' | ' ' | '&' | '|' | '<' | '>' | '^' | '%' | '!'))
    {
        return false;
    }
    #[cfg(target_os = "windows")]
    {
        // 不用 cmd /C start：rundll32 的 URL 处理器不经过 shell 解析。
        let mut cmd = Command::new("rundll32");
        cmd.args(["url.dll,FileProtocolHandler", url]);
        quiet(&mut cmd);
        cmd.spawn().is_ok()
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("xdg-open").arg(url).spawn().is_ok()
    }
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    {
        let _ = url;
        false
    }
}

// ---------------------------------------------------------------- 单测（纯函数）

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rules_match_os_and_arch() {
        let windows_only = serde_json::json!([
            {"action": "allow", "os": {"name": "windows"}}
        ]);
        assert!(rules_allowed(Some(&windows_only), "windows", "x86_64", &default_features()));
        assert!(!rules_allowed(Some(&windows_only), "linux", "x86_64", &default_features()));
        let arch_rule = serde_json::json!([
            {"action": "allow", "os": {"arch": "x86"}}
        ]);
        assert!(!rules_allowed(Some(&arch_rule), "windows", "x86_64", &default_features()));
    }

    #[test]
    fn library_path_from_maven_coordinates() {
        let library = serde_json::json!({"name": "org.lwjgl:lwjgl:3.4.1:natives-windows"});
        assert_eq!(
            library_artifact_path(&library).unwrap(),
            "org/lwjgl/lwjgl/3.4.1/lwjgl-3.4.1-natives-windows.jar"
        );
        let with_downloads = serde_json::json!({"downloads": {"artifact": {"path": "a/b/c.jar"}}});
        assert_eq!(library_artifact_path(&with_downloads).unwrap(), "a/b/c.jar");
    }

    #[test]
    fn prism_instance_detection_reads_mmc_pack() {
        let dir = std::env::temp_dir().join(format!("loom-prism-test-{}", std::process::id()));
        let instance = dir.join("26.1.2 test");
        fs::create_dir_all(&instance).unwrap();
        fs::write(
            instance.join("mmc-pack.json"),
            r#"{"components":[{"uid":"net.minecraft","version":"26.1.2","important":true}]}"#,
        )
        .unwrap();
        assert_eq!(prism_instance_for(&dir, "26.1.2").as_deref(), Some("26.1.2 test"));
        assert_eq!(prism_instance_for(&dir, "1.20.1"), None);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn prism_newlaunch_cmdline_is_detected_and_version_parsed() {
        let cmdline = "java -Duser.language=en -cp /app/share/PrismLauncher/NewLaunch.jar:/home/u/.var/app/PrismLauncher/libraries/com/mojang/minecraft/26.1.2/minecraft-26.1.2-client.jar org.prismlauncher.EntryPoint";
        assert!(is_minecraft_cmdline(&cmdline.to_ascii_lowercase()));
        assert_eq!(parse_client_version(cmdline).as_deref(), Some("26.1.2"));
        assert_eq!(parse_client_version("java org.prismlauncher.EntryPoint"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn linux_prism_entrypoint_process_is_probed_as_minecraft() {
        use std::process::{Command, Stdio};
        // 模拟 Prism NewLaunch 在宿主 /proc 里的真实形态：argv0 是包装后的 java 命令，
        // 没有 --version，但 classpath 带 minecraft-26.1.2-client.jar。
        let fake = "java -cp /tmp/NewLaunch.jar:/tmp/minecraft-26.1.2-client.jar org.prismlauncher.EntryPoint";
        let mut child = Command::new("bash")
            .arg("-c")
            .arg(format!("exec -a {fake:?} sleep 5"))
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("spawn fake prism process");
        let mut found = None;
        for _ in 0..20 {
            std::thread::sleep(Duration::from_millis(50));
            let probe = client_probe();
            if probe.version.as_deref() == Some("26.1.2") {
                found = Some(probe);
                break;
            }
        }
        let _ = child.kill();
        let _ = child.wait();
        let probe = found.expect("Prism EntryPoint 进程未被识别为 26.1.2");
        assert!(probe.running);
        assert!(probe.compatible("26.1.2"));
    }

    #[test]
    fn build_direct_command_replaces_placeholders_and_filters_os_rules() {
        let version = serde_json::json!({
            "id": "26.1.2",
            "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "30"},
            "libraries": [
                {"name": "com.example:base:1.0", "downloads": {"artifact": {"path": "com/example/base/1.0/base-1.0.jar"}}},
                {"name": "com.example:linuxonly:1.0", "downloads": {"artifact": {"path": "com/example/linuxonly/1.0/linuxonly-1.0.jar"}},
                 "rules": [{"action": "allow", "os": {"name": "linux"}}]},
                {"name": "com.example:natives-windows:2.0", "downloads": {"artifact": {"path": "com/example/natives/2.0/natives-windows-2.0.jar"}},
                 "rules": [{"action": "allow", "os": {"name": "windows"}}]}
            ],
            "arguments": {
                "jvm": ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
                "game": ["--username", "${auth_player_name}", "--version", "${version_name}"]
            }
        });
        let config = DirectConfig {
            java: PathBuf::from("java"),
            mc_dir: PathBuf::from("/mc"),
            version: "26.1.2".into(),
            username: "Tester".into(),
            uuid: "00000000-0000-3000-8000-000000000000".into(),
            natives_dir: PathBuf::from("/mc/natives"),
            server: Some("127.0.0.1:25565".into()),
            launcher_name: "LoomCraft".into(),
            launcher_version: "0.1.0".into(),
        };
        let argv = build_direct_command(&version, &config).expect("argv");
        assert!(argv.iter().any(|arg| arg.contains("java.library.path=/mc/natives")));
        assert!(argv.iter().any(|arg| arg == "net.minecraft.client.main.Main"));
        assert!(argv.iter().any(|arg| arg == "Tester"));
        assert!(argv.iter().any(|arg| arg == "26.1.2"));
        assert!(argv.windows(2).any(|pair| pair[0] == "--quickPlayMultiplayer" && pair[1] == "127.0.0.1:25565"));
        let classpath = argv.iter().find(|arg| arg.contains("base-1.0.jar")).expect("classpath entry");
        // 下面两条必须按当前宿主 OS 断言：原测试在 Windows 上写死 natives-windows，
        // 在 Linux CI 会把合法过滤误判为失败（分支 Windows 本机测试未覆盖）。
        if cfg!(target_os = "windows") {
            assert!(classpath.contains("natives-windows-2.0.jar"), "Windows 下 natives jar 也进 classpath（LWJGL 从 classpath 解压）");
            assert!(!classpath.contains("linuxonly"), "OS 规则不匹配的库不能进 classpath");
        } else {
            assert!(classpath.contains("linuxonly-1.0.jar"), "Linux 下匹配 OS 的库必须进 classpath");
            assert!(!classpath.contains("natives-windows-2.0.jar"), "OS 规则不匹配的库不能进 classpath");
        }
        // 占位符不应残留
        assert!(!argv.iter().any(|arg| arg.contains("${")));
    }

    #[test]
    fn offline_uuid_is_stable_and_valid_shape() {
        let uuid = offline_uuid("Alami");
        assert_eq!(uuid, offline_uuid("Alami"));
        assert_eq!(uuid.len(), 36);
        assert_eq!(uuid.as_bytes()[14], b'3');
        assert!(uuid.chars().filter(|ch| *ch == '-').count() == 4);
    }

    #[test]
    fn program_validation_rejects_shell_injection() {
        // P0-4 回归：任何 shell 拼接语法都必须被拒绝。
        for bad in [
            "calc.exe & del important.txt",
            "calc.exe|calc",
            "calc.exe > out.txt",
            "calc.exe; shutdown /s",
            "$(calc.exe)",
            "`calc.exe`",
            "cmd /C calc.exe",
            "calc.exe\ncalc.exe",
        ] {
            assert!(validate_program(bad).is_err(), "应当拒绝：{bad}");
        }
    }

    #[test]
    fn program_validation_accepts_existing_executable_path() {
        // 真实存在的文件（当前测试可执行文件）允许（可含空格）。
        let current = std::env::current_exe().expect("current exe");
        assert!(validate_program(&current.to_string_lossy()).is_ok());
        // 不存在的带空格路径（像是「命令 + 参数」）必须拒绝。
        assert!(validate_program("C:\\does not exist\\launcher.exe --launch foo").is_err());
    }

    #[test]
    fn quickplay_does_not_leak_placeholders_or_duplicate_flags() {
        // P1-2 回归：真实 26.1.2 风格的 quickPlay 规则（features 门控）不能展开成半成品；
        // 手工追加的 --quickPlayMultiplayer 只能出现一次，且不能有 ${...} 残留。
        let version = serde_json::json!({
            "id": "26.1.2",
            "mainClass": "net.minecraft.client.main.Main",
            "assetIndex": {"id": "30"},
            "libraries": [
                {"name": "com.example:base:1.0", "downloads": {"artifact": {"path": "com/example/base/1.0/base-1.0.jar"}}}
            ],
            "arguments": {
                "jvm": ["-cp", "${classpath}"],
                "game": [
                    "--username", "${auth_player_name}",
                    "--clientId", "${clientid}",
                    "--xuid", "${auth_xuid}",
                    {"rules": [{"action": "allow", "features": {"has_quick_plays_support": true}}],
                     "value": ["--quickPlayPath", "${quickPlayPath}"]},
                    {"rules": [{"action": "allow", "features": {"is_quick_play_multiplayer": true}}],
                     "value": ["--quickPlayMultiplayer", "${quickPlayMultiplayer}"]}
                ]
            }
        });
        let config = DirectConfig {
            java: PathBuf::from("java"),
            mc_dir: PathBuf::from("/mc"),
            version: "26.1.2".into(),
            username: "Tester".into(),
            uuid: "00000000-0000-3000-8000-000000000000".into(),
            natives_dir: PathBuf::from("/mc/natives"),
            server: Some("127.0.0.1:25565".into()),
            launcher_name: "LoomCraft".into(),
            launcher_version: "0.1.0".into(),
        };
        let argv = build_direct_command(&version, &config).expect("argv");
        assert!(!argv.iter().any(|arg| arg.contains("${")), "不能残留占位符：{argv:?}");
        let quickplay_flags = argv.iter().filter(|arg| *arg == "--quickPlayMultiplayer").count();
        assert_eq!(quickplay_flags, 1, "quickPlayMultiplayer 只能出现一次：{argv:?}");
        assert!(argv.windows(2).any(|pair| pair[0] == "--quickPlayMultiplayer" && pair[1] == "127.0.0.1:25565"));
    }

    #[test]
    fn wait_for_client_respects_cancel_flag() {
        let cancel = AtomicBool::new(true);
        let result = wait_for_client(None, Duration::from_secs(5), "26.1.2", Some(&cancel));
        assert!(result.cancelled);
        assert!(!result.ready);
    }

    #[test]
    fn open_url_rejects_non_http_or_shell_payload() {
        assert!(!open_url("file:///C:/Windows/System32/calc.exe"));
        assert!(!open_url("https://example.com/&calc.exe"));
        assert!(!open_url("javascript:alert(1)"));
    }

    #[test]
    fn client_version_parsing_and_compatibility_matrix() {
        // task-16 验收矩阵：--version 解析 + 只有 26.1.x（协议 775）算兼容。
        let cmdline = "java -Dminecraft.launcher.brand=PCL --version 1.21.1 -cp x net.minecraft.client.main.Main";
        assert_eq!(parse_client_version(cmdline).as_deref(), Some("1.21.1"));
        assert_eq!(
            parse_client_version("javaw --version=26.1.2 net.minecraft.client.main.Main").as_deref(),
            Some("26.1.2")
        );
        assert_eq!(parse_client_version("java net.minecraft.client.main.Main"), None);
        assert_eq!(parse_version_from_title("Minecraft 26.1.2 - 单人游戏").as_deref(), Some("26.1.2"));
        assert_eq!(parse_version_from_title("Minecraft 1.21.1").as_deref(), Some("1.21.1"));

        for (found, expected) in [
            (Some("26.1.2"), true),
            (Some("26.1"), true),
            (Some("26.1.1"), true),
            (Some("1.21.1"), false),
            (Some("26.3"), false),
            (None, false),
        ] {
            assert_eq!(client_version_compatible(found, "26.1.2"), expected, "found={found:?}");
        }
        assert_eq!(protocol_for_version("26.1.2"), Some(775));
        assert_eq!(protocol_for_version("26.1"), Some(775));
        assert_eq!(protocol_for_version("1.21.1"), Some(767));
        assert_eq!(protocol_for_version("26.3"), None);
    }

    #[test]
    fn minecraft_dir_pick_prefers_directory_with_expected_version() {
        // task-16 验收：空 %APPDATA%\.minecraft 不能挡住真实 versions/26.1.2 目录。
        let root = std::env::temp_dir().join(format!("loom-task16-{}", std::process::id()));
        let empty = root.join("empty-appdata/.minecraft");
        let real = root.join("prograft/.minecraft");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(empty.join("runtime")).expect("empty dir");
        fs::create_dir_all(real.join("versions/26.1.2")).expect("real dir");
        fs::write(real.join("versions/26.1.2/26.1.2.json"), "{}").expect("version json");

        let picked = pick_minecraft_dir(&[empty.clone(), real.clone()], "26.1.2").expect("picked");
        assert_eq!(picked, real, "必须优先有 versions/26.1.2 的目录");
        // 没有精确版本时，含 versions/ 的目录优先于普通存在目录。
        let versions_only = root.join("versions-only");
        fs::create_dir_all(versions_only.join("versions/1.21.1")).expect("versions only");
        let fallback = pick_minecraft_dir(&[empty.clone(), versions_only.clone()], "26.1.2").expect("fallback");
        assert_eq!(fallback, versions_only);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn pcl2_candidates_include_prograft() {
        // 静态保护：用户实际 PCL2 在 D:\Prograft（docs/58 §1.2）。
        let source = include_str!("launcher.rs");
        assert!(source.contains("D:\\\\Prograft") || source.contains("D:\\Prograft"));
        assert!(source.contains("tools/pcl/launcher-2.14"));
    }

    #[test]
    fn multi_client_probe_prefers_26_1_and_keeps_game_dir() {
        // task-18 回归：1.21.1 + 26.1.2 同时运行 → 探针选 26.1.2，旧版本只进 otherVersions；
        // 并保留 26.1.2 的 --gameDir（direct 复用产品自管 .minecraft）。
        let old = r#"java -Dminecraft.launcher.brand=PCL --version 1.21.1 --gameDir D:\Prograft\tools\pcl\launcher-2.14\.minecraft\versions\1.21.1 -cp x net.minecraft.client.main.Main"#.to_string();
        let new = r#"java --version 26.1.2 --gameDir D:\VScode_code\the-loom\.minecraft -cp y net.minecraft.client.main.Main"#.to_string();
        let probe = probe_from_cmdlines(&[old.clone(), new.clone()], &[], true);
        assert!(probe.running);
        assert_eq!(probe.version.as_deref(), Some("26.1.2"));
        assert!(probe.compatible("26.1.2"));
        assert_eq!(probe.other_versions, vec!["1.21.1"]);
        assert_eq!(probe.game_dir.as_deref(), Some(std::path::Path::new(r"D:\VScode_code\the-loom\.minecraft")));

        // 只有 1.21.1 在跑：不能绿，且没有可复用 gameDir。
        let only_old = probe_from_cmdlines(&[old], &[], true);
        assert!(only_old.running);
        assert_eq!(only_old.version.as_deref(), Some("1.21.1"));
        assert!(!only_old.compatible("26.1.2"));
        assert!(only_old.other_versions.is_empty());
    }

    #[test]
    fn launch_order_direct_first_when_old_client_running() {
        // task-20：产品自管 26.1.2 直启是**默认第一选择**（无论有没有旧客户端在跑）；
        // 外部启动器（含 prefer 的 prism）排第二/之后，且启动后仍要过版本校验。
        let with_old = launch_adapter_order(Some("prism"), true);
        assert_eq!(with_old.first().map(String::as_str), Some("direct"));
        assert_eq!(with_old.iter().filter(|item| *item == "direct").count(), 1);
        assert_eq!(with_old.get(1).map(String::as_str), Some("prism"));

        let normal = launch_adapter_order(Some("prism"), false);
        assert_eq!(normal.first().map(String::as_str), Some("direct"), "task-20：默认产品直启优先");
        assert_eq!(normal.get(1).map(String::as_str), Some("prism"));
        let default_order = launch_adapter_order(None, false);
        assert_eq!(default_order.first().map(String::as_str), Some("direct"));
        assert_eq!(default_order.len(), 5);
        assert_eq!(default_order.iter().filter(|item| *item == "direct").count(), 1);
    }

    #[test]
    fn existing_install_detection_requires_version_json() {
        // task-20 一键准备：只有真的含 versions/26.1.2/26.1.2.json 的目录才算可用安装。
        let root = std::env::temp_dir().join(format!("loom-task20-install-{}", std::process::id()));
        let empty = root.join("empty/.minecraft");
        let install = root.join("product/.minecraft");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(empty.join("versions/26.1.2")).expect("empty versions");
        fs::create_dir_all(install.join("versions/26.1.2")).expect("real install");
        fs::write(install.join("versions/26.1.2/26.1.2.json"), "{}").expect("version json");

        assert_eq!(find_install_in_dirs(&[empty.clone(), install.clone()], "26.1.2"), Some(install.clone()));
        assert_eq!(find_install_in_dirs(&[empty], "26.1.2"), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn external_launchers_accept_only_26_1_x() {
        // task-20：Prism/HMCL/PCL2/官方启动器的结果只有 26.1.x 才接受；1.21.1/未知/未运行一律拒绝。
        let mut probe = ClientProbe { running: true, version: Some("26.1.2".into()), ..Default::default() };
        assert!(external_client_accepted(&probe, "26.1.2"));
        probe.version = Some("26.1".into());
        assert!(external_client_accepted(&probe, "26.1.2"));
        probe.version = Some("1.21.1".into());
        assert!(!external_client_accepted(&probe, "26.1.2"));
        probe.version = None;
        assert!(!external_client_accepted(&probe, "26.1.2"));
        probe.running = false;
        probe.version = Some("26.1.2".into());
        assert!(!external_client_accepted(&probe, "26.1.2"));
    }

    #[test]
    #[ignore = "depends on current machine: repo .minecraft/26.1.2 exists (read-only scan)"]
    fn machine_existing_install_is_detected_for_prepare() {
        // task-20 真机：一键准备应能在本机现有资产（repo .minecraft）下直接采用。
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest
            .parent()
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
            .map(|path| path.to_path_buf())
            .expect("repo root");
        let ctx = LaunchContext {
            repo_root: Some(repo_root),
            version: DEFAULT_MC_VERSION.to_string(),
            ..Default::default()
        };
        let install = find_existing_client_install(&ctx).expect("本机应能找到 26.1.2 安装");
        assert!(install.dir.join("versions/26.1.2/26.1.2.json").is_file(), "{install:?}");
        assert_eq!(install.version, DEFAULT_MC_VERSION);
    }

    #[test]
    #[ignore = "depends on current machine: repo .minecraft/26.1.2 + bundled Java (read-only argv build)"]
    fn machine_direct_argv_uses_repo_assets_offline_quickplay() {
        // task-20：产品直启默认 = 官方 version JSON + 包内 Java 25 + 离线账号 + quickPlay 25565。
        // 这里只拼 argv（不 spawn），验证本机现有 repo 资产可用。
        let manifest = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let repo_root = manifest
            .parent()
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
            .map(|path| path.to_path_buf())
            .expect("repo root");
        let mc_dir = repo_root.join(".minecraft");
        let version_json_path = mc_dir.join("versions/26.1.2/26.1.2.json");
        let version_json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&version_json_path).expect("read version json")).expect("parse version json");
        let java = manifest.join("runtime/real/java/bin").join(if cfg!(target_os = "windows") { "java.exe" } else { "java" });
        assert!(java.exists(), "包内 Java 25 应存在：{}", java.display());
        let ctx = LaunchContext {
            minecraft_dir: Some(mc_dir.clone()),
            version: DEFAULT_MC_VERSION.to_string(),
            username: "Alami".into(),
            server: Some(DEFAULT_SERVER.to_string()),
            bundled_java: Some(java.clone()),
            repo_root: Some(repo_root),
            logs_dir: std::env::temp_dir().join("loom-task20-direct"),
            ..Default::default()
        };
        let install = find_existing_client_install(&ctx).expect("应找到 repo 26.1.2");
        assert_eq!(install.dir, mc_dir);
        let resolved_java = resolve_java(&ctx, Some(&mc_dir)).expect("应解析到 Java");
        if std::env::var("LOOM_JAVA").ok().filter(|value| !value.trim().is_empty()).is_none() {
            assert_eq!(resolved_java, java, "默认应优先包内 Java（LOOM_JAVA 未设置时）");
        }
        let config = DirectConfig {
            java: resolved_java,
            mc_dir: mc_dir.clone(),
            version: DEFAULT_MC_VERSION.to_string(),
            username: "Alami".into(),
            uuid: offline_uuid("Alami"),
            natives_dir: std::env::temp_dir().join("loom-task20-natives"),
            server: Some(DEFAULT_SERVER.to_string()),
            launcher_name: "LoomCraft".to_string(),
            launcher_version: env!("CARGO_PKG_VERSION").to_string(),
        };
        let argv = build_direct_command(&version_json, &config).expect("argv");
        let pair = |flag: &str| argv.windows(2).find(|pair| pair[0] == flag).map(|pair| pair[1].as_str());
        assert_eq!(pair("--username"), Some("Alami"));
        assert_eq!(pair("--version"), Some("26.1.2"));
        assert_eq!(pair("--quickPlayMultiplayer"), Some(DEFAULT_SERVER));
        assert_eq!(pair("--accessToken"), Some("0"), "离线账号 token=0");
        // 26.1.2 的 version JSON 可能不再带 --userType（新版 launcher 参数变化）；有才校验。
        if argv.iter().any(|arg| arg == "--userType") {
            assert_eq!(pair("--userType"), Some("legacy"), "离线账号 userType=legacy");
        }
        assert!(argv.iter().any(|arg| arg.contains("26.1.2.jar")), "classpath 应包含 repo 26.1.2 client jar");
        assert!(argv.iter().any(|arg| arg == "net.minecraft.client.main.Main"));
        assert!(!argv.iter().any(|arg| arg.contains("${")), "不能残留占位符");
    }

    #[test]
    #[ignore = "depends on current machine: 26.1.2 client running (read-only probe)"]
    fn machine_current_26_1_2_is_detected_and_reused() {
        let probe = client_probe();
        if !probe.running {
            eprintln!("skip: 当前没有《我的世界》客户端在跑");
            return;
        }
        assert!(probe.compatible("26.1.2"), "探针应优先 26.1.x: {probe:?}");
        assert!(probe.game_dir.as_deref().map(|dir| dir.is_dir()).unwrap_or(false), "应解析到有效 gameDir: {probe:?}");
    }

    #[test]
    #[ignore = "depends on current machine: 26.1.2 client running (does not launch/spawn)"]
    fn machine_existing_26_1_2_is_reused_not_duplicated() {
        // task-18 回归：26.1.2 已在跑时，launch_client 必须走 reuse，不能再 spawn 第二个客户端。
        if !client_probe().compatible(DEFAULT_MC_VERSION) {
            eprintln!("skip: 当前没有 26.1.2 在跑");
            return;
        }
        let ctx = LaunchContext {
            minecraft_dir: None,
            extra_minecraft_dirs: Vec::new(),
            version: DEFAULT_MC_VERSION.to_string(),
            username: "ProbeUser".into(),
            server: None,
            prism_command: None,
            bundled_java: None,
            repo_root: None,
            logs_dir: std::env::temp_dir().join("loom-task18-reuse"),
            prefer_adapter: None,
            cancel: None,
        };
        let outcome = launch_client(&ctx);
        assert!(outcome.ok, "已运行时应成功复用: {outcome:?}");
        assert_eq!(outcome.adapter, "reuse", "已运行时应走 reuse，不能再启动一个客户端");
        assert!(outcome.child.is_none(), "reuse 不应产生 child 进程");
    }
}
