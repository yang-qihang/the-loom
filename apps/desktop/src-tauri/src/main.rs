#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 织界 Tauri 2 桌面壳（T3 spike）。
//! 无浏览器窗口加载 Studio 构建产物；管理 engine sidecar / Paper / Prism 的子进程生命周期；
//! 首启环境探测；置顶 / 伴玩模式 / 全局快捷键 / 设置持久化 / 单实例锁。
//! 业务逻辑仍在 apps/studio 与 apps/engine；本文件只做窗口与进程编排。

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use window_geometry::{GeoRect, GeoSize};

mod envstate;
mod launcher;
mod window_geometry;

const ENGINE_PORT: u16 = 4317;
const MC_PORT: u16 = 25565;
/// L1「退出游戏」：先礼后兵地关客户端，最多等 8 秒。
const CLIENT_CLOSE_WAIT_MS: u64 = 8_000;
/// 四灯监视线程节拍（只用端口/进程/本地 health，不做 PowerShell/UIA，避免旧卡顿回归）。
const ENV_MONITOR_INTERVAL_MS: u64 = 2_000;
/// CloseRequested 二次放行窗口：第一次 prevent 后 N 秒内再点 X/Alt+F4 视为「坚持关闭」。
const CLOSE_SECOND_PASS_MS: u64 = 6_000;
/// shell 确认弹窗迟迟不 ack 时，Rust 兜底放行关闭（避免窗口永远关不掉）。
const CLOSE_CONFIRM_FALLBACK_MS: u64 = 10_000;
/// engine+paper 就绪但织偶超过 N 秒未连上 → L0 转为可点「重启织偶」。
const BOT_STALL_MS: u64 = 60_000;
const PIN_SHORTCUT: &str = "Ctrl+Shift+L";
const RESTORE_SHORTCUT: &str = "Ctrl+Shift+F";
const FOCUS_SHORTCUT: &str = "Alt+Z";
const COMPANION_WIDTH: u32 = 420;
const COMPANION_HEIGHT: u32 = 620;
const WORKBENCH_WIDTH: u32 = 1280;
const WORKBENCH_HEIGHT: u32 = 840;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct Settings {
    always_on_top: bool,
    #[serde(default = "default_focus_follow")]
    focus_follow: bool,
    mode: String,
    page: String,
    prism_command: Option<String>,
    /// 可选：手工指定 .minecraft 目录（空 = 自动探测 APPDATA/.minecraft、仓库 .minecraft）。
    #[serde(default)]
    minecraft_dir: Option<String>,
    /// 可选：目标版本，默认 26.1.2（见 launcher::DEFAULT_MC_VERSION）。
    #[serde(default)]
    mc_version: Option<String>,
    /// 可选：离线 profile 用户名（空 = LOOM_MC_USERNAME > 系统用户名 > Player）。
    #[serde(default)]
    mc_username: Option<String>,
    window: Option<WindowGeom>,
    #[serde(skip)]
    last_save: Option<Instant>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: false,
            focus_follow: false,
            mode: "workbench".into(),
            page: "wizard".into(),
            prism_command: None,
            minecraft_dir: None,
            mc_version: None,
            mc_username: None,
            window: None,
            last_save: None,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WindowGeom {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Probe {
    ok: bool,
    detail: String,
    hint: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EnvReport {
    java: Probe,
    node: Probe,
    prism: Probe,
    paper: Probe,
    engine: Probe,
    repo_root: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct OpStatus {
    ok: bool,
    detail: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeStatus {
    engine_ok: bool,
    engine_detail: String,
    world_ok: bool,
    world_detail: String,
}

/// 当前关卡会话（shell 从 Studio 的 `loom:session` 消息同步过来）。
#[derive(Clone, Debug)]
struct GameSessionRef {
    session_id: String,
    level_id: String,
}

struct AppState {
    settings: Mutex<Settings>,
    children: Mutex<HashMap<String, Child>>,
    settings_path: PathBuf,
    logs_dir: PathBuf,
    resource_dir: Mutex<PathBuf>,
    repo_root: Option<PathBuf>,
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    kde_wayland: bool,
    /// 正在执行的长操作（engine/paper/bot/client），全局启动锁防重复。
    starting: Mutex<HashSet<String>>,
    /// 最近一次四灯快照（env_state 命令直接返回；监视线程负责刷新 + 发事件）。
    env: Mutex<envstate::EnvState>,
    /// 各灯最近一次失败原因（成功时清除）。
    errors: Mutex<HashMap<String, String>>,
    /// 当前关卡会话（L2 客户端丢失判定与「一键重连当前进度」）。
    session: Mutex<Option<GameSessionRef>>,
    /// L2 红色阻断：关卡会话进行中、客户端掉线。
    client_lost: Mutex<bool>,
    /// 是否曾经亮过客户端灯（区分「还没启动」与「从运行中掉线」）。
    client_seen_ready: Mutex<bool>,
    /// 客户端适配器给出的安装/手动引导 key（prism/hmcl/official/pcl2/install…）。
    client_guide: Mutex<Option<String>>,
    /// 最近一次成功使用的客户端适配器（L2 一键重启优先复用）。
    last_client_adapter: Mutex<Option<String>>,
    /// 用户已确认退出（CloseRequested 放行 / quit_game 正在执行）。
    quit_confirmed: Mutex<bool>,
    /// 第一次关闭请求时间（用于「二次点 X 直接放行」）；None = 无未确认请求。
    close_requested_at: Mutex<Option<Instant>>,
    /// shell 确认弹窗的 ack 时间（Rust 超时兜底用）。
    quit_ack_at: Mutex<Option<Instant>>,
    /// 自动启动只跑一次。
    autostart_started: Mutex<bool>,
    /// 启动器取消标志（env_cancel），launcher 等待窗口时检查。
    client_cancel: Arc<AtomicBool>,
    /// engine+paper 已就绪但 bot 未连上的起始时间（P1-7 织偶死局）。
    bot_pending_since: Mutex<Option<Instant>>,
    /// task-18：最近一次检测到的 26.1.x 客户端 `--gameDir`（direct 启动优先复用它）。
    client_game_dir: Mutex<Option<String>>,
}

impl AppState {
    /// 配置好、但尚未启动的初始环境快照（L0 首帧不闪烁）。
    fn initial_env(&self) -> envstate::EnvState {
        let mut state = envstate::EnvState::default();
        let light = |detail: &str| envstate::EnvLight {
            state: envstate::STATE_CHECKING.to_string(),
            detail: detail.to_string(),
            hint: None,
            can_start: false,
            can_retry: false,
            guide: None,
        };
        state.engine = light("正在检测织机…");
        state.paper = light("正在检测世界服务端…");
        state.bot = light("正在检测织偶…");
        state.client = light("正在检测《我的世界》…");
        state
    }

    /// 尝试占住某个启动锁；已在跑则返回 false（防重复启动）。
    fn try_begin_start(&self, kind: &str) -> bool {
        match self.starting.lock() {
            Ok(mut set) => set.insert(kind.to_string()),
            Err(_) => false,
        }
    }

    fn end_start(&self, kind: &str) {
        if let Ok(mut set) = self.starting.lock() {
            set.remove(kind);
        }
    }

    fn starting_snapshot(&self) -> Vec<String> {
        self.starting
            .lock()
            .map(|set| set.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn set_error(&self, kind: &str, message: Option<String>) {
        if let Ok(mut errors) = self.errors.lock() {
            match message {
                Some(message) => {
                    errors.insert(kind.to_string(), message);
                }
                None => {
                    errors.remove(kind);
                }
            }
        }
    }

    fn set_client_guide(&self, guide: Option<String>) {
        if let Ok(mut current) = self.client_guide.lock() {
            *current = guide;
        }
    }

    fn set_last_client_adapter(&self, adapter: Option<String>) {
        if let Ok(mut current) = self.last_client_adapter.lock() {
            *current = adapter;
        }
    }

    fn session_snapshot(&self) -> (bool, Option<GameSessionRef>) {
        match self.session.lock() {
            Ok(guard) => (guard.is_some(), guard.clone()),
            Err(_) => (false, None),
        }
    }

    /// 每次启动固定 L0：把持久化页面强制改回 wizard（shell 每次启动也会强制 show("wizard")）。
    fn force_l0_page(&self) {
        if let Ok(mut settings) = self.settings.lock() {
            settings.page = "wizard".into();
        }
    }

    fn build_launch_context(&self, prefer_adapter: Option<String>, server: Option<String>) -> launcher::LaunchContext {
        let (settings_snapshot, repo_root, resource_dir) = (
            self.settings.lock().map(|guard| guard.clone()).unwrap_or_default(),
            self.repo_root.clone(),
            self.resource_dir(),
        );
        let minecraft_dir = settings_snapshot
            .minecraft_dir
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| {
                // task-18：当前 26.1.2 客户端在跑时，直接复用它的 .minecraft（产品自管客户端）。
                self.client_game_dir
                    .lock()
                    .ok()
                    .and_then(|guard| guard.clone())
                    .map(PathBuf::from)
            });
        let mut extra_minecraft_dirs: Vec<PathBuf> = Vec::new();
        if let Ok(guard) = self.client_game_dir.lock() {
            if let Some(dir) = guard.as_deref().map(PathBuf::from) {
                if minecraft_dir.as_ref() != Some(&dir) {
                    extra_minecraft_dirs.push(dir);
                }
            }
        }
        let version = launcher::DEFAULT_MC_VERSION.to_string();
        let username = settings_snapshot
            .mc_username
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| std::env::var("LOOM_MC_USERNAME").ok().map(|value| value.trim().to_string()).filter(|value| !value.is_empty()))
            .or_else(|| std::env::var("USERNAME").ok().or_else(|| std::env::var("USER").ok()))
            .unwrap_or_else(|| "Player".to_string())
            .chars()
            .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '_')
            .take(16)
            .collect::<String>();
        let username = if username.is_empty() { "Player".to_string() } else { username };
        let bundled_java = {
            let exe = if cfg!(target_os = "windows") { "java.exe" } else { "java" };
            let mut candidates = vec![resource_dir.join("runtime").join("real").join("java").join("bin").join(exe)];
            if let Some(root) = repo_root.as_ref() {
                candidates.push(root.join("apps/desktop/src-tauri/runtime/real/java/bin").join(exe));
            }
            candidates.into_iter().find(|path| path.exists())
        };
        launcher::LaunchContext {
            minecraft_dir,
            extra_minecraft_dirs,
            version,
            username,
            server,
            prism_command: settings_snapshot.prism_command.clone(),
            bundled_java,
            repo_root,
            logs_dir: self.logs_dir.clone(),
            prefer_adapter,
            cancel: Some(self.client_cancel.clone()),
        }
    }
}

impl AppState {
    fn save(&self) {
        let mut clean = match self.settings.lock() {
            Ok(mut guard) => {
                guard.last_save = Some(Instant::now());
                guard.clone()
            }
            Err(_) => return,
        };
        clean.last_save = None;
        if let Ok(json) = serde_json::to_string_pretty(&clean) {
            let _ = fs::write(&self.settings_path, json);
        }
    }

    fn log(&self, channel: &str, message: &str) {
        let _ = fs::create_dir_all(&self.logs_dir);
        if let Ok(mut file) = OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.logs_dir.join(format!("{channel}.log")))
        {
            let _ = writeln!(file, "[{}] {message}", timestamp());
        }
    }

    fn resource_dir(&self) -> PathBuf {
        self.resource_dir.lock().map(|guard| guard.clone()).unwrap_or_default()
    }
}

fn timestamp() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}.{:03}", now.as_secs(), now.subsec_millis())
}

fn loom_dir() -> PathBuf {
    #[cfg(windows)]
    let base = std::env::var("USERPROFILE")
        .or_else(|_| {
            let drive = std::env::var("HOMEDRIVE")?;
            let path = std::env::var("HOMEPATH")?;
            Ok::<String, std::env::VarError>(format!("{drive}{path}"))
        })
        .unwrap_or_else(|_| std::env::temp_dir().to_string_lossy().into_owned());
    #[cfg(not(windows))]
    let base = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    Path::new(&base).join(".loomcraft")
}

fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
}

fn process_alive(pid: u32) -> bool {
    #[cfg(target_os = "linux")]
    {
        Path::new(&format!("/proc/{pid}")).exists()
    }
    #[cfg(target_os = "windows")]
    {
        #[link(name = "kernel32")]
        extern "system" {
            fn OpenProcess(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void;
            fn GetExitCodeProcess(handle: *mut std::ffi::c_void, code: *mut u32) -> i32;
            fn CloseHandle(handle: *mut std::ffi::c_void) -> i32;
        }
        const PROCESS_QUERY_LIMITED_INFORMATION: u32 = 0x1000;
        const STILL_ACTIVE: u32 = 259;
        unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
            if handle.is_null() {
                return false;
            }
            let mut code = 0u32;
            let ok = GetExitCodeProcess(handle, &mut code);
            CloseHandle(handle);
            ok != 0 && code == STILL_ACTIVE
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "windows")))]
    {
        let _ = pid;
        false
    }
}

fn acquire_single_instance() -> PathBuf {
    let dir = loom_dir();
    let _ = fs::create_dir_all(&dir);
    let lock = dir.join("desktop.lock");
    if let Ok(content) = fs::read_to_string(&lock) {
        if let Ok(pid) = content.trim().parse::<u32>() {
            if process_alive(pid) {
                eprintln!("[织界] 已有实例在运行（pid {pid}），本实例退出。");
                std::process::exit(0);
            }
        }
    }
    let _ = fs::write(&lock, std::process::id().to_string());
    lock
}

/// 引擎端口：默认 4317；LOOM_ENGINE_PORT 可覆盖（联调/自动化测试用）。
fn engine_port() -> u16 {
    std::env::var("LOOM_ENGINE_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(ENGINE_PORT)
}

fn port_open(port: u16) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn wait_for_port(port: u16, timeout_ms: u64) -> bool {
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    while Instant::now() < deadline {
        if port_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    false
}

fn no_console(command: &mut Command) {
    // GUI 壳拉起的 java/node/powershell/taskkill 不能弹控制台窗口，否则会闪窗并抢焦点。
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    {
        let _ = command;
    }
}

fn run_capture(command: &mut Command) -> (bool, String) {
    no_console(command);
    match command.output() {
        Ok(output) => {
            let mut text = String::from_utf8_lossy(&output.stdout).to_string();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            (output.status.success(), text.lines().collect::<Vec<_>>().join(" ").trim().to_string())
        }
        Err(error) => (false, error.to_string()),
    }
}

fn java_major(version_text: &str) -> Option<u32> {
    let marker = "version \"";
    let start = version_text.find(marker)? + marker.len();
    let rest = &version_text[start..];
    let mut digits = String::new();
    for ch in rest.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
        } else {
            break;
        }
    }
    let first: u32 = digits.parse().ok()?;
    if first == 1 {
        let second: String = rest.split('.').nth(1)?.chars().take_while(|c| c.is_ascii_digit()).collect();
        second.parse().ok()
    } else {
        Some(first)
    }
}

fn probe_java() -> Probe {
    let (ok, text) = run_capture(Command::new("java").arg("-version"));
    if !ok && text.is_empty() {
        return Probe {
            ok: false,
            detail: "没有找到 java 命令。".into(),
            hint: Some("安装 Java 25（Fedora：sudo dnf install java-25-openjdk）后点「重新检测」。".into()),
        };
    }
    let major = java_major(&text);
    let version = text.split_whitespace().take(3).collect::<Vec<_>>().join(" ");
    match major {
        Some(value) if value >= 25 => Probe { ok: true, detail: format!("Java {value} 已就绪（{version}）。"), hint: None },
        Some(value) => Probe {
            ok: false,
            detail: format!("检测到 Java {value}，但 Paper 26.1.2 需要 Java 25。"),
            hint: Some("安装 Java 25 后重新检测。".into()),
        },
        None => Probe { ok: false, detail: format!("无法识别 Java 版本：{version}"), hint: Some("在终端运行 java -version 确认安装。".into()) },
    }
}

fn probe_node() -> Probe {
    let (ok, text) = run_capture(Command::new("node").arg("--version"));
    if !ok {
        return Probe { ok: false, detail: "没有找到 node 命令。".into(), hint: Some("安装 Node 22+（引擎以 Node 子进程运行）。".into()) };
    }
    Probe { ok: true, detail: format!("Node {text} 已就绪。"), hint: None }
}

fn probe_prism(configured: Option<&str>) -> Probe {
    if let Some(command) = configured {
        if !command.trim().is_empty() {
            return Probe { ok: true, detail: format!("使用自定义 Prism 命令：{command}"), hint: None };
        }
    }
    if cfg!(target_os = "linux") {
        let (flatpak_ok, _) = run_capture(Command::new("flatpak").arg("--version"));
        if flatpak_ok {
            let (found, _) = run_capture(Command::new("flatpak").args(["info", "org.prismlauncher.PrismLauncher"]));
            if found {
                return Probe {
                    ok: true,
                    detail: "已找到 Prism Launcher（flatpak）。".into(),
                    hint: Some("在 Prism 里选 26.1.2 实例；建议设为无边框窗口或窗口化全屏（F11）。".into()),
                };
            }
            return Probe {
                ok: false,
                detail: "flatpak 已安装，但没有找到 Prism Launcher。".into(),
                hint: Some("flatpak install flathub org.prismlauncher.PrismLauncher，装好后点「重新检测」。".into()),
            };
        }
        let (which_ok, path) = run_capture(Command::new("sh").args(["-lc", "command -v prismlauncher || command -v PrismLauncher"]));
        if which_ok && !path.is_empty() {
            return Probe { ok: true, detail: format!("已找到 Prism：{path}"), hint: None };
        }
        return Probe {
            ok: false,
            detail: "没有找到 Prism Launcher。".into(),
            hint: Some("安装 Prism 后点「重新检测」；也可以手动打开 MC，织界会等待世界连接。".into()),
        };
    }
    // Windows：常见安装位置 / PATH 中的 prismlauncher.exe。
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(Path::new(&local).join("Programs/PrismLauncher/prismlauncher.exe"));
        candidates.push(Path::new(&local).join("PrismLauncher/prismlauncher.exe"));
    }
    if let Ok(program_files) = std::env::var("PROGRAMFILES") {
        candidates.push(Path::new(&program_files).join("PrismLauncher/prismlauncher.exe"));
    }
    for candidate in candidates {
        if candidate.exists() {
            return Probe { ok: true, detail: format!("已找到 Prism：{}", candidate.display()), hint: None };
        }
    }
    let (which_ok, path) = run_capture(Command::new("where").arg("prismlauncher.exe"));
    if which_ok && !path.is_empty() {
        Probe { ok: true, detail: format!("已找到 Prism：{path}"), hint: None }
    } else {
        Probe {
            ok: false,
            detail: "没有找到 Prism Launcher。".into(),
            hint: Some("安装 Prism 后点「重新检测」；也可以手动打开 MC，织界会等待世界连接。".into()),
        }
    }
}

fn probe_paper(repo_root: Option<&Path>, java_ok: bool) -> Probe {
    // 打包版带 runtime/real/paper；开发版也允许从仓库 runtime 目录探测。
    if let Some(root) = repo_root {
        let real = root.join("apps/desktop/src-tauri/runtime/real/paper");
        if real.join("paper.jar").exists() {
            return if port_open(MC_PORT) {
                Probe { ok: true, detail: "内置 Paper 世界已在运行（127.0.0.1:25565）。".into(), hint: None }
            } else {
                Probe { ok: true, detail: "内置 Paper 就绪，点「启动世界」起服。".into(), hint: Some("包内 Java/Paper，无需系统安装。".into()) }
            };
        }
    }
    let Some(root) = repo_root else {
        return Probe {
            ok: false,
            detail: "找不到仓库目录（scripts/mc-up.sh）。".into(),
            hint: Some("开发机请从仓库目录启动；打包版由 T4 附带 Paper 资源。".into()),
        };
    };
    let script = root.join("scripts/mc-up.sh");
    if !script.exists() {
        return Probe { ok: false, detail: format!("缺少 {}", script.display()), hint: Some("恢复 scripts/mc-up.sh 后重试。".into()) };
    }
    if port_open(MC_PORT) {
        return Probe { ok: true, detail: "Paper 世界已在运行（127.0.0.1:25565）。".into(), hint: None };
    }
    if !java_ok {
        return Probe { ok: false, detail: "Paper 脚本存在，但 Java 25 未就绪。".into(), hint: Some("先安装 Java 25。".into()) };
    }
    Probe {
        ok: true,
        detail: "Paper 脚本就绪；点「启动世界」起服（首次约 10–20 秒）。".into(),
        hint: Some("世界起好后织偶会自动连接；无需开浏览器。".into()),
    }
}

fn native_path(path: &Path) -> PathBuf {
    // Tauri 的 resource_dir 在 Windows 上会返回 \\?\D:\... 扩展路径。
    // Java 能接受，但 Node 的 argv 解析会把它误判成 D:（EISDIR: lstat 'D:'），必须还原普通路径。
    #[cfg(windows)]
    {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
            return PathBuf::from(format!(r"\\{rest}"));
        }
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            return PathBuf::from(rest);
        }
    }
    path.to_path_buf()
}

fn bundled_node_path(real: &Path) -> PathBuf {
    real.join("node")
        .join("bin")
        .join(if cfg!(windows) { "node.exe" } else { "node" })
}

fn bundled_java_path(real: &Path) -> PathBuf {
    real.join("java")
        .join("bin")
        .join(if cfg!(windows) { "java.exe" } else { "java" })
}

fn find_real_runtime(state: &AppState) -> Option<PathBuf> {
    let candidates = {
        let mut paths = vec![state.resource_dir().join("runtime").join("real")];
        if let Some(root) = &state.repo_root {
            paths.push(root.join("apps/desktop/src-tauri/runtime/real"));
        }
        paths
    };
    for candidate in candidates {
        if candidate.join("engine.mjs").exists() && bundled_node_path(&candidate).exists() {
            return Some(native_path(&candidate));
        }
    }
    None
}

fn probe_bundled_node(real: &Path) -> Probe {
    let node = bundled_node_path(real);
    if !node.exists() {
        return Probe { ok: false, detail: "包内缺少 Node 运行时。".into(), hint: Some("重新构建 runtime/real。".into()) };
    }
    let (ok, text) = run_capture(Command::new(&node).arg("--version"));
    if !ok {
        return Probe { ok: false, detail: "包内 Node 无法执行。".into(), hint: Some("检查 runtime/real/node/bin/node(.exe)。".into()) };
    }
    Probe { ok: true, detail: format!("包内 Node {text} 已就绪。"), hint: None }
}

fn probe_bundled_java(real: &Path) -> Probe {
    let java = bundled_java_path(real);
    if !java.exists() {
        return Probe { ok: false, detail: "包内缺少 Java 运行时。".into(), hint: Some("重新构建 runtime/real。".into()) };
    }
    let (ok, text) = run_capture(Command::new(&java).arg("-version"));
    if !ok && text.is_empty() {
        return Probe { ok: false, detail: "包内 Java 无法执行。".into(), hint: Some("检查 runtime/real/java/bin/java(.exe)。".into()) };
    }
    Probe { ok: true, detail: "包内 Java 25 已就绪。".into(), hint: None }
}

fn copy_dir_all(from: &Path, to: &Path) -> Result<(), String> {
    fs::create_dir_all(to).map_err(|error| error.to_string())?;
    let entries = fs::read_dir(from).map_err(|error| format!("读取运行时资源失败：{error}"))?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if source.is_dir() {
            copy_dir_all(&source, &target)?;
        } else {
            fs::copy(&source, &target).map_err(|error| format!("复制运行时文件失败：{error}"))?;
        }
    }
    Ok(())
}

/// 可写目录里的内置 Paper 路径。
fn bundled_paper_dir() -> PathBuf {
    loom_dir().join("runtime").join("paper")
}

/// task-16 P0：25565 上的 java 是否确实是我们拉起的 26.1.2 Paper，
/// 而不是用户自己的旧 Paper/其他服务端（端口开着不等于世界就绪）。
fn paper_owned_by_us(state: &AppState) -> bool {
    if child_alive(state, "paper") {
        return true;
    }
    let owned_dir = bundled_paper_dir().to_string_lossy().replace('\\', "/").to_ascii_lowercase();
    launcher::java_process_cmdlines().iter().any(|cmdline| {
        let normalized = cmdline.replace('\\', "/").to_ascii_lowercase();
        normalized.contains("paper.jar")
            && (normalized.contains(&owned_dir)
                || normalized.contains("loomcraft")
                || normalized.contains("the-loom")
                || normalized.contains("the loom"))
    })
}

fn spawn_bundled_paper(state: &AppState) -> Result<OpStatus, String> {
    if port_open(MC_PORT) {
        if paper_owned_by_us(state) {
            return Ok(OpStatus { ok: true, detail: "内置 Paper 世界已在运行（127.0.0.1:25565）。".into() });
        }
        return Err(
            "25565 端口已被其他服务端占用（不是内置 26.1.2 Paper）。请先关闭旧 Paper/其他服务端，再点「重试启动世界」；织界不会自动杀它。"
                .into(),
        );
    }
    // 幂等（P0-1/P1-8）：已有存活的 Paper 子进程时绝不再次 spawn（防止同目录第二个 java/抢 session.lock）。
    if child_alive(state, "paper") {
        return Ok(OpStatus { ok: true, detail: "世界服务端已在启动中（进程存活），等待 25565 就绪。".into() });
    }
    let Some(real) = find_real_runtime(state) else {
        return Err("安装包内没有真实运行时（runtime/real）。".into());
    };
    let source_paper = real.join("paper");
    let paper_dir = loom_dir().join("runtime").join("paper");
    // 世界布局版本：场景/重置语义升级后，老用户可写世界可能残留上一版的关卡方块与实体。
    // 这里用包内 marker 与可写目录 marker 对比，不一致就换一份干净世界（进度/星级不存于世界）。
    let bundled_world_version = fs::read_to_string(source_paper.join("world").join(".loom-world-version"))
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let current_world_version = fs::read_to_string(paper_dir.join("world").join(".loom-world-version"))
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let missing_runtime = !paper_dir.join("paper.jar").exists() || !paper_dir.join("world").exists();
    let stale_world = !bundled_world_version.is_empty() && current_world_version != bundled_world_version;
    // AppImage 的挂载点只读；Paper 需要写 world/session.lock、日志、server.properties。
    if missing_runtime || stale_world {
        if paper_dir.exists() {
            let _ = fs::remove_dir_all(&paper_dir);
        }
        state.log(
            "lifecycle",
            if missing_runtime {
                "首次启动：复制内置 Paper 世界到可写目录"
            } else {
                "世界布局升级：换成包内干净世界（旧关卡残留会污染 sandbox）"
            },
        );
        copy_dir_all(&source_paper, &paper_dir)?;
        for world in ["world", "world_nether", "world_the_end"] {
            let _ = fs::remove_file(paper_dir.join(world).join("session.lock"));
        }
    }
    // 新版本插件/性能配置要覆盖到已存在的可写世界，否则老用户永远用旧 plugin。
    let _ = fs::create_dir_all(paper_dir.join("plugins"));
    for rel in ["plugins/loomcraft-plugin.jar", "server.properties"] {
        let from = source_paper.join(rel);
        if from.exists() {
            let _ = fs::copy(&from, paper_dir.join(rel));
        }
    }
    let java = bundled_java_path(&real);
    let jar = paper_dir.join("paper.jar");
    if !java.exists() || !jar.exists() {
        return Err("安装包缺少 Java/Paper 运行时。".into());
    }
    let _ = fs::create_dir_all(&state.logs_dir);
    let log_file = File::create(state.logs_dir.join("paper.log")).map_err(|error| error.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
    let mut paper_command = Command::new(&java);
    paper_command
        .args(["-Xms384M", "-Xmx1024M", "-XX:+UseG1GC", "-jar", "paper.jar", "--nogui"])
        .current_dir(&paper_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    no_console(&mut paper_command);
    let child = paper_command
        .spawn()
        .map_err(|error| format!("启动内置 Paper 失败：{error}"))?;
    state.children.lock().map_err(|_| "子进程状态锁失效".to_string())?.insert("paper".into(), child);
    state.log("lifecycle", "启动内置 Paper（包内 Java + paper.jar）");
    Ok(OpStatus { ok: true, detail: "内置 Paper 正在启动（首次约 10–20 秒）。".into() })
}

fn find_engine_script(state: &AppState) -> Option<PathBuf> {
    let resource_dir = state.resource_dir();
    let mut candidates = vec![resource_dir.join("runtime").join("engine.cjs"), resource_dir.join("engine.cjs")];
    if let Some(root) = &state.repo_root {
        candidates.push(root.join("apps/desktop/src-tauri/runtime/engine.cjs"));
        candidates.push(root.join("apps/desktop/runtime/engine.cjs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("engine.cjs"));
            candidates.push(dir.join("runtime/engine.cjs"));
        }
    }
    candidates.into_iter().find(|path| path.exists())
}

fn find_repo_root() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("LOOM_REPO_ROOT") {
        let path = PathBuf::from(value);
        if path.join("scripts/mc-up.sh").exists() {
            return Some(path);
        }
    }
    let mut starts: Vec<PathBuf> = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        starts.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            starts.push(dir.to_path_buf());
        }
    }
    for start in starts {
        let mut cursor = Some(start.as_path());
        while let Some(dir) = cursor {
            if dir.join("scripts/mc-up.sh").exists() {
                return Some(dir.to_path_buf());
            }
            cursor = dir.parent();
        }
    }
    None
}

fn spawn_engine_child(state: &AppState) -> Result<OpStatus, String> {
    if port_open(engine_port()) {
        return Ok(OpStatus { ok: true, detail: format!("引擎已在运行（127.0.0.1:{}）。", engine_port()) });
    }
    // 幂等（P0-1）：已有存活的 engine 子进程时不再 spawn 第二个。
    if child_alive(state, "engine") {
        return Ok(OpStatus { ok: true, detail: format!("织机进程已在启动中，等待 127.0.0.1:{} 就绪。", engine_port()) });
    }
    // 打包版优先启动包内真实引擎（Node + bot + 真实 Paper 适配器）。
    if let Some(real) = find_real_runtime(state) {
        let node = bundled_node_path(&real);
        let engine = real.join("engine.mjs");
        #[cfg(target_os = "linux")]
        let lib = real.join("node/lib");
        state.log(
            "lifecycle",
            &format!(
                "engine spawn node={} engine={} cwd={} resource={}",
                node.display(),
                engine.display(),
                real.display(),
                state.resource_dir().display()
            ),
        );
        let _ = fs::create_dir_all(&state.logs_dir);
        let log_file = File::create(state.logs_dir.join("engine.log")).map_err(|error| format!("创建引擎日志失败：{error}"))?;
        let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
        let mut command = Command::new(&node);
        command
            .arg(&engine)
            .current_dir(&real)
            .env("PORT", engine_port().to_string())
            .env("LOOM_WORLD", "paper")
            .env("LOOM_MC_WAIT_MS", "60000")
            .env("LOOM_BOT_NAME", "Golem")
            .env("NODE_PATH", real.join("node_modules"))
            .env("LOOM_STUDIO_DIR", real.join("studio"))
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err));
        #[cfg(target_os = "linux")]
        command.env("LD_LIBRARY_PATH", &lib);
        no_console(&mut command);
        let child = command.spawn().map_err(|error| format!("启动内置真实引擎失败：{error}"))?;
        state.children.lock().map_err(|_| "子进程状态锁失效".to_string())?.insert("engine".into(), child);
        return Ok(OpStatus { ok: true, detail: format!("开箱真实引擎已启动：127.0.0.1:{}", engine_port()) });
    }
    let engine = find_engine_script(state).ok_or_else(|| "找不到 engine.cjs（先运行 npm run desktop:assets）。".to_string())?;
    if !run_capture(Command::new("node").arg("--version")).0 {
        return Err("没有 node 运行时，无法启动引擎。".into());
    }
    let _ = fs::create_dir_all(&state.logs_dir);
    let log_file = File::create(state.logs_dir.join("engine.log")).map_err(|error| format!("创建引擎日志失败：{error}"))?;
    let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
    let cwd = state.repo_root.clone().unwrap_or_else(|| engine.parent().map(Path::to_path_buf).unwrap_or_default());
    let mut command = Command::new("node");
    command
        .arg(&engine)
        .current_dir(&cwd)
        .env("PORT", engine_port().to_string())
        .env("NODE_PATH", cwd.join("node_modules"))
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err));
    if !port_open(engine_port()) {
        no_console(&mut command);
        let child = command.spawn().map_err(|error| format!("启动引擎失败：{error}"))?;
        if let Ok(mut children) = state.children.lock() {
            children.insert("engine".into(), child);
        }
    }
    Ok(OpStatus { ok: true, detail: "引擎进程已拉起，正在等待 4317 就绪…".into() })
}

fn kill_children(state: &AppState) {
    if let Ok(mut children) = state.children.lock() {
        // 先停 engine，再给 Paper 通过 stdin 发 stop 让世界落盘（Windows/Linux 一致，P1-1）；最后才强杀/清进程树。
        for name in ["engine", "paper"] {
            let Some(child) = children.get_mut(name) else { continue; };
            let pid = child.id();
            state.log("lifecycle", &format!("停止子进程 {name}（pid {pid}）"));
            // P1-1：Windows/Linux 都先通过 stdin 发 stop，让 Paper 落盘后再（必要时）强杀。
            if name == "paper" {
                if let Some(stdin) = child.stdin.as_mut() {
                    let _ = stdin.write_all(b"stop\n");
                    let _ = stdin.flush();
                }
                let deadline = Instant::now() + Duration::from_secs(8);
                loop {
                    if matches!(child.try_wait(), Ok(Some(_))) {
                        break;
                    }
                    if Instant::now() >= deadline {
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(200));
                }
            }
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(target_os = "windows")]
            {
                let pid_text = pid.to_string();
                let mut taskkill = Command::new("taskkill");
                taskkill.args(["/PID", &pid_text, "/T", "/F"]);
                no_console(&mut taskkill);
                let _ = taskkill.output();
            }
        }
        // 其它子进程（直接启动的 Minecraft、Prism 等）直接回收。
        for (name, child) in children.iter_mut() {
            if name == "engine" || name == "paper" {
                continue;
            }
            let pid = child.id();
            state.log("lifecycle", &format!("停止子进程 {name}（pid {pid}）"));
            let _ = child.kill();
            let _ = child.wait();
            #[cfg(target_os = "windows")]
            {
                let pid_text = pid.to_string();
                let mut taskkill = Command::new("taskkill");
                taskkill.args(["/PID", &pid_text, "/T", "/F"]);
                no_console(&mut taskkill);
                let _ = taskkill.output();
            }
        }
        children.clear();
    }
}

// ---------------- L0 启动编排（P0-1：锁覆盖到端口就绪） ----------------

/// 子进程是否仍存活；已退出则顺手从表里移除。
fn child_alive(state: &AppState, name: &str) -> bool {
    match state.children.lock() {
        Ok(mut children) => match children.get_mut(name) {
            Some(child) => match child.try_wait() {
                Ok(Some(_)) => {
                    children.remove(name);
                    false
                }
                Ok(None) => true,
                Err(_) => {
                    children.remove(name);
                    false
                }
            },
            None => false,
        },
        Err(_) => false,
    }
}

/// 等端口就绪；子进程中途退出立刻失败（不再让锁被过早释放）。
fn wait_port_or_exit(state: &AppState, name: &str, port: u16, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    loop {
        if port_open(port) {
            return Ok(());
        }
        if !child_alive(state, name) {
            // 进程刚退出时端口可能刚关闭：再确认一次。
            if port_open(port) {
                return Ok(());
            }
            return Err(format!("{name} 进程已退出，端口 {port} 未就绪；查看「打开日志目录」里的日志。"));
        }
        if Instant::now() >= deadline {
            // 进程仍在（慢机器首次解压/加载）：保留它，报可重试错误，避免杀半启动的服务器。
            return Err(format!(
                "{name} 启动超时（{port} 未就绪，进程仍在后台启动）；稍后刷新或重试即可，不会重复启动。"
            ));
        }
        std::thread::sleep(Duration::from_millis(400));
    }
}

/// Paper：spawn 幂等 + 等端口（锁由调用方持有）。
fn start_paper_wait(state: &AppState) -> Result<(), String> {
    if port_open(MC_PORT) {
        // task-16：端口开着但如果不是内置 26.1.2 Paper，不能当作“世界就绪”。
        if paper_owned_by_us(state) {
            state.set_error("paper", None);
            return Ok(());
        }
        return Err(
            "25565 端口已被其他服务端占用（不是内置 26.1.2 Paper）。请先关闭旧 Paper/其他服务端，再点「重试启动世界」；织界不会自动杀它。"
                .into(),
        );
    }
    if !child_alive(state, "paper") {
        let status = spawn_paper_any(state)?;
        state.log("lifecycle", &format!("启动世界：{}", status.detail));
    }
    wait_port_or_exit(state, "paper", MC_PORT, Duration::from_secs(150))?;
    state.set_error("paper", None);
    Ok(())
}

/// Engine：spawn 幂等 + 等端口（锁由调用方持有）。
fn start_engine_wait(state: &AppState) -> Result<(), String> {
    if port_open(engine_port()) {
        state.set_error("engine", None);
        return Ok(());
    }
    if !child_alive(state, "engine") {
        let status = spawn_engine_child(state)?;
        state.log("lifecycle", &format!("启动织机：{}", status.detail));
    }
    wait_port_or_exit(state, "engine", engine_port(), Duration::from_secs(45))?;
    state.set_error("engine", None);
    Ok(())
}

/// 织偶重试：重启 engine 并等 bot.connected（P1-7）。
fn restart_bot_wait(state: &AppState) -> Result<(), String> {
    let (session_active, _) = state.session_snapshot();
    if session_active {
        return Err("关卡进行中不能重启织机（会丢当前会话）；请先回到 L0 再重试织偶。".into());
    }
    // 只重启 engine（Paper 不动）。
    if let Ok(mut children) = state.children.lock() {
        if let Some(mut child) = children.remove("engine") {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    state.set_error("bot", None);
    state.set_error("engine", None);
    std::thread::sleep(Duration::from_millis(600));
    if port_open(engine_port()) {
        // 老进程可能还占着端口：等它释放，超时则报错（不重复 spawn）。
        let deadline = Instant::now() + Duration::from_secs(10);
        while port_open(engine_port()) && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(300));
        }
    }
    start_engine_wait(state)?;
    let deadline = Instant::now() + Duration::from_secs(90);
    loop {
        if let Some(health) = envstate::read_engine_health(engine_port()) {
            if health.bot_connected {
                state.set_error("bot", None);
                return Ok(());
            }
        }
        if !child_alive(state, "engine") {
            return Err("织机在重启后退出，织偶未连接；查看日志目录。".into());
        }
        if Instant::now() >= deadline {
            return Err("织机已启动，但织偶 90 秒内没有进服；检查 Paper/插件日志或点「重启织偶」再试。".into());
        }
        std::thread::sleep(Duration::from_millis(700));
    }
}

/// 保存窗口几何前先看是否全屏/最大化（task-17：最大化/全屏时不要把屏幕尺寸写进普通窗口几何）。
fn save_geometry_if_windowed(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
            return;
        }
    }
    save_window_geometry(app, true);
}

/// Ctrl+Shift+F 兜底（P0-2/P1-11）：全屏→退出全屏；伴玩→回工作台；最小化→还原。
fn restore_safety(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<AppState>();
    if window.is_fullscreen().unwrap_or(false) {
        let _ = window.set_fullscreen(false);
        let info = window_state_of(&window);
        let _ = window.emit("loom://window-state", info);
        state.log("window", "Ctrl+Shift+F：退出全屏");
        return;
    }
    let companion = state.settings.lock().map(|settings| settings.mode == "companion").unwrap_or(false);
    if companion {
        let _ = apply_mode(&window, "workbench");
        if let Ok(mut settings) = state.settings.lock() {
            settings.mode = "workbench".into();
        }
        state.save();
        let _ = window.emit("loom://mode", "workbench");
        let _ = window.emit("loom://restore-companion", ());
        state.log("window", "Ctrl+Shift+F：伴玩模式退出 → 工作台");
        return;
    }
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    state.log("window", "Ctrl+Shift+F：还原/聚焦窗口");
}

fn default_focus_follow() -> bool { true }

fn set_pin_internal(app: &tauri::AppHandle, value: bool) -> Result<bool, String> {
    let Some(window) = app.get_webview_window("main") else {
        return Err("主窗口不存在".into());
    };
    window.set_always_on_top(value).map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    if let Ok(mut settings) = state.settings.lock() {
        settings.always_on_top = value;
    }
    state.save();
    state.log("window", &format!("置顶 = {value}"));
    let _ = window.emit("loom://pin", value);
    Ok(value)
}

fn toggle_pin_internal(app: &tauri::AppHandle) -> Result<bool, String> {
    let current = app
        .state::<AppState>()
        .settings
        .lock()
        .map(|settings| settings.always_on_top)
        .unwrap_or(false);
    set_pin_internal(app, !current)
}

fn apply_mode(window: &WebviewWindow, mode: &str) -> Result<(), String> {
    // P1-11：进伴玩/工作台前先退出全屏，否则小窗/工作台按钮在无系统框的全屏里可能看不见。
    if window.is_fullscreen().unwrap_or(false) {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
    }
    let companion = mode == "companion";
    let (width, height) = if companion { (COMPANION_WIDTH, COMPANION_HEIGHT) } else { (WORKBENCH_WIDTH, WORKBENCH_HEIGHT) };
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width as f64, height as f64)))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
    // task-17：小屏/窄工作区上 1280×840 或 420×620 也不能超出工作区。
    clamp_window_to_work_area(window, None);
    Ok(())
}

// ---------------- Tauri 命令 ----------------

#[tauri::command]
fn get_settings(app: tauri::AppHandle) -> Settings {
    let state = app.state::<AppState>();
    let mut settings = state.settings.lock().map(|guard| guard.clone()).unwrap_or_default();
    settings.last_save = None;
    settings
}

#[tauri::command]
fn save_settings(app: tauri::AppHandle, settings: Settings) {
    let state = app.state::<AppState>();
    if let Ok(mut stored) = state.settings.lock() {
        stored.always_on_top = settings.always_on_top;
        stored.focus_follow = settings.focus_follow;
        stored.mode = settings.mode;
        stored.page = settings.page;
        // P0-4 第二道防线：即使调用方绕过壳白名单，也拒绝携带 shell 元字符的启动器命令。
        stored.prism_command = settings
            .prism_command
            .as_deref()
            .and_then(launcher::sanitize_program_setting);
        stored.minecraft_dir = settings.minecraft_dir;
        stored.mc_version = settings.mc_version;
        stored.mc_username = settings.mc_username;
    }
    state.save();
}

#[tauri::command]
fn window_start_drag(window: WebviewWindow) -> Result<(), String> {
    window.start_dragging().map_err(|error| error.to_string())
}

#[tauri::command]
fn window_minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

/// 窗口状态快照（壳顶栏还原/全屏按钮与双击标题栏共用；事件 loom://window-state）。
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WindowStateInfo {
    fullscreen: bool,
    maximized: bool,
    visible: bool,
}

fn window_state_of(window: &WebviewWindow) -> WindowStateInfo {
    WindowStateInfo {
        fullscreen: window.is_fullscreen().unwrap_or(false),
        maximized: window.is_maximized().unwrap_or(false),
        visible: window.is_visible().unwrap_or(true),
    }
}

fn emit_window_state(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = app.emit("loom://window-state", window_state_of(&window));
    }
}

#[tauri::command]
fn window_state(window: WebviewWindow) -> WindowStateInfo {
    window_state_of(&window)
}

/// 全屏/退出全屏。任务-8：无论从哪里进入全屏，都必须有回到窗口态的路径。
#[tauri::command]
fn window_toggle_fullscreen(window: WebviewWindow) -> Result<WindowStateInfo, String> {
    let next = !window.is_fullscreen().map_err(|error| error.to_string())?;
    window.set_fullscreen(next).map_err(|error| error.to_string())?;
    let info = window_state_of(&window);
    let _ = window.emit("loom://window-state", info.clone());
    Ok(info)
}

/// 还原窗口：先退出全屏，再取消最大化；返回普通窗口态（保留可见/可操作）。
#[tauri::command]
fn window_restore_main(window: WebviewWindow) -> Result<WindowStateInfo, String> {
    if window.is_fullscreen().map_err(|error| error.to_string())? {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
    }
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
    }
    // task-17：取消最大化/全屏后，OS 恢复的普通窗口也可能落在屏幕外/超出工作区。
    clamp_window_to_work_area(&window, None);
    let info = window_state_of(&window);
    let _ = window.emit("loom://window-state", info.clone());
    Ok(info)
}

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<WindowStateInfo, String> {
    // 全屏状态下「最大化/还原」语义是「先退出全屏」，避免按钮看起来没反应。
    if window.is_fullscreen().map_err(|error| error.to_string())? {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
    } else if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())?;
    } else {
        window.maximize().map_err(|error| error.to_string())?;
    }
    let info = window_state_of(&window);
    let _ = window.emit("loom://window-state", info.clone());
    Ok(info)
}

#[tauri::command]
fn window_close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_pin(app: tauri::AppHandle) -> Result<bool, String> {
    toggle_pin_internal(&app)
}

#[tauri::command]
fn set_pin(app: tauri::AppHandle, value: bool) -> Result<bool, String> {
    set_pin_internal(&app, value)
}

#[tauri::command]
fn focus_workbench(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        // 显式双向切换：织界在前 → 交给 Minecraft；Minecraft 在前 → Escape 松鼠标 + 拉起织界。
        // X11 的精确窗口查找只在 Linux 编译；Windows 先退化为最小化/还原，MC 侧用 Alt+Tab。
        if window.is_focused().unwrap_or(false) {
            #[cfg(target_os = "linux")]
            {
                if let Some(display) = x11_focus::DisplayHandle::open() {
                    if display.focus_minecraft() {
                        return;
                    }
                }
            }
            #[cfg(target_os = "windows")]
            {
                if win_focus::focus_minecraft() {
                    return;
                }
            }
            let _ = window.minimize();
            return;
        }
        #[cfg(target_os = "linux")]
        {
            if let Some(display) = x11_focus::DisplayHandle::open() {
                display.send_escape();
            }
        }
        #[cfg(target_os = "windows")]
        {
            win_focus::send_escape();
        }
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        let _ = window.emit("loom://focus-workbench", ());
    }
}

#[tauri::command]
fn snap_half(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "找不到主窗口".to_string())?;
    let monitor = window.current_monitor().map_err(|error| error.to_string())?.ok_or_else(|| "找不到当前显示器".to_string())?;
    let size = monitor.size();
    let position = monitor.position();
    window.set_always_on_top(true).map_err(|error| error.to_string())?;
    window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(size.width / 2, size.height))).map_err(|error| error.to_string())?;
    window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(position.x, position.y))).map_err(|error| error.to_string())?;
    let state = app.state::<AppState>();
    if let Ok(mut settings) = state.settings.lock() { settings.always_on_top = true; }
    state.save();
    state.log("window", "半屏布局：左半屏 + 置顶");
    Ok(())
}

#[tauri::command]
fn show_main_window(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        // task-17：窗口真正显示后再做一次物理 clamp（DPI/外框以显示后的真实值为准），
        // 并把修正后的几何写回，避免下次启动继续用超屏坐标。
        clamp_window_to_work_area(&window, Some(&app));
        save_geometry_if_windowed(&app);
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn engine_ready() -> bool {
    port_open(engine_port())
}

#[tauri::command]
fn set_webview_zoom(window: tauri::WebviewWindow, scale: f64) -> Result<(), String> {
    window.set_zoom(scale).map_err(|error| error.to_string())
}

#[tauri::command]
fn set_mode(app: tauri::AppHandle, mode: String) -> Result<bool, String> {
    let normalized = if mode == "companion" { "companion" } else { "workbench" };
    let Some(window) = app.get_webview_window("main") else {
        return Err("主窗口不存在".into());
    };
    apply_mode(&window, normalized)?;
    let state = app.state::<AppState>();
    if let Ok(mut settings) = state.settings.lock() {
        settings.mode = normalized.to_string();
    }
    state.save();
    let _ = window.emit("loom://mode", normalized);
    Ok(true)
}

#[tauri::command]
fn env_probe(app: tauri::AppHandle) -> EnvReport {
    let state = app.state::<AppState>();
    let real = find_real_runtime(&state);
    let java = match real.as_deref() {
        Some(runtime) => probe_bundled_java(runtime),
        None => probe_java(),
    };
    let node = match real.as_deref() {
        Some(runtime) => probe_bundled_node(runtime),
        None => probe_node(),
    };
    let prism_command = state.settings.lock().ok().and_then(|guard| guard.prism_command.clone());
    let prism = probe_prism(prism_command.as_deref());
    let paper = if real.is_some() {
        if port_open(MC_PORT) {
            Probe { ok: true, detail: "内置 Paper 世界已在运行（127.0.0.1:25565）。".into(), hint: None }
        } else {
            Probe { ok: true, detail: "包内 Java + Paper 已就绪；启动时会自动拉起。".into(), hint: Some("无需系统 Java/Paper。".into()) }
        }
    } else {
        probe_paper(state.repo_root.as_deref(), java.ok)
    };
    let engine = match find_engine_script(&state) {
        Some(path) if node.ok => Probe { ok: true, detail: format!("引擎可执行：{}", path.display()), hint: None },
        Some(path) => Probe { ok: false, detail: format!("找到引擎但没有 node：{}", path.display()), hint: Some("安装 Node 22+ 后重试。".into()) },
        None => Probe {
            ok: false,
            detail: "没有找到 engine.cjs。".into(),
            hint: Some("开发机先运行 npm run desktop:assets；打包版检查 resources。".into()),
        },
    };
    EnvReport {
        java,
        node,
        prism,
        paper,
        engine,
        repo_root: state.repo_root.as_ref().map(|path| path.display().to_string()),
    }
}

#[tauri::command]
async fn start_engine(app: tauri::AppHandle) -> Result<OpStatus, String> {
    {
        let state = app.state::<AppState>();
        spawn_engine_child(&state)?;
        state.log("lifecycle", "已请求启动 engine sidecar");
    }
    let started = tauri::async_runtime::spawn_blocking(move || wait_for_port(engine_port(), 10_000))
        .await
        .map_err(|error| format!("启动任务失败：{error}"))?;
    if !started {
        return Err("引擎 10 秒内没有响应；查看 ~/.loomcraft/logs/engine.log".into());
    }
    Ok(OpStatus { ok: true, detail: format!("引擎已启动：127.0.0.1:{}", engine_port()) })
}

#[tauri::command]
fn stop_engine(app: tauri::AppHandle) -> Result<OpStatus, String> {
    let state = app.state::<AppState>();
    let child = state.children.lock().map_err(|_| "子进程状态锁失效".to_string())?.remove("engine");
    match child {
        Some(mut child) => {
            let _ = child.kill();
            let _ = child.wait();
            state.log("lifecycle", "停止 engine");
            Ok(OpStatus { ok: true, detail: "引擎已停止。".into() })
        }
        None => Ok(OpStatus { ok: true, detail: "引擎未在运行（由本应用管理）。".into() }),
    }
}

#[tauri::command]
fn start_paper(app: tauri::AppHandle) -> Result<OpStatus, String> {
    let state = app.state::<AppState>();
    if find_real_runtime(&state).is_some() {
        return spawn_bundled_paper(&state);
    }
    let Some(root) = state.repo_root.clone() else {
        return Err("找不到仓库目录，无法启动 Paper 世界。".into());
    };
    if port_open(MC_PORT) {
        return Ok(OpStatus { ok: true, detail: "世界已在运行（127.0.0.1:25565）。".into() });
    }
    let script = root.join("scripts/mc-up.sh");
    if !script.exists() {
        return Err(format!("缺少 {}", script.display()));
    }
    let _ = fs::create_dir_all(&state.logs_dir);
    let log_file = File::create(state.logs_dir.join("paper.log")).map_err(|error| error.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
    let child = Command::new("bash")
        .arg(&script)
        .current_dir(&root)
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err))
        .spawn()
        .map_err(|error| format!("启动世界失败：{error}"))?;
    state.children.lock().map_err(|_| "子进程状态锁失效".to_string())?.insert("paper".into(), child);
    state.log("lifecycle", &format!("启动 Paper：{}", script.display()));
    Ok(OpStatus { ok: true, detail: "Paper 正在启动（首次约 10–20 秒），就绪后织偶会自动连接。".into() })
}

#[tauri::command]
fn launch_prism(app: tauri::AppHandle) -> Result<OpStatus, String> {
    // P0-4：旧命令也走安全适配层（自定义命令直启 exe，不经过 cmd /C start / sh -lc）。
    let state = app.state::<AppState>();
    let context = state.build_launch_context(None, None);
    let outcome = launcher::launch_prism_only(&context);
    state.log("launcher", &format!("launch_prism：{}", outcome.detail));
    Ok(OpStatus { ok: outcome.ok || outcome.needs_manual, detail: outcome.detail })
}

#[tauri::command]
fn client_running() -> bool {
    launcher::client_process_running()
}

// ============================================================================
// L0/L1/L2：四灯 EnvState + 全局启动锁 + 客户端启动器适配
//
// 契约（同时写进 docs/55-launcher-env-contract.md，Studio/壳共用）：
//   命令：env_state / env_refresh / env_autostart / env_start / env_retry
//         launch_client / restart_client_and_reconnect
//         set_game_session / clear_game_session / quit_game / open_launcher_download
//   事件：loom://env（四灯快照）、loom://quit-requested（窗口 X/Alt+F4，需红色确认）
//         loom://client-restored（L2 一键重连成功）、loom://client-failed
// ============================================================================

/// 启动世界服务端：打包版走内置 runtime；开发机（无打包 runtime）退回 scripts/mc-up.sh。
fn spawn_paper_any(state: &AppState) -> Result<OpStatus, String> {
    match spawn_bundled_paper(state) {
        Ok(status) => Ok(status),
        Err(error) => {
            if let Some(root) = state.repo_root.as_ref() {
                let script = root.join("scripts/mc-up.sh");
                if script.exists() {
                    let _ = fs::create_dir_all(&state.logs_dir);
                    let log_file = File::create(state.logs_dir.join("paper.log")).map_err(|cause| cause.to_string())?;
                    let log_file_err = log_file.try_clone().map_err(|cause| cause.to_string())?;
                    let child = Command::new("bash")
                        .arg(&script)
                        .current_dir(root)
                        .stdout(Stdio::from(log_file))
                        .stderr(Stdio::from(log_file_err))
                        .spawn()
                        .map_err(|cause| format!("{error}；开发脚本 scripts/mc-up.sh 也启动失败：{cause}"))?;
                    if let Ok(mut children) = state.children.lock() {
                        children.insert("paper".into(), child);
                    }
                    state.log("lifecycle", "开发模式：通过 scripts/mc-up.sh 启动世界");
                    return Ok(OpStatus {
                        ok: true,
                        detail: "开发模式：已通过 scripts/mc-up.sh 启动世界（首次约 10–20 秒）。".into(),
                    });
                }
            }
            Err(error)
        }
    }
}

/// 由「主进程事实」组装四灯快照（监视线程每 2 秒一次；命令 env_refresh 立即一次）。
/// task-16 P0：客户端/服务端都做版本门控，任何不匹配都不能绿、不能 allReady。
fn build_env_state(
    state: &AppState,
    client_probe: launcher::ClientProbe,
    health: Option<envstate::EngineHealth>,
) -> envstate::EnvState {
    let launching = state.starting_snapshot();
    let errors = state.errors.lock().map(|guard| guard.clone()).unwrap_or_default();
    let (session_active, _session) = state.session_snapshot();
    let client_guide = state.client_guide.lock().ok().and_then(|guard| guard.clone());
    let client_adapter = state.last_client_adapter.lock().ok().and_then(|guard| guard.clone());
    let expected = launcher::DEFAULT_MC_VERSION;
    let client_running = client_probe.running;
    let client_version = client_probe.version.clone();
    let other_client_version = client_probe.other_version().map(str::to_string);
    let client_compatible = client_probe.compatible(expected);
    // task-18：记住 26.1.x 客户端的 .minecraft，direct 启动优先复用（产品自管客户端）。
    if client_compatible {
        if let Some(game_dir) = client_probe.game_dir.as_ref() {
            let path = game_dir.display().to_string();
            if let Ok(mut stored) = state.client_game_dir.lock() {
                *stored = Some(path.clone());
            }
            // 首次检测到产品客户端且用户没显式配置时，把它写进设置，重启后 direct 也能找到。
            let mut persist = false;
            if let Ok(mut settings) = state.settings.lock() {
                if settings
                    .minecraft_dir
                    .as_deref()
                    .map(str::trim)
                    .filter(|value| !value.is_empty())
                    .is_none()
                {
                    settings.minecraft_dir = Some(path);
                    persist = true;
                }
            }
            if persist {
                state.save();
            }
        }
    }
    let paper_port_open = port_open(MC_PORT);
    let engine_ready = health.as_ref().map(|value| value.ok).unwrap_or(false);
    let bot_ready = health.as_ref().map(|value| value.bot_connected).unwrap_or(false);
    let mock = health.as_ref().map(|value| value.mock).unwrap_or(false);
    let server_version = health
        .as_ref()
        .filter(|value| value.mc_connected)
        .map(|value| value.mc_version.trim().to_string())
        .filter(|value| !value.is_empty());
    let server_compatible = mock
        || server_version
            .as_deref()
            .map(|value| launcher::client_version_compatible(Some(value), expected))
            .unwrap_or(false);
    let paper_confirmed = mock || (health.as_ref().map(|value| value.mc_connected).unwrap_or(false) && server_compatible);
    if !engine_ready || !paper_confirmed || bot_ready {
        if let Ok(mut since) = state.bot_pending_since.lock() {
            *since = None;
        }
    } else if let Ok(mut since) = state.bot_pending_since.lock() {
        if since.is_none() {
            *since = Some(Instant::now());
        }
    }
    let bot_stalled = state
        .bot_pending_since
        .lock()
        .ok()
        .and_then(|since| *since)
        .map(|started| started.elapsed() >= Duration::from_millis(BOT_STALL_MS))
        .unwrap_or(false);
    let launch_context = state.build_launch_context(None, None);
    // task-20：本机是否已有可用 26.1.2 安装（「启动 26.1.2」/「准备 26.1.2」入口）。
    let existing_install = if !mock && !client_compatible {
        launcher::find_existing_client_install(&launch_context)
    } else {
        None
    };
    let client_install_dir = existing_install.as_ref().map(|install| install.dir.display().to_string());
    let client_prepare_available = !mock && !client_compatible && existing_install.is_none();
    let input = envstate::PollInput {
        engine_health: health.as_ref(),
        paper_port_open,
        client_running,
        client_version: client_version.clone(),
        other_client_version: other_client_version.clone(),
        expected_version: expected,
        client_install_dir: client_install_dir.clone(),
        launching: &launching,
        errors: &errors,
        client_guide: client_guide.clone(),
        client_adapter: client_adapter.clone(),
        bot_stalled,
    };
    let (engine, paper, bot, client) = envstate::poll_lights(&input);
    let paper_ok = mock || paper.state == envstate::STATE_READY;
    let bot_ok = mock || bot.state == envstate::STATE_READY;
    let client_ok = mock || client_compatible;
    let seen_ready = state.client_seen_ready.lock().map(|value| *value).unwrap_or(false);
    let client_version_mismatch = !mock && client_running && !client_compatible;
    let usable_client = client_running && client_compatible;
    let (client, client_lost, next_seen_ready) = envstate::apply_client_loss(envstate::ClientLossInput {
        mock,
        engine_ready,
        client_running: usable_client,
        session_active,
        seen_ready,
        client,
        guide: client_guide.clone(),
        client_version_mismatch,
    });
    if let Ok(mut seen) = state.client_seen_ready.lock() {
        *seen = next_seen_ready;
    }
    // 客户端第一次就绪：把游戏窗口抬到前台（Linux X11/XWayland 或 KDE KWin script）。
    if !seen_ready && next_seen_ready && client.state == envstate::STATE_READY {
        focus_client_window();
    }
    if let Ok(mut lost) = state.client_lost.lock() {
        *lost = client_lost;
    }
    // task-16：版本不匹配（含「运行中但读不到版本」、服务端连上但版本未知）都算 blocked。
    let version_blocked = !mock
        && (client_version_mismatch
            || (health.as_ref().map(|value| value.mc_connected).unwrap_or(false) && !server_compatible));
    let all_ready = engine_ready && paper_ok && bot_ok && client_ok && !client_lost && !version_blocked;
    let (minecraft_dir, _versions) = launcher::detect_minecraft_dir(&launch_context);
    let minecraft_dir = client_install_dir.as_ref().map(PathBuf::from).or(minecraft_dir);
    envstate::EnvState {
        engine,
        paper,
        bot,
        client,
        all_ready,
        launching,
        client_lost,
        session_active,
        client_adapter,
        client_available_launcher: client_guide,
        client_version,
        other_client_version,
        server_version,
        expected_version: expected.to_string(),
        minecraft_dir: minecraft_dir.map(|path| path.display().to_string()),
        client_install_dir,
        client_prepare_available,
        version_blocked,
        mock,
        updated_at: envstate::now_millis(),
    }
}

fn refresh_env(app: &AppHandle) -> envstate::EnvState {
    let state = app.state::<AppState>();
    let health = envstate::read_engine_health(engine_port());
    let client_probe = launcher::client_probe();
    let env = build_env_state(&state, client_probe, health);
    if let Ok(mut stored) = state.env.lock() {
        *stored = env.clone();
    }
    env
}

fn emit_env(app: &AppHandle, env: &envstate::EnvState) {
    let _ = app.emit("loom://env", env);
}

/// 后台监视线程：只做端口/进程/本地 health 探测（无 PowerShell/UIA，避免旧卡顿回归）。
fn spawn_env_monitor(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(ENV_MONITOR_INTERVAL_MS));
            let env = refresh_env(&app);
            // P1-6：去重时忽略 updatedAt，否则每 2 秒必发事件、L0 按钮被反复重建。
            let Ok(json) = serde_json::to_string(&{
                let mut probe = env.clone();
                probe.updated_at = 0;
                probe
            }) else {
                continue;
            };
            if json != last {
                last = json;
                emit_env(&app, &env);
            }
        }
    });
}

/// L0 首屏自动启动：Paper → engine（织偶由 engine 自动连接）→ 客户端自动检测/拉起（task-11）。
/// P0-1：每步的锁覆盖到端口就绪（或子进程被判退出/超时）才释放。
fn spawn_env_autostart(app: AppHandle) {
    std::thread::spawn(move || {
        // 先让 L0 首帧渲染出来，再做重活，避免启动白屏。
        std::thread::sleep(Duration::from_millis(700));
        {
            let state = app.state::<AppState>();
            let mut started = match state.autostart_started.lock() {
                Ok(guard) => guard,
                Err(_) => return,
            };
            if *started {
                return;
            }
            *started = true;
        }
        {
            let state = app.state::<AppState>();
            if state.try_begin_start("paper") {
                let result = start_paper_wait(&state);
                if let Err(error) = result {
                    state.log("lifecycle", &format!("自动启动世界失败：{error}"));
                    state.set_error("paper", Some(error));
                }
                state.end_start("paper");
            }
        }
        {
            let state = app.state::<AppState>();
            if state.try_begin_start("engine") {
                let result = start_engine_wait(&state);
                if let Err(error) = result {
                    state.log("lifecycle", &format!("自动启动引擎失败：{error}"));
                    state.set_error("engine", Some(error));
                }
                state.end_start("engine");
            }
        }
        // task-11/16/18：自动检测/拉起《我的世界》客户端（需求；失败才在卡片显示安装/引导）。
        // 只自动尝试一次；Mock 演示、或显式禁用（自动化/无 GUI 验证）时跳过。
        // 已运行但版本不兼容时（如 1.21.1）不杀它，继续按 direct 优先启动产品 26.1.2。
        {
            let mock = envstate::read_engine_health(engine_port())
                .map(|health| health.mock)
                .unwrap_or(false);
            let disabled = std::env::var("LOOM_DISABLE_CLIENT_AUTOSTART")
                .map(|value| value == "1" || value.eq_ignore_ascii_case("true"))
                .unwrap_or(false);
            let state = app.state::<AppState>();
            let probe = launcher::client_probe();
            let compatible = probe.compatible(launcher::DEFAULT_MC_VERSION);
            let version_label = probe.version.clone().unwrap_or_else(|| "未知版本".to_string());
            if envstate::should_autostart_client(mock, compatible, disabled) && state.try_begin_start("client") {
                state.client_cancel.store(false, Ordering::SeqCst);
                if probe.running {
                    state.log(
                        "launcher",
                        &format!("L0 自动检测：客户端版本 {version_label} 与 {} 不匹配，仍尝试启动正确版本（不会关闭旧客户端）", launcher::DEFAULT_MC_VERSION),
                    );
                } else {
                    state.log("launcher", "L0 自动尝试启动《我的世界》客户端（失败才显示安装/引导）");
                }
                spawn_client_worker(app.clone(), None);
            } else if compatible {
                state.log("launcher", &format!("L0 自动检测：客户端 {version_label} 已运行且版本匹配，复用不重复启动"));
            } else if mock {
                state.log("launcher", "L0 自动检测：Mock 演示环境，跳过客户端启动");
            } else if disabled {
                state.log("launcher", "L0 自动检测：LOOM_DISABLE_CLIENT_AUTOSTART=1，跳过客户端启动");
            }
        }
        let env = refresh_env(&app);
        emit_env(&app, &env);
    });
}

/// 单卡启动的 worker 壳：拿锁 → 等就绪 → 放锁 → 刷新事件。
fn run_single_start(app: AppHandle, kind: &'static str) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        let result = match kind {
            "paper" => start_paper_wait(&state),
            "engine" => start_engine_wait(&state),
            "bot" => restart_bot_wait(&state),
            _ => Err(format!("未知启动项：{kind}")),
        };
        if let Err(error) = result {
            state.log("lifecycle", &format!("启动 {kind} 失败：{error}"));
            state.set_error(kind, Some(error));
        }
        state.end_start(kind);
        let env = refresh_env(&app);
        emit_env(&app, &env);
    });
}

fn env_start_inner(app: AppHandle, kind: &str) -> OpStatus {
    match kind {
        "engine" | "paper" | "bot" => {
            {
                let state = app.state::<AppState>();
                if kind == "bot" {
                    let (session_active, _) = state.session_snapshot();
                    if session_active {
                        return OpStatus {
                            ok: false,
                            detail: "关卡进行中不能重启织机（会丢当前会话）；请先回到 L0 再重试织偶。".into(),
                        };
                    }
                }
                let busy_detail = match kind {
                    "engine" => "织机正在启动中，请稍候。",
                    "paper" => "世界服务端正在启动中，请稍候。",
                    _ => "织偶正在重连中，请稍候。",
                };
                if !state.try_begin_start(kind) {
                    return OpStatus { ok: false, detail: busy_detail.into() };
                }
                state.set_error(kind, None);
            }
            run_single_start(app, if kind == "engine" { "engine" } else if kind == "paper" { "paper" } else { "bot" });
            OpStatus {
                ok: true,
                detail: match kind {
                    "engine" => "已开始启动织机（首次约 5–15 秒）。",
                    "paper" => "已开始启动世界服务端（首次约 10–20 秒）。",
                    _ => "正在重启织机以重连织偶（Paper 不受影响）…",
                }
                .into(),
            }
        }
        "client" => {
            {
                let state = app.state::<AppState>();
                if !state.try_begin_start("client") {
                    return OpStatus { ok: false, detail: "《我的世界》正在启动中，请稍候。".into() };
                }
                state.client_cancel.store(false, Ordering::SeqCst);
            }
            spawn_client_worker(app, None);
            OpStatus { ok: true, detail: "已开始启动《我的世界》（会自动选择可用的启动器；可点「取消启动」中止）。".into() }
        }
        "all" => {
            {
                let state = app.state::<AppState>();
                if !state.try_begin_start("all") {
                    return OpStatus { ok: false, detail: "已经在启动中，请稍候。".into() };
                }
            }
            std::thread::spawn(move || {
                let state = app.state::<AppState>();
                // P1-8：all 必须尊重子锁；拿不到说明另一个入口正在启动，直接跳过（不再并发 spawn）。
                if state.try_begin_start("paper") {
                    if let Err(error) = start_paper_wait(&state) {
                        state.set_error("paper", Some(error));
                    }
                    state.end_start("paper");
                } else {
                    state.log("lifecycle", "一键启动：世界服务端已由其他启动占用，跳过");
                }
                if state.try_begin_start("engine") {
                    if let Err(error) = start_engine_wait(&state) {
                        state.set_error("engine", Some(error));
                    }
                    state.end_start("engine");
                } else {
                    state.log("lifecycle", "一键启动：织机已由其他启动占用，跳过");
                }
                state.end_start("all");
                let env = refresh_env(&app);
                emit_env(&app, &env);
            });
            OpStatus { ok: true, detail: "正在依次启动世界服务端与织机（已在启动的步骤会自动跳过）…".into() }
        }
        other => OpStatus { ok: false, detail: format!("未知启动项：{other}") },
    }
}

/// 客户端启动线程（L0「启动《我的世界》」与 L2「一键重启并连接」共用）。
fn spawn_client_worker(app: AppHandle, prefer: Option<String>) {
    std::thread::spawn(move || {
        let state = app.state::<AppState>();
        state.set_error("client", None);
        state.client_cancel.store(false, Ordering::SeqCst);
        // task-16：只有 engine 确认连上的是 26.1.2 Paper 时才 quickPlay 进服；
        // 旧 Paper 占 25565 时绝不把客户端往里送。
        let server = envstate::read_engine_health(engine_port())
            .filter(|health| {
                health.mc_connected
                    && launcher::client_version_compatible(Some(&health.mc_version), launcher::DEFAULT_MC_VERSION)
            })
            .map(|_| launcher::DEFAULT_SERVER.to_string());
        let prefer_adapter = prefer.or_else(|| state.last_client_adapter.lock().ok().and_then(|guard| guard.clone()));
        let context = state.build_launch_context(prefer_adapter, server);
        let outcome = launcher::launch_client(&context);
        if let Some(child) = outcome.child {
            if let Ok(mut children) = state.children.lock() {
                children.insert("minecraft".into(), child);
            }
        }
        if outcome.ok {
            state.set_last_client_adapter(Some(outcome.adapter.clone()));
            state.set_client_guide(outcome.guide.clone());
            if outcome.needs_manual {
                // 已拉起启动器 UI，但还需要用户在启动器里点「启动」：按可操作提示展示，不算自动化成功。
                let hint = outcome.hint.clone().unwrap_or_default();
                state.set_error("client", Some(if hint.is_empty() { outcome.detail.clone() } else { format!("{}；{}", outcome.detail, hint) }));
            } else {
                state.set_error("client", None);
            }
            state.log("launcher", &format!("客户端（{}）：{}", outcome.adapter, outcome.detail));
            let _ = app.emit("loom://client-restored", &outcome.detail);
        } else {
            state.set_error("client", Some(outcome.detail.clone()));
            state.set_client_guide(outcome.guide.clone());
            state.log("launcher", &format!("客户端启动失败（{}）：{}", outcome.adapter, outcome.detail));
            let _ = app.emit("loom://client-failed", &outcome.detail);
        }
        state.end_start("client");
        let env = refresh_env(&app);
        emit_env(&app, &env);
    });
}

fn quit_game_impl(app: &AppHandle) {
    {
        let state = app.state::<AppState>();
        if let Ok(mut confirmed) = state.quit_confirmed.lock() {
            if *confirmed {
                return;
            }
            *confirmed = true;
        }
        // 中止所有进行中的客户端启动链，避免退出后还冒出一个孤儿 java。
        state.client_cancel.store(true, Ordering::SeqCst);
        state.log("lifecycle", "用户确认退出游戏：开始关闭客户端/世界/织机");
        // 先礼后兵地关 Minecraft（task-18：只关版本匹配的 26.1.x 产品客户端；
        // 用户自己开的 1.21.1 旧客户端不关、不杀）。
        let _ = launcher::close_client_window_for_version(launcher::DEFAULT_MC_VERSION);
        let deadline = Instant::now() + Duration::from_millis(CLIENT_CLOSE_WAIT_MS.min(5_000));
        while Instant::now() < deadline && launcher::client_process_running() {
            std::thread::sleep(Duration::from_millis(200));
        }
        save_geometry_if_windowed(app);
        kill_children(&state);
        state.save();
    }
    if let Ok(contents) = fs::read_to_string(loom_dir().join("desktop.lock")) {
        if contents.trim() == std::process::id().to_string() {
            let _ = fs::remove_file(loom_dir().join("desktop.lock"));
        }
    }
    app.exit(0);
}

#[tauri::command]
fn env_state(app: tauri::AppHandle) -> envstate::EnvState {
    let state = app.state::<AppState>();
    state.env.lock().map(|guard| guard.clone()).unwrap_or_default()
}

#[tauri::command]
fn env_refresh(app: tauri::AppHandle) -> envstate::EnvState {
    let env = refresh_env(&app);
    emit_env(&app, &env);
    env
}

#[tauri::command]
fn env_autostart(app: tauri::AppHandle) {
    spawn_env_autostart(app);
}

#[tauri::command]
fn env_start(app: tauri::AppHandle, kind: String) -> OpStatus {
    env_start_inner(app, kind.trim().to_ascii_lowercase().as_str())
}

#[tauri::command]
fn env_retry(app: tauri::AppHandle, kind: String) -> OpStatus {
    env_start_inner(app, kind.trim().to_ascii_lowercase().as_str())
}

#[tauri::command]
fn launch_client(app: tauri::AppHandle) -> OpStatus {
    env_start_inner(app, "client")
}

#[tauri::command]
fn restart_client_and_reconnect(app: tauri::AppHandle) -> OpStatus {
    {
        let state = app.state::<AppState>();
        if !state.try_begin_start("client") {
            return OpStatus { ok: false, detail: "《我的世界》正在启动中，请稍候。".into() };
        }
        let prefer = state.last_client_adapter.lock().ok().and_then(|guard| guard.clone());
        state.log("launcher", "L2：一键重启客户端并连接当前世界");
        spawn_client_worker(app.clone(), prefer);
    }
    OpStatus {
        ok: true,
        detail: "正在重新拉起《我的世界》并连接当前世界；关卡进度/Paper 会话不会重建。".into(),
    }
}

#[tauri::command]
fn set_game_session(app: tauri::AppHandle, session_id: Option<String>, level_id: Option<String>) {
    let state = app.state::<AppState>();
    let next = match (session_id, level_id) {
        (Some(session_id), Some(level_id)) if !session_id.trim().is_empty() && !level_id.trim().is_empty() => Some(GameSessionRef {
            session_id: session_id.trim().to_string(),
            level_id: level_id.trim().to_string(),
        }),
        _ => None,
    };
    let lost_next = next.is_none();
    let event_payload = next
        .as_ref()
        .map(|session| serde_json::json!({ "sessionId": session.session_id, "levelId": session.level_id }))
        .unwrap_or(serde_json::Value::Null);
    if let Ok(mut session) = state.session.lock() {
        *session = next;
    }
    if lost_next {
        if let Ok(mut lost) = state.client_lost.lock() {
            *lost = false;
        }
    }
    let _ = app.emit("loom://session-changed", event_payload);
    let env = refresh_env(&app);
    emit_env(&app, &env);
}

#[tauri::command]
fn clear_game_session(app: tauri::AppHandle) {
    set_game_session(app, None, None);
}

#[tauri::command]
fn open_launcher_download(kind: String) -> OpStatus {
    let key = kind.trim().to_ascii_lowercase();
    let (url, label) = launcher::download_guide(&key);
    if launcher::open_url(url) {
        OpStatus { ok: true, detail: format!("已打开下载页：{label}（{url}）；安装完成后再回来点「重试」。" ) }
    } else {
        OpStatus { ok: false, detail: format!("打不开浏览器；请手动访问：{url}") }
    }
}

/// task-20：「准备 26.1.2」一键入口。
/// - 本机已有 `versions/26.1.2` → 直接采用（写入设置 `minecraftDir`），返回可立即启动；
/// - 本机没有 → 打开官方下载页并给明确诊断（不伪造下载、不打包 Mojang 资产）。
#[tauri::command]
fn client_prepare(app: tauri::AppHandle) -> OpStatus {
    let state = app.state::<AppState>();
    let context = state.build_launch_context(None, None);
    if let Some(install) = launcher::find_existing_client_install(&context) {
        let path = install.dir.display().to_string();
        if let Ok(mut settings) = state.settings.lock() {
            settings.minecraft_dir = Some(path.clone());
        }
        if let Ok(mut game_dir) = state.client_game_dir.lock() {
            *game_dir = Some(path.clone());
        }
        state.save();
        state.log(
            "launcher",
            &format!("一键准备：采用本机 {} 客户端 {path}（来源：{}）", install.version, install.source),
        );
        let env = refresh_env(&app);
        emit_env(&app, &env);
        return OpStatus {
            ok: true,
            detail: format!(
                "已采用本机《我的世界》{} 客户端：{path}。现在点「启动 {}」即可（内置 Java/离线账号 + quickPlay 25565）。",
                install.version, install.version
            ),
        };
    }
    let (url, label) = launcher::download_guide("official");
    let opened = launcher::open_url(url);
    let (dir, versions) = launcher::detect_minecraft_dir(&context);
    let scan = match dir {
        Some(dir) => format!(
            "扫描到 {}（现有版本：{}）",
            dir.display(),
            if versions.is_empty() { "无".to_string() } else { versions.join(",") }
        ),
        None => "没有找到可用的 .minecraft 目录".to_string(),
    };
    state.log("launcher", &format!("一键准备：本机未找到 versions/{}；{scan}", launcher::DEFAULT_MC_VERSION));
    OpStatus {
        ok: false,
        detail: format!(
            "本机没有找到《我的世界》{} 客户端文件（{scan}）。{}（{label}：{url}）；安装 26.1.2 后点重试，或在设置里指定 .minecraft / 设置 LOOM_MINECRAFT_DIR。",
            launcher::DEFAULT_MC_VERSION,
            if opened { "已打开官方下载页" } else { "请手动打开官方下载页" }
        ),
    }
}

#[tauri::command]
fn quit_game(app: tauri::AppHandle) {
    quit_game_impl(&app);
}

/// shell 已显示确认弹窗（ack）：Rust 停止「确认 UI 无响应」超时兜底。
#[tauri::command]
fn quit_ack(app: tauri::AppHandle) {
    {
        let state = app.state::<AppState>();
        if let Ok(mut ack) = state.quit_ack_at.lock() {
            *ack = Some(Instant::now());
        };
    }
}

/// shell 引导失败/无监听时的兜底：允许关闭（下次 X/Alt+F4 直接放行）。
#[tauri::command]
fn window_allow_close(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    if let Ok(mut confirmed) = state.quit_confirmed.lock() {
        *confirmed = true;
    }
    state.log("window", "shell 请求 allow_close：后续关闭请求直接放行");
}

/// 立即关闭窗口（Rust 兜底出口，供 shell 引导异常时调用）。
#[tauri::command]
fn window_force_close(app: tauri::AppHandle) {
    {
        let state = app.state::<AppState>();
        if let Ok(mut confirmed) = state.quit_confirmed.lock() {
            *confirmed = true;
        }
        state.client_cancel.store(true, Ordering::SeqCst);
        state.log("lifecycle", "shell 请求 force_close：关闭窗口");
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.close();
    }
}

/// 取消进行中的《我的世界》启动链（等待窗口/直启进程会在下一个检查点退出并 kill）。
#[tauri::command]
fn env_cancel(app: tauri::AppHandle) -> OpStatus {
    let state = app.state::<AppState>();
    state.client_cancel.store(true, Ordering::SeqCst);
    state.log("launcher", "用户取消启动《我的世界》");
    let env = refresh_env(&app);
    emit_env(&app, &env);
    OpStatus { ok: true, detail: "已请求取消启动；正在结束等待中的启动器/直启进程。".into() }
}

#[tauri::command]
fn runtime_status() -> RuntimeStatus {
    let engine_ok = port_open(engine_port());
    // task-16：25565 端口开着 ≠ 26.1.2 Paper 就绪（旧 1.21.1 也会占端口）。
    let world_health = envstate::read_engine_health(engine_port());
    let world_ok = world_health
        .as_ref()
        .map(|health| {
            health.mc_connected
                && launcher::client_version_compatible(Some(&health.mc_version), launcher::DEFAULT_MC_VERSION)
        })
        .unwrap_or(false);
    RuntimeStatus {
        engine_ok,
        engine_detail: if engine_ok { "引擎 4317 已连接".into() } else { "引擎未启动（向导里点「启动引擎」）".into() },
        world_ok,
        world_detail: if world_ok {
            match world_health.as_ref().map(|health| health.mc_version.as_str()) {
                Some(version) if !version.is_empty() => format!("世界 25565 已连接（{version}）"),
                _ => "世界 25565 已连接（26.1.2）".into(),
            }
        } else {
            "世界未就绪：25565 可能是旧 Paper/其他服务端，或内置 26.1.2 尚未启动".into()
        },
    }
}

#[tauri::command]
fn open_logs(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    #[cfg(target_os = "linux")]
    let mut command = Command::new("xdg-open");
    #[cfg(not(target_os = "linux"))]
    let mut command = Command::new("explorer");
    command
        .arg(&state.logs_dir)
        .spawn()
        .map_err(|error| format!("打开日志目录失败：{error}"))?;
    Ok(())
}

// ---------------- 窗口/应用生命周期 ----------------

// task-17 P0：窗口几何恢复/保存都必须夹到「当前显示器工作区」（Windows 取 rcWork，含任务栏），
// 否则保存的大窗口（如 2560×1440）在 1707 宽屏幕上恢复会右侧被裁。

fn preferred_window_size() -> GeoSize {
    GeoSize { width: WORKBENCH_WIDTH, height: WORKBENCH_HEIGHT }
}

fn min_window_size() -> GeoSize {
    GeoSize { width: window_geometry::MIN_WINDOW_WIDTH, height: window_geometry::MIN_WINDOW_HEIGHT }
}

fn physical_rect(rect: GeoRect, scale: f64) -> GeoRect {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    GeoRect {
        x: (rect.x as f64 * scale).round() as i32,
        y: (rect.y as f64 * scale).round() as i32,
        width: ((rect.width as f64 * scale).round() as u32).max(1),
        height: ((rect.height as f64 * scale).round() as u32).max(1),
    }
}

fn logical_rect(rect: GeoRect, scale: f64) -> GeoRect {
    let scale = if scale > 0.0 { scale } else { 1.0 };
    GeoRect {
        x: (rect.x as f64 / scale).round() as i32,
        y: (rect.y as f64 / scale).round() as i32,
        width: ((rect.width as f64 / scale).round() as u32).max(1),
        height: ((rect.height as f64 / scale).round() as u32).max(1),
    }
}

/// 某个显示器的物理工作区（Windows：GetMonitorInfoW rcWork；其它平台：整块屏幕）。
fn monitor_work_area_physical(monitor: &tauri::Monitor) -> GeoRect {
    let position = monitor.position();
    let size = monitor.size();
    let center_x = position.x + (size.width / 2) as i32;
    let center_y = position.y + (size.height / 2) as i32;
    #[cfg(target_os = "windows")]
    {
        if let Some(work) = win_work_area::work_area_for_point(center_x, center_y) {
            return work;
        }
    }
    GeoRect {
        x: position.x,
        y: position.y,
        width: size.width.max(1),
        height: size.height.max(1),
    }
}

fn monitor_work_areas_logical(window: &WebviewWindow) -> Vec<GeoRect> {
    let Ok(monitors) = window.available_monitors() else { return Vec::new() };
    monitors
        .iter()
        .map(|monitor| {
            let scale = monitor.scale_factor();
            logical_rect(monitor_work_area_physical(monitor), scale)
        })
        .collect()
}

/// 恢复保存几何时选工作区：优先与保存矩形交集最大的显示器；都不相交（旧屏被拔掉）→ 主屏。
fn choose_saved_work_area(window: &WebviewWindow, saved: Option<GeoRect>) -> Option<GeoRect> {
    let works = monitor_work_areas_logical(window);
    if works.is_empty() {
        return None;
    }
    if let Some(saved) = saved {
        if let Some(work) = works
            .iter()
            .copied()
            .max_by_key(|work| saved.intersection_area(work))
            .filter(|work| saved.intersection_area(work) > 0)
        {
            return Some(work);
        }
    }
    if let Some(primary) = window.primary_monitor().ok().flatten() {
        let scale = primary.scale_factor();
        let work = logical_rect(monitor_work_area_physical(&primary), scale);
        if work.width > 0 && work.height > 0 {
            return Some(work);
        }
    }
    works.into_iter().next()
}

/// 当前窗口所在显示器的物理工作区（窗口中心点命中）。
fn work_area_physical_for_window(window: &WebviewWindow) -> Option<GeoRect> {
    let position = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    let center_x = position.x + (size.width / 2) as i32;
    let center_y = position.y + (size.height / 2) as i32;
    #[cfg(target_os = "windows")]
    {
        if let Some(work) = win_work_area::work_area_for_point(center_x, center_y) {
            return Some(work);
        }
    }
    let monitors = window.available_monitors().ok()?;
    let containing = monitors.iter().find(|monitor| {
        let monitor_position = monitor.position();
        let monitor_size = monitor.size();
        center_x >= monitor_position.x
            && center_x < monitor_position.x + monitor_size.width as i32
            && center_y >= monitor_position.y
            && center_y < monitor_position.y + monitor_size.height as i32
    });
    if let Some(monitor) = containing {
        return Some(monitor_work_area_physical(monitor));
    }
    window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|monitor| monitor_work_area_physical(&monitor))
}

fn log_window(app: Option<&AppHandle>, message: String) {
    if let Some(app) = app {
        let state = app.state::<AppState>();
        state.log("window", &message);
    }
}

/// task-17：恢复后/DPI 变化后把窗口物理外框夹回工作区。
/// 与 `restore_rect` 共用同一套策略：尺寸先夹、位置再夹、完全出屏则居中回退。
fn clamp_window_to_work_area(window: &WebviewWindow, app: Option<&AppHandle>) {
    if window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return;
    }
    let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) else { return };
    let Some(work) = work_area_physical_for_window(window) else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let min = physical_rect(
        GeoRect { x: 0, y: 0, width: min_window_size().width, height: min_window_size().height },
        scale,
    );
    let min_size = GeoSize { width: min.width, height: min.height };
    let preferred = physical_rect(
        GeoRect { x: 0, y: 0, width: preferred_window_size().width, height: preferred_window_size().height },
        scale,
    );
    let preferred_size = GeoSize { width: preferred.width, height: preferred.height };
    let saved = GeoRect { x: position.x, y: position.y, width: size.width.max(1), height: size.height.max(1) };
    let (rect, adjusted) = window_geometry::restore_rect(Some(saved), work, min_size, preferred_size);
    if !adjusted && window_geometry::fully_visible(&rect, &work) {
        return;
    }
    let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(rect.width, rect.height)));
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(rect.x, rect.y)));
    // 恢复后再校验一次（WM 可能按最小尺寸/装饰做二次调整），只做一轮，避免和用户拖动打架。
    if let (Ok(position), Ok(size)) = (window.outer_position(), window.outer_size()) {
        let actual = GeoRect { x: position.x, y: position.y, width: size.width.max(1), height: size.height.max(1) };
        if !window_geometry::fully_visible(&actual, &work) {
            let (fitted, _) = window_geometry::restore_rect(Some(actual), work, min_size, preferred_size);
            let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(fitted.width, fitted.height)));
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(fitted.x, fitted.y)));
        }
    }
    if adjusted {
        log_window(
            app,
            format!(
                "窗口几何超出工作区，已夹回：{}x{} @ ({},{}) → {}x{} @ ({},{})",
                saved.width, saved.height, saved.x, saved.y, rect.width, rect.height, rect.x, rect.y
            ),
        );
    }
}

fn apply_saved_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<AppState>();
    let (always_on_top, mode, geometry) = match state.settings.lock() {
        Ok(settings) => (settings.always_on_top, settings.mode.clone(), settings.window.clone()),
        Err(_) => return,
    };
    let _ = window.set_always_on_top(always_on_top);
    if mode == "companion" {
        let _ = apply_mode(&window, "companion");
        clamp_window_to_work_area(&window, Some(app));
        return;
    }
    let saved = geometry.as_ref().map(|geom| GeoRect {
        x: geom.x,
        y: geom.y,
        width: geom.width.max(1),
        height: geom.height.max(1),
    });
    if let Some(work) = choose_saved_work_area(&window, saved) {
        let (rect, adjusted) = window_geometry::restore_rect(saved, work, min_window_size(), preferred_window_size());
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(rect.width as f64, rect.height as f64)));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(rect.x as f64, rect.y as f64)));
        if adjusted {
            let saved_label = saved
                .map(|rect| format!("{}x{} @ ({},{})", rect.width, rect.height, rect.x, rect.y))
                .unwrap_or_else(|| "无".to_string());
            log_window(
                Some(app),
                format!(
                    "恢复窗口几何已夹到工作区：保存 {saved_label}，工作区 {}x{} @ ({},{}) → {}x{} @ ({},{})",
                    work.width, work.height, work.x, work.y, rect.width, rect.height, rect.x, rect.y
                ),
            );
        }
    } else if let Some(geometry) = geometry.as_ref() {
        // 拿不到显示器信息时退回旧行为，但仍由后面的物理 clamp 兜底。
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(geometry.width as f64, geometry.height as f64)));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(geometry.x as f64, geometry.y as f64)));
    }
    // 恢复后再 clamp 一次（窗口显示后由 show_main_window 再做物理 clamp；
    // 隐藏窗口的 outer_* 可能还是创建时的默认值，不能据此覆盖刚恢复的几何）。
    if window.is_visible().unwrap_or(false) {
        clamp_window_to_work_area(&window, Some(app));
        save_geometry_if_windowed(app);
    }
}

fn save_window_geometry(app: &tauri::AppHandle, force: bool) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<AppState>();
    // task-17：最大化/全屏都不记录普通窗口几何，避免把屏幕尺寸/偏移写进下次启动。
    if window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false) {
        return;
    }
    if !force {
        let throttled = state
            .settings
            .lock()
            .ok()
            .and_then(|settings| settings.last_save)
            .map(|instant| instant.elapsed() < Duration::from_millis(800))
            .unwrap_or(false);
        if throttled {
            return;
        }
    }
    if let (Ok(scale), Ok(position), Ok(size)) = (window.scale_factor(), window.outer_position(), window.outer_size()) {
        let mut geometry = WindowGeom {
            x: (position.x as f64 / scale).round() as i32,
            y: (position.y as f64 / scale).round() as i32,
            width: (size.width as f64 / scale).round().max(1.0) as u32,
            height: (size.height as f64 / scale).round().max(1.0) as u32,
        };
        // task-17：保存前也夹到当前工作区，坏数据（超屏/负坐标）不落盘。
        let logical_saved = GeoRect { x: geometry.x, y: geometry.y, width: geometry.width, height: geometry.height };
        let works = monitor_work_areas_logical(&window);
        let center = GeoRect {
            x: logical_saved.x + (logical_saved.width / 2) as i32,
            y: logical_saved.y + (logical_saved.height / 2) as i32,
            width: 1,
            height: 1,
        };
        if let Some(work) = works
            .iter()
            .copied()
            .find(|work| center.intersection_area(work) > 0)
            .or_else(|| works.into_iter().next())
        {
            let (fitted, adjusted) = window_geometry::restore_rect(Some(logical_saved), work, min_window_size(), preferred_window_size());
            if adjusted {
                log_window(
                    Some(app),
                    format!(
                        "保存窗口几何前已夹到工作区：{}x{} @ ({},{}) → {}x{} @ ({},{})",
                        geometry.width, geometry.height, geometry.x, geometry.y,
                        fitted.width, fitted.height, fitted.x, fitted.y
                    ),
                );
            }
            geometry = WindowGeom { x: fitted.x, y: fitted.y, width: fitted.width, height: fitted.height };
        }
        if geometry.width >= COMPANION_WIDTH && geometry.height >= COMPANION_HEIGHT {
            if let Ok(mut settings) = state.settings.lock() {
                settings.window = Some(geometry);
            }
            state.save();
        }
    }
}

fn cleanup(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    // P1-9：全屏退出时不要把屏幕尺寸写进普通窗口几何。
    save_geometry_if_windowed(app);
    kill_children(&state);
    state.save();
    if let Ok(contents) = fs::read_to_string(loom_dir().join("desktop.lock")) {
        if contents.trim() == std::process::id().to_string() {
            let _ = fs::remove_file(loom_dir().join("desktop.lock"));
        }
    }
}


#[cfg(target_os = "windows")]
mod win_work_area {
    use super::window_geometry::GeoRect;

    type Hmonitor = *mut core::ffi::c_void;
    type Bool = i32;
    const MONITOR_DEFAULTTONEAREST: u32 = 2;

    #[repr(C)]
    struct Point {
        x: i32,
        y: i32,
    }

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }

    #[repr(C)]
    struct MonitorInfo {
        cb_size: u32,
        rc_monitor: Rect,
        rc_work: Rect,
        dw_flags: u32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn MonitorFromPoint(point: Point, flags: u32) -> Hmonitor;
        fn GetMonitorInfoW(monitor: Hmonitor, info: *mut MonitorInfo) -> Bool;
    }

    /// task-17：取某点所在显示器的**工作区**（rcWork，已扣除任务栏）。
    pub fn work_area_for_point(x: i32, y: i32) -> Option<GeoRect> {
        unsafe {
            let monitor = MonitorFromPoint(Point { x, y }, MONITOR_DEFAULTTONEAREST);
            if monitor.is_null() {
                return None;
            }
            let mut info: MonitorInfo = std::mem::zeroed();
            info.cb_size = std::mem::size_of::<MonitorInfo>() as u32;
            if GetMonitorInfoW(monitor, &mut info) == 0 {
                return None;
            }
            let width = (info.rc_work.right - info.rc_work.left).max(1) as u32;
            let height = (info.rc_work.bottom - info.rc_work.top).max(1) as u32;
            Some(GeoRect { x: info.rc_work.left, y: info.rc_work.top, width, height })
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use crate::window_geometry::{fully_visible, restore_rect, GeoSize};

        #[test]
        fn win32_work_area_query_and_real_screen_clamp() {
            // 真机回归（Windows）：查询 rcWork（含任务栏），并验证 2560×1440 保存几何能 fit。
            let work = work_area_for_point(0, 0).expect("GetMonitorInfoW 工作区查询");
            assert!(work.width > 0 && work.height > 0);
            assert!(work.x == 0 && work.y == 0, "主屏工作区原点应为 (0,0)：{work:?}");
            let (rect, adjusted) = restore_rect(
                Some(GeoRect { x: 0, y: 0, width: 2560, height: 1440 }),
                work,
                GeoSize { width: 420, height: 620 },
                GeoSize { width: 1280, height: 840 },
            );
            assert!(adjusted, "2560×1440 在真实工作区 {:?} 上必须被夹", work);
            assert!(rect.width <= work.width && rect.height <= work.height);
            assert!(fully_visible(&rect, &work), "恢复矩形必须完全在工作区内：{rect:?} vs {work:?}");
        }
    }
}

// ---------------- X11 焦点跟随鼠标 ----------------
// Tauri 在 Wayland 下无法可靠地做全局指针/窗口焦点；桌面壳强制 XWayland，
// 这里直接用 libX11 查询根指针并激活 Minecraft 的 XWayland 窗口。
#[cfg(target_os = "linux")]
mod x11_focus {
    use std::ffi::{CStr, CString, c_char, c_int, c_uint, c_ulong, c_void};

    type Display = c_void;
    type Window = c_ulong;

    #[repr(C)]
    struct XClassHint {
        res_name: *mut c_char,
        res_class: *mut c_char,
    }

    #[link(name = "X11")]
    extern "C" {
        fn XOpenDisplay(name: *const c_char) -> *mut Display;
        fn XDefaultRootWindow(display: *mut Display) -> Window;
        fn XQueryPointer(
            display: *mut Display,
            window: Window,
            root_return: *mut Window,
            child_return: *mut Window,
            root_x: *mut c_int,
            root_y: *mut c_int,
            win_x: *mut c_int,
            win_y: *mut c_int,
            mask: *mut c_uint,
        ) -> c_int;
        fn XQueryTree(
            display: *mut Display,
            window: Window,
            root_return: *mut Window,
            parent_return: *mut Window,
            children_return: *mut *mut Window,
            count_return: *mut c_uint,
        ) -> c_int;
        fn XFetchName(display: *mut Display, window: Window, name_return: *mut *mut c_char) -> c_int;
        fn XGetClassHint(display: *mut Display, window: Window, hint_return: *mut XClassHint) -> c_int;
        fn XFree(data: *mut c_void) -> c_int;
        fn XSetInputFocus(display: *mut Display, window: Window, revert_to: c_int, time: c_ulong) -> c_int;
        fn XRaiseWindow(display: *mut Display, window: Window) -> c_int;
        fn XMapWindow(display: *mut Display, window: Window) -> c_int;
        fn XMapRaised(display: *mut Display, window: Window) -> c_int;
        fn XFlush(display: *mut Display) -> c_int;
        fn XStringToKeysym(name: *const c_char) -> c_ulong;
        fn XKeysymToKeycode(display: *mut Display, keysym: c_ulong) -> u8;
    }

    #[link(name = "Xtst")]
    extern "C" {
        fn XTestFakeKeyEvent(display: *mut Display, keycode: c_uint, is_press: c_int, delay: c_ulong) -> c_int;
    }

    pub struct DisplayHandle(*mut Display);
    // 只在焦点线程内使用；Xlib Display 不是线程安全的，因此整体传给一个线程。
    unsafe impl Send for DisplayHandle {}

    impl DisplayHandle {
        pub fn open() -> Option<Self> {
            let display = unsafe { XOpenDisplay(std::ptr::null()) };
            if display.is_null() { None } else { Some(Self(display)) }
        }

        pub fn pointer(&self) -> Option<(i32, i32)> {
            let root = unsafe { XDefaultRootWindow(self.0) };
            let mut root_return: Window = 0;
            let mut child_return: Window = 0;
            let mut root_x: c_int = 0;
            let mut root_y: c_int = 0;
            let mut win_x: c_int = 0;
            let mut win_y: c_int = 0;
            let mut mask: c_uint = 0;
            let ok = unsafe {
                XQueryPointer(self.0, root, &mut root_return, &mut child_return, &mut root_x, &mut root_y, &mut win_x, &mut win_y, &mut mask)
            };
            if ok == 0 { None } else { Some((root_x, root_y)) }
        }

        fn window_label(&self, window: Window) -> String {
            let mut label = String::new();
            let mut name: *mut c_char = std::ptr::null_mut();
            if unsafe { XFetchName(self.0, window, &mut name) } != 0 && !name.is_null() {
                if let Ok(value) = unsafe { CStr::from_ptr(name) }.to_str() {
                    label.push_str(value);
                }
                unsafe { XFree(name.cast()) };
            }
            let mut hint = XClassHint { res_name: std::ptr::null_mut(), res_class: std::ptr::null_mut() };
            if unsafe { XGetClassHint(self.0, window, &mut hint) } != 0 {
                if !hint.res_name.is_null() {
                    if let Ok(value) = unsafe { CStr::from_ptr(hint.res_name) }.to_str() { label.push(' '); label.push_str(value); }
                    unsafe { XFree(hint.res_name.cast()) };
                }
                if !hint.res_class.is_null() {
                    if let Ok(value) = unsafe { CStr::from_ptr(hint.res_class) }.to_str() { label.push(' '); label.push_str(value); }
                    unsafe { XFree(hint.res_class.cast()) };
                }
            }
            label.to_lowercase()
        }

        fn find_window(&self, window: Window, needle: &str, depth: u32) -> Option<Window> {
            if self.window_label(window).contains(needle) { return Some(window); }
            if depth == 0 { return None; }
            let mut root_return: Window = 0;
            let mut parent_return: Window = 0;
            let mut children: *mut Window = std::ptr::null_mut();
            let mut count: c_uint = 0;
            let ok = unsafe { XQueryTree(self.0, window, &mut root_return, &mut parent_return, &mut children, &mut count) };
            if ok == 0 || children.is_null() { return None; }
            let slice = unsafe { std::slice::from_raw_parts(children, count as usize) };
            let mut found = None;
            for child in slice {
                if let Some(hit) = self.find_window(*child, needle, depth - 1) { found = Some(hit); break; }
            }
            unsafe { XFree(children.cast()) };
            found
        }

        pub fn send_escape(&self) {
            let symbol = CString::new("Escape").unwrap();
            let keysym = unsafe { XStringToKeysym(symbol.as_ptr()) };
            if keysym == 0 { return; }
            let keycode = unsafe { XKeysymToKeycode(self.0, keysym) };
            if keycode == 0 { return; }
            unsafe {
                XTestFakeKeyEvent(self.0, keycode as c_uint, 1, 0);
                XTestFakeKeyEvent(self.0, keycode as c_uint, 0, 0);
                XFlush(self.0);
            }
        }

        pub fn focus_minecraft(&self) -> bool {
            let root = unsafe { XDefaultRootWindow(self.0) };
            let Some(window) = self.find_window(root, "minecraft", 4) else { return false; };
            unsafe {
                // 最小化/图标化时先 map，再 raise；仅 XSetInputFocus 不会把窗口显示出来。
                XMapWindow(self.0, window);
                XMapRaised(self.0, window);
                XRaiseWindow(self.0, window);
                XSetInputFocus(self.0, window, 2, 0);
                XFlush(self.0);
            }
            true
        }
    }
}

/// 启动完成后把游戏窗口带到前台；Wayland 下 X11 proto 不可用，走 KWin scripting DBus。
static LAST_CLIENT_FOCUS_MS: AtomicU64 = AtomicU64::new(0);

#[cfg(target_os = "linux")]
fn focus_client_window() {
    LAST_CLIENT_FOCUS_MS.store(envstate::now_millis(), Ordering::Relaxed);
    // X11/XWayland 先直接 map+raise；KDE Wayland 下 KWin script 才是能激活窗口的那条路径，
    // 因此即使 X11 找到了窗口也继续走 KWin（两者对同一窗口幂等）。
    if let Some(display) = x11_focus::DisplayHandle::open() {
        let _ = display.focus_minecraft();
    }
    focus_client_window_kwin();
}

#[cfg(target_os = "linux")]
fn focus_client_window_kwin() {
    let desktop = std::env::var("XDG_CURRENT_DESKTOP").unwrap_or_default().to_ascii_lowercase();
    if !desktop.contains("kde") && !desktop.contains("plasma") {
        return;
    }
    // 放在私有 runtime 目录，避免 /tmp 固定文件名被 symlink 抢占后执行任意 KWin script。
    let base = std::env::var_os("XDG_RUNTIME_DIR")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let script_path = base.join(format!("loom-focus-mc-{}.js", std::process::id()));
    let pids = crate::launcher::minecraft_pids_for_version(crate::launcher::DEFAULT_MC_VERSION);
    let pids: Vec<String> = pids.iter().map(ToString::to_string).collect();
    let script = r#"const pids = [__PIDS__];
const list = workspace.windowList();
const mc = list.find(w => {
  const s = ((w.caption || '') + ' ' + (w.resourceClass || '') + ' ' + (w.resourceName || '')).toLowerCase();
  return (typeof w.pid === 'number' && pids.includes(w.pid)) || s.includes('minecraft') || s.includes('lwjgl') || s.includes('glfw');
});
if (mc) {
  try { mc.minimized = false; } catch (e) {}
  try { workspace.activateWindow(mc); } catch (e) {}
}
"#.replace("__PIDS__", &pids.join(","));
    if std::fs::write(&script_path, script).is_err() {
        return;
    }
    let path = script_path.to_string_lossy().to_string();
    let _ = std::process::Command::new("gdbus")
        .args(["call", "--session", "--dest", "org.kde.KWin", "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.loadScript", &path])
        .output();
    let _ = std::process::Command::new("gdbus")
        .args(["call", "--session", "--dest", "org.kde.KWin", "--object-path", "/Scripting", "--method", "org.kde.kwin.Scripting.start"])
        .output();
}

#[cfg(target_os = "windows")]
fn focus_client_window() {
    let _ = win_focus::focus_minecraft();
}

#[cfg(not(any(target_os = "linux", target_os = "windows")))]
fn focus_client_window() {}

#[cfg(target_os = "linux")]
fn install_kwin_focus_script(state: &AppState) -> bool {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    let dir = Path::new(&home).join(".local/share/kwin/scripts/loom-focus/contents/code");
    if fs::create_dir_all(&dir).is_err() { return false; }
    let metadata = r#"{"KPlugin":{"Id":"loom-focus","Name":"Loom Focus","Description":"Alt+Z toggle between Loom and Minecraft","Version":"1.0","License":"MIT"},"X-Plasma-API":"javascript","X-Plasma-MainScript":"code/main.js"}"#;
    let script = r#"function toggleLoomFocus() {
  const list = workspace.windowList();
  const app = list.find(w => ((w.caption || '') + ' ' + (w.resourceClass || '')).toLowerCase().includes('织界') || ((w.resourceClass || '').toLowerCase().includes('loom')));
  const mc = list.find(w => ((w.caption || '') + ' ' + (w.resourceClass || '')).toLowerCase().includes('minecraft'));
  if (!app) return;
  function activate(w) {
    try { if (typeof workspace.activateWindow === 'function') { workspace.activateWindow(w); return; } } catch (e) {}
    try { if (w && typeof w.activate === 'function') { w.activate(); return; } } catch (e) {}
    try { workspace.activeWindow = w; } catch (e) {}
  }
  if (app.active) { if (mc) activate(mc); }
  else activate(app);
}
registerShortcut('LoomToggleFocus', 'Loom: toggle focus', 'Alt+Z', toggleLoomFocus);
"#;
    let _ = fs::write(dir.join("main.js"), script);
    let _ = fs::write(Path::new(&home).join(".local/share/kwin/scripts/loom-focus/metadata.json"), metadata);
    let path = dir.join("main.js");
    let qdbus = ["qdbus-qt6", "qdbus"];
    let mut ok = false;
    for tool in qdbus {
        let unload = Command::new(tool).args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.unloadScript", "loom-focus"]).output();
        let _ = unload;
        let loaded = Command::new(tool).args(["org.kde.KWin", "/Scripting", "org.kde.kwin.Scripting.loadScript", path.to_str().unwrap_or(""), "loom-focus"]).output();
        let Ok(loaded) = loaded else { continue; };
        let id = String::from_utf8_lossy(&loaded.stdout).trim().to_string();
        if id.is_empty() { continue; }
        let obj = format!("/Scripting/Script{id}");
        let _ = Command::new(tool).args(["org.kde.KWin", obj.as_str(), "org.kde.kwin.Script.run"]).output();
        ok = true;
        state.log("shortcut", &format!("KWin 焦点脚本已加载 id={id}"));
        break;
    }
    ok
}

#[cfg(target_os = "windows")]
pub(crate) mod win_focus {
    use std::ffi::c_void;

    type Hwnd = *mut c_void;
    type Bool = i32;
    type Dword = u32;

    const SW_RESTORE: i32 = 9;
    const VK_ESCAPE: u8 = 0x1B;
    const KEYEVENTF_KEYUP: u32 = 0x0002;

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            callback: Option<unsafe extern "system" fn(Hwnd, isize) -> Bool>,
            lparam: isize,
        ) -> Bool;
        fn IsWindowVisible(hwnd: Hwnd) -> Bool;
        fn IsIconic(hwnd: Hwnd) -> Bool;
        fn ShowWindow(hwnd: Hwnd, command: i32) -> Bool;
        fn SetForegroundWindow(hwnd: Hwnd) -> Bool;
        fn GetForegroundWindow() -> Hwnd;
        fn GetWindowThreadProcessId(hwnd: Hwnd, pid: *mut Dword) -> Dword;
        fn AttachThreadInput(attach: Dword, attach_to: Dword, enabled: Bool) -> Bool;
        fn keybd_event(vk: u8, scan: u8, flags: u32, extra: usize);
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn GetCurrentThreadId() -> Dword;
    }

    struct Search {
        found: Hwnd,
        /// P0-3：只认 launcher 校验过的 java/javaw 客户端进程，绝不按标题误认浏览器/启动器。
        pids: Vec<u32>,
    }

    unsafe extern "system" fn enum_proc(hwnd: Hwnd, lparam: isize) -> Bool {
        if IsWindowVisible(hwnd) == 0 {
            return 1;
        }
        let context = &mut *(lparam as *mut Search);
        let mut pid: Dword = 0;
        GetWindowThreadProcessId(hwnd, &mut pid);
        if !context.pids.contains(&pid) {
            return 1;
        }
        context.found = hwnd;
        0
    }

    fn find_minecraft_window() -> Hwnd {
        // 先做进程级校验（java/javaw + cmdline/GLFW），再找该进程的可见窗口。
        // task-18：多客户端时 Alt+Z 优先聚焦 26.1.x 产品客户端，不全屏切到旧 1.21.1。
        let mut pids = crate::launcher::minecraft_pids_for_version(crate::launcher::DEFAULT_MC_VERSION);
        if pids.is_empty() {
            pids = crate::launcher::minecraft_pids();
        }
        if pids.is_empty() {
            return std::ptr::null_mut();
        }
        let mut search = Search {
            found: std::ptr::null_mut(),
            pids,
        };
        unsafe {
            EnumWindows(Some(enum_proc), &mut search as *mut Search as isize);
        }
        search.found
    }

    /// 尝试把 Minecraft 窗口提到前台。Windows 前台锁允许“当前前台进程”切换，
    /// 所以从织界出发通常可行；如果游戏在独占全屏/被系统阻止，返回 false，调用方回退 Alt+Tab。
    pub fn focus_minecraft() -> bool {
        let hwnd = find_minecraft_window();
        if hwnd.is_null() {
            return false;
        }
        unsafe {
            if IsIconic(hwnd) != 0 {
                ShowWindow(hwnd, SW_RESTORE);
            }
            let foreground = GetForegroundWindow();
            let foreground_thread = if foreground.is_null() {
                0
            } else {
                GetWindowThreadProcessId(foreground, std::ptr::null_mut())
            };
            let current_thread = GetCurrentThreadId();
            let attached = foreground_thread != 0
                && foreground_thread != current_thread
                && AttachThreadInput(current_thread, foreground_thread, 1) != 0;
            let focused = SetForegroundWindow(hwnd) != 0;
            if attached {
                AttachThreadInput(current_thread, foreground_thread, 0);
            }
            if !focused {
                ShowWindow(hwnd, SW_RESTORE);
            }
            focused
        }
    }

    pub fn send_escape() {
        unsafe {
            keybd_event(VK_ESCAPE, 0, 0, 0);
            keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, 0);
        }
    }
}

#[cfg(target_os = "linux")]
fn start_focus_follow(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Some(display) = x11_focus::DisplayHandle::open() else { return; };
        let mut was_inside = false;
        let mut last_action = Instant::now() - Duration::from_secs(2);
        loop {
            std::thread::sleep(Duration::from_millis(140));
            let Some(window) = app.get_webview_window("main") else { continue; };
            if !window.is_visible().unwrap_or(false) { continue; }
            let (Ok(position), Ok(size)) = (window.outer_position(), window.inner_size()) else { continue; };
            let Some((px, py)) = display.pointer() else { continue; };
            let inside = px >= position.x && px < position.x + size.width as i32
                && py >= position.y && py < position.y + size.height as i32;
            if inside == was_inside { continue; }
            if last_action.elapsed() < Duration::from_millis(320) { continue; }
            let follow_game = app
                .state::<AppState>()
                .settings
                .lock()
                .map(|settings| settings.focus_follow)
                .unwrap_or(true);
            let recently_focused_client = envstate::now_millis().saturating_sub(LAST_CLIENT_FOCUS_MS.load(Ordering::Relaxed)) < 3000;
            if inside && !recently_focused_client {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            } else if follow_game && window.is_focused().unwrap_or(false) && !recently_focused_client {
                let _ = display.focus_minecraft();
            }
            was_inside = inside;
            last_action = Instant::now();
        }
    });
}

fn main() {
    #[cfg(target_os = "linux")]
    let kde_wayland = std::env::var("XDG_SESSION_TYPE").map(|v| v == "wayland").unwrap_or(false)
        && std::env::var("KDE_FULL_SESSION").map(|v| v == "true").unwrap_or(false);
    #[cfg(not(target_os = "linux"))]
    let kde_wayland = false;
    // KDE/GNOME 的 Wayland 会话下，GTK 窗口的 always-on-top 与全局快捷键都不可靠；
    // 去掉 WAYLAND_DISPLAY / 把 session type 设为 x11，让 Tauri 的 global-shortcut 走 X11，
    // 而不是弹出 xdg-desktop-portal 的全局快捷键授权框（授权状态损坏后 Alt+Z 会完全失效）。
    #[cfg(target_os = "linux")]
    if std::env::var_os("WAYLAND_DISPLAY").is_some() {
        std::env::remove_var("WAYLAND_DISPLAY");
        std::env::set_var("XDG_SESSION_TYPE", "x11");
        std::env::set_var("GDK_BACKEND", "x11");
    }
    let _lock_path = acquire_single_instance();
    let settings_path = loom_dir().join("settings.json");
    let settings = load_settings(&settings_path);
    let state = AppState {
        settings: Mutex::new(settings),
        children: Mutex::new(HashMap::new()),
        settings_path,
        logs_dir: loom_dir().join("logs"),
        resource_dir: Mutex::new(PathBuf::new()),
        repo_root: find_repo_root(),
        kde_wayland,
        starting: Mutex::new(HashSet::new()),
        env: Mutex::new(envstate::EnvState::default()),
        errors: Mutex::new(HashMap::new()),
        session: Mutex::new(None),
        client_lost: Mutex::new(false),
        client_seen_ready: Mutex::new(false),
        client_guide: Mutex::new(None),
        last_client_adapter: Mutex::new(None),
        quit_confirmed: Mutex::new(false),
        autostart_started: Mutex::new(false),
        close_requested_at: Mutex::new(None),
        quit_ack_at: Mutex::new(None),
        client_cancel: Arc::new(AtomicBool::new(false)),
        bot_pending_since: Mutex::new(None),
        client_game_dir: Mutex::new(None),
    };
    {
        state.force_l0_page();
        state.save();
        if let Ok(mut env) = state.env.lock() {
            *env = state.initial_env();
        }
    }

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::ALT, Code::KeyZ) {
                        focus_workbench(app);
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyL) {
                        let _ = toggle_pin_internal(app);
                    } else if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyF) {
                        // P0-2/P1-11：Rust 级兜底——shell 崩了也能退出全屏/伴玩。
                        restore_safety(app);
                    }
                })
                .build(),
        )
        .manage(state)
        .setup(|app| {
            let resource_dir = app.path().resource_dir().unwrap_or_else(|_| PathBuf::from("."));
            {
                let state = app.state::<AppState>();
                if let Ok(mut dir) = state.resource_dir.lock() {
                    *dir = resource_dir;
                }
                state.log("lifecycle", &format!("织界启动，repo_root={:?}", state.repo_root));
            }
            apply_saved_window(&app.handle().clone());
            #[cfg(target_os = "linux")]
            let kde_script = {
                let state = app.state::<AppState>();
                state.kde_wayland && install_kwin_focus_script(&state)
            };
            #[cfg(not(target_os = "linux"))]
            let kde_script = false;
            let window = app.get_webview_window("main").expect("main window");
            emit_window_state(app.handle());
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => {
                    // task-17：全屏/最大化时不写 geometry（会把屏幕尺寸/偏移污染下次普通窗口）。
                    let skip = app_handle
                        .get_webview_window("main")
                        .map(|window| {
                            window.is_fullscreen().unwrap_or(false) || window.is_maximized().unwrap_or(false)
                        })
                        .unwrap_or(false);
                    if !skip {
                        save_window_geometry(&app_handle, false);
                    }
                    emit_window_state(&app_handle);
                }
                tauri::WindowEvent::ScaleFactorChanged { .. } => {
                    // task-17：DPI/显示器变化后先把窗口夹回工作区，再保存新几何。
                    if let Some(window) = app_handle.get_webview_window("main") {
                        clamp_window_to_work_area(&window, Some(&app_handle));
                    }
                    save_window_geometry(&app_handle, true);
                    emit_window_state(&app_handle);
                }
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    save_geometry_if_windowed(&app_handle);
                    let state = app_handle.state::<AppState>();
                    let confirmed = state.quit_confirmed.lock().map(|guard| *guard).unwrap_or(false);
                    if confirmed {
                        // quit_game/allow_close 已确认：放行真正的关闭（退出清理由 RunEvent::Exit 兜底）。
                        return;
                    }
                    // P0-2：第一次关闭只提醒，同一次会话里再次请求（或 shell 确认 UI 无响应）才放行，避免永久关不掉。
                    let now = Instant::now();
                    let second_pass = state
                        .close_requested_at
                        .lock()
                        .ok()
                        .and_then(|guard| *guard)
                        .map(|first| now.duration_since(first) <= Duration::from_millis(CLOSE_SECOND_PASS_MS))
                        .unwrap_or(false);
                    if second_pass {
                        if let Ok(mut confirmed) = state.quit_confirmed.lock() {
                            *confirmed = true;
                        }
                        state.log("lifecycle", "关闭请求二次到达：直接放行");
                        return;
                    }
                    if let Ok(mut first) = state.close_requested_at.lock() {
                        *first = Some(now);
                    }
                    if let Ok(mut ack) = state.quit_ack_at.lock() {
                        *ack = None;
                    }
                    api.prevent_close();
                    state.log("lifecycle", "收到关闭请求：等待用户确认退出");
                    let _ = app_handle.emit("loom://quit-requested", ());
                    // P0-2 兜底：若 shell 没有在 10s 内 ack（JS 崩了/事件没接上），强制放行关闭。
                    let watchdog = app_handle.clone();
                    std::thread::spawn(move || {
                        std::thread::sleep(Duration::from_millis(CLOSE_CONFIRM_FALLBACK_MS));
                        let state = watchdog.state::<AppState>();
                        let confirmed = state.quit_confirmed.lock().map(|guard| *guard).unwrap_or(false);
                        if confirmed {
                            return;
                        }
                        let acked = state
                            .quit_ack_at
                            .lock()
                            .ok()
                            .and_then(|guard| *guard)
                            .map(|ack| ack.elapsed() < Duration::from_millis(CLOSE_CONFIRM_FALLBACK_MS))
                            .unwrap_or(false);
                        if acked {
                            return;
                        }
                        state.log("lifecycle", "确认 UI 无响应：放行关闭（Rust 兜底）");
                        if let Ok(mut confirmed) = state.quit_confirmed.lock() {
                            *confirmed = true;
                        }
                        state.client_cancel.store(true, Ordering::SeqCst);
                        if let Some(window) = watchdog.get_webview_window("main") {
                            let _ = window.set_fullscreen(false);
                            let _ = window.close();
                        }
                    });
                }
                _ => {}
            });
            if !kde_script {
                match app
                    .global_shortcut()
                    .register(Shortcut::new(Some(Modifiers::ALT), Code::KeyZ))
                {
                    Ok(()) => {
                        let state = app.state::<AppState>();
                        state.log("shortcut", &format!("注册全局快捷键 {FOCUS_SHORTCUT} 成功（X11）"));
                    }
                    Err(error) => {
                        let state = app.state::<AppState>();
                        state.log("shortcut", &format!("注册 {FOCUS_SHORTCUT} 失败：{error}"));
                    }
                }
            } else {
                let state = app.state::<AppState>();
                state.log("shortcut", "KDE Wayland：Alt+Z 由 KWin 脚本接管（绕过 portal）");
            }
            match app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyL))
            {
                Ok(()) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册全局快捷键 {PIN_SHORTCUT} 成功"));
                    let _ = app.emit("loom://shortcut", PIN_SHORTCUT);
                }
                Err(error) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册 {PIN_SHORTCUT} 失败：{error}"));
                }
            }
            // P0-2/P1-11：全屏/伴玩兜底快捷键（即使 shell 页面卡死也能按）。
            match app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyF))
            {
                Ok(()) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册全局快捷键 {RESTORE_SHORTCUT} 成功（退出全屏/伴玩兜底）"));
                    let _ = app.emit("loom://shortcut", RESTORE_SHORTCUT);
                }
                Err(error) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册 {RESTORE_SHORTCUT} 失败：{error}"));
                }
            }
            let startup_handle = app.handle().clone();
            std::thread::spawn(move || {
                // 页面若因 JS 错误没调用 show_main_window，5 秒后兜底显示，避免永久不可见。
                std::thread::sleep(Duration::from_secs(5));
                if let Some(window) = startup_handle.get_webview_window("main") {
                    let _ = window.show();
                }
            });
            // L0 四灯：监视线程每 2 秒只做端口/进程/health 探测；自动启动 Paper+engine（织偶随 engine 连接）。
            spawn_env_monitor(app.handle().clone());
            spawn_env_autostart(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            toggle_pin,
            set_pin,
            set_mode,
            client_running,
            env_probe,
            env_state,
            env_refresh,
            env_autostart,
            env_start,
            env_retry,
            launch_client,
            restart_client_and_reconnect,
            set_game_session,
            clear_game_session,
            open_launcher_download,
            client_prepare,
            quit_game,
            quit_ack,
            env_cancel,
            window_allow_close,
            window_force_close,
            start_engine,
            stop_engine,
            start_paper,
            launch_prism,
            runtime_status,
            open_logs,
            window_minimize,
            window_toggle_maximize,
            window_close,
            window_start_drag,
            window_state,
            window_toggle_fullscreen,
            window_restore_main,
            set_webview_zoom,
            engine_ready,
            show_main_window,
            snap_half
        ])
        .build(tauri::generate_context!())
        .expect("构建织界桌面应用失败");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            cleanup(app_handle);
        }
    });
}
