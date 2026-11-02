import { useCallback, useEffect } from "react";
import { getDesktopInvoke } from "../desktop";

/** 桌面壳的自绘标题栏：去掉各平台系统窗框，统一成像素风。浏览器里不渲染。 */
export function DesktopTitlebar() {
  useEffect(() => {
    document.body.classList.add("desktop-shell");
    return () => document.body.classList.remove("desktop-shell");
  }, []);

  const control = useCallback((command: string) => {
    const invoke = getDesktopInvoke();
    if (invoke) void invoke(command).catch(() => {});
  }, []);

  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest(".dtitle-controls")) return;
    if (event.button !== 0) return;
    control("window_start_drag");
  };

  return (
    <header className="desktop-titlebar" data-testid="desktop-titlebar" data-tauri-drag-region role="banner" onPointerDown={startDrag}>
      <div className="dtitle-brand" data-tauri-drag-region>
        <span className="dtitle-mark" aria-hidden="true" />
        <span className="dtitle-name">织界</span>
        <span className="dtitle-sub">THE LOOM</span>
      </div>
      <div className="dtitle-drag" data-tauri-drag-region onDoubleClick={() => control("window_toggle_maximize")} />
      <div className="dtitle-controls">
        <button type="button" className="dtitle-btn" onClick={() => control("window_minimize")} aria-label="最小化窗口" title="最小化" data-testid="btn-win-min">
          <svg className="dtitle-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
          </svg>
        </button>
        <button type="button" className="dtitle-btn" onClick={() => control("window_toggle_maximize")} aria-label="最大化或还原窗口" title="最大化 / 还原" data-testid="btn-win-max">
          <svg className="dtitle-icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
        <button type="button" className="dtitle-btn is-close" onClick={() => control("window_close")} aria-label="关闭窗口" title="关闭" data-testid="btn-win-close">
          <svg className="dtitle-icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
          </svg>
        </button>
      </div>
    </header>
  );
}
