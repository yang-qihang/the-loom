import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { acts, buttons, chrome, fill, journal, journalLabels, levelCopy, prologue, rules, unlockedTerms } from "../copy";
import { ConceptRevealCard } from "./ConceptRevealCard";
import type { StudioProgress } from "../progress";
import { JustifiedText } from "./JustifiedText";
import { NarrativeLines } from "./NarrativeLines";

const CHINESE_INDEX = ["一", "二", "三"];

function StageBackdrop({ variant, children }: { variant: number; children: React.ReactNode }) {
  return (
    <div className={`narrative-stage stage-${variant % 8}`}>
      <div className="stage-photo" aria-hidden="true" />
      <div className="stage-content">{children}</div>
    </div>
  );
}

interface ScrollMetrics {
  scrollable: boolean;
  atTop: boolean;
  atBottom: boolean;
  /** 0–1：滚动位置占可滚动区间的比例。 */
  offset: number;
  /** 滑块高度占轨道的比例（按可视比例计算并夹到最小 10%，保证可抓取）。 */
  visibleRatio: number;
}

interface DragState {
  pointerId: number;
  startY: number;
  startTop: number;
  usableTrack: number;
  scrollRange: number;
}

const EMPTY_METRICS: ScrollMetrics = { scrollable: false, atTop: true, atBottom: true, offset: 0, visibleRatio: 1 };

/**
 * 叙事浮层内容壳：固定头 / 可滚动内容 / 固定底三段式的中间层。
 *
 * 为什么不直接把整张卡片 overflow-y:auto：卡片是 flex 容器时，长内容会被 flex
 * 压缩、由父级 overflow 裁掉（原 L06 开场在 896×603 上下各裁 ~50px 且无滚动条）。
 * 这里让中间层独占剩余的收缩空间（flex:1 + min-height:0），内容在内部自然滚动。
 *
 * 原生滚动条被隐藏，滚动位置靠不占布局的悬浮滑块展示；滚轮/触屏用原生滚动，
 * 键盘与拖拽在组件里补足，按钮始终在固定底栏里可见可点。
 */
function NarrativeScroll({
  children,
  ariaLabel,
  resetKey,
}: {
  children: React.ReactNode;
  ariaLabel: string;
  resetKey?: string | number;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [metrics, setMetrics] = useState<ScrollMetrics>(EMPTY_METRICS);
  const [dragging, setDragging] = useState(false);

  const measure = useCallback(() => {
    const element = scrollRef.current;
    if (!element) return;
    const maxScroll = element.scrollHeight - element.clientHeight;
    const scrollable = maxScroll > 2;
    const visibleRatio = element.scrollHeight > 0 ? Math.min(1, Math.max(0.1, element.clientHeight / element.scrollHeight)) : 1;
    const offset = scrollable ? Math.min(1, Math.max(0, element.scrollTop / maxScroll)) : 0;
    setMetrics((previous) => {
      const next: ScrollMetrics = {
        scrollable,
        atTop: !scrollable || element.scrollTop <= 1,
        atBottom: !scrollable || element.scrollTop >= maxScroll - 1,
        offset,
        visibleRatio,
      };
      if (
        previous.scrollable === next.scrollable &&
        previous.atTop === next.atTop &&
        previous.atBottom === next.atBottom &&
        Math.abs(previous.offset - next.offset) < 0.001 &&
        Math.abs(previous.visibleRatio - next.visibleRatio) < 0.001
      ) {
        return previous;
      }
      return next;
    });
  }, []);

  useLayoutEffect(() => {
    measure();
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    if (content) observer.observe(content);
    return () => observer.disconnect();
  }, [measure]);

  // 翻页 / 重看时回到顶部，避免新页短内容停在上一页的滚动位置。
  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    element.scrollTo({ top: 0 });
    measure();
  }, [measure, resetKey]);

  // 键盘滚动：PageUp/PageDown/上下键/Home/End；输入控件内不拦截。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const element = scrollRef.current;
      if (!element || element.scrollHeight <= element.clientHeight + 2) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target && (target.closest("input, textarea, select") || target.isContentEditable)) return;
      const step = Math.max(120, element.clientHeight * 0.82);
      const current = element.scrollTop;
      let next: number | null = null;
      if (event.key === "PageDown") next = current + step;
      else if (event.key === "PageUp") next = current - step;
      else if (event.key === "ArrowDown") next = current + 48;
      else if (event.key === "ArrowUp") next = current - 48;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = element.scrollHeight;
      if (next === null) return;
      event.preventDefault();
      element.scrollTo({ top: Math.min(element.scrollHeight, Math.max(0, next)), behavior: "smooth" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const scrollToTrackPosition = (clientY: number, track: HTMLDivElement, thumb: HTMLElement | null) => {
    const element = scrollRef.current;
    if (!element) return;
    const trackHeight = track.clientHeight;
    const thumbHeight = thumb?.clientHeight ?? 0;
    const usableTrack = Math.max(1, trackHeight - thumbHeight);
    const ratio = Math.min(1, Math.max(0, (clientY - track.getBoundingClientRect().top - thumbHeight / 2) / usableTrack));
    element.scrollTo({ top: ratio * (element.scrollHeight - element.clientHeight), behavior: "smooth" });
  };

  const onTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    scrollToTrackPosition(event.clientY, event.currentTarget, event.currentTarget.firstElementChild as HTMLElement | null);
  };

  const onThumbPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const element = scrollRef.current;
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    const thumb = event.currentTarget;
    const track = thumb.parentElement;
    if (!track) return;
    thumb.setPointerCapture(event.pointerId);
    const usableTrack = Math.max(1, track.clientHeight - thumb.clientHeight);
    dragRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startTop: element.scrollTop,
      usableTrack,
      scrollRange: element.scrollHeight - element.clientHeight,
    };
    setDragging(true);
  };

  const onThumbPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const element = scrollRef.current;
    if (!drag || !element || drag.pointerId !== event.pointerId) return;
    const delta = ((event.clientY - drag.startY) / drag.usableTrack) * drag.scrollRange;
    element.scrollTop = drag.startTop + delta;
  };

  const onThumbPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="narrative-scroll-shell">
      <div
        ref={scrollRef}
        className="narrative-scroll"
        role="region"
        aria-label={ariaLabel}
        tabIndex={0}
        data-testid="narrative-scroll"
        data-scrollable={metrics.scrollable ? "true" : "false"}
        data-at-top={metrics.atTop ? "true" : "false"}
        data-at-bottom={metrics.atBottom ? "true" : "false"}
        onScroll={measure}
      >
        <div className="narrative-scroll-content" ref={contentRef}>
          {children}
        </div>
      </div>
      <div
        className={`narrative-fade narrative-fade-top${metrics.scrollable && !metrics.atTop ? " is-on" : ""}`}
        data-testid="narrative-fade-top"
        aria-hidden="true"
      />
      <div
        className={`narrative-fade narrative-fade-bottom${metrics.scrollable && !metrics.atBottom ? " is-on" : ""}`}
        data-testid="narrative-fade-bottom"
        aria-hidden="true"
      />
      {metrics.scrollable ? (
        <div
          className={`narrative-scrollbar${dragging ? " is-dragging" : ""}`}
          data-testid="narrative-scrollbar"
          aria-hidden="true"
          onPointerDown={onTrackPointerDown}
        >
          <div
            className="narrative-scrollbar-thumb"
            data-testid="narrative-scrollbar-thumb"
            style={{ top: `${metrics.offset * (1 - metrics.visibleRatio) * 100}%`, height: `${metrics.visibleRatio * 100}%` }}
            onPointerDown={onThumbPointerDown}
            onPointerMove={onThumbPointerMove}
            onPointerUp={onThumbPointerUp}
            onPointerCancel={onThumbPointerUp}
            onLostPointerCapture={onThumbPointerUp}
          />
        </div>
      ) : null}
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
    <div className="narrative-overlay" role="dialog" aria-modal="true" aria-label={prologue.title} data-testid="prologue-overlay">
      <div className="narrative-card">
        <header className="narrative-head">
          {mode === "replay" ? <p className="settle-caption">{journalLabels.replayPrologue}</p> : null}
          <h2 data-ui-title>{prologue.title}</h2>
          <div className="narrative-dots" aria-hidden="true">
            {prologue.screens.map((_, dot) => (
              <span key={dot} className={dot <= index ? "is-on" : ""} />
            ))}
          </div>
        </header>
        <NarrativeScroll ariaLabel={`${prologue.title}剧情`} resetKey={index}>
          <StageBackdrop variant={index}>
            <p className="stage-scene">{screen.scene}</p>
            <p className="stage-speaker">{screen.speaker}</p>
            <NarrativeLines className="stage-lines-text" key={index}>
              {screen.lines.map((line) => (
                <p key={line}>
                  <JustifiedText text={line} />
                </p>
              ))}
            </NarrativeLines>
          </StageBackdrop>
          <p className="narrative-note">{prologue.skippable}</p>
        </NarrativeScroll>
        <footer className="narrative-foot">
          <div className="narrative-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              data-testid="onboarding-prev"
            >
              上一页
            </button>
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
        </footer>
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
    <div className="narrative-overlay" role="dialog" aria-modal="true" aria-label={copy.title} data-testid="act-overlay">
      <div className="narrative-card">
        <header className="narrative-head">
          {mode === "replay" ? <p className="settle-caption">{journalLabels.replayAct}</p> : null}
          <h2 data-ui-title>{copy.title}</h2>
          <div className="narrative-dots" aria-hidden="true">
            {copy.screens.map((_, dot) => (
              <span key={dot} className={dot <= index ? "is-on" : ""} />
            ))}
          </div>
        </header>
        <NarrativeScroll ariaLabel={`${copy.title}剧情`} resetKey={index}>
          <StageBackdrop variant={act * 2 + index}>
            <NarrativeLines className="stage-lines-text" key={index}>
              <p className="act-opening-line" key={copy.screens[index]}>
                <JustifiedText text={copy.screens[index]} centerWhenSingleLine />
              </p>
            </NarrativeLines>
          </StageBackdrop>
          <p className="narrative-note">{rules.skip}</p>
        </NarrativeScroll>
        <footer className="narrative-foot">
          <div className="narrative-actions">
            <button
              type="button"
              className="btn btn-quiet"
              onClick={() => setIndex((current) => Math.max(0, current - 1))}
              disabled={index === 0}
              data-testid="act-prev"
            >
              上一页
            </button>
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
        </footer>
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
    <div className="narrative-overlay" role="dialog" aria-modal="true" aria-label={copy.title} data-testid="opening-overlay">
      <div className="narrative-card opening-card" key={round}>
        <header className="narrative-head">
          <p className="settle-caption">{copy.act}</p>
          <h2 data-ui-title>{copy.title}</h2>
        </header>
        <NarrativeScroll ariaLabel={`${copy.title}开场`} resetKey={round}>
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
                    <JustifiedText text={line} />
                  </span>
                </li>
              ))}
            </ol>
          </StageBackdrop>
          <p className="narrative-note">{rules.skip}</p>
        </NarrativeScroll>
        <footer className="narrative-foot">
          <div className="narrative-actions">
            <button type="button" className="btn btn-quiet" onClick={() => setRound(round + 1)} data-testid="opening-replay">
              {chrome.onboarding.replayOpening}
            </button>
            <button type="button" className="btn btn-primary" onClick={onStart} data-testid="opening-start">
              {buttons.start}
            </button>
          </div>
        </footer>
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
  // 概念揭晓：优先刚通关的关卡，其次最近开始的关卡。
  const conceptLevelId = progress.lastCompletedLevelId
    ?? (progress.levelsStarted.length > 0 ? progress.levelsStarted[progress.levelsStarted.length - 1] : null);
  const ACT_NUMERALS = ["一", "二", "三"];
  const replayActNumber = progress.actsSeen.length > 0 ? Math.max(...progress.actsSeen) : 1;
  const replayActLabel = fill(journalLabels.replayAct, { 幕: ACT_NUMERALS[replayActNumber - 1] ?? "一" });
  const [openTerm, setOpenTerm] = useState<string | null>(null);
  return (
    <div className="narrative-overlay" role="dialog" aria-modal="true" aria-label={journalLabels.title} data-testid="journal-overlay">
      <div className="journal-card">
        <header className="narrative-head">
          <h2 data-ui-title>{journalLabels.title}</h2>
        </header>
        <NarrativeScroll ariaLabel={journalLabels.title}>
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
            {conceptLevelId ? (
              <section className="journal-section" data-testid="journal-concept">
                <ConceptRevealCard levelId={conceptLevelId} variant="journal" onOpenCodex={onOpenCodex} />
              </section>
            ) : null}
            <section className="journal-section">
              <h3>{journalLabels.last}</h3>
              <p>{lastLevel?.journalRecap ?? journalLabels.emptyLast}</p>
            </section>
          </div>
          <p className="muted small journal-footer">{journalLabels.footer}</p>
        </NarrativeScroll>
        <footer className="narrative-foot">
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
        </footer>
      </div>
    </div>
  );
}
