import { useEffect, useMemo, useState } from "react";
import { acts, buttons, chrome, fill, journal, journalLabels, levelCopy, prologue, unlockedTerms } from "../copy";
import type { StudioProgress } from "../progress";
import { RichText } from "./RichText";

const CHINESE_INDEX = ["一", "二", "三"];

function StageBackdrop({ variant, children }: { variant: number; children: React.ReactNode }) {
  return (
    <div className={`narrative-stage stage-${variant % 8}`}>
      <div className="stage-photo" aria-hidden="true" />
      <div className="stage-lines" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className="stage-content">{children}</div>
    </div>
  );
}

interface PrologueProps {
  mode: "first" | "replay";
  onDone: () => void;
}

export function PrologueOverlay({ mode, onDone }: PrologueProps) {
  const [index, setIndex] = useState(0);
  const screen = prologue.screens[index];
  const last = index === prologue.screens.length - 1;
  return (
    <div className="narrative-overlay" role="dialog" aria-modal="true" data-testid="prologue-overlay">
      <div className="narrative-card">
        {mode === "replay" ? <p className="settle-caption">{journalLabels.replayPrologue}</p> : null}
        <h2 data-ui-title>{prologue.title}</h2>
        <StageBackdrop variant={index}>
          <p className="stage-scene">{screen.scene}</p>
          <p className="stage-speaker">{screen.speaker}</p>
          <div className="stage-lines-text">
            {screen.lines.map((line) => (
              <p key={line}>
                <RichText text={line} />
              </p>
            ))}
          </div>
        </StageBackdrop>
        <div className="narrative-dots" aria-hidden="true">
          {prologue.screens.map((_, dot) => (
            <span key={dot} className={dot <= index ? "is-on" : ""} />
          ))}
        </div>
        <p className="narrative-note">{prologue.skippable}</p>
        <div className="narrative-actions">
          <button type="button" className="btn btn-quiet" onClick={onDone} data-testid="onboarding-skip">
            {chrome.onboarding.skip}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? onDone() : setIndex(index + 1))}
            data-testid="onboarding-next"
          >
            {chrome.onboarding.next}
          </button>
        </div>
      </div>
    </div>
  );
}

interface ActIntroProps {
  act: number;
  mode: "first" | "replay";
  onDone: () => void;
}

export function ActIntroOverlay({ act, mode, onDone }: ActIntroProps) {
  const copy = acts[`act${act}`];
  const [index, setIndex] = useState(0);
  if (!copy) return null;
  const last = index === copy.screens.length - 1;
  return (
    <div className="narrative-overlay" role="dialog" aria-modal="true" data-testid="act-overlay">
      <div className="narrative-card">
        {mode === "replay" ? <p className="settle-caption">{journalLabels.replayAct}</p> : null}
        <h2 data-ui-title>{copy.title}</h2>
        <StageBackdrop variant={act * 2 + index}>
          <div className="stage-lines-text">
            <p>
              <RichText text={copy.screens[index]} />
            </p>
          </div>
        </StageBackdrop>
        <div className="narrative-dots" aria-hidden="true">
          {copy.screens.map((_, dot) => (
            <span key={dot} className={dot <= index ? "is-on" : ""} />
          ))}
        </div>
        <p className="narrative-note">{prologue.skippable}</p>
        <div className="narrative-actions">
          <button type="button" className="btn btn-quiet" onClick={onDone} data-testid="act-skip">
            {chrome.onboarding.skip}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => (last ? onDone() : setIndex(index + 1))}
            data-testid="act-next"
          >
            {chrome.onboarding.next}
          </button>
        </div>
      </div>
    </div>
  );
}

interface LevelOpeningProps {
  levelId: string;
  onStart: () => void;
}

export function LevelOpeningOverlay({ levelId, onStart }: LevelOpeningProps) {
  const copy = levelCopy(levelId);
  const [round, setRound] = useState(0);
  if (!copy) return null;
  const lines = [copy.opening.worldState, copy.opening.task, copy.opening.whyYou];
  return (
    <div className="narrative-overlay" role="dialog" aria-modal="true" data-testid="opening-overlay">
      <div className="narrative-card opening-card" key={round}>
        <p className="settle-caption">{copy.act}</p>
        <h2 data-ui-title>{copy.title}</h2>
        <StageBackdrop variant={Number(levelId.slice(1))}>
          <ol className="opening-lines" data-testid="opening-lines">
            {lines.map((line, index) => (
              <li className={`opening-line line-${index + 1}${index === 1 ? " is-task" : ""}`} key={line}>
                <span className="opening-mark" aria-hidden="true">
                  {CHINESE_INDEX[index]}
                </span>
                <span className="opening-copy">
                  <span className="opening-label">
                    {[chrome.onboarding.openingLabels.world, chrome.onboarding.openingLabels.task, chrome.onboarding.openingLabels.why][index]}
                  </span>
                  <RichText text={line} />
                </span>
              </li>
            ))}
          </ol>
        </StageBackdrop>
        <div className="narrative-actions">
          <button type="button" className="btn btn-quiet" onClick={() => setRound(round + 1)} data-testid="opening-replay">
            {chrome.onboarding.replayOpening}
          </button>
          <button type="button" className="btn btn-primary" onClick={onStart} data-testid="opening-start">
            {buttons.start}
          </button>
        </div>
      </div>
    </div>
  );
}

interface JournalProps {
  progress: StudioProgress;
  onClose: () => void;
  onReplayPrologue: () => void;
  onReplayAct: (act: number) => void;
  onOpenRepl: () => void;
  onOpenCodex: () => void;
}

export function JournalOverlay({ progress, onClose, onReplayPrologue, onReplayAct, onOpenRepl, onOpenCodex }: JournalProps) {
  const terms = useMemo(() => unlockedTerms(progress.levelsStarted), [progress.levelsStarted]);
  const lastLevel = progress.lastCompletedLevelId ? levelCopy(progress.lastCompletedLevelId) : null;
  const ACT_NUMERALS = ["一", "二", "三"];
  const replayActNumber = progress.actsSeen.length > 0 ? Math.max(...progress.actsSeen) : 1;
  const replayActLabel = fill(journalLabels.replayAct, { 幕: ACT_NUMERALS[replayActNumber - 1] ?? "一" });
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  return (
    <div className="narrative-overlay" role="dialog" aria-modal="true" data-testid="journal-overlay">
      <div className="journal-card">
        <h2 data-ui-title>{journalLabels.title}</h2>
        <div className="journal-body">
          <section className="journal-section">
            <h3>{journalLabels.world}</h3>
            <p>{journal.world}</p>
          </section>
          <section className="journal-section">
            <h3>{journalLabels.me}</h3>
            <p>{journal.me}</p>
          </section>
          <section className="journal-section">
            <h3>{journalLabels.terms}</h3>
            <p className="muted small">{journalLabels.termsHint}</p>
            {terms.length === 0 ? (
              <p className="muted">{journalLabels.emptyTerms}</p>
            ) : (
              <ul className="term-list" aria-label={chrome.aria.terms}>
                {terms.map((term) => (
                  <li key={term.term} className="term-item">
                    <button
                      type="button"
                      className="term-button"
                      data-testid={`term-${term.term}`}
                      aria-expanded={openTerm === term.term}
                      onClick={() => setOpenTerm(openTerm === term.term ? null : term.term)}
                    >
                      {term.term}
                    </button>
                    {openTerm === term.term ? <p className="term-explain">{term.explain}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="journal-section">
            <h3>{journalLabels.last}</h3>
            <p>{lastLevel?.journalRecap ?? journalLabels.emptyLast}</p>
          </section>
        </div>
        <div className="journal-actions">
          <button type="button" className="btn" onClick={onReplayPrologue} data-testid="journal-replay-prologue">
            {journalLabels.replayPrologue}
          </button>
          {progress.actsSeen.length > 0 ? (
            <button type="button" className="btn" onClick={() => onReplayAct(replayActNumber)} data-testid="journal-replay-act">
              {replayActLabel}
            </button>
          ) : null}
          <button type="button" className="btn" onClick={onOpenRepl} data-testid="journal-repl">
            {chrome.runeBench.journalGo}
          </button>
          <button type="button" className="btn" onClick={onOpenCodex} data-testid="journal-codex">
            {chrome.codex.open}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose} data-testid="journal-close">
            {journalLabels.close}
          </button>
        </div>
        <p className="muted small journal-footer">{journalLabels.footer}</p>
      </div>
    </div>
  );
}
