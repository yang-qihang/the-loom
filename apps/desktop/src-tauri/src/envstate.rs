//! L0/L1/L2 四灯环境状态（EnvState）与轻量探测。
//!
//! 本模块只做「纯数据 + 探测」：不依赖 Tauri AppState，方便单测；
//! main.rs 的后台监视线程每 2 秒调用一次 [`poll_lights`]，把结果包装成
//! [`EnvState`] 并通过 `loom://env` 事件推给壳页面与 L0 UI。
//!
//! 四灯 = 织机（engine）/ 世界服务端（Paper）/ 织偶（bot）/ 客户端（Minecraft）。
//! 灯态：checking / starting / ready / needs_action / error。

use serde::Serialize;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub const STATE_CHECKING: &str = "checking";
pub const STATE_STARTING: &str = "starting";
pub const STATE_READY: &str = "ready";
pub const STATE_NEEDS_ACTION: &str = "needs_action";
pub const STATE_ERROR: &str = "error";

pub const KIND_ENGINE: &str = "engine";
pub const KIND_PAPER: &str = "paper";
pub const KIND_BOT: &str = "bot";
pub const KIND_CLIENT: &str = "client";

/// 一盏灯。`guide` 非空时代表需要引导安装/打开下载页（值见 launcher::download_guide）。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvLight {
    pub state: String,
    pub detail: String,
    pub hint: Option<String>,
    /// 是否显示「启动/重试」按钮（前端据此渲染，Rust 不直接下发按钮文案）。
    pub can_start: bool,
    pub can_retry: bool,
    /// 已探测到但不可用的启动器种类（prism/hmcl/official/pcl2/install）。
    pub guide: Option<String>,
}

impl EnvLight {
    fn new(state: &str, detail: impl Into<String>) -> Self {
        Self {
            state: state.to_string(),
            detail: detail.into(),
            hint: None,
            can_start: false,
            can_retry: false,
            guide: None,
        }
    }

    fn hint(mut self, hint: impl Into<String>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    fn start(mut self, can: bool) -> Self {
        self.can_start = can;
        self
    }

    fn retry(mut self, can: bool) -> Self {
        self.can_retry = can;
        self
    }

    fn guide(mut self, guide: Option<String>) -> Self {
        self.guide = guide;
        self
    }
}

/// 引擎 `/api/health` 的精简投影（字段名与 engine 的 JSON 对应）。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineHealth {
    pub ok: bool,
    pub port: String,
    pub mc_connected: bool,
    pub mc_kind: String,
    pub bot_connected: bool,
    pub mock: bool,
    /// 插件 health 里的 MC 版本（engine world.ts `mc.version`，内置 Paper 为 26.1.2）。
    pub mc_version: String,
    /// 插件自身版本（loomcraft-mc）。
    pub plugin_version: String,
}

impl EngineHealth {
    fn from_json(value: &serde_json::Value) -> Option<Self> {
        let ok = value.get("ok").and_then(|v| v.as_bool()).unwrap_or(false);
        if !ok {
            return None;
        }
        let port = value.get("port").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let mc = value.get("mc");
        Some(Self {
            ok,
            mock: port == "mock",
            mc_connected: mc.and_then(|m| m.get("connected")).and_then(|v| v.as_bool()).unwrap_or(false),
            mc_kind: mc.and_then(|m| m.get("kind")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            mc_version: mc.and_then(|m| m.get("version")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            plugin_version: mc.and_then(|m| m.get("pluginVersion")).and_then(|v| v.as_str()).unwrap_or("").to_string(),
            bot_connected: value
                .get("bot")
                .and_then(|b| b.get("connected"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            port,
        })
    }
}

/// L0 是否应自动尝试拉起《我的世界》客户端（task-11/task-16）。
/// 需求：自动检测/拉起，失败才在卡片显示安装/引导；
/// Mock 演示环境、**已运行且版本兼容**、或显式禁用（LOOM_DISABLE_CLIENT_AUTOSTART=1）时跳过。
/// 已运行但版本不兼容时仍会尝试（launcher 会快速失败并给出中文版本提示，不会杀旧客户端）。
pub fn should_autostart_client(mock: bool, client_compatible: bool, disabled: bool) -> bool {
    !disabled && !mock && !client_compatible
}

/// 所有灯 + 全局门控信息。字段名进 JSON 时用 camelCase（壳/L0/Studio 共用）。
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct EnvState {
    pub engine: EnvLight,
    pub paper: EnvLight,
    pub bot: EnvLight,
    pub client: EnvLight,
    /// 四灯全绿（L0「进入工坊」唯一门控）。
    pub all_ready: bool,
    /// 正在执行的长操作：engine / paper / client / bot。
    pub launching: Vec<String>,
    /// L2：关卡会话进行中且客户端掉线（红色阻断）。
    pub client_lost: bool,
    /// 当前是否存在关卡会话（shell 通过 set_game_session 同步）。
    pub session_active: bool,
    /// 最近一次成功使用的客户端启动方式（prism/hmcl/direct/official/pcl2/custom）。
    pub client_adapter: Option<String>,
    /// 客户端可用启动器探测结果（没有时 None）。
    pub client_available_launcher: Option<String>,
    /// task-16 P0：检测到的客户端版本（命令行 --version / 窗口标题；未知时 None）。
    pub client_version: Option<String>,
    /// task-18：同机仍在运行的其它版本客户端（如 1.21.1）；仅提示，不阻塞。
    pub other_client_version: Option<String>,
    /// task-16 P0：世界服务端版本（engine health `mc.version`）。
    pub server_version: Option<String>,
    /// 本作要求的版本（26.1.2）；前端中文提示用。
    pub expected_version: String,
    /// 实际使用的 .minecraft 目录（诊断/提示用）。
    pub minecraft_dir: Option<String>,
    /// task-20：本机已找到的 26.1.2 客户端安装目录（一键准备/启动提示用）。
    pub client_install_dir: Option<String>,
    /// task-20：本机没有 26.1.2 文件 → 前端可显示「准备 26.1.2」一键入口（采用现有/打开下载）。
    pub client_prepare_available: bool,
    /// 客户端/服务端版本不匹配：禁止进入工坊（即使 other lights 绿）。
    pub version_blocked: bool,
    /// 本地演示（Mock 世界）：四灯语义按演示降级，壳顶栏显示 Mock 样式。
    pub mock: bool,
    pub updated_at: u64,
}

/// L2 客户端丢失判定所需的输入（纯数据，便于单测「关掉→重开」状态切换）。
pub struct ClientLossInput {
    pub mock: bool,
    pub engine_ready: bool,
    pub client_running: bool,
    pub session_active: bool,
    /// 本次掉线前是否曾经亮过客户端灯（区分「还没启动」与「从运行中掉线」）。
    pub seen_ready: bool,
    pub client: EnvLight,
    pub guide: Option<String>,
    /// task-16：客户端版本不匹配（不是「关掉了」，提示文案要区分）。
    pub client_version_mismatch: bool,
}

/// 返回 (客户端灯, 是否丢失, 下一次 seen_ready)。
/// 只有「引擎就绪 + 曾经亮过 + 关卡会话进行中 + 现在不在」才算 L2 丢失；
/// 一旦客户端重新出现，灯恢复 ready、lost 自动清除（不需要手动 reset）。
pub fn apply_client_loss(mut input: ClientLossInput) -> (EnvLight, bool, bool) {
    if input.mock {
        return (input.client, false, input.seen_ready);
    }
    if input.client_running {
        return (input.client, false, true);
    }
    if input.engine_ready && input.session_active && input.seen_ready {
        input.client.state = STATE_ERROR.to_string();
        if input.client_version_mismatch {
            input.client.detail = "《我的世界》客户端版本不匹配；当前关卡进度已保留".to_string();
            input.client.hint = Some(
                "关闭当前运行的旧客户端后点「一键重启并连接」，织界会自动启动 26.1.2 并回到当前世界；版本匹配前不能继续运行/评分/切关。"
                    .to_string(),
            );
            input.client.can_start = true;
        } else {
            input.client.detail = "《我的世界》客户端已关闭；当前关卡进度已保留".to_string();
            input.client.hint = Some(
                "点「一键重启并连接」会重新拉起客户端并直接回到当前世界；客户端恢复前不能继续运行/评分/切关。"
                    .to_string(),
            );
            input.client.can_start = true;
        }
        input.client.can_retry = true;
        input.client.guide = input.guide;
        return (input.client, true, true);
    }
    (input.client, false, input.seen_ready)
}

/// 一次轮询的输入：全部是主进程侧已经拿到的轻量事实。
pub struct PollInput<'a> {
    pub engine_health: Option<&'a EngineHealth>,
    /// 25565 端口是否打开（只是事实；是否 ready 还要校验版本/插件 health）。
    pub paper_port_open: bool,
    pub client_running: bool,
    /// 检测到的客户端版本（None = 运行中但读不到版本 → 不放行）。
    pub client_version: Option<String>,
    /// task-18：同机其它版本客户端（如 1.21.1）；仅提示，不阻塞。
    pub other_client_version: Option<String>,
    /// 本作要求的 MC 版本（默认 26.1.2 / 协议 775）。
    pub expected_version: &'a str,
    /// task-20：本机已找到的 26.1.2 安装目录（客户端未运行时的提示/一键启动用）。
    pub client_install_dir: Option<String>,
    /// 正在启动中的 kind 集合（engine/paper/bot/client）。
    pub launching: &'a [String],
    /// 各 kind 最近一次失败信息（key = kind）。
    pub errors: &'a std::collections::HashMap<String, String>,
    pub client_guide: Option<String>,
    pub client_adapter: Option<String>,
    /// 织偶连接超时（engine+paper 已就绪、bot 仍未连超过阈值）：转为可重试的 needs_action。
    pub bot_stalled: bool,
}

fn launching(input: &PollInput, kind: &str) -> bool {
    input.launching.iter().any(|item| item == kind)
}

/// 四盏灯的判定（纯函数，方便单测）。
pub fn poll_lights(input: &PollInput) -> (EnvLight, EnvLight, EnvLight, EnvLight) {
    let mock = input
        .engine_health
        .map(|health| health.mock)
        .unwrap_or(false);
    let engine_ready = input.engine_health.map(|health| health.ok).unwrap_or(false);
    let expected = {
        let value = input.expected_version.trim();
        if value.is_empty() { crate::launcher::DEFAULT_MC_VERSION } else { value }
    };
    let bot_ready = input
        .engine_health
        .map(|health| health.bot_connected)
        .unwrap_or(false);

    let engine = if engine_ready {
        EnvLight::new(
            STATE_READY,
            "织机已连接".to_string(),
        )
    } else if launching(input, KIND_ENGINE) {
        EnvLight::new(STATE_STARTING, "正在启动织机…").hint("首次启动约 5–15 秒，启动后会自动连接世界与织偶。")
    } else if let Some(error) = input.errors.get(KIND_ENGINE) {
        EnvLight::new(STATE_ERROR, error.clone())
            .hint("可点「重试启动织机」；若反复失败，打开日志目录看 engine 日志。")
            .retry(true)
    } else {
        EnvLight::new(STATE_NEEDS_ACTION, "织机未启动")
            .hint("点「启动织机」（或等自动启动完成后刷新）。")
            .start(true)
    };

    let paper = if mock {
        EnvLight::new(STATE_READY, "本地演示：Mock 世界（无需真实服务端）")
    } else if let Some(health) = input.engine_health {
        let server_version = health.mc_version.trim();
        let server_compatible = !server_version.is_empty() && crate::launcher::client_version_compatible(Some(server_version), expected);
        if health.mc_connected && server_compatible {
            EnvLight::new(STATE_READY, format!("世界服务端已就绪（{server_version}）"))
        } else if health.mc_connected && !server_version.is_empty() {
            EnvLight::new(
                STATE_ERROR,
                format!("世界服务端版本不一致：当前 {server_version}，本作需要 {expected}"),
            )
            .hint("请关闭旧服务端后点「重试启动世界」；织界不会自动关闭它。")
            .retry(true)
        } else if health.mc_connected {
            EnvLight::new(
                STATE_ERROR,
                format!("世界服务端已连接，但无法确认版本（需要 {expected}）"),
            )
            .hint("点「重试启动世界」重启本作服务端；若 25565 被别的程序占用，先关闭它。")
            .retry(true)
        } else if input.paper_port_open {
            EnvLight::new(
                STATE_NEEDS_ACTION,
                format!("25565 被其他程序占用，还没连上本作服务端（需要 {expected}）"),
            )
            .hint("关闭占用 25565 的程序后点「重试启动世界」；织界不会自动关闭它。")
            .retry(true)
        } else {
            EnvLight::new(STATE_NEEDS_ACTION, "世界服务端未启动")
                .hint("点「启动世界服务端」；首次需要解压/复制内置世界。")
                .start(true)
        }
    } else if launching(input, KIND_PAPER) {
        EnvLight::new(STATE_STARTING, "正在启动世界服务端…").hint("首次启动约 10–20 秒（要加载世界与插件）。")
    } else if input.paper_port_open {
        // P0：端口开着不等于 26.1.2 Paper 就绪（旧 1.21.1 也能占 25565）。
        EnvLight::new(
            STATE_NEEDS_ACTION,
            format!("25565 被其他程序占用，还没确认本作服务端（需要 {expected}）"),
        )
        .hint("关闭占用 25565 的程序后点「重试启动世界」。")
        .retry(true)
    } else if let Some(error) = input.errors.get(KIND_PAPER) {
        EnvLight::new(STATE_ERROR, error.clone())
            .hint("可点「重试启动世界」；日志在「打开日志目录」里的 paper.log。")
            .retry(true)
    } else {
        EnvLight::new(STATE_NEEDS_ACTION, "世界服务端未启动")
            .hint("点「启动世界服务端」；首次需要解压/复制内置世界。")
            .start(true)
    };
    let paper_ready = paper.state == STATE_READY;

    let bot = if mock {
        EnvLight::new(STATE_READY, "本地演示：没有真实织偶（不需要客户端）")
    } else if bot_ready {
        EnvLight::new(STATE_READY, "织偶已进入世界，等待你的符文")
    } else if !engine_ready {
        EnvLight::new(STATE_NEEDS_ACTION, "等到织机启动后，织偶才会连接")
    } else if !paper_ready {
        EnvLight::new(STATE_NEEDS_ACTION, "等到世界服务端就绪后，织偶才会连接")
    } else if launching(input, KIND_BOT) {
        EnvLight::new(STATE_STARTING, "正在重启织偶连接…")
    } else if let Some(error) = input.errors.get(KIND_BOT) {
        EnvLight::new(STATE_ERROR, error.clone()).retry(true)
    } else if input.bot_stalled {
        // P1-7：engine+paper 就绪但织偶迟迟没连上时，不能永远显示 starting；给可点的重启出口。
        EnvLight::new(STATE_NEEDS_ACTION, "织偶还没连上世界")
            .hint("点「重启织偶」让织机重新连接；如果世界刚启动，也可以再等几秒后刷新。")
            .retry(true)
    } else {
        EnvLight::new(STATE_STARTING, "织偶正在连接世界…")
            .hint("通常几秒内完成；若长时间不亮，点「重启织偶」让织偶重新连接。")
            .retry(true)
    };

    let client_version = input.client_version.as_deref().map(str::trim).filter(|value| !value.is_empty());
    let client_compatible = client_version
        .map(|version| crate::launcher::client_version_compatible(Some(version), expected))
        .unwrap_or(false);
    let client = if mock {
        EnvLight::new(STATE_READY, "本地演示：不需要《我的世界》客户端")
    } else if input.client_running && client_compatible {
        let found = client_version.unwrap_or(expected);
        let other = input
            .other_client_version
            .as_deref()
            .map(|version| format!("（另有 {version} 在运行，未关闭、不影响）"))
            .unwrap_or_default();
        EnvLight::new(
            STATE_READY,
            match input.client_adapter.as_deref() {
                Some(adapter) => format!("《我的世界》{found} 已连接（{}）{other}", adapter_label(adapter)),
                None => format!("《我的世界》{found} 已连接（版本匹配）{other}"),
            },
        )
    } else if input.client_running && launching(input, KIND_CLIENT) && !client_compatible {
        // task-18：旧客户端在跑时正在启动 26.1.2 —— 显示启动中（旧客户端保持不动），不要显示失败。
        EnvLight::new(
            STATE_STARTING,
            format!(
                "正在启动《我的世界》{expected}（检测到旧版本在运行；织界不会关闭它，启动完成后自动优先使用 {expected}）"
            ),
        )
        .hint("首次启动可能需要十几秒；完成后客户端灯会变绿；失败会给出可操作的中文提示。")
    } else if input.client_running {
        // 任意版本客户端在跑但版本不符 → 绝不绿、绝不 allReady。
        let found = client_version.unwrap_or("未知版本");
        EnvLight::new(
            STATE_NEEDS_ACTION,
            format!("检测到《我的世界》{found}，版本与本作不一致"),
        )
        .hint(format!("本作使用 {expected}；旧客户端不用关闭，点「重试」会自动启动本作版本。"))
        .retry(true)
    } else if launching(input, KIND_CLIENT) {
        EnvLight::new(STATE_STARTING, "正在启动《我的世界》…").hint("首次启动可能需要十几秒，完成后会自动切到游戏。")
    } else if let Some(error) = input.errors.get(KIND_CLIENT) {
        EnvLight::new(STATE_ERROR, error.clone())
            .hint("点「重试」再试一次；仍失败可打开日志目录查看原因。")
            .retry(true)
            .guide(input.client_guide.clone())
    } else {
        // task-20：本机已有 26.1.2 时提示可直接启动；没有时提示「准备 26.1.2」入口。
        let hint = match input.client_install_dir.as_deref() {
            Some(_dir) => format!("点「启动《我的世界》」即可，本机已找到 {expected}。"),
            None => format!("点「准备 {expected}」找到本机客户端；没有的话会打开官方下载页。"),
        };
        EnvLight::new(STATE_NEEDS_ACTION, "《我的世界》客户端未运行")
            .hint(hint)
            .start(true)
            .guide(input.client_guide.clone())
    };

    (engine, paper, bot, client)
}

pub fn adapter_label(adapter: &str) -> &str {
    match adapter {
        "reuse" => "已运行的客户端",
        "prism" => "Prism Launcher",
        "hmcl" => "HMCL",
        "direct" => "本作启动",
        "official" => "官方启动器",
        "pcl2" => "PCL2",
        "custom" => "自定义启动器",
        other => other,
    }
}

pub fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or(0)
}

/// 轻量 HTTP GET（只读 health，150ms 建连 + 500ms 读超时；绝不用于业务请求）。
pub fn http_get_json(port: u16, path: &str) -> Option<serde_json::Value> {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let mut stream = TcpStream::connect_timeout(&addr, Duration::from_millis(180)).ok()?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(600)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(300)));
    let request = format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n");
    stream.write_all(request.as_bytes()).ok()?;
    let mut buffer = Vec::new();
    let mut chunk = [0u8; 4096];
    loop {
        match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(read) => {
                buffer.extend_from_slice(&chunk[..read]);
                if buffer.len() > 1_500_000 {
                    return None;
                }
            }
            Err(_) => break,
        }
    }
    let text = String::from_utf8_lossy(&buffer);
    let body = text.split("\r\n\r\n").nth(1)?;
    serde_json::from_str(body).ok()
}

pub fn read_engine_health(engine_port: u16) -> Option<EngineHealth> {
    let value = http_get_json(engine_port, "/api/health")?;
    EngineHealth::from_json(&value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn health(mc_version: &str, bot_connected: bool) -> EngineHealth {
        EngineHealth {
            ok: true,
            port: "paper".into(),
            mc_connected: true,
            mc_kind: "paper".into(),
            bot_connected,
            mock: false,
            mc_version: mc_version.into(),
            plugin_version: "0.1.0".into(),
        }
    }

    fn input<'a>(
        health: Option<&'a EngineHealth>,
        paper_port_open: bool,
        client_running: bool,
        launching: &'a [String],
        errors: &'a HashMap<String, String>,
    ) -> PollInput<'a> {
        PollInput {
            engine_health: health,
            paper_port_open,
            client_running,
            client_version: if client_running { Some("26.1.2".into()) } else { None },
            other_client_version: None,
            expected_version: "26.1.2",
            client_install_dir: None,
            launching,
            errors,
            client_guide: None,
            client_adapter: None,
            bot_stalled: false,
        }
    }

    #[test]
    fn all_green_requires_every_light() {
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let (engine, paper, bot, client) = poll_lights(&input(Some(&healthy), true, true, &launching, &errors));
        assert_eq!(engine.state, STATE_READY);
        assert_eq!(paper.state, STATE_READY);
        assert_eq!(bot.state, STATE_READY);
        assert_eq!(client.state, STATE_READY);
        assert!(client.detail.contains("26.1.2"));

        let (_, _, _, client_off) = poll_lights(&input(Some(&healthy), true, false, &launching, &errors));
        assert_eq!(client_off.state, STATE_NEEDS_ACTION);
        assert!(client_off.can_start);
        assert!(!client_off.can_retry);
    }

    #[test]
    fn mock_env_is_ready_without_paper_or_client() {
        let mut mocked = health("26.1.2", false);
        mocked.mock = true;
        mocked.port = "mock".into();
        mocked.mc_kind = "mock".into();
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let (engine, paper, bot, client) = poll_lights(&input(Some(&mocked), false, false, &launching, &errors));
        assert_eq!(engine.state, STATE_READY);
        assert_eq!(paper.state, STATE_READY);
        assert_eq!(bot.state, STATE_READY);
        assert_eq!(client.state, STATE_READY);
    }

    #[test]
    fn failure_and_launching_states_are_reported() {
        let errors = HashMap::from([(KIND_PAPER.to_string(), "世界启动失败：java 缺失".to_string())]);
        let launching = vec![KIND_ENGINE.to_string()];
        let (engine, paper, _, _) = poll_lights(&input(None, false, false, &launching, &errors));
        assert_eq!(engine.state, STATE_STARTING);
        assert_eq!(paper.state, STATE_ERROR);
        assert!(paper.can_retry);
    }

    #[test]
    fn health_json_projection_handles_missing_bot() {
        let value = serde_json::json!({
            "ok": true,
            "port": "paper",
            "mc": { "kind": "paper", "connected": true, "version": "26.1.2", "pluginVersion": "0.1.0" },
            "bot": { "connected": false }
        });
        let parsed = EngineHealth::from_json(&value).expect("health");
        assert!(parsed.mc_connected);
        assert!(!parsed.bot_connected);
        assert!(!parsed.mock);
        assert_eq!(parsed.mc_version, "26.1.2");
        assert_eq!(parsed.plugin_version, "0.1.0");
    }

    #[test]
    fn client_121_running_is_needs_action_and_never_ready() {
        // 1.21.1 在跑 → client 灯不绿、提示当前版本/需要版本，且可重试。
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = Some("1.21.1".into());
        let (_, paper, _, client) = poll_lights(&poll);
        assert_eq!(paper.state, STATE_READY);
        assert_ne!(client.state, STATE_READY);
        assert_eq!(client.state, STATE_NEEDS_ACTION);
        assert!(client.can_retry);
        assert!(!client.can_start);
        assert!(client.detail.contains("1.21.1"));
        assert!(client.detail.contains("版本与本作不一致"));
        assert!(client.hint.as_deref().unwrap_or("").contains("26.1.2"));
    }

    #[test]
    fn client_card_text_does_not_expose_internal_protocol_jargon() {
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = Some("1.21.1".into());
        let (_, _, _, client) = poll_lights(&poll);
        let text = format!("{} {}", client.detail, client.hint.unwrap_or_default());
        assert!(!text.contains("协议"), "卡片不能显示内部协议号：{text}");
        assert!(!text.contains("写死"), "卡片不能显示实现口径：{text}");
        assert!(text.contains("26.1.2"));
    }

    #[test]
    fn client_26_1_family_running_is_ready() {
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = Some("26.1".into());
        let (_, _, _, client) = poll_lights(&poll);
        assert_eq!(client.state, STATE_READY);
    }

    #[test]
    fn multi_client_prefers_26_1_and_shows_other_version_note() {
        // task-18：1.21.1 + 26.1.2 同时运行 → 灯绿（26.1.2），旧版本只提示、不阻塞。
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = Some("26.1.2".into());
        poll.other_client_version = Some("1.21.1".into());
        let (_, _, _, client) = poll_lights(&poll);
        assert_eq!(client.state, STATE_READY);
        assert!(client.detail.contains("26.1.2"));
        assert!(client.detail.contains("1.21.1"));
        assert!(client.detail.contains("未关闭"));
    }

    #[test]
    fn launching_26_1_while_old_client_runs_shows_starting_not_failure() {
        // task-18：旧 1.21.1 在跑、正在启动 26.1.2 → 显示「启动中」（旧客户端不关），不是错误。
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching = vec![KIND_CLIENT.to_string()];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = Some("1.21.1".into());
        let (_, _, _, client) = poll_lights(&poll);
        assert_eq!(client.state, STATE_STARTING);
        assert!(client.detail.contains("不会关闭"));
        assert!(client.detail.contains("26.1.2"));
        assert!(!client.can_start);
    }

    #[test]
    fn running_client_with_unknown_version_is_not_green() {
        // task-16：运行中但读不到版本也必须保守处理（不能误绿）。
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.client_version = None;
        let (_, _, _, client) = poll_lights(&poll);
        assert_ne!(client.state, STATE_READY);
        assert!(client.can_retry);
        assert!(client.detail.contains("未知版本"));
    }

    #[test]
    fn paper_port_only_without_health_is_not_ready() {
        // task-16 P0：25565 端口开着但 engine 未确认（旧 1.21.1 Paper 占端口）→ 不能绿。
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let (_, paper, _, _) = poll_lights(&input(None, true, false, &launching, &errors));
        assert_ne!(paper.state, STATE_READY);
        assert_eq!(paper.state, STATE_NEEDS_ACTION);
        assert!(paper.can_retry);
        assert!(paper.detail.contains("25565"));
        assert!(paper.detail.contains("26.1.2"));
    }

    #[test]
    fn paper_wrong_version_is_error_not_ready() {
        let old_paper = health("1.21.1", false);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let (_, paper, _, _) = poll_lights(&input(Some(&old_paper), true, false, &launching, &errors));
        assert_eq!(paper.state, STATE_ERROR);
        assert!(paper.can_retry);
        assert!(paper.detail.contains("1.21.1"));
        assert!(paper.detail.contains("版本不一致"));
        assert!(paper.detail.contains("26.1.2"));
    }

    #[test]
    fn paper_26_1_health_is_ready_even_if_engine_busy() {
        let healthy = health("26.1.2", true);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let (_, paper, _, _) = poll_lights(&input(Some(&healthy), true, true, &launching, &errors));
        assert_eq!(paper.state, STATE_READY);
        assert!(paper.detail.contains("26.1.2"));
    }

    fn ready_client_light() -> EnvLight {
        EnvLight::new(STATE_READY, "《我的世界》客户端已连接")
    }

    #[test]
    fn client_loss_requires_active_session_and_seen_ready() {
        // 没有会话：掉线不算 L2 阻断（L0 里客户端灯只是 needs_action）。
        let (_, lost, seen) = apply_client_loss(ClientLossInput {
            mock: false,
            engine_ready: true,
            client_running: false,
            session_active: false,
            seen_ready: true,
            client: EnvLight::new(STATE_NEEDS_ACTION, "未运行"),
            guide: None,
            client_version_mismatch: false,
        });
        assert!(!lost);
        assert!(seen);

        // 关卡进行中 + 曾经亮过 + 现在不在 → L2 红色阻断。
        let (client, lost, seen) = apply_client_loss(ClientLossInput {
            mock: false,
            engine_ready: true,
            client_running: false,
            session_active: true,
            seen_ready: true,
            client: ready_client_light(),
            guide: Some("prism".into()),
            client_version_mismatch: false,
        });
        assert!(lost);
        assert!(seen);
        assert_eq!(client.state, STATE_ERROR);
        assert!(client.can_retry);
        assert!(client.detail.contains("进度已保留"));
        assert_eq!(client.guide.as_deref(), Some("prism"));
    }

    #[test]
    fn client_loss_message_distinguishes_version_mismatch() {
        let (client, lost, _) = apply_client_loss(ClientLossInput {
            mock: false,
            engine_ready: true,
            client_running: false,
            session_active: true,
            seen_ready: true,
            client: ready_client_light(),
            guide: None,
            client_version_mismatch: true,
        });
        assert!(lost);
        assert!(client.detail.contains("版本不匹配"));
        assert!(client.hint.as_deref().unwrap_or("").contains("26.1.2"));
    }

    #[test]
    fn client_loss_clears_when_client_returns() {
        // 模拟「关掉→重开」：重开后灯恢复 ready、lost=false，不需要手动 reset。
        let (_, lost_before, seen) = apply_client_loss(ClientLossInput {
            mock: false,
            engine_ready: true,
            client_running: false,
            session_active: true,
            seen_ready: true,
            client: ready_client_light(),
            guide: None,
            client_version_mismatch: false,
        });
        assert!(lost_before);
        let (client_after, lost_after, seen_after) = apply_client_loss(ClientLossInput {
            mock: false,
            engine_ready: true,
            client_running: true,
            session_active: true,
            seen_ready: seen,
            client: EnvLight::new(STATE_STARTING, "正在启动"),
            guide: None,
            client_version_mismatch: false,
        });
        assert!(!lost_after);
        assert!(seen_after);
        assert_eq!(client_after.state, STATE_STARTING);
    }

    #[test]
    fn mock_mode_never_blocks_on_client_loss() {
        let (_, lost, _) = apply_client_loss(ClientLossInput {
            mock: true,
            engine_ready: true,
            client_running: false,
            session_active: true,
            seen_ready: true,
            client: ready_client_light(),
            guide: None,
            client_version_mismatch: false,
        });
        assert!(!lost);
    }

    #[test]
    fn stalled_bot_becomes_actionable_instead_of_starting_forever() {
        // P1-7 回归：engine+paper 就绪、bot 未连且超过阈值 → needs_action + retry，而不是永久 starting。
        let healthy = health("26.1.2", false);
        let errors = HashMap::new();
        let launching: Vec<String> = vec![];
        let mut poll = input(Some(&healthy), true, true, &launching, &errors);
        poll.bot_stalled = true;
        let (_, _, bot, _) = poll_lights(&poll);
        assert_eq!(bot.state, STATE_NEEDS_ACTION);
        assert!(bot.can_retry);
        assert!(!bot.can_start);
    }

    #[test]
    fn client_autostart_decision_matches_l0_requirement() {
        // task-11/16：正常环境且客户端未运行/不兼容 → 自动尝试；兼容在跑、mock、显式禁用 → 跳过。
        assert!(should_autostart_client(false, false, false));
        assert!(!should_autostart_client(false, true, false));
        assert!(!should_autostart_client(true, false, false));
        assert!(!should_autostart_client(false, false, true));
    }
}
