/* iframe 命令桥的来源与输入边界；原生窗口权限仍由 Tauri 控制。 */
export const DEFAULT_ENGINE_URL = "http://127.0.0.1:4317";
export function normalizeEngineUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
export const BRIDGE_COMMANDS = new Set([
  "env_state", "env_refresh", "env_probe", "env_cancel", "engine_ready", "client_running",
  "start_engine", "start_paper", "start_bot", "start_all", "launch_client", "client_prepare",
  "restart_client_and_reconnect", "open_launcher_download", "open_logs",
  "get_settings", "save_settings", "toggle_pin", "set_pin", "set_mode",
  "window_close", "window_minimize", "window_toggle_maximize", "window_start_drag",
  "open_textbook_window",
]);
export function trustedFrameMessage(event, frameWindow, shellOrigin, engineOrigin) {
  return event.source === frameWindow && [shellOrigin, engineOrigin].includes(event.origin);
}
export function bridgeArgs(command, args) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  if (command !== "save_settings" || !args.settings || typeof args.settings !== "object") return args;
  const settings = { ...args.settings };
  if (typeof settings.prismCommand === "string") settings.prismCommand = settings.prismCommand.replace(/[;&|`$<>\r\n]/g, "");
  return { ...args, settings };
}
