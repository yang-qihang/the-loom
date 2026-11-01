import { a11y, buttons, chrome, hintLabel, labels } from "../copy";
import { RichText } from "./RichText";
import { RuneGlyph } from "./RuneGlyph";

interface CoachCardProps {
  message: string;
  hint: string | null;
  hintLevel: number;
  canHint: boolean;
  onHint: () => void;
  /** 引擎 progress 真值给的「这一步怎么做」（失败/目标完成时显示；按节点出现，不刷屏）。 */
  progressHint?: string | null;
  /** 打开指令手册（新手随时可查）。 */
  onOpenManual?: () => void;
}

export function CoachCard({ message, hint, hintLevel, canHint, onHint, progressHint, onOpenManual }: CoachCardProps) {
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
      {progressHint ? (
        <div className="coach-guide" data-testid="coach-progress-hint">
          <span className="coach-guide-title">{chrome.coach.progressHintTitle}</span>
          <p className="coach-guide-text"><RichText text={progressHint} /></p>
        </div>
      ) : null}
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
        {onOpenManual ? (
          <button type="button" className="btn btn-quiet coach-manual" onClick={onOpenManual} data-testid="btn-coach-manual">
            {chrome.coach.manualLink}
          </button>
        ) : null}
        <span className="coach-note">{chrome.coach.hintNote}</span>
      </div>
      </div>
    </section>
  );
}
