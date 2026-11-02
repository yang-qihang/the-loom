import { useMemo } from "react";
import { acts, buttons, chrome, fill, journalLabels, levelCards, STATUS_PLAYABLE } from "../copy";
import type { EngineMode } from "../types";
import { RuneGlyph } from "./RuneGlyph";
import { RichText } from "./RichText";

interface MapWallProps {
  cards: ReturnType<typeof levelCards> | null;
  loading: boolean;
  error: string | null;
  engineMode: EngineMode;
  journalEnabled: boolean;
  onOpenJournal: () => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onQuit: () => void;
  onOpenRepl: () => void;
  onOpenCodex: () => void;
  onSelect: (card: ReturnType<typeof levelCards>[number]) => void;
  onRetry: () => void;
}

export function MapWall({ cards, loading, error, engineMode, journalEnabled, onOpenJournal, onOpenAbout, onOpenSettings, onQuit, onOpenRepl, onOpenCodex, onSelect, onRetry }: MapWallProps) {
  const actEntries = useMemo(
    () => Object.entries(acts).map(([key, value]) => ({ act: Number(key.replace("act", "")), title: value.title })),
    [],
  );
  const byAct = useMemo(() => {
    const grouped = new Map<number, ReturnType<typeof levelCards>>();
    for (const card of cards ?? []) {
      const list = grouped.get(card.act) ?? [];
      list.push(card);
      grouped.set(card.act, list);
    }
    for (const list of grouped.values()) list.sort((a, b) => a.order - b.order);
    return grouped;
  }, [cards]);

  return (
    <div className="map-wall">
      <header className="map-head">
        <div className="map-title-row">
          <div>
            <p className="kicker">{chrome.map.brand}</p>
            <h1 data-ui-title>{chrome.map.title}</h1>
          </div>
          <div className="map-head-actions">
            {journalEnabled ? (
              <button type="button" className="btn btn-quiet" onClick={onOpenJournal} data-testid="btn-journal">
                {journalLabels.open}
              </button>
            ) : null}
            <span className={engineMode === "mock" ? "mode-chip is-mock" : "mode-chip"}>
              {engineMode === "mock" ? chrome.mode.local : chrome.mode.real}
            </span>
          </div>
        </div>
        <p className="lede">{chrome.map.lede}</p>
        {loading ? <p className="map-status">{chrome.map.loading}</p> : null}
      </header>

      <div className="map-hero-band" data-testid="map-hero-band">
        <img src="./world/L01.png" alt="灰岩村的黄昏：石径、灯柱与村舍" />
        <div className="map-hero-copy">
          <span className="map-hero-kicker">{chrome.map.heroTitle}</span>
          <p>{chrome.map.heroLine}</p>
        </div>
      </div>

      {error ? (
        <div className="error-panel" role="alert">
          <p className="error-title">{chrome.map.errorTitle}</p>
          <p className="error-detail"><RichText text={error} /></p>
          <div className="error-actions">
            <button type="button" className="btn btn-primary" onClick={onRetry} data-testid="btn-retry-levels">
              {chrome.map.retry}
            </button>
          </div>
        </div>
      ) : null}

      <div className="acts" data-testid="map-acts">
        {actEntries.map(({ act, title }) => {
          const actCards = byAct.get(act) ?? [];
          if (actCards.length === 0) return null;
          return (
            <section className="act-section" key={act} data-act={act}>
              <header className="act-head">
                <h2 data-ui-title>{title}</h2>
                <span className="act-count">{actCards.length} 关</span>
              </header>
              <ul className="map-cards">
                {actCards.map((card) => {
                  const playable = card.status === STATUS_PLAYABLE;
                  if (!playable) {
                    return (
                      <li key={card.id}>
                        <div className="map-card is-locked" aria-disabled="true" data-testid={`level-card-${card.id}`}>
                          <RuneGlyph id={card.id} className="card-rune" size={52} />
                          <span className="card-order">第 {card.order} 关</span>
                          <h3>{card.title}</h3>
                          <p className="card-meta">
                            {card.runeName} · {card.minutes} {chrome.map.minutes}
                          </p>
                          <span className="card-status">{fill(chrome.map.lockHint, { 关: card.order - 1 })}</span>
                        </div>
                      </li>
                    );
                  }
                  return (
                    <li key={card.id}>
                      <button
                        type="button"
                        className="map-card is-ready"
                        data-testid={`level-card-${card.id}`}
                        onClick={() => onSelect(card)}
                      >
                        <RuneGlyph id={card.id} className="card-rune" size={52} />
                        <span className="card-order">第 {card.order} 关</span>
                        <h3>{card.title}</h3>
                        <p className="card-meta">
                          {card.runeName} · {card.minutes} {chrome.map.minutes}
                        </p>
                        <span className="card-cta">{buttons.start} →</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>

      <footer className="map-foot">
        <div className="map-foot-left">
          <button type="button" className="btn btn-quiet" onClick={onOpenRepl} data-testid="btn-repl">
            {chrome.runeBench.open}
          </button>
          <button type="button" className="btn btn-quiet" onClick={onOpenCodex} data-testid="btn-codex">
            {chrome.codex.open}
          </button>
          <span>{chrome.map.footActions}</span>
        </div>
        <div className="map-foot-right">
          <span>{chrome.map.footKeys}</span>
          <nav className="map-foot-nav" aria-label="游戏菜单">
            <button type="button" className="btn btn-quiet" onClick={onOpenAbout} data-testid="btn-about">{chrome.system.about}</button>
            <button type="button" className="btn btn-quiet" onClick={onOpenSettings} data-testid="btn-settings">{chrome.system.settings}</button>
            <button type="button" className="btn btn-quiet" onClick={onQuit} data-testid="btn-quit">{chrome.system.quit}</button>
          </nav>
        </div>
      </footer>
    </div>
  );
}
