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
}

function shellWindow(): WindowWithShell {
  return window as unknown as WindowWithShell;
}

function hasNativeTauri(): boolean {
  const shell = shellWindow();
  return !!(shell.__TAURI_INTERNALS__?.invoke || shell.__TAURI__?.core?.invoke);
}

/**
 * Studio 是否运行在 Tauri 桌面壳里（顶层窗口或壳的 iframe 都算）。
 * 注意：Tauri 的初始化脚本会注入到子 frame（WebView2 / WebKitGTK 均如此），
 * 所以 iframe 里的 Studio 也会看到 `__TAURI_INTERNALS__`；窗口/进程能力必须再区分顶层。
 */
export function isDesktopShell(): boolean {
  if (hasNativeTauri()) return true;
  try {
    return window.parent !== window;
  } catch {
    // 跨源 iframe：比较 window.parent 与 window 本身不会抛错，这里只是兜底。
    return true;
  }
}

/**
 * 是否是顶层窗口（不是被壳 iframe 嵌入的 Studio）。
 * 只比较 window.self / window.top 引用，跨源 iframe 也安全。
 */
export function isTopLevelWindow(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.self === window.top;
  } catch {
    return false;
  }
}

/** Studio 是否被桌面壳以 iframe 嵌入（此时标题栏/系统控制归桌面壳所有）。 */
export function isEmbeddedFrame(): boolean {
  return !isTopLevelWindow();
}

export function getDesktopInvoke(): DesktopInvoke | null {
  const shell = shellWindow();
  if (shell.__TAURI_INTERNALS__?.invoke) return shell.__TAURI_INTERNALS__.invoke;
  if (shell.__TAURI__?.core?.invoke) return shell.__TAURI__.core.invoke;
  // Studio 在 iframe 里时通过壳的 postMessage 桥转发（见 apps/desktop/shell/shell.js）。
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
