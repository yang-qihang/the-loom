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

export function getDesktopInvoke(): DesktopInvoke | null {
  const shell = shellWindow();
  if (shell.__TAURI_INTERNALS__?.invoke) return shell.__TAURI_INTERNALS__.invoke;
  if (shell.__TAURI__?.core?.invoke) return shell.__TAURI__.core.invoke;
  return null;
}

export function isDesktopShell(): boolean {
  const shell = shellWindow();
  return !!getDesktopInvoke() || typeof shell.setAlwaysOnTop === "function" || typeof shell.setCompanionMode === "function";
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
