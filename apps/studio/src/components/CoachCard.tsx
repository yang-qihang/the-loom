import { a11y, buttons, chrome, hintLabel, labels } from "../copy";
import { RichText } from "./RichText";
import { RuneGlyph } from "./RuneGlyph";

interface CoachCardProps {
  message: string;
  hint: string | null;
  hintLevel: number;
  canHint: boolean;
  onHint: () => void;
}

export function CoachCard({ message, hint, hintLevel, canHint, onHint }: CoachCardProps) {
  return (
    <section className="card coach" aria-label={a11y.coach}>
      <header className="card-head">
        <span className="rune-avatar" aria-hidden="true">
          <RuneGlyph id="L01" size={24} label="艾" />
        </span>
        <h3 data-ui-panel-title>{labels.coach}</h3>
        <span className="card-tag">{chrome.coach.label}</span>
      </header>
      <div className="card-body">
      <p className="coach-line" data-testid="coach-line">
        <RichText text={message} />
      </p>
      {hint ? (
        <p className="coach-hint" data-testid="coach-hint">
          <span className="hint-level">{hintLabel(hintLevel)}</span>
          <RichText text={hint} />
        </p>
      ) : null}
      <div className="coach-actions">
        <button type="button" className="btn btn-quiet" onClick={onHint} disabled={!canHint} data-testid="btn-hint">
          {buttons.hint}
        </button>
        <span className="coach-note">{chrome.coach.hintNote}</span>
      </div>
      </div>
    </section>
  );
}
