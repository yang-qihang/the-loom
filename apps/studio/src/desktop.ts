/** 桌面壳（Tauri）能力探测：浏览器开发环境下全部返回空，按钮隐藏。 */
export type DesktopInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

interface TauriInternals {
  invoke?: DesktopInvoke;
}
interface TauriGlobal {
  core?: { invoke?: DesktopInvoke };
}
interface WindowWithShell {
  __TAURI_INTERNALS__?: TauriInternals;
  __TAURI__?: TauriGlobal;
  setAlwaysOnTop?: (value: boolean) => void;
  setCompanionMode?: (value: boolean) => void;
}

function shellWindow(): WindowWithShell {
  return window as unknown as WindowWithShell;
}

function hasNativeTauri(): boolean {
  const shell = shellWindow();
  return !!(shell.__TAURI_INTERNALS__?.invoke || shell.__TAURI__?.core?.invoke);
}

export function getDesktopInvoke(): DesktopInvoke | null {
  const shell = shellWindow();
  if (shell.__TAURI_INTERNALS__?.invoke) return shell.__TAURI_INTERNALS__.invoke;
  if (shell.__TAURI__?.core?.invoke) return shell.__TAURI__.core.invoke;
  // Tauri 只把原生 IPC 注入主 frame；Studio 在 iframe 里时通过壳的 postMessage 桥转发。
  if (typeof window !== "undefined" && window.parent && window.parent !== window) {
    return (command, args) => new Promise((resolve, reject) => {
      const id = `studio-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", onMessage);
        reject(new Error(`desktop bridge timeout: ${command}`));
      }, 5000);
      const onMessage = (event: MessageEvent) => {
        const data = event.data as { type?: string; id?: string; ok?: boolean; result?: unknown; error?: string } | null;
        if (!data || data.type !== "loom:invoke-result" || data.id !== id) return;
        window.clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        if (data.ok) resolve(data.result);
        else reject(new Error(data.error || "desktop bridge failed"));
      };
      window.addEventListener("message", onMessage);
      window.parent.postMessage({ type: "loom:invoke", id, command, args: args ?? {} }, "*");
    });
  }
  return null;
}

export function isDesktopShell(): boolean {
  const shell = shellWindow();
  return hasNativeTauri() || typeof shell.setAlwaysOnTop === "function" || typeof shell.setCompanionMode === "function";
}

export async function setAlwaysOnTop(value: boolean): Promise<boolean> {
  const invoke = getDesktopInvoke();
  if (invoke) {
    await invoke("set_always_on_top", { value });
    return true;
  }
  const fallback = shellWindow().setAlwaysOnTop;
  if (fallback) {
    fallback(value);
    return true;
  }
  return false;
}

export async function setCompanionMode(value: boolean): Promise<boolean> {
  const invoke = getDesktopInvoke();
  if (invoke) {
    await invoke("set_companion_mode", { value });
    return true;
  }
  const fallback = shellWindow().setCompanionMode;
  if (fallback) {
    fallback(value);
    return true;
  }
  return false;
}
