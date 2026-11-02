import { useCallback, useEffect, useRef, useState } from "react";
import { chrome, levelCopy } from "../copy";
import type { LevelView, ReplHistoryEntry, StudioEngine } from "../types";
import { pointRows, xzText, type PointRow } from "./guidance-data";
import { RichText } from "./RichText";

interface ReplScreenProps {
  engine: StudioEngine;
  /** 当前关卡（修复「打开 REPL 跳回第一关」：用工作台/地图当前关卡建 REPL 会话）。 */
  levelId: string;
  onBack: () => void;
  /** 打开指令手册（App 统一渲染）。 */
  onOpenManual?: () => void;
}

interface Example {
  code: string;
  gloss: string;
}

/** 示例都是可直接执行的代码；中文小字只解释意思，不进入代码。 */
const EXAMPLES: Example[] = [
  { code: "golem.pos", gloss: "意思是看灰崽现在站在哪里。" },
  { code: "golem.moveTo(-12, -2)", gloss: "意思是让灰崽走到 2 号灯下。" },
  { code: 'golem.say("你好，灰崽")', gloss: "意思是让灰崽说一句话。" },
];

function cleanReplError(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  if (!text) return chrome.runeBench.errorGeneric;
  if (/括号|paren|Unexpected end|expected|unterminated|missing \)/i.test(text)) return chrome.runeBench.errorParen;
  if (/参数\s*\d+\s*必须是数字|必须是数字/.test(text)) return chrome.runeBench.errorNumber;
  if (/括号|paren|Unexpected end|expected|unterminated/i.test(text)) return chrome.runeBench.errorParen;
  if (/[A-Za-z]{2,}/.test(text)) return chrome.runeBench.errorGeneric;
  return text;
}

function errorOf(entry: { display?: string; error?: string }): string {
  return cleanReplError(entry.error ?? entry.display);
}

function formatReplValue(raw: string | undefined): string {
  const text = (raw ?? "").trim();
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value) && value.length === 3) {
      return `灰崽现在在：左右 ${value[0]}，高度 ${value[1]}，前后 ${value[2]}`;
    }
  } catch {
    /* 不是 JSON 就原样显示 */
  }
  return text;
}

export function ReplScreen({ engine, levelId, onBack, onOpenManual }: ReplScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [level, setLevel] = useState<LevelView | null>(null);
  const [entries, setEntries] = useState<ReplHistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const levelTitle = level?.title ?? levelCopy(levelId)?.title ?? levelId;
  const points: PointRow[] = level ? pointRows(level) : [];

  useEffect(() => {
    let disposed = false;
    // 当前关卡的 REPL：世界/命名点都来自这一关，不再强制 L01。
    void (async () => {
      try {
        const id = await engine.createReplSession(levelId);
        if (disposed) return;
        setSessionId(id);
        const history = await engine.replHistory(id);
        if (!disposed) setEntries(history);
      } catch (cause) {
        if (!disposed) setError(cleanReplError(cause instanceof Error ? cause.message : undefined));
      }
    })();
    void engine
      .loadLevel(levelId)
      .then((loaded) => {
        if (!disposed) setLevel(loaded);
      })
      .catch(() => {
        /* 关卡视图只为显示标题/命名点；失败不阻塞 REPL。 */
      });
    return () => {
      disposed = true;
    };
  }, [engine, levelId]);

  useEffect(() => {
    listRef.current?.scrollTo?.({ top: listRef.current.scrollHeight });
  }, [entries]);

  const tryLine = useCallback(async () => {
    if (!sessionId || busy) return;
    const line = input.trim();
    if (!line) {
      setError(chrome.runeBench.errorGeneric);
      return;
    }
    // help / 手册：不打到引擎，直接翻开指令手册（零基础随时可查）。
    if (line === "help" || line === "帮助" || line === "手册") {
      setInput("");
      setError(null);
      setNotice(chrome.runeBench.helpOpened);
      onOpenManual?.();
      inputRef.current?.focus();
      return;
    }
    // 先做一次括号/引号配对检查：缺括号时给出「括号没写完」，不要误报「数字没写对」。
    let depth = 0;
    let quote: string | null = null;
    for (const ch of line) {
      if (quote) { if (ch === quote) quote = null; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { quote = ch; continue; }
      if (ch === "(" || ch === "[") depth += 1;
      if (ch === ")" || ch === "]") depth -= 1;
    }
    if (depth !== 0 || quote) {
      setError("括号或引号还没配对。照着示例把这一行补完整，再试一次。");
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await engine.repl(sessionId, line);
      const display = outcome.kind === "error"
        ? errorOf(outcome)
        : outcome.kind === "action"
          ? "照做了"
          : formatReplValue(outcome.display);
      const entry: ReplHistoryEntry = {
        line,
        kind: outcome.kind,
        display,
        at: Date.now(),
      };
      setEntries((previous) => [...previous, entry]);
      if (outcome.kind === "error") setError(entry.display);
      setInput("");
    } catch (cause) {
      setError(cleanReplError(cause instanceof Error ? cause.message : undefined));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [busy, engine, input, onOpenManual, sessionId]);

  const clearHistory = useCallback(() => {
    setEntries([]);
    setError(null);
    setNotice(null);
    inputRef.current?.focus();
  }, []);

  const resetBench = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await engine.replReset(sessionId);
      setNotice(chrome.runeBench.resetDone);
      setEntries([]);
    } catch (cause) {
      setError(cleanReplError(cause instanceof Error ? cause.message : undefined));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [engine, sessionId]);

  const useExample = useCallback((code: string) => {
    setInput(code);
    setError(null);
    inputRef.current?.focus();
  }, []);

  return (
    <div className="repl-overlay" role="dialog" aria-modal="true" data-testid="repl-screen">
      <div className="repl-card">
        <header className="repl-head">
          <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-repl-back">
            {chrome.runeBench.back}
          </button>
          <div className="repl-title-block">
            <h2 data-ui-title>{chrome.runeBench.title}</h2>
            <p className="repl-subtitle">{chrome.runeBench.subtitle}</p>
            <span className="repl-level-chip" data-testid="repl-current-level">
              {chrome.runeBench.currentLevel}：{levelTitle}
            </span>
          </div>
          <div className="repl-head-actions">
            {onOpenManual ? (
              <button type="button" className="btn btn-quiet" onClick={onOpenManual} data-testid="btn-repl-manual">
                {chrome.runeBench.manual}
              </button>
            ) : null}
            <span className={engine.mode === "mock" ? "mode-chip is-mock" : "mode-chip"}>
              {engine.mode === "mock" ? chrome.mode.local : chrome.mode.real}
            </span>
          </div>
        </header>

        <div className="repl-body">
          <section className="repl-bench">
            <label className="repl-input-label" htmlFor="repl-input">
              {chrome.runeBench.inputLabel}
            </label>
            <div className="repl-input-row">
              <input
                id="repl-input"
                ref={inputRef}
                className="repl-input"
                value={input}
                spellCheck={false}
                autoComplete="off"
                placeholder="写一句符文……"
                disabled={!sessionId || busy}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void tryLine();
                  }
                }}
                data-testid="repl-input"
              />
              <button type="button" className="btn btn-primary" onClick={() => void tryLine()} disabled={!sessionId || busy} data-testid="btn-repl-try">
                {chrome.runeBench.try}
              </button>
            </div>
            <p className="repl-hint">{chrome.runeBench.inputHint}</p>
            <p className="repl-hint repl-help-hint"><RichText text={chrome.runeBench.helpHint} /></p>
            {error ? (
              <p className="repl-error" role="alert" data-testid="repl-error">
                <RichText text={error} />
              </p>
            ) : null}
            {notice ? (
              <p className="repl-notice" data-testid="repl-notice">
                <RichText text={notice} />
              </p>
            ) : null}
            <div className="repl-actions">
              <button type="button" className="btn" onClick={clearHistory} data-testid="btn-repl-clear">
                {chrome.runeBench.clear}
              </button>
              <button type="button" className="btn" onClick={() => void resetBench()} disabled={!sessionId || busy} data-testid="btn-repl-reset">
                {chrome.runeBench.reset}
              </button>
            </div>
            <div className="repl-examples">
              <p className="repl-examples-title">{chrome.runeBench.examplesTitle}</p>
              <ul className="repl-example-list">
                {EXAMPLES.map((example) => (
                  <li key={example.code}>
                    <button
                      type="button"
                      className="repl-example"
                      onClick={() => useExample(example.code)}
                      data-testid={`repl-example-${example.code.startsWith("golem.pos") ? "pos" : example.code.startsWith("golem.moveTo") ? "move" : example.code.startsWith("golem.say") ? "say" : "place"}`}
                    >
                      <code>{example.code}</code>
                      <span className="repl-example-gloss">{example.gloss}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {points.length > 0 ? (
              <div className="repl-points" data-testid="repl-points">
                <p className="repl-points-title">{chrome.runeBench.pointsTitle}</p>
                <ul className="repl-point-list">
                  {points.map((point) => (
                    <li className="repl-point" key={point.key} data-testid={`repl-point-${point.key}`}>
                      <code>{point.key}</code>
                      <span className="repl-point-pos">（{xzText(point.pos)}）</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section className="repl-history" aria-label={chrome.runeBench.title}>
            <header className="repl-history-head">
              <h3 data-ui-panel-title>对话</h3>
            </header>
            <div className="repl-history-list" ref={listRef} data-testid="repl-history">
              {entries.length === 0 ? (
                <p className="muted" data-testid="repl-empty">
                  {chrome.runeBench.empty}
                </p>
              ) : (
                entries.map((entry, index) => (
                  <div
                    key={`${entry.at}-${index}`}
                    className={entry.kind === "error" ? "repl-entry is-error" : "repl-entry"}
                    data-testid="repl-entry"
                  >
                    <div className="repl-entry-line">
                      <span className="repl-who">{chrome.runeBench.you}</span>
                      <code>{entry.line}</code>
                    </div>
                    <div className="repl-entry-result">
                      <span className="repl-who">{chrome.runeBench.golem}</span>
                      {entry.kind === "error" || entry.kind === "value" ? (
                        <code className="repl-value">{entry.display}</code>
                      ) : (
                        <span>{entry.display}</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
