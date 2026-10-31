import { useMemo, useState } from "react";
import { chrome } from "../copy";
import type { StudioProgress } from "../progress";
import codexData from "../../../../content/codex/codex.json";

interface CodexLanguage {
  lang: string;
  code: string;
}

interface CodexPage {
  id: string;
  title: string;
  subtitle: string;
  solve: string;
  mechanism: string;
  cost: string;
  crossLanguage: CodexLanguage[];
  inGame: string;
  misconception: string;
  unlock: string;
}

interface CodexScreenProps {
  progress: StudioProgress;
  onBack: () => void;
}

const PAGE_NUMBER = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖", "拾", "拾壹", "拾贰", "拾叁", "拾肆", "拾伍", "拾陆", "拾柒"];

const LANGUAGE_NAMES: Record<string, string> = {
  ts: "TypeScript",
  js: "JavaScript",
  python: "Python",
  c: "C 语言",
  cpp: "C++ 语言",
  haskell: "Haskell",
  rust: "Rust",
  java: "Java",
  go: "Go",
  scheme: "Scheme",
  erlang: "Erlang",
};

/** 内容资料里偶尔用 L1/L2 指代关卡；界面统一成中文。 */
function zh(text: string): string {
  return String(text ?? "").replace(/L(\d+)/g, (_match, number: string) => `第 ${Number(number)} 关`);
}

function sourceLabel(unlock: string): string {
  const match = /^L(\d+)$/.exec(unlock);
  if (match) return `第 ${Number(match[1])} 关`;
  if (unlock === "EP") return "尾声";
  if (unlock.startsWith("LAB")) return "试炼";
  return "未完的篇章";
}

export function CodexScreen({ progress, onBack }: CodexScreenProps) {
  const pages = codexData.pages as CodexPage[];
  const unlocked = useMemo(() => new Set(pages.filter((page) => progress.levelsStarted.includes(page.unlock)).map((page) => page.id)), [pages, progress.levelsStarted]);
  // 默认打开“最新解锁”的一页，而不是永远第一页；刚通关拿到的奖励直接可见。
  const unlockedPages = pages.filter((page) => unlocked.has(page.id));
  const firstOpen = unlockedPages[unlockedPages.length - 1] ?? pages[0];
  const [selectedId, setSelectedId] = useState(firstOpen.id);
  const [language, setLanguage] = useState<string | null>(null);
  const selected = pages.find((page) => page.id === selectedId) ?? firstOpen;
  const isUnlocked = unlocked.has(selected.id);
  const languageEntries = selected.crossLanguage ?? [];
  const activeLanguage = language && languageEntries.some((entry) => entry.lang === language) ? language : languageEntries[0]?.lang ?? null;
  const activeEntry = languageEntries.find((entry) => entry.lang === activeLanguage) ?? languageEntries[0] ?? null;
  const pageIndex = pages.findIndex((page) => page.id === selected.id);

  return (
    <div className="codex-overlay" role="dialog" aria-modal="true" data-testid="codex-screen">
      <div className="codex-card">
        <header className="codex-head">
          <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-codex-back">
            {chrome.codex.back}
          </button>
          <div className="codex-title-block">
            <h2 data-ui-title>{chrome.codex.title}</h2>
            <p className="codex-subtitle">{chrome.codex.subtitle}</p>
          </div>
          <span className="codex-count">共 {pages.length} 页</span>
        </header>

        <div className="codex-body">
          <nav className="codex-list" aria-label={chrome.codex.catalogTitle}>
            <header className="codex-list-head">
              <h3 data-ui-panel-title>{chrome.codex.catalogTitle}</h3>
            </header>
            <ul>
              {pages.map((page) => {
                const open = unlocked.has(page.id);
                return (
                  <li key={page.id}>
                    <button
                      type="button"
                      className={`codex-item${page.id === selected.id ? " is-active" : ""}${open ? "" : " is-locked"}`}
                      onClick={() => {
                        setSelectedId(page.id);
                        setLanguage(null);
                      }}
                      data-testid={`codex-page-${page.id}`}
                    >
                      <span className="codex-item-number">{PAGE_NUMBER[pages.indexOf(page)] ?? page.id}</span>
                      <span className="codex-item-main">
                        <span className="codex-item-title">{page.title}</span>
                        <span className="codex-item-sub">{zh(page.subtitle)}</span>
                      </span>
                      <span className="codex-item-source">{sourceLabel(page.unlock)}</span>
                      <span className={open ? "codex-badge is-open" : "codex-badge"}>
                        {open ? chrome.codex.unlocked : chrome.codex.locked}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <section className="codex-detail" data-testid="codex-detail">
            {isUnlocked ? (
              <>
                <header className="codex-detail-head">
                  <p className="codex-detail-index">
                    {chrome.codex.pagePrefix} {PAGE_NUMBER[pageIndex] ?? selected.id}
                  </p>
                  <h3 data-ui-panel-title>{selected.title}</h3>
                  <p className="codex-detail-sub">{selected.subtitle}</p>
                </header>
                <div className="codex-sections">
                  <section className="codex-section">
                    <h4>{chrome.codex.solve}</h4>
                    <p>{zh(selected.solve)}</p>
                  </section>
                  <section className="codex-section">
                    <h4>{chrome.codex.mechanism}</h4>
                    <p>{zh(selected.mechanism)}</p>
                  </section>
                  <section className="codex-section">
                    <h4>{chrome.codex.cost}</h4>
                    <p>{zh(selected.cost)}</p>
                  </section>
                  <section className="codex-section">
                    <h4>{chrome.codex.crossLanguage}</h4>
                    <div className="codex-tabs" role="tablist">
                      {languageEntries.map((entry) => (
                        <button
                          key={entry.lang}
                          type="button"
                          role="tab"
                          aria-selected={entry.lang === activeLanguage}
                          className={entry.lang === activeLanguage ? "codex-tab is-active" : "codex-tab"}
                          onClick={() => setLanguage(entry.lang)}
                          data-testid={`codex-tab-${entry.lang}`}
                        >
                          {LANGUAGE_NAMES[entry.lang] ?? entry.lang}
                        </button>
                      ))}
                    </div>
                    {activeEntry ? (
                      <pre className="codex-code" data-testid="codex-code">
                        <code>{activeEntry.code}</code>
                      </pre>
                    ) : null}
                  </section>
                  <section className="codex-section">
                    <h4>{chrome.codex.inGame}</h4>
                    <p>{zh(selected.inGame)}</p>
                  </section>
                  <section className="codex-section is-warn">
                    <h4>
                      <span className="codex-warn-badge">{chrome.codex.misconceptionBadge}</span>
                      {chrome.codex.misconception}
                    </h4>
                    <p>{zh(selected.misconception)}</p>
                  </section>
                </div>
                <footer className="codex-foot">{chrome.codex.from}：{sourceLabel(selected.unlock)}</footer>
              </>
            ) : (
              <div className="codex-locked" data-testid="codex-locked">
                <h3 data-ui-panel-title>{selected.title}</h3>
                <p className="codex-locked-hint">{chrome.codex.lockedHint}</p>
                <p className="muted">来自{sourceLabel(selected.unlock)}。</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
