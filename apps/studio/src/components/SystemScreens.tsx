import { useEffect, useState } from "react";
import { chrome } from "../copy";
import { getDesktopInvoke } from "../desktop";

const s = chrome.system;

function readNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value !== "off";
  } catch {
    return fallback;
  }
}

export function AboutScreen({ onBack }: { onBack: () => void }) {
  return (
    <main className="system-page about-screen" data-testid="about-screen">
      <header className="system-head">
        <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-system-back">{s.back}</button>
        <span className="system-kicker">{s.about}</span>
      </header>

      <section className="about-hero">
        <p className="about-tagline">{s.aboutTagline}</p>
        <h1 data-testid="about-title">{s.aboutTitle}</h1>
        <p className="about-en">{s.aboutEn}</p>
        <p className="about-lead">{s.aboutLead}</p>
      </section>

      <div className="about-grid">
        <section className="about-panel">
          <h2>这个世界</h2>
          {s.aboutBody.map((line) => <p key={line}>{line}</p>)}
        </section>
        <section className="about-panel">
          <h2>{s.aboutLearnTitle}</h2>
          <ol className="about-list">{s.aboutLearn.map((line) => <li key={line}>{line}</li>)}</ol>
        </section>
        <section className="about-panel is-wide">
          <h2>{s.aboutControlsTitle}</h2>
          <p>{s.aboutControls}</p>
          <p className="about-version">{s.version}</p>
        </section>
      </div>
    </main>
  );
}

export function SettingsScreen({ onBack }: { onBack: () => void }) {
  const [fontSize, setFontSize] = useState(() => Math.min(22, Math.max(13, readNumber("loom.editor.fontSize", 16))));
  const [annotations, setAnnotations] = useState(() => readFlag("loom.annotations", true));
  const [reduceMotion, setReduceMotion] = useState(() => readFlag("loom.reduceMotion", false));

  useEffect(() => {
    try { localStorage.setItem("loom.editor.fontSize", String(fontSize)); } catch { /* ignore */ }
  }, [fontSize]);
  useEffect(() => {
    try { localStorage.setItem("loom.annotations", annotations ? "on" : "off"); } catch { /* ignore */ }
  }, [annotations]);
  useEffect(() => {
    document.body.classList.toggle("reduce-motion", reduceMotion);
    try { localStorage.setItem("loom.reduceMotion", reduceMotion ? "on" : "off"); } catch { /* ignore */ }
  }, [reduceMotion]);

  return (
    <main className="system-page settings-screen" data-testid="settings-screen">
      <header className="system-head">
        <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-system-back">{s.back}</button>
        <span className="system-kicker">{s.settings}</span>
      </header>
      <h1 className="system-title">{s.settingsTitle}</h1>
      <p className="system-lede">{s.settingsLead}</p>

      <section className="settings-list">
        <div className="settings-row">
          <div><b>{s.fontSize}</b><p>{s.fontSizeHint}</p></div>
          <div className="settings-stepper">
            <button type="button" className="btn btn-quiet" onClick={() => setFontSize((n) => Math.max(13, n - 1))} data-testid="settings-font-smaller">A-</button>
            <span data-testid="settings-font-value">{fontSize}</span>
            <button type="button" className="btn btn-quiet" onClick={() => setFontSize((n) => Math.min(22, n + 1))} data-testid="settings-font-larger">A+</button>
          </div>
        </div>
        <div className="settings-row">
          <div><b>{s.annotations}</b><p>{s.annotationsHint}</p></div>
          <button type="button" className="btn" onClick={() => setAnnotations((v) => !v)} data-testid="settings-annotations">
            {annotations ? s.on : s.off}
          </button>
        </div>
        <div className="settings-row">
          <div><b>{s.reduceMotion}</b><p>{s.reduceMotionHint}</p></div>
          <button type="button" className="btn" onClick={() => setReduceMotion((v) => !v)} data-testid="settings-motion">
            {reduceMotion ? s.on : s.off}
          </button>
        </div>
      </section>
    </main>
  );
}

export function QuitScreen({ onBack }: { onBack: () => void }) {
  const desktop = !!getDesktopInvoke();
  const quit = () => {
    const invoke = getDesktopInvoke();
    if (invoke) void invoke("window_close").catch(() => {});
  };
  return (
    <main className="system-page quit-screen" data-testid="quit-screen">
      <header className="system-head">
        <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-system-back">{s.back}</button>
        <span className="system-kicker">{s.quit}</span>
      </header>
      <h1 className="system-title">{s.quitTitle}</h1>
      <p className="system-lede">{s.quitLead}</p>
      <div className="quit-actions">
        <button type="button" className="btn btn-primary" onClick={onBack}>{s.quitStay}</button>
        {desktop ? (
          <button type="button" className="btn" onClick={quit} data-testid="btn-quit-confirm">{s.quitLeave}</button>
        ) : (
          <p className="muted">{s.quitBrowser}</p>
        )}
      </div>
    </main>
  );
}
