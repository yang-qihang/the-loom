import { useCallback, useEffect, useRef, useState } from "react";
import { chrome } from "../copy";
import type { EngineMode, ReplHistoryEntry, StudioEngine } from "../types";
import { RichText } from "./RichText";

interface ReplScreenProps {
  engine: StudioEngine;
  onBack: () => void;
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

export function ReplScreen({ engine, onBack }: ReplScreenProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [entries, setEntries] = useState<ReplHistoryEntry[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const id = await engine.createReplSession();
        if (disposed) return;
        setSessionId(id);
        const history = await engine.replHistory(id);
        if (!disposed) setEntries(history);
      } catch (cause) {
        if (!disposed) setError(cleanReplError(cause instanceof Error ? cause.message : undefined));
      }
    })();
    return () => {
      disposed = true;
    };
  }, [engine]);

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
  }, [busy, engine, input, sessionId]);

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
          </div>
          <span className={engine.mode === "mock" ? "mode-chip is-mock" : "mode-chip"}>
            {engine.mode === "mock" ? chrome.mode.local : chrome.mode.real}
          </span>
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
            {error ? (
              <p className="repl-error" role="alert" data-testid="repl-error">
                {error}
              </p>
            ) : null}
            {notice ? (
              <p className="repl-notice" data-testid="repl-notice">
                {notice}
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
