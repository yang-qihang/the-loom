#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! 织界 Tauri 2 桌面壳（T3 spike）。
//! 无浏览器窗口加载 Studio 构建产物；管理 engine sidecar / Paper / Prism 的子进程生命周期；
//! 首启环境探测；置顶 / 伴玩模式 / 全局快捷键 / 设置持久化 / 单实例锁。
//! 业务逻辑仍在 apps/studio 与 apps/engine；本文件只做窗口与进程编排。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const ENGINE_PORT: u16 = 4317;
const MC_PORT: u16 = 25565;
const PIN_SHORTCUT: &str = "Ctrl+Shift+L";
const FOCUS_SHORTCUT: &str = "Ctrl+Shift+K";
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
    window: Option<WindowGeom>,
    #[serde(skip)]
    last_save: Option<Instant>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_on_top: false,
            focus_follow: true,
            mode: "workbench".into(),
            page: "wizard".into(),
            prism_command: None,
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

struct AppState {
    settings: Mutex<Settings>,
    children: Mutex<HashMap<String, Child>>,
    settings_path: PathBuf,
    logs_dir: PathBuf,
    resource_dir: Mutex<PathBuf>,
    repo_root: Option<PathBuf>,
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
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    Path::new(&home).join(".loomcraft")
}

fn load_settings(path: &Path) -> Settings {
    fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok())
        .unwrap_or_default()
}

fn acquire_single_instance() -> PathBuf {
    let dir = loom_dir();
    let _ = fs::create_dir_all(&dir);
    let lock = dir.join("desktop.lock");
    if let Ok(content) = fs::read_to_string(&lock) {
        if let Ok(pid) = content.trim().parse::<u32>() {
            if Path::new(&format!("/proc/{pid}")).exists() {
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

fn run_capture(command: &mut Command) -> (bool, String) {
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

fn find_real_runtime(state: &AppState) -> Option<PathBuf> {
    let resource = state.resource_dir().join("runtime").join("real");
    if resource.join("engine.mjs").exists() && resource.join("node/bin/node").exists() {
        return Some(resource);
    }
    if let Some(root) = &state.repo_root {
        let dev = root.join("apps/desktop/src-tauri/runtime/real");
        if dev.join("engine.mjs").exists() && dev.join("node/bin/node").exists() {
            return Some(dev);
        }
    }
    None
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

fn spawn_bundled_paper(state: &AppState) -> Result<OpStatus, String> {
    if port_open(MC_PORT) {
        return Ok(OpStatus { ok: true, detail: "世界已在运行（127.0.0.1:25565）。".into() });
    }
    let Some(real) = find_real_runtime(state) else {
        return Err("安装包内没有真实运行时（runtime/real）。".into());
    };
    let source_paper = real.join("paper");
    let paper_dir = loom_dir().join("runtime").join("paper");
    // AppImage 的挂载点只读；Paper 需要写 world/session.lock、日志、server.properties。
    if !paper_dir.join("paper.jar").exists() || !paper_dir.join("world").exists() {
        if paper_dir.exists() {
            let _ = fs::remove_dir_all(&paper_dir);
        }
        state.log("lifecycle", "首次启动：复制内置 Paper 世界到可写目录");
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
    let java = real.join("java/bin/java");
    let jar = paper_dir.join("paper.jar");
    if !java.exists() || !jar.exists() {
        return Err("安装包缺少 Java/Paper 运行时。".into());
    }
    let _ = fs::create_dir_all(&state.logs_dir);
    let log_file = File::create(state.logs_dir.join("paper.log")).map_err(|error| error.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
    let child = Command::new(&java)
        .args(["-Xms384M", "-Xmx1024M", "-XX:+UseG1GC", "-jar", "paper.jar", "--nogui"])
        .current_dir(&paper_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err))
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
    // 打包版优先启动包内真实引擎（Node + bot + 真实 Paper 适配器）。
    if let Some(real) = find_real_runtime(state) {
        let node = real.join("node/bin/node");
        let engine = real.join("engine.mjs");
        let lib = real.join("node/lib");
        let _ = fs::create_dir_all(&state.logs_dir);
        let log_file = File::create(state.logs_dir.join("engine.log")).map_err(|error| format!("创建引擎日志失败：{error}"))?;
        let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
        let child = Command::new(&node)
            .arg(&engine)
            .current_dir(&real)
            .env("PORT", engine_port().to_string())
            .env("LOOM_WORLD", "paper")
            .env("LOOM_MC_WAIT_MS", "60000")
            .env("LOOM_BOT_NAME", "Golem")
            .env("LD_LIBRARY_PATH", &lib)
            .env("NODE_PATH", real.join("node_modules"))
            .env("LOOM_STUDIO_DIR", real.join("studio"))
            .stdin(Stdio::null())
            .stdout(Stdio::from(log_file))
            .stderr(Stdio::from(log_file_err))
            .spawn()
            .map_err(|error| format!("启动内置真实引擎失败：{error}"))?;
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
        let child = command.spawn().map_err(|error| format!("启动引擎失败：{error}"))?;
        if let Ok(mut children) = state.children.lock() {
            children.insert("engine".into(), child);
        }
    }
    Ok(OpStatus { ok: true, detail: "引擎进程已拉起，正在等待 4317 就绪…".into() })
}

fn kill_children(state: &AppState) {
    if let Ok(mut children) = state.children.lock() {
        for (name, child) in children.iter_mut() {
            state.log("lifecycle", &format!("停止子进程 {name}（pid {}）", child.id()));
            let _ = child.kill();
            let _ = child.wait();
        }
        children.clear();
    }
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
    let companion = mode == "companion";
    let (width, height) = if companion { (COMPANION_WIDTH, COMPANION_HEIGHT) } else { (WORKBENCH_WIDTH, WORKBENCH_HEIGHT) };
    window
        .set_size(tauri::Size::Logical(tauri::LogicalSize::new(width as f64, height as f64)))
        .map_err(|error| error.to_string())?;
    window.center().map_err(|error| error.to_string())?;
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
        stored.prism_command = settings.prism_command;
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

#[tauri::command]
fn window_toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize().map_err(|error| error.to_string())
    } else {
        window.maximize().map_err(|error| error.to_string())
    }
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
        // 同一个快捷键来回切：织界在前时收起，焦点交给 Minecraft；不在前时拉起织界。
        if window.is_focused().unwrap_or(false) {
            let _ = window.minimize();
            return;
        }
        // 游戏正在前台时，先让游戏松开鼠标（Escape 打开游戏菜单），再拉起织界。
        if let Some(display) = x11_focus::DisplayHandle::open() {
            display.send_escape();
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
    let java = probe_java();
    let node = probe_node();
    let prism_command = state.settings.lock().ok().and_then(|guard| guard.prism_command.clone());
    let prism = probe_prism(prism_command.as_deref());
    let paper = if find_real_runtime(&state).is_some() {
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
    let state = app.state::<AppState>();
    let configured = state.settings.lock().ok().and_then(|guard| guard.prism_command.clone());
    let command = std::env::var("LOOM_PRISM").ok().or(configured).unwrap_or_else(|| "flatpak run org.prismlauncher.PrismLauncher".to_string());
    let _ = fs::create_dir_all(&state.logs_dir);
    let log_file = File::create(state.logs_dir.join("prism.log")).map_err(|error| error.to_string())?;
    let log_file_err = log_file.try_clone().map_err(|error| error.to_string())?;
    Command::new("sh")
        .args(["-lc", &format!("{command} >/dev/null 2>&1 &")])
        .current_dir(state.repo_root.clone().unwrap_or_else(|| loom_dir()))
        .stdout(Stdio::from(log_file))
        .stderr(Stdio::from(log_file_err))
        .spawn()
        .map_err(|error| format!("拉起 Prism 失败：{error}"))?;
    state.log("lifecycle", &format!("拉起 Prism：{command}"));
    Ok(OpStatus { ok: true, detail: "已请求拉起 Minecraft（Prism）。若没有出现，请手动打开 Prism 并进入 26.1.2 实例。".into() })
}

#[tauri::command]
fn client_running() -> bool {
    std::process::Command::new("pgrep")
        .args(["-f", "net.minecraft.client.main.Main"])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

#[tauri::command]
fn runtime_status() -> RuntimeStatus {
    let engine_ok = port_open(engine_port());
    let world_ok = port_open(MC_PORT);
    RuntimeStatus {
        engine_ok,
        engine_detail: if engine_ok { "引擎 4317 已连接".into() } else { "引擎未启动（向导里点「启动引擎」）".into() },
        world_ok,
        world_detail: if world_ok { "世界 25565 已连接".into() } else { "世界未启动（向导里点「启动世界」）".into() },
    }
}

#[tauri::command]
fn open_logs(app: tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    Command::new("xdg-open")
        .arg(&state.logs_dir)
        .spawn()
        .map_err(|error| format!("打开日志目录失败：{error}"))?;
    Ok(())
}

// ---------------- 窗口/应用生命周期 ----------------

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
    } else if let Some(geometry) = geometry {
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(geometry.width as f64, geometry.height as f64)));
        let _ = window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(geometry.x as f64, geometry.y as f64)));
    }
}

fn save_window_geometry(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    let state = app.state::<AppState>();
    if let (Ok(scale), Ok(position), Ok(size)) = (window.scale_factor(), window.outer_position(), window.inner_size()) {
        let geometry = WindowGeom {
            x: (position.x as f64 / scale).round() as i32,
            y: (position.y as f64 / scale).round() as i32,
            width: (size.width as f64 / scale).round() as u32,
            height: (size.height as f64 / scale).round() as u32,
        };
        if geometry.width >= COMPANION_WIDTH && geometry.height >= COMPANION_HEIGHT {
            if let Ok(mut settings) = state.settings.lock() {
                settings.window = Some(geometry);
            }
            let throttled = state
                .settings
                .lock()
                .ok()
                .and_then(|settings| settings.last_save)
                .map(|instant| instant.elapsed() < Duration::from_millis(800))
                .unwrap_or(false);
            if !throttled {
                state.save();
            }
        }
    }
}

fn cleanup(app: &tauri::AppHandle) {
    let state = app.state::<AppState>();
    save_window_geometry(app);
    kill_children(&state);
    state.save();
    if let Ok(contents) = fs::read_to_string(loom_dir().join("desktop.lock")) {
        if contents.trim() == std::process::id().to_string() {
            let _ = fs::remove_file(loom_dir().join("desktop.lock"));
        }
    }
}


// ---------------- X11 焦点跟随鼠标 ----------------
// Tauri 在 Wayland 下无法可靠地做全局指针/窗口焦点；桌面壳强制 XWayland，
// 这里直接用 libX11 查询根指针并激活 Minecraft 的 XWayland 窗口。
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
                XRaiseWindow(self.0, window);
                XSetInputFocus(self.0, window, 2, 0);
                XFlush(self.0);
            }
            true
        }
    }
}

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
            // 仅在指针真正跨过窗口边界时动作，避免反复抢焦点造成卡顿/焦点抖动。
            if last_action.elapsed() < Duration::from_millis(320) { continue; }
            let follow_game = app
                .state::<AppState>()
                .settings
                .lock()
                .map(|settings| settings.focus_follow)
                .unwrap_or(true);
            if inside {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            } else if follow_game && window.is_focused().unwrap_or(false) {
                // 默认行为：鼠标离开织界就交给 Minecraft。游戏会捕获并隐藏鼠标，
                // 这是 Minecraft 正常操作；按 Ctrl+Shift+K 会先 Escape 释放鼠标再回到织界。
                let _ = display.focus_minecraft();
            }
            was_inside = inside;
            last_action = Instant::now();
        }
    });
}

fn main() {
    // KDE/GNOME 的 Wayland 会话下，GTK 窗口的 always-on-top 与 X11 全局快捷键都不可靠。
    // 强制走 XWayland，让置顶/跨窗口快捷键与 Minecraft（通常也是 XWayland）一致工作。
    if std::env::var_os("WAYLAND_DISPLAY").is_some() && std::env::var_os("GDK_BACKEND").is_none() {
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
    };

    let app = tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyK) {
                        focus_workbench(app);
                    } else {
                        let _ = toggle_pin_internal(app);
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
            let window = app.get_webview_window("main").expect("main window");
            let app_handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) => save_window_geometry(&app_handle),
                tauri::WindowEvent::CloseRequested { .. } => {
                    save_window_geometry(&app_handle);
                    let state = app_handle.state::<AppState>();
                    kill_children(&state);
                    state.save();
                }
                _ => {}
            });
            match app
                .global_shortcut()
                .register(Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyK))
            {
                Ok(()) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册全局快捷键 {FOCUS_SHORTCUT} 成功"));
                }
                Err(error) => {
                    let state = app.state::<AppState>();
                    state.log("shortcut", &format!("注册 {FOCUS_SHORTCUT} 失败：{error}"));
                }
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
            start_focus_follow(app.handle().clone());
            let startup_handle = app.handle().clone();
            std::thread::spawn(move || {
                // 页面若因 JS 错误没调用 show_main_window，5 秒后兜底显示，避免永久不可见。
                std::thread::sleep(Duration::from_secs(5));
                if let Some(window) = startup_handle.get_webview_window("main") {
                    let _ = window.show();
                }
                let state = startup_handle.state::<AppState>();
                if find_real_runtime(&state).is_some() {
                    match spawn_bundled_paper(&state) {
                        Ok(status) => state.log("lifecycle", &format!("自动启动世界：{}", status.detail)),
                        Err(error) => state.log("lifecycle", &format!("自动启动世界失败：{error}")),
                    }
                    let deadline = Instant::now() + Duration::from_secs(75);
                    while Instant::now() < deadline && !port_open(MC_PORT) {
                        std::thread::sleep(Duration::from_millis(700));
                    }
                }
                match spawn_engine_child(&state) {
                    Ok(status) => state.log("lifecycle", &format!("自动启动引擎：{}", status.detail)),
                    Err(error) => state.log("lifecycle", &format!("自动启动引擎失败：{error}")),
                }
                let _ = startup_handle.emit("loom://status", runtime_status());
            });
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
