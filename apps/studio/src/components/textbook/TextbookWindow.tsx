import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { RichText } from "../RichText";
import { createPortal } from "react-dom";
import { getDesktopInvoke } from "../../desktop";
import { TextbookContent, textbookSections } from "./TextbookContent";
import type { TextbookLibrary } from "../../textbook/types";
import "./textbook.css";

/**
 * 配套教材浮动窗口（task-6 / docs/49 §2.5）。
 *
 * 非模态：createPortal 到 document.body，不锁页面滚动、不做焦点陷阱。
 * 开合由父组件挂载/卸载控制；本组件只用 localStorage 持久化「窗口几何 + 置顶」，
 * 不持久化开合、也不读全局阅读状态（当前章节由 currentId + onNavigate 驱动）。
 *
 * 交互：
 * - 拖动标题栏移动（夹在视口内，四周留 8px）；右下角把手缩放（最小 420×320，最大视口−16）；
 * - 置顶：pinned 时 z-index 85，否则 60（低于模态层级，见报告「遗留风险」）；
 * - 关闭按钮 / 底部主按钮「开始写代码」/ 窗口获得焦点时按 Esc → onClose；
 * - 上一章/下一章（按 chapter.order 排序）+ 可选章节内目录（h2 列表，点击滚动）。
 */

export const TEXTBOOK_WINDOW_STORAGE_KEY = "loom.textbook.window.v1";
export const TEXTBOOK_MIN_WIDTH = 420;
export const TEXTBOOK_MIN_HEIGHT = 320;
export const TEXTBOOK_VIEWPORT_MARGIN = 8;
export const TEXTBOOK_DEFAULT_WIDTH = 980;
export const TEXTBOOK_DEFAULT_HEIGHT = 760;
/** 窗口宽度小于该值时正文单列、隐藏侧边目录。 */
export const TEXTBOOK_COMPACT_WIDTH = 900;
export const TEXTBOOK_UNPINNED_Z_INDEX = 60;
export const TEXTBOOK_PINNED_Z_INDEX = 85;

export interface TextbookWindowProps {
  chapters: TextbookLibrary;
  currentId: string;
  onNavigate: (id: string) => void;
  onClose: () => void;
  className?: string;
  /** 由桌面壳的独立 WebviewWindow 承载：不使用 DOM 内拖拽/缩放，标题栏拖动交给 Tauri。 */
  standalone?: boolean;
}

interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StoredWindowState extends WindowGeometry {
  pinned: boolean;
}

interface ViewportSize {
  width: number;
  height: number;
}

function viewportSize(): ViewportSize {
  if (typeof window === "undefined") return { width: 1280, height: 800 };
  return { width: window.innerWidth || 1280, height: window.innerHeight || 800 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function clampGeometry(geometry: WindowGeometry, viewport: ViewportSize): WindowGeometry {
  const maxWidth = Math.max(TEXTBOOK_MIN_WIDTH, viewport.width - TEXTBOOK_VIEWPORT_MARGIN * 2);
  const maxHeight = Math.max(TEXTBOOK_MIN_HEIGHT, viewport.height - TEXTBOOK_VIEWPORT_MARGIN * 2);
  const width = Math.round(clamp(geometry.width, TEXTBOOK_MIN_WIDTH, maxWidth));
  const height = Math.round(clamp(geometry.height, TEXTBOOK_MIN_HEIGHT, maxHeight));
  const x = Math.round(
    clamp(geometry.x, TEXTBOOK_VIEWPORT_MARGIN, Math.max(TEXTBOOK_VIEWPORT_MARGIN, viewport.width - width - TEXTBOOK_VIEWPORT_MARGIN)),
  );
  const y = Math.round(
    clamp(geometry.y, TEXTBOOK_VIEWPORT_MARGIN, Math.max(TEXTBOOK_VIEWPORT_MARGIN, viewport.height - height - TEXTBOOK_VIEWPORT_MARGIN)),
  );
  return { x, y, width, height };
}

function defaultGeometry(viewport: ViewportSize): WindowGeometry {
  const width = clamp(TEXTBOOK_DEFAULT_WIDTH, TEXTBOOK_MIN_WIDTH, Math.max(TEXTBOOK_MIN_WIDTH, viewport.width - TEXTBOOK_VIEWPORT_MARGIN * 2));
  const height = clamp(TEXTBOOK_DEFAULT_HEIGHT, TEXTBOOK_MIN_HEIGHT, Math.max(TEXTBOOK_MIN_HEIGHT, viewport.height - TEXTBOOK_VIEWPORT_MARGIN * 2));
  return {
    x: Math.round((viewport.width - width) / 2),
    y: Math.round(Math.max(TEXTBOOK_VIEWPORT_MARGIN, (viewport.height - height) / 2)),
    width,
    height,
  };
}

function readStoredWindowState(): StoredWindowState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(TEXTBOOK_WINDOW_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    const numbers = [record.x, record.y, record.width, record.height];
    if (!numbers.every((value) => typeof value === "number" && Number.isFinite(value))) return null;
    return {
      x: record.x as number,
      y: record.y as number,
      width: record.width as number,
      height: record.height as number,
      pinned: record.pinned === true,
    };
  } catch {
    // 损坏的 JSON / 隐私模式禁用 localStorage：退回默认几何，不阻塞阅读。
    return null;
  }
}

function writeStoredWindowState(geometry: WindowGeometry, pinned: boolean): void {
  if (typeof window === "undefined") return;
  try {
    const payload: StoredWindowState = { ...geometry, pinned };
    window.localStorage.setItem(TEXTBOOK_WINDOW_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // 配额满或被禁用时忽略：窗口仍可拖动/缩放，只是不持久化。
  }
}

interface DragOrigin {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface ResizeOrigin {
  pointerId: number;
  startX: number;
  startY: number;
  originWidth: number;
  originHeight: number;
}

const TITLEBAR_BUTTON_SELECTOR = "button, a, input, textarea, select, [role='button'], [data-no-drag]";

export function TextbookWindow({
  chapters,
  currentId,
  onNavigate,
  onClose,
  className,
  standalone = false,
}: TextbookWindowProps): ReactNode {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragOrigin | null>(null);
  const resizeRef = useRef<ResizeOrigin | null>(null);

  const [geometry, setGeometry] = useState<WindowGeometry>(() => {
    const viewport = viewportSize();
    const stored = readStoredWindowState();
    return stored ? clampGeometry(stored, viewport) : defaultGeometry(viewport);
  });
  const [pinned, setPinned] = useState<boolean>(() => readStoredWindowState()?.pinned ?? false);
  const [dragging, setDragging] = useState(false);

  // 独立窗口的「置顶」必须落到原生窗口，不能只改 DOM z-index；这里把持久化的初值同步过去。
  useEffect(() => {
    if (!standalone) return;
    const invoke = getDesktopInvoke();
    if (!invoke) return;
    void invoke("set_textbook_pin", { value: pinned }).catch(() => {});
  }, [pinned, standalone]);

  const orderedChapters = useMemo(
    () => Object.values(chapters).sort((a, b) => a.order - b.order || a.levelId.localeCompare(b.levelId)),
    [chapters],
  );
  const chapter = chapters[currentId] ?? null;
  const currentIndex = chapter ? orderedChapters.findIndex((entry) => entry.levelId === chapter.levelId) : -1;
  const previousChapter = currentIndex > 0 ? orderedChapters[currentIndex - 1] : null;
  const nextChapter = currentIndex >= 0 && currentIndex < orderedChapters.length - 1 ? orderedChapters[currentIndex + 1] : null;
  const sections = useMemo(() => (chapter ? textbookSections(chapter) : []), [chapter]);
  const compact = (standalone ? viewportSize().width : geometry.width) < TEXTBOOK_COMPACT_WIDTH;

  // 几何/置顶变化后落盘（拖动过程中只在停手后写一次，避免每帧写 localStorage）。
  useEffect(() => {
    const timer = window.setTimeout(() => writeStoredWindowState(geometry, pinned), 120);
    return () => window.clearTimeout(timer);
  }, [geometry, pinned]);

  // 浏览器窗口变小时把教材留在视口内（窗口本身的位置/尺寸不反向影响视口）。
  useEffect(() => {
    const onViewportResize = (): void => {
      setGeometry((current) => clampGeometry(current, viewportSize()));
    };
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, []);

  // 章节切换时正文回到顶部（目录/滚动位置不跨章残留）。
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [chapter?.levelId]);

  const focusWindow = useCallback((): void => {
    const root = rootRef.current;
    if (!root) return;
    if (!root.contains(document.activeElement)) root.focus({ preventScroll: true });
  }, []);

  const togglePinned = useCallback((): void => {
    setPinned((value) => !value);
  }, []);

  const onRootPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      // 点击窗口内任意非按钮区域都让窗口拿到焦点，这样 Esc 的「窗口焦点内」语义成立。
      const target = event.target as HTMLElement | null;
      if (target?.closest(TITLEBAR_BUTTON_SELECTOR)) return;
      focusWindow();
    },
    [focusWindow],
  );

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    },
    [onClose],
  );

  const onTitlebarPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>): void => {
      if (event.button !== 0) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(TITLEBAR_BUTTON_SELECTOR)) return;
      event.preventDefault();
      if (standalone) {
        const invoke = getDesktopInvoke();
        if (invoke) void invoke("window_start_drag").catch(() => {});
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: geometry.x,
        originY: geometry.y,
      };
      setDragging(true);
    },
    [geometry.x, geometry.y, standalone],
  );

  const onTitlebarPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (standalone) return;
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    setGeometry((current) =>
      clampGeometry({ ...current, x: drag.originX + dx, y: drag.originY + dy }, viewportSize()),
    );
  }, [standalone]);

  const finishDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    if (standalone) {
      const invoke = getDesktopInvoke();
      if (invoke) void invoke("textbook_start_resize", { direction: "south-east" }).catch(() => {});
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    resizeRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originWidth: geometry.width,
      originHeight: geometry.height,
    };
  }, [geometry.height, geometry.width, standalone]);

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    if (standalone) return;
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const dx = event.clientX - resize.startX;
    const dy = event.clientY - resize.startY;
    setGeometry((current) =>
      clampGeometry(
        {
          x: current.x,
          y: current.y,
          width: resize.originWidth + dx,
          height: resize.originHeight + dy,
        },
        viewportSize(),
      ),
    );
  }, [standalone]);

  const finishResize = useCallback((event: ReactPointerEvent<HTMLDivElement>): void => {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  const onTitlebarLostPointerCapture = useCallback((): void => {
    dragRef.current = null;
    setDragging(false);
  }, []);

  const onResizeLostPointerCapture = useCallback((): void => {
    resizeRef.current = null;
  }, []);

  const scrollToSection = useCallback((anchorId: string): void => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const target = scroller.querySelector<HTMLElement>(`#${anchorId}`);
    if (!target) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 12;
    scroller.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
  }, []);

  if (typeof document === "undefined") return null;

  const windowClassName = ["tb-window", standalone ? "tb-window-standalone" : "", className].filter(Boolean).join(" ");
  const counterText = chapter && currentIndex >= 0 ? `第 ${currentIndex + 1} / ${orderedChapters.length} 章` : "—";

  return createPortal(
    <div
      ref={rootRef}
      className={windowClassName}
      style={
        standalone
          ? { position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }
          : {
              left: geometry.x,
              top: geometry.y,
              width: geometry.width,
              height: geometry.height,
              zIndex: pinned ? TEXTBOOK_PINNED_Z_INDEX : TEXTBOOK_UNPINNED_Z_INDEX,
            }
      }
      role="dialog"
      aria-modal={false}
      aria-label={chapter ? `配套教材：${chapter.title}` : "配套教材"}
      tabIndex={-1}
      data-testid="textbook-window"
      data-pinned={pinned ? "true" : "false"}
      data-standalone={standalone ? "true" : "false"}
      data-compact={compact ? "true" : "false"}
      data-dragging={dragging ? "true" : "false"}
      onKeyDown={onKeyDown}
      onPointerDown={onRootPointerDown}
    >
      <div
        className="tb-titlebar"
        data-testid="textbook-titlebar"
        onPointerDown={onTitlebarPointerDown}
        onPointerMove={onTitlebarPointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onLostPointerCapture={onTitlebarLostPointerCapture}
      >
        <div className="tb-titlebar-main">
          <p className="tb-titlebar-kicker">配套教材</p>
          <h2 className="tb-titlebar-title" data-testid="textbook-title" title={chapter?.title ?? "配套教材"}>
            <RichText text={chapter?.title ?? "本章教材尚未收录"} />
          </h2>
          <p className="tb-titlebar-sub" data-testid="textbook-subtitle">
            {chapter?.subtitle ?? "内容正在编写中；可先关闭窗口开始写代码。"}
          </p>
        </div>
        <div className="tb-titlebar-actions">
          <button
            type="button"
            className="tb-icon-btn tb-pin-btn"
            data-testid="btn-textbook-pin"
            data-pinned={pinned ? "true" : "false"}
            aria-pressed={pinned}
            aria-label={pinned ? "取消置顶教材窗口" : "置顶教材窗口"}
            title={pinned ? "取消置顶" : "置顶窗口"}
            onClick={togglePinned}
          >
            {pinned ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            className="tb-icon-btn tb-close-btn"
            data-testid="btn-textbook-close"
            aria-label="关闭教材"
            title="关闭教材"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>

      <div className="tb-toolbar">
        <div className="tb-nav">
          <button
            type="button"
            className="tb-nav-btn"
            data-testid="btn-textbook-prev"
            onClick={() => previousChapter && onNavigate(previousChapter.levelId)}
            disabled={!previousChapter}
            title={previousChapter ? `上一章：${previousChapter.title}` : "已经是第一章"}
          >
            ← 上一章
          </button>
          <span className="tb-counter" data-testid="textbook-counter">
            {counterText}
          </span>
          <button
            type="button"
            className="tb-nav-btn"
            data-testid="btn-textbook-next"
            onClick={() => nextChapter && onNavigate(nextChapter.levelId)}
            disabled={!nextChapter}
            title={nextChapter ? `下一章：${nextChapter.title}` : "已经是最后一章"}
          >
            下一章 →
          </button>
        </div>
        <span className="tb-toolbar-meta">
          {chapter ? `预计精读 ${chapter.minutes} 分钟` : ""}
        </span>
      </div>

      <div className="tb-layout">
        {sections.length > 0 ? (
          <nav className="tb-toc" data-testid="textbook-toc" aria-label="本章小节">
            <p className="tb-toc-title">本章小节</p>
            <ul>
              {sections.map((section, index) => (
                <li key={section.id}>
                  <button
                    type="button"
                    data-testid={`btn-textbook-toc-${index}`}
                    onClick={() => scrollToSection(section.id)}
                    title={section.text}
                  >
                    <RichText text={section.text} />
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
        <div className="tb-scroll-shell">
          <div className="tb-scroll" ref={scrollRef} data-testid="textbook-scroll" tabIndex={0}>
            {chapter ? (
              <TextbookContent chapter={chapter} />
            ) : (
              <p className="tb-empty">本章教材尚未收录；可以关闭窗口先写代码，或切到上一章阅读。</p>
            )}
          </div>
        </div>
      </div>

      <footer className="tb-footer">
        <span className="tb-footer-hint">{standalone ? "拖动标题栏移动 · Esc 关闭" : "拖动标题栏移动 · 右下角缩放 · Esc 关闭"}</span>
        <button type="button" className="btn btn-primary tb-start" data-testid="btn-textbook-start" onClick={onClose}>
          开始写代码
        </button>
      </footer>

      <div
        className="tb-resize-handle"
        role="separator"
        aria-label="缩放教材窗口"
        aria-orientation="horizontal"
        data-testid="textbook-resize"
        onPointerDown={onResizePointerDown}
        onPointerMove={onResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onLostPointerCapture={onResizeLostPointerCapture}
      />
    </div>,
    document.body,
  );
}

export default TextbookWindow;
