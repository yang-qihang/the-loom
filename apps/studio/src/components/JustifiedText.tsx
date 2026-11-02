import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { RichText } from "./RichText";

/**
 * 跨引擎的叙事正文两端对齐。
 *
 * Chrome/Chromium 原生支持 CJK `text-align: justify`；WebKitGTK（Tauri 桌面）对
 * 纯 CJK 行的 justification 扩展不生效（行宽只到自然宽度）。这里在检测到原生能力
 * 缺失时，按真实换行位置把段落拆成行，并对非末行做逐行 letter-spacing 补齐。
 * 只处理纯文本（含反引号的富文本保持 RichText，避免拆坏 inline-code）。
 */

let nativeSupport: boolean | null = null;

function probeNativeCjkJustify(): boolean {
  if (typeof document === "undefined") return true;
  if (nativeSupport !== null) return nativeSupport;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  // Tauri Linux = WebKitGTK：CJK justification 扩展不可靠，直接走逐行补齐。
  if (/AppleWebKit/i.test(ua) && !/Chrome|Chromium|Edg\//i.test(ua)) {
    nativeSupport = false;
    return nativeSupport;
  }
  const probe = document.createElement("p");
  probe.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "left:-99999px",
    "top:0",
    "width:240px",
    "font-family:var(--font-text)",
    "font-size:18px",
    "line-height:1.7",
    "text-align:justify",
    "text-align-last:left",
    "margin:0",
    "padding:0",
  ].join(";");
  probe.textContent = "这是灰岩村山脚下的小村屋墙用灰岩砌成夜里灯一亮就像一条落在山脚的河";
  document.body.appendChild(probe);
  try {
    const range = document.createRange();
    range.selectNodeContents(probe);
    const firstLine = range.getClientRects()[0];
    nativeSupport = Boolean(firstLine && firstLine.width >= probe.clientWidth - 2);
  } catch {
    nativeSupport = true;
  } finally {
    probe.remove();
  }
  return nativeSupport;
}

function computeLines(host: HTMLElement, text: string): string[] {
  const measure = document.createElement("span");
  measure.style.cssText = [
    "position:absolute",
    "visibility:hidden",
    "left:0",
    "top:0",
    "display:block",
    `width:${host.clientWidth || host.getBoundingClientRect().width}px`,
    "white-space:normal",
    "font-family:var(--font-text)",
    "font-size:18px",
    "line-height:1.7",
  ].join(";");
  measure.textContent = text;
  host.appendChild(measure);
  try {
    const textNode = measure.firstChild;
    if (!textNode) return [text];
    const range = document.createRange();
    const lines: string[] = [];
    let start = 0;
    let lineCount = 1;
    for (let index = 1; index <= text.length; index += 1) {
      range.setStart(textNode, 0);
      range.setEnd(textNode, index);
      const count = range.getClientRects().length;
      if (count > lineCount) {
        lines.push(text.slice(start, index - 1));
        start = index - 1;
        lineCount = count;
      }
    }
    lines.push(text.slice(start));
    return lines.filter((line) => line.length > 0);
  } finally {
    measure.remove();
  }
}

export function JustifiedText({ text, centerWhenSingleLine = false }: { text: string; centerWhenSingleLine?: boolean }): ReactNode {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const blockRef = useRef<HTMLSpanElement>(null);
  const [lines, setLines] = useState<string[] | null>(null);

  const updateFallback = (): void => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    const next = computeLines(parent, text);
    parent.classList.toggle("is-single-line", centerWhenSingleLine && next.length === 1);
    if (probeNativeCjkJustify() || text.includes("`")) {
      setLines(null);
      return;
    }
    setLines(next.length > 1 ? next : null);
  };

  useLayoutEffect(() => {
    updateFallback();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    const parent = anchorRef.current?.parentElement;
    if (!parent) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(updateFallback);
    });
    observer.observe(parent);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useLayoutEffect(() => {
    const block = blockRef.current;
    if (!block || !lines || lines.length < 2) return;
    const target = block.getBoundingClientRect().width;
    const lineEls = Array.from(block.querySelectorAll<HTMLElement>(".justified-line"));
    for (let index = 0; index < lineEls.length; index += 1) {
      const el = lineEls[index];
      el.style.letterSpacing = "";
      if (index === lineEls.length - 1) continue;
      const range = document.createRange();
      range.selectNodeContents(el);
      const naturalRect = range.getClientRects()[0];
      const natural = naturalRect ? naturalRect.width : el.getBoundingClientRect().width;
      const chars = Array.from(lines[index] ?? "").length;
      if (chars <= 1 || natural <= 0) continue;
      const spacing = (target - natural) / chars;
      if (spacing > 0.02) el.style.letterSpacing = `${spacing.toFixed(3)}px`;
    }
  }, [lines]);

  return (
    <>
      <span ref={anchorRef} hidden aria-hidden="true" />
      {lines === null ? <RichText text={text} /> : (
    <span className="justified-text-block" ref={blockRef}>
      {lines.map((line, index) => (
        <span className={`justified-line${index === lines.length - 1 ? " is-last" : ""}`} key={`${index}-${line}`}>
          {line}
        </span>
      ))}
    </span>
      )}
    </>
  );
}
