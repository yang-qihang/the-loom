import { useEffect, useMemo, useState } from "react";
import { chrome } from "../copy";
import type { LevelView } from "../types";

/**
 * 完整解查看器（调试用）：把本关 `referenceSolution` 原样展示出来，可滚动、可复制。
 * 入口在工作台顶栏/更多菜单（和「指令手册」「试符台」同一区域），每关都能打开。
 */
export function SolutionViewer({
  level,
  loading,
  error,
  onClose,
  onOpenManual,
}: {
  level: LevelView | null;
  loading: boolean;
  error?: string | null;
  onClose: () => void;
  onOpenManual?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const code = level?.referenceSolution ?? "";
  const lineCount = useMemo(() => (code ? code.split("\n").length : 0), [code]);

  useEffect(() => {
    setCopied(false);
  }, [level?.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  const copy = async (): Promise<void> => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* 剪贴板不可用时仍可手动选中复制。 */
    }
  };

  return (
    <div
      className="gd-overlay solution-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={chrome.workbench.solutionTitle}
      data-testid="solution-viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="gd-panel solution-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="solution-head">
          <div>
            <p className="kicker">{chrome.workbench.solutionKicker}</p>
            <h2>{level ? `${level.title} · ${chrome.workbench.solutionTitle}` : chrome.workbench.solutionTitle}</h2>
            <p className="solution-hint">{chrome.workbench.solutionHint}</p>
          </div>
          <button type="button" className="gd-close" aria-label={chrome.workbench.solutionClose} data-testid="btn-solution-close" onClick={onClose}>
            ×
          </button>
        </div>

        {loading ? (
          <p className="solution-note">{chrome.workbench.solutionLoading}</p>
        ) : error ? (
          <p className="solution-note solution-error" data-testid="solution-error">
            {error}
          </p>
        ) : (
          <pre className="solution-code" data-testid="solution-code" tabIndex={0}>
            {code || chrome.workbench.solutionEmpty}
          </pre>
        )}

        <div className="solution-foot">
          <span className="solution-count">{lineCount > 0 ? chrome.workbench.solutionLines.replace("{行数}", String(lineCount)) : ""}</span>
          <div className="solution-actions">
            {onOpenManual ? (
              <button type="button" className="btn btn-quiet" data-testid="btn-solution-manual" onClick={onOpenManual}>
                {chrome.workbench.solutionManual}
              </button>
            ) : null}
            <button type="button" className="btn" data-testid="btn-solution-copy" onClick={() => void copy()} disabled={!code}>
              {copied ? chrome.workbench.solutionCopied : chrome.workbench.solutionCopy}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
