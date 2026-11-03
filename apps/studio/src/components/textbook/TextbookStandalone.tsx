import { useCallback, useEffect, useState, type ReactNode } from "react";
import { getDesktopInvoke, getDesktopWindow } from "../../desktop";
import { TEXTBOOK, TEXTBOOK_CHAPTERS, markTextbookRead } from "../../textbook";
import { TextbookWindow } from "./TextbookWindow";

export interface TextbookStandaloneProps {
  initialId: string;
}

/**
 * 独立桌面窗口里的教材内容。
 *
 * 外层由 Rust 的 `open_textbook_window` 创建，没有 main window parent；
 * 这里只负责章节路由、原生窗口关闭/置顶/拖动，不再渲染 Studio 或读取引擎。
 */
export function TextbookStandalone({ initialId }: TextbookStandaloneProps): ReactNode {
  const fallbackId = TEXTBOOK_CHAPTERS[0]?.levelId ?? "L01";
  const [currentId, setCurrentId] = useState<string>(TEXTBOOK[initialId] ? initialId : fallbackId);

  const close = useCallback((): void => {
    if (TEXTBOOK[currentId]) markTextbookRead(currentId);
    const nativeWindow = getDesktopWindow();
    if (nativeWindow) {
      void nativeWindow.close().catch(() => {
        const invoke = getDesktopInvoke();
        if (invoke) void invoke("window_close").catch(() => {});
      });
      return;
    }
    const invoke = getDesktopInvoke();
    if (invoke) {
      void invoke("window_close").catch(() => {});
    } else {
      window.close();
    }
  }, [currentId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("textbook", currentId);
    window.history.replaceState(null, "", url);
  }, [currentId]);

  return <TextbookWindow chapters={TEXTBOOK} currentId={currentId} onNavigate={setCurrentId} onClose={close} standalone />;
}

export default TextbookStandalone;
