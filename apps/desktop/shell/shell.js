import { DEFAULT_ENGINE_URL, normalizeEngineUrl, BRIDGE_COMMANDS, trustedFrameMessage, bridgeArgs } from "./shell-policy.js";
/* 织界桌面壳：标题栏按钮 + iframe 路由 + Tauri 命令桥。 */
const tauri = window.__TAURI__;
const invoke = (command, args) => tauri.core.invoke(command, args);

const els = {
  iframe: document.getElementById("content"),
  pin: document.getElementById("btn-pin"),
  mode: document.getElementById("btn-mode"),
  settings: document.getElementById("btn-settings"),
  modal: document.getElementById("settings-modal"),
  setPin: document.getElementById("set-pin"),
  setCompanion: document.getElementById("set-companion"),
  setPrism: document.getElementById("set-prism"),
  setScale: document.getElementById("set-scale"),
  openLogs: document.getElementById("btn-open-logs"),
  closeSettings: document.getElementById("btn-close-settings"),
  toast: document.getElementById("toast"),
  connEngine: document.getElementById("conn-engine"),
  connPaper: document.getElementById("conn-paper"),
  connBot: document.getElementById("conn-bot"),
  connClient: document.getElementById("conn-client"),
};

let settings = { alwaysOnTop: false, mode: "workbench", page: "wizard", uiScale: 0.8 };
let currentSession = null;
let currentLevel = null;
// 迁移旧版开发地址：新自包含包内置引擎在 4317，旧的 4320 外部地址只会让 Studio 连错。
try {
  const savedEngine = localStorage.getItem("loom.engineUrl");
  if (savedEngine && /^http:\/\/127\.0\.0\.1:4320\/?$/.test(savedEngine)) localStorage.removeItem("loom.engineUrl");
} catch { /* ignore */ }
try {
  const savedScale = Number(localStorage.getItem("loom.uiScale"));
  if (savedScale >= 0.7 && savedScale <= 1.2) settings.uiScale = savedScale;
} catch { /* ignore */ }

function currentEngineUrl() {
  try { return normalizeEngineUrl(localStorage.getItem("loom.engineUrl")) || DEFAULT_ENGINE_URL; }
  catch { return DEFAULT_ENGINE_URL; }
}

let currentEnv = null;
function sendFrame(data) {
  try { els.iframe.contentWindow?.postMessage(data, "*"); } catch { /* frame navigating */ }
}
function applyUiScale() {
  // Studio 与壳跨源；用消息即时缩放，不重新加载学生编辑器。
  sendFrame({ type: "loom:scale", scale: settings.uiScale });
  try {
    const doc = els.iframe?.contentDocument;
    if (doc?.documentElement) doc.documentElement.style.zoom = String(settings.uiScale);
  } catch { /* cross-origin Studio consumes loom:scale */ }
}
function updateSession(sessionId, levelId) {
  currentSession = sessionId || null;
  currentLevel = levelId || null;
  void invoke("set_game_session", { sessionId: currentSession, levelId: currentLevel }).catch(() => {});
}
function showQuitConfirmation() {
  document.getElementById("quit-modal").hidden = false;
  void invoke("quit_ack").catch(() => {});
}
function applyEnv(env) {
  if (!env || typeof env !== "object") return;
  currentEnv = env;
  for (const key of ["engine", "paper", "bot", "client"]) {
    const light = env[key];
    const state = env.mock ? "mock" : light?.state === "ready" ? "ok"
      : light?.state === "error" ? "bad" : ["checking", "starting"].includes(light?.state) ? "busy" : "off";
    setConn(els["conn" + key[0].toUpperCase() + key.slice(1)], state, light?.detail || "");
  }
  document.getElementById("client-lost-modal").hidden = !env.clientLost;
  sendFrame({ type: "loom:env", env });
  sendFrame({ type: "loom:conn", client: env.client?.state === "ready" });
}

function toast(text) {
  els.toast.textContent = text;
  els.toast.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    els.toast.hidden = true;
  }, 2400);
}

function renderPin() {
  els.pin.textContent = settings.alwaysOnTop ? "取消置顶" : "置顶";
  els.setPin.checked = settings.alwaysOnTop;
}

function renderMode() {
  const companion = settings.mode === "companion";
  els.mode.textContent = companion ? "工作台" : "伴玩";
  els.setCompanion.checked = companion;
  document.body.classList.toggle("companion", companion);
}

let pendingPage = null;
let pendingTimer = null;

function frameUrl(page) {
  if (page === "wizard") return "./wizard.html";
  const engine = currentEngineUrl();
  const params = new URLSearchParams();
  params.set("engine", engine);
  params.set("scale", String(settings.uiScale));
  // WebView 可能缓存旧 Studio HTML；每次启动带 version 查询，避免桌面停留在旧 CSS/JS。
  params.set("v", String(Date.now()));
  if (page === "companion") {
    if (currentSession) params.set("session", currentSession);
    if (currentLevel) params.set("level", currentLevel);
    return `${engine}/companion.html?${params.toString()}`;
  }
  return `${engine}/studio/index.html?${params.toString()}`;
}

async function waitEngineThen(page, attempt = 0) {
  if (page !== pendingPage) return;
  let ready = false;
  try { ready = await invoke("engine_ready"); } catch { /* fallback below */ }
  if (!ready) {
    try {
      const base = currentEngineUrl();
      const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(700) });
      ready = response.ok;
    } catch { /* still booting */ }
  }
  if (page !== pendingPage) return;
  if (ready) {
    pendingPage = null;
    els.iframe.src = frameUrl(page);
    return;
  }
  if (attempt > 120) { pendingPage = null; return; }
  pendingTimer = setTimeout(() => void waitEngineThen(page, attempt + 1), 500);
}

function show(page) {
  if (!["wizard", "workbench", "companion"].includes(page)) return;
  if (page !== "wizard" && currentEnv?.versionBlocked) { toast("客户端版本不匹配，请先准备 26.1.2。"); return; }
  if (page === "wizard") updateSession(null, null);
  settings.page = page;
  void invoke("save_settings", { settings }).catch(() => {});
  if (page === "wizard") {
    pendingPage = null;
    if (pendingTimer) clearTimeout(pendingTimer);
    els.iframe.src = "./wizard.html";
    return;
  }
  pendingPage = page;
  if (pendingTimer) clearTimeout(pendingTimer);
  // 引擎还没起来时先显示本地向导，避免 iframe 对着 connection refused 永久白屏。
  els.iframe.src = "./wizard.html";
  void waitEngineThen(page, 0);
}

async function loadSettings() {
  try {
    const loaded = await invoke("get_settings");
    if (loaded) settings = { ...settings, ...loaded };
  } catch {
    toast("读取设置失败，使用默认值");
  }
  // 修复历史坏状态：伴玩模式只能承载 companion 页面；向导/工作台必须是完整窗口，
  // 否则 Linux/Windows 首启会把设置向导塞进 420×620 小窗。
  if (settings.mode === "companion" && settings.page !== "companion") {
    settings.mode = "workbench";
    try { await invoke("set_mode", { mode: "workbench" }); } catch { /* old shell */ }
  }
  renderPin();
  renderMode();
  els.setPrism.value = settings.prismCommand ?? "flatpak run org.prismlauncher.PrismLauncher";
  els.setScale.value = String(settings.uiScale);
  applyUiScale();
  show(settings.page === "companion" ? "companion" : settings.page === "workbench" ? "workbench" : "wizard");
}

function setConn(el, state, title) {
  if (!el) return;
  el.dataset.state = state;
  el.title = title || "";
}
async function refreshStatus() {
  try {
    const env = await invoke("env_state");
    if (env?.engine && env?.client) { applyEnv(env); return; }
  } catch { /* old shell falls back to health */ }
  let health = null;
  try {
    const base = currentEngineUrl();
    const response = await fetch(base + "/api/health", { signal: AbortSignal.timeout(1800) });
    health = await response.json();
  } catch { /* engine offline */ }
  const engineOk = !!health?.ok;
  const isMock = health?.port === "mock";
  const paperOk = !isMock && health?.mc?.kind === "paper" && health?.mc?.connected === true;
  const botOk = !isMock && health?.bot?.connected === true;
  setConn(els.connEngine, engineOk ? "ok" : "off", engineOk ? "织机已连接" : "织机未连接");
  setConn(els.connPaper, isMock ? "mock" : paperOk ? "ok" : "bad", isMock ? "Mock 试玩：未连接 Paper" : paperOk ? "Paper 26.1.2 已连接" : "Paper / 插件未连接");
  setConn(els.connBot, isMock ? "mock" : botOk ? "ok" : "bad", isMock ? "Mock 试玩：没有真实织偶" : botOk ? "mineflayer 织偶已进服" : "mineflayer 织偶未连接");
  let clientOk = false;
  try { clientOk = !!(await invoke("client_running")); } catch { /* old shell */ }
  setConn(els.connClient, clientOk ? "ok" : "off", clientOk ? "我的世界客户端正在运行" : "我的世界客户端未检测到");
  try { els.iframe.contentWindow?.postMessage({ type: "loom:conn", client: clientOk }, "*"); } catch { /* ignore */ }
}

els.pin.addEventListener("click", async () => {
  try {
    const value = await invoke("toggle_pin");
    settings.alwaysOnTop = !!value;
    renderPin();
    toast(settings.alwaysOnTop ? "已置顶：《我的世界》最大化时织界仍可见" : "已取消置顶");
  } catch (error) {
    toast(`置顶失败：${error}`);
  }
});

document.getElementById("btn-snap")?.addEventListener("click", async () => {
  try {
    await invoke("snap_half");
    settings.alwaysOnTop = true;
    renderPin();
    toast("半屏 + 置顶：点织界任意处回到代码，Minecraft 全屏留在后面");
  } catch (error) {
    toast(`半屏失败：${error}`);
  }
});
els.mode.addEventListener("click", async () => {
  const next = settings.mode === "companion" ? "workbench" : "companion";
  try {
    await invoke("set_mode", { mode: next });
    settings.mode = next;
    renderMode();
    show(next === "companion" ? "companion" : "workbench");
    toast(next === "companion" ? "伴玩模式：小窗跟随，随时运行" : "已回到完整工作台");
  } catch (error) {
    toast(`切换模式失败：${error}`);
  }
});

els.settings.addEventListener("click", () => {
  els.modal.hidden = false;
});
els.closeSettings.addEventListener("click", () => {
  els.modal.hidden = true;
});
els.setPin.addEventListener("change", async () => {
  const value = await invoke("set_pin", { value: els.setPin.checked });
  settings.alwaysOnTop = !!value;
  renderPin();
});
els.setCompanion.addEventListener("change", async () => {
  const mode = els.setCompanion.checked ? "companion" : "workbench";
  await invoke("set_mode", { mode });
  settings.mode = mode;
  renderMode();
  show(mode === "companion" ? "companion" : "workbench");
});
els.setScale.addEventListener("change", async () => {
  settings.uiScale = Number(els.setScale.value) || 0.8;
  try { localStorage.setItem("loom.uiScale", String(settings.uiScale)); } catch { /* ignore */ }
  applyUiScale();
  await invoke("save_settings", { settings }).catch(() => {});
});
els.setPrism.addEventListener("change", async () => {
  settings.prismCommand = els.setPrism.value.trim();
  await invoke("save_settings", { settings });
  toast("启动器启动命令已保存");
});
els.openLogs.addEventListener("click", async () => {
  try {
    await invoke("open_logs");
  } catch (error) {
    toast(`打开日志目录失败：${error}`);
  }
});

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || typeof data !== "object") return;
  if (!trustedFrameMessage(event, els.iframe.contentWindow, location.origin, currentEngineUrl())) return;
  if (data.type === "loom:session") {
    if (!data.sessionId && settings.page === "companion") return;
    if (!data.sessionId && data.previousSessionId && data.previousSessionId !== currentSession) return;
    updateSession(data.sessionId, data.levelId);
    return;
  }
  if (data.type === "loom:request-quit") { showQuitConfirmation(); return; }
  if (data.type === "loom:invoke") {
    // iframe 里没有 window.__TAURI__（Tauri 只注入主 frame），由壳代发命令。
    const source = event.source;
    if (!source || typeof source.postMessage !== "function") return;
    if (!BRIDGE_COMMANDS.has(data.command)) {
      source.postMessage({ type: "loom:invoke-result", id: data.id, ok: false, error: "命令不在白名单" }, event.origin);
      return;
    }
    invoke(data.command, bridgeArgs(data.command, data.args)).then(
      result => source.postMessage({ type: "loom:invoke-result", id: data.id, ok: true, result }, event.origin),
      error => source.postMessage({ type: "loom:invoke-result", id: data.id, ok: false, error: String(error) }, event.origin),
    );
    return;
  }
  if (data.type === "loom:navigate") {
    const page = data.page === "workbench" ? "workbench" : data.page;
    // 伴玩里点「返回工作台」必须先把窗口尺寸恢复，否则 1280 宽的工作台会被塞进 420 小窗。
    if (page === "workbench" && settings.mode === "companion") {
      void invoke("set_mode", { mode: "workbench" }).then(() => {
        settings.mode = "workbench";
        renderMode();
        show("workbench");
      }).catch(error => toast(`切换工作台失败：${error}`));
      return;
    }
    show(page);
  }
  if (data.type === "loom:toast" && data.text) toast(String(data.text).slice(0, 500));
});

window.addEventListener("loom:status", refreshStatus);

await applyTauriEvents();
async function applyTauriEvents() {
  if (!tauri?.event) return;
  const listen = async (topic, callback) => {
    try { await tauri.event.listen(topic, callback); }
    catch (error) { console.warn(`桌面事件订阅失败 ${topic}`, error); }
  };
  await listen("loom://env", event => applyEnv(event.payload));
  await listen("loom://quit-requested", showQuitConfirmation);
  await listen("loom://restore-companion", () => {
    settings.mode = "workbench";
    renderMode();
    show("workbench");
  });
  await listen("loom://session-changed", event => {
    currentSession = event.payload?.sessionId || null;
    currentLevel = event.payload?.levelId || null;
  });
  await listen("loom://pin", event => {
    settings.alwaysOnTop = !!event.payload;
    renderPin();
    toast(settings.alwaysOnTop ? "已置顶（按控制键、上档键和 L 可切换）" : "已取消置顶");
  });
  await listen("loom://mode", event => {
    settings.mode = event.payload === "companion" ? "companion" : "workbench";
    renderMode();
  });
}

await loadSettings();
document.getElementById("boot-splash")?.classList.add("is-hidden");
try { await invoke("show_main_window"); } catch { /* old shell */ }
void refreshStatus();
setInterval(refreshStatus, 2000);
window.__loomShell = { show, toast };

/* ---- T9：自绘标题栏窗口控制（Rust 命令）+ 原生行为收口 ---- */
const winBar = document.getElementById("loom-bar");
const winMin = document.getElementById("btn-win-min");
const winMax = document.getElementById("btn-win-max");
const winClose = document.getElementById("btn-win-close");

async function windowCommand(command) {
  try {
    await invoke(command);
  } catch (error) {
    toast(`窗口操作失败：${error}`);
  }
}

winMin?.addEventListener("click", () => void windowCommand("window_minimize"));
winMax?.addEventListener("click", () => void windowCommand("window_toggle_maximize"));
winClose?.addEventListener("click", () => void windowCommand("window_close"));
// 拖动兜底：即使 WebKit 的 data-tauri-drag-region 在某个平台失效，标题栏空白处也能拖。
winBar?.addEventListener("pointerdown", event => {
  const target = event.target;
  if (target instanceof Element && target.closest(".bar-actions, button, input, textarea, select, a")) return;
  if (event.button !== 0) return;
  void windowCommand("window_start_drag");
});

winBar?.addEventListener("dblclick", event => {
  if (event.target instanceof Element && event.target.closest(".bar-actions")) return;
  void windowCommand("window_toggle_maximize");
});

/* 原生行为收口：禁浏览器右键菜单/F12/Ctrl+Shift+I/刷新/文件拖入；输入框、编辑区保留复制粘贴。 */
const EDITABLE_SELECTOR = ["input", "textarea", "[contenteditable='true']", ".monaco-editor", ".codex-code", "pre", "code"].join(",");

function isEditableTarget(target) {
  // 注意：iframe 内的 Element 与主框架不属于同一 realm，instanceof 会失效；
  // 用结构化判断（nodeType + closest）保证 iframe 内的编辑器/输入框也能保留右键菜单。
  const element = target && target.nodeType === 1 ? target : null;
  return !!element && typeof element.closest === "function" && !!element.closest(EDITABLE_SELECTOR);
}

function installNativeGuard(doc) {
  if (!doc || doc.__loomNativeGuard) return;
  try {
    Object.defineProperty(doc, "__loomNativeGuard", { value: true });
  } catch {
    doc.__loomNativeGuard = true;
  }
  const onContextMenu = event => {
    if (!isEditableTarget(event.target)) event.preventDefault();
  };
  const onKeyDown = event => {
    const mod = event.ctrlKey || event.metaKey;
    const key = String(event.key || "").toLowerCase();
    const blocked =
      event.key === "F5" ||
      event.key === "F12" ||
      (mod && (key === "r" || key === "u" || (event.shiftKey && (key === "i" || key === "j" || key === "c"))));
    if (blocked) {
      event.preventDefault();
      event.stopPropagation();
    }
  };
  const prevent = event => event.preventDefault();
  doc.addEventListener("contextmenu", onContextMenu, true);
  doc.addEventListener("keydown", onKeyDown, true);
  doc.addEventListener("dragover", prevent, true);
  doc.addEventListener("drop", prevent, true);
  doc.addEventListener("auxclick", event => {
    if (event.button === 1 && !isEditableTarget(event.target)) event.preventDefault();
  }, true);
}

installNativeGuard(document);
function guardFrame() {
  try {
    installNativeGuard(els.iframe.contentWindow?.document ?? null);
  } catch {
    // 跨源页面无法注入时静默跳过（当前 Studio 为同源）。
  }
}
els.iframe.addEventListener("load", () => {
  if (currentEnv) sendFrame({ type: "loom:env", env: currentEnv });
  applyUiScale();
  guardFrame();
});
guardFrame();

document.getElementById("btn-quit-cancel").addEventListener("click", async () => {
  try { await invoke("quit_cancel"); document.getElementById("quit-modal").hidden = true; }
  catch (error) { toast(`取消退出失败：${error}`); }
});
document.getElementById("btn-quit-confirm").addEventListener("click", () => {
  void invoke("quit_game").catch(error => toast(`退出失败：${error}`));
});
document.getElementById("btn-client-reconnect").addEventListener("click", async event => {
  event.currentTarget.disabled = true;
  try { const result = await invoke("restart_client_and_reconnect"); toast(result?.detail || "正在重新连接"); }
  catch (error) { toast(`重连失败：${error}`); }
  finally { document.getElementById("btn-client-reconnect").disabled = false; }
});
document.getElementById("btn-client-home").addEventListener("click", async () => {
  await invoke("set_mode", { mode: "workbench" });
  settings.mode = "workbench"; renderMode(); show("wizard");
});
document.getElementById("btn-client-quit").addEventListener("click", showQuitConfirmation);
