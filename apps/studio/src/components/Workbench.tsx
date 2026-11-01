import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  a11y,
  buttons,
  chrome,
  fill,
  humanizeError,
  journalLabels,
  labels,
  levelCopy,
  resolveCopy,
  sanitizeLog,
  states,
} from "../copy";
import { isDesktopShell, setAlwaysOnTop, setCompanionMode } from "../desktop";
import type { LevelCard } from "../copy";
import type { GoalState } from "./GoalList";
import type { LevelView, RunResult, SessionPhase, StudioEngine, StudioEvent } from "../types";
import { CoachCard } from "./CoachCard";
import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { ConceptRevealCard } from "./ConceptRevealCard";
import { GoalList } from "./GoalList";
import { PositionHud } from "./PositionHud";
import { ResultCard } from "./ResultCard";
import { SceneIllustration } from "./SceneIllustration";
import { skyFor } from "./scene-sky";
import { RichText } from "./RichText";
import { RuneGlyph } from "./RuneGlyph";
import { Stars } from "./Stars";
import { WorldLog } from "./WorldLog";

interface WorkbenchProps {
  levelId: string;
  engine: StudioEngine;
  onBack: () => void;
  onOpenJournal: () => void;
  onOpenCodex: () => void;
  /** 打开指令手册（顶栏按钮/教练卡链接；App 统一渲染模态）。 */
  onOpenManual: () => void;
  /** 用当前关卡打开试符台（REPL 不再强制跳回第一关）。 */
  onOpenRepl: () => void;
  onCompleted: () => void;
  nextLevel: LevelCard | null;
  onNextLevel: (levelId: string) => void;
}

interface WorkbenchError {
  message: string;
  line?: number;
}

function phaseLabel(phase: SessionPhase, result: RunResult | null, waitingForPlayer: boolean): string {
  if (phase === "ready") return waitingForPlayer ? chrome.workbench.phaseAwaiting : states.ready;
  if (phase === "running") return states.running;
  if (phase === "awaiting-player-beat") return chrome.workbench.phaseAwaiting;
  if (phase === "graded") return result?.passed ? states.pass : states.fail;
  if (phase === "error") return chrome.workbench.phaseError;
  return labels.loading;
}

export function Workbench({
  levelId,
  engine,
  onBack,
  onOpenJournal,
  onOpenCodex,
  onOpenManual,
  onOpenRepl,
  onCompleted,
  nextLevel,
  onNextLevel,
}: WorkbenchProps) {
  const [level, setLevel] = useState<LevelView | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SessionPhase>("loading");
  const [goals, setGoals] = useState<GoalState[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [error, setError] = useState<WorkbenchError | null>(null);
  /** 引擎 SSE hint 事件（每次 run 失败最多 1 条，不刷屏）。 */
  const [engineHint, setEngineHint] = useState<string | null>(null);
  /** 从 result.progress 推出的「第一个未完成目标」的引导。 */
  const [resultHint, setResultHint] = useState<string | null>(null);
  /** 目标完成提示（✓ 目标完成 + 下一步）。 */
  const [completedNotice, setCompletedNotice] = useState<{ goal: string; next: string | null } | null>(null);
  const [hintIndex, setHintIndex] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [annotationsOn, setAnnotationsOn] = useState(() => {
    try { return localStorage.getItem("loom.annotations") !== "off"; } catch { return true; }
  });
  const [editorFontSize, setEditorFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("loom.editor.fontSize"));
      return Number.isFinite(saved) && saved >= 13 && saved <= 22 ? saved : 16;
    } catch { return 16; }
  });
  const [companion, setCompanion] = useState(false);
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches);
  const [moreOpen, setMoreOpen] = useState(false);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [worldOpen, setWorldOpen] = useState(() => !(typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches));
  const [settleOpen, setSettleOpen] = useState(false);
  const errorHoldRef = useRef(false);
  const desktop = useMemo(() => isDesktopShell(), []);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 1100px)");
    const update = () => setNarrow(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const codeRef = useRef("");
  /** progress id → 目标面板下标（loadLevel/reset 时由 level.objectives 重建；不再按事件到达顺序猜）。 */
  const goalIndexRef = useRef<Map<string, number>>(new Map());
  const completedRef = useRef(false);
  const copy = level ? levelCopy(level.id) : null;
  const sky = skyFor(levelId);
  const isNightLevel = levelId === "L03" && !!copy?.trialUI;
  // 只有当引擎真值说「织偶部分已完成、轮到玩家」且这一轮还没通过时，才进入玩家节拍。
  const waitingForPlayer = !!result?.playerBeatReady && !result.passed;

  useEffect(() => {
    let disposed = false;
    setLoadError(null);
    setLevel(null);
    setSessionId(null);
    setPhase("loading");
    void (async () => {
      try {
        const loaded = await engine.loadLevel(levelId);
        const session = await engine.createSession(levelId);
        if (disposed) return;
        setLevel(loaded);
        setSessionId(session);
        codeRef.current = loaded.starterCode;
        goalIndexRef.current = new Map(loaded.objectives.map((goal, index) => [goal.id, index]));
        setGoals(loaded.objectives.map((goal) => ({ id: goal.id, text: goal.text, done: false })));
      } catch (cause) {
        if (disposed) return;
        setLoadError(cause instanceof Error ? cause.message : chrome.workbench.loadFailed);
        setPhase("error");
      }
    })();
    return () => {
      disposed = true;
    };
  }, [engine, levelId]);

  useEffect(() => {
    if (!sessionId) return;
    try {
      window.parent?.postMessage({ type: "loom:session", sessionId, levelId }, "*");
    } catch { /* 浏览器直开时没有父壳 */ }
  }, [sessionId, levelId]);

  useEffect(() => {
    if (!sessionId) return;
    const unsubscribe = engine.subscribe(sessionId, (event: StudioEvent) => {
      if (event.type === "state") {
        if (errorHoldRef.current && event.state === "ready") return;
        setPhase(event.state);
      }
      else if (event.type === "log") {
        const line = sanitizeLog(event.line);
        if (line) setLogs((previous) => [...previous.slice(-59), line]);
      } else if (event.type === "objective") {
        // 目标按 progress id 更新；id 映射来自 loadLevel/reset 时的 level.objectives（不再猜 index）。
        const index = goalIndexRef.current.get(event.id);
        if (index === undefined) return;
        setGoals((previous) => {
          if (!previous[index]) return previous;
          const next = [...previous];
          next[index] = { ...next[index], done: event.done };
          return next;
        });
      } else if (event.type === "result") {
        const hasResult = event.result.criteria.length > 0 || (event.result.progress?.length ?? 0) > 0;
        setResult(hasResult ? event.result : null);
        if (event.result.passed) {
          void engine.inGame(sessionId, "灯河亮了。");
        } else if (hasResult && event.result.playerBeatReady) {
          // 只有引擎说「轮到你」时才在游戏内提示，避免过早引导。
          void engine.inGame(sessionId, copy?.playerBeatUI ?? "轮到你完成最后一步。", "actionbar");
        }
        if (hasResult) {
          setLogs((previous) => (previous.length > 1 ? previous : [...previous, chrome.workbench.runFinished]));
        }
        if (hasResult && !event.result.passed) {
          const steps = event.result.progress ?? [];
          const pending = steps.filter((step) => !step.passed);
          const done = steps.filter((step) => step.passed);
          const pendingGoal = pending[0] ? level?.objectives.find((goal) => goal.id === pending[0].id) : undefined;
          setResultHint(pendingGoal?.hint ?? null);
          if (!event.result.playerBeatReady && done.length > 0 && pending.length > 0) {
            setCompletedNotice({ goal: done[done.length - 1]?.text ?? "", next: pending[0].text });
          } else {
            setCompletedNotice(null);
          }
        }
        if (event.result.passed) {
          setPhase("graded");
          setSettleOpen(true);
        }
      } else if (event.type === "hint") {
        // 引擎按节点发引导（每次 run 失败最多 1 条）；相同文案去重，避免刷屏。
        const text = String(event.text ?? "").trim();
        if (text) setEngineHint((previous) => (previous === text ? previous : text));
      } else if (event.type === "error") {
        setResult(null);
        setPhase("error");
        errorHoldRef.current = true;
        const raw = String(event.message ?? "");
        const syntaxLike = typeof event.line === "number" || /SyntaxError|Unexpected token|Unexpected end|Unexpected identifier|Unterminated/i.test(raw);
        if (syntaxLike) {
          const authored = copy?.errors.syntax ?? "这一行还没写完：先看括号、引号和逗号，改完再运行一次。";
          void engine.inGame(sessionId, "第 " + String(event.line ?? 1) + " 行还没写完。看看括号和数字。", "actionbar");
          setError({ message: resolveCopy(authored), line: typeof event.line === "number" ? event.line : 1 });
          if (typeof event.line === "number") editorRef.current?.revealLine(event.line);
        } else {
          // 沙箱/运行时错误不是语法错误，不能伪装成「第 1 行没写完」。
          setError({ message: humanizeError(raw, levelId) });
        }
        setLogs([]);
      }
    });
    return unsubscribe;
  }, [engine, level, levelId, sessionId]);

  useEffect(() => {
    if (!result?.passed || completedRef.current) return;
    completedRef.current = true;
    onCompleted();
  }, [onCompleted, result]);

  const resetWorkbench = useCallback(async () => {
    if (sessionId) void engine.inGame(sessionId, "这一关已经重置。");
    if (!sessionId) return;
    await engine.reset(sessionId);
    errorHoldRef.current = false;
    setPhase("ready");
    setResult(null);
    setError(null);
    setLogs([]);
    setHintIndex(0);
    setSettleOpen(false);
    setEngineHint(null);
    setResultHint(null);
    setCompletedNotice(null);
    goalIndexRef.current.clear();
    if (level) {
      goalIndexRef.current = new Map(level.objectives.map((goal, index) => [goal.id, index]));
      setGoals(level.objectives.map((goal) => ({ text: goal.text, done: false, id: goal.id })));
      editorRef.current?.setValue(level.starterCode);
      codeRef.current = level.starterCode;
    }
  }, [engine, level, sessionId]);

  const runProgram = useCallback(async () => {
    if (!sessionId || phase === "running") return;
    setResult(null);
    setError(null);
    setLogs([chrome.workbench.runStarted]);
    setEngineHint(null);
    setResultHint(null);
    setCompletedNotice(null);
    errorHoldRef.current = false;
    setPhase("running");
    try {
      await engine.run(sessionId, codeRef.current);
    } catch (cause) {
      setError({ message: humanizeError(cause instanceof Error ? cause.message : undefined, levelId) });
      errorHoldRef.current = false;
    setPhase("ready");
    }
  }, [engine, levelId, phase, sessionId]);

  const stopProgram = useCallback(async () => {
    if (!sessionId) return;
    await engine.stop(sessionId);
  }, [engine, sessionId]);

  const playerBeat = useCallback(async () => {
    if (!sessionId) return;
    // 由引擎决定模拟还是真实确认：mock 世界模拟，paper 世界只确认真人亲手完成的结果。
    await engine.playerBeat(sessionId);
  }, [engine, sessionId]);

  const showHint = useCallback(() => {
    if (!copy) return;
    setHintIndex((previous) => Math.min(previous + 1, copy.hints.length));
  }, [copy]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target) {
        if (target.closest(".monaco-editor") || target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
        if (target.tagName === "BUTTON") return;
      }
      event.preventDefault();
      void runProgram();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [runProgram]);

  const togglePinned = useCallback(async () => {
    const next = !pinned;
    try {
      if (await setAlwaysOnTop(next)) setPinned(next);
    } catch {
      setPinned(pinned);
    }
  }, [pinned]);

  const toggleCompanion = useCallback(async () => {
    const next = !companion;
    try {
      if (await setCompanionMode(next)) setCompanion(next);
    } catch {
      setCompanion(companion);
    }
  }, [companion]);

  useEffect(() => {
    if (import.meta.env.VITE_E2E !== "1") return;
    window.__loomStudio = {
      fillReference: () => {
        if (level) {
          editorRef.current?.setValue(level.referenceSolution);
          codeRef.current = level.referenceSolution;
        }
      },
      fillStarter: () => {
        if (level) {
          editorRef.current?.setValue(level.starterCode);
          codeRef.current = level.starterCode;
        }
      },
      setCode: (code: string) => {
        editorRef.current?.setValue(code);
        codeRef.current = code;
      },
      run: () => void runProgram(),
      playerBeat: () => void playerBeat(),
      reset: () => void resetWorkbench(),
    };
    return () => {
      delete window.__loomStudio;
    };
  }, [level, playerBeat, resetWorkbench, runProgram]);

  const coachMessage = useMemo(() => {
    if (loadError) return chrome.workbench.loadFailed;
    if (!copy) return labels.loading;
    if (error) return `先改第 ${error.line ?? 1} 行，再点一次「运行」。`;
    if (phase === "running") return copy.coachOpen[1] ?? copy.firstStep;
    if (result?.passed) return copy.coachReact[3] ?? copy.settle.stars;
    if (waitingForPlayer) return `轮到你了：${copy.playerBeatUI}`;
    if (completedNotice) {
      return fill(chrome.workbench.progressDoneNext, {
        目标: completedNotice.goal,
        下一步: completedNotice.next ?? chrome.workbench.progressAllDone,
      });
    }
    if (result) {
      // 失败但还没轮到玩家：直接说还差哪一条（目标真值来自引擎 progress），不提前教玩家节拍。
      const pending = goals.filter((goal) => !goal.done);
      return `还没完成：${pending[0]?.text ?? copy.goals[0]}`;
    }
    return copy.firstStep;
  }, [completedNotice, copy, error, goals, loadError, phase, result, waitingForPlayer]);
  // 引导优先级：引擎 SSE hint（内容层写的 2–4 句）→ result.progress 里第一个未完成目标的 hint。
  const progressHint = engineHint ?? resultHint;
  const hint = copy && hintIndex > 0 ? resolveCopy(copy.hints[hintIndex - 1]) : null;

  return (
    <div className={companion ? "workbench is-companion" : "workbench"}>
      <header className="wb-top">
        <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-back">
          {buttons.back}
        </button>
        <div className="wb-title">
          <span className="wb-act">{copy?.act ?? ""}</span>
          <h2 data-ui-title>{level?.title ?? labels.loading}</h2>
          <span className="sky-chip" data-testid="sky-chip" title={sky.note}>
            {sky.periodLabel} · {sky.weatherLabel}
          </span>
        </div>
        <div className="wb-status">
          {narrow ? (
            <div className="wb-more-wrap">
              <button type="button" className="btn btn-quiet" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} data-testid="btn-more">
                更多
              </button>
              {moreOpen ? (
                <div className="wb-more-menu" onClick={(event) => { if ((event.target as HTMLElement).closest("button")) setMoreOpen(false); }}>
                  {desktop ? (
                    <>
                      <button type="button" className="btn btn-quiet" onClick={() => void togglePinned()}>{pinned ? chrome.shell.unpin : chrome.shell.pin}</button>
                      <button type="button" className="btn btn-quiet" onClick={() => void toggleCompanion()}>{companion ? chrome.shell.expand : chrome.shell.companion}</button>
                    </>
                  ) : null}
                  <button type="button" className="btn btn-quiet" onClick={() => void resetWorkbench()} data-testid="btn-reset-top">重置本关</button>
                  <button type="button" className="btn btn-quiet" onClick={onOpenManual} data-testid="btn-manual-menu">{chrome.workbench.manualButton}</button>
                  <button type="button" className="btn btn-quiet" onClick={onOpenRepl} data-testid="btn-repl-menu">{chrome.workbench.replButton}</button>
                  <button type="button" className="btn btn-quiet" onClick={() => { const next = !annotationsOn; setAnnotationsOn(next); try { localStorage.setItem("loom.annotations", next ? "on" : "off"); } catch { /* ignore */ } if (sessionId) void engine.setAnnotations(sessionId, next); }} data-testid="btn-annotations">世界标注：{annotationsOn ? "开" : "关"}</button>
                  <button type="button" className="btn btn-quiet" onClick={onOpenJournal} data-testid="btn-journal">{journalLabels.open}</button>
                  <button type="button" className="btn btn-quiet" onClick={onOpenCodex} data-testid="btn-codex">{chrome.codex.open}</button>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              {desktop ? (
                <>
                  <button type="button" className="btn btn-quiet btn-shell" onClick={() => void togglePinned()} data-testid="btn-pin">{pinned ? chrome.shell.unpin : chrome.shell.pin}</button>
                  <button type="button" className="btn btn-quiet btn-shell" onClick={() => void toggleCompanion()} data-testid="btn-companion">{companion ? chrome.shell.expand : chrome.shell.companion}</button>
                </>
              ) : null}
              <button type="button" className="btn btn-quiet" onClick={() => void resetWorkbench()} data-testid="btn-reset-top">重置本关</button>
              <button type="button" className="btn btn-quiet" onClick={onOpenManual} data-testid="btn-manual">{chrome.workbench.manualButton}</button>
              <button type="button" className="btn btn-quiet" onClick={onOpenRepl} data-testid="btn-repl-top">{chrome.workbench.replButton}</button>
              <button type="button" className="btn btn-quiet" onClick={() => { const next = !annotationsOn; setAnnotationsOn(next); try { localStorage.setItem("loom.annotations", next ? "on" : "off"); } catch { /* ignore */ } if (sessionId) void engine.setAnnotations(sessionId, next); }} title="世界里的中文浮空字是路标，帮你认第几盏灯、谁是艾拉和灰崽；不想看可以随时关掉。" data-testid="btn-annotations">世界标注：{annotationsOn ? "开" : "关"}</button>
              <button type="button" className="btn btn-quiet" onClick={onOpenJournal} data-testid="btn-journal">{journalLabels.open}</button>
              <button type="button" className="btn btn-quiet" onClick={onOpenCodex} data-testid="btn-codex">{chrome.codex.open}</button>
              <span className={engine.mode === "mock" ? "mode-chip is-mock" : "mode-chip"}>{engine.mode === "mock" ? chrome.mode.local : chrome.mode.real}</span>
            </>
          )}
          <span className="phase-chip" data-testid="phase-chip">{phaseLabel(phase, result, waitingForPlayer)}</span>
        </div>
      </header>

      {loadError ? (
        <div className="error-panel" role="alert">
          <p className="error-title">{chrome.workbench.loadFailed}</p>
          <p className="error-detail">{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={onBack}>
            {buttons.back}
          </button>
        </div>
      ) : (
        <main className="wb-body">
          <section className="editor-pane">
            <div className={worldOpen ? "world-strip" : "world-strip is-collapsed"}>
              {worldOpen ? (
                <>
                  <img src={`./world/${levelId}.png`} alt={`真实 Minecraft 客户端里的${level?.title ?? ""}场景`} data-testid="world-strip-image" data-level={levelId} />
                  <div className="world-strip-text">
                    <b>世界在「我的世界」窗口里</b>
                    <span>这是真实游戏窗口里的当前场景；代码在左边，世界在另一个窗口，两边会一起动。</span>
                  </div>
                </>
              ) : (
                <b className="world-strip-collapsed-title">世界画面说明已收起</b>
              )}
              <button type="button" className="btn btn-quiet world-strip-toggle" onClick={() => setWorldOpen((open) => !open)} aria-expanded={worldOpen}>
                {worldOpen ? "收起" : "展开"}
              </button>
            </div>
            <div className="pane-head">
              <span className="pane-title" data-ui-panel-title>
                {chrome.workbench.codeLabel}
              </span>
              <span className="kbd">{labels.keyRun}</span>
              <button
                type="button"
                className="btn btn-primary btn-run-top"
                onClick={() => void runProgram()}
                disabled={phase === "running" || !level}
                data-testid="btn-run-top"
              >
                {buttons.run}
              </button>
              <div className="editor-font-controls" role="group" aria-label="代码字号">
                <button
                  type="button"
                  className="font-step"
                  aria-label="缩小代码字号"
                  title="缩小代码字号"
                  onClick={() => {
                    const next = Math.max(13, editorFontSize - 1);
                    setEditorFontSize(next);
                    try { localStorage.setItem("loom.editor.fontSize", String(next)); } catch { /* ignore */ }
                  }}
                  data-testid="btn-font-smaller"
                >
                  A-
                </button>
                <span className="font-value" data-testid="font-size-value">{editorFontSize}</span>
                <button
                  type="button"
                  className="font-step"
                  aria-label="放大代码字号"
                  title="放大代码字号"
                  onClick={() => {
                    const next = Math.min(22, editorFontSize + 1);
                    setEditorFontSize(next);
                    try { localStorage.setItem("loom.editor.fontSize", String(next)); } catch { /* ignore */ }
                  }}
                  data-testid="btn-font-larger"
                >
                  A+
                </button>
              </div>
            </div>
            <div className="pane-body">
              {isNightLevel && copy?.trialUI ? (
                <div className="night-strip" data-testid="night-cards">
                  <div className="night-strip-head">
                    <span className="night-title">{chrome.workbench.nightHeader}</span>
                    <span className="muted small">{chrome.workbench.nightNote}</span>
                  </div>
                  <ul className="night-cards">
                    {copy.trialUI.nights.map((night, index) => (
                      <li className="night-card" key={night}>
                        <span className="night-index">
                          {fill(chrome.workbench.nightCard, { 序号: index + 1 })}
                          {index === 0 ? chrome.workbench.nightTonight : ""}
                        </span>
                        <span className="night-name">{night}</span>
                        <span className="night-state">{chrome.workbench.nightNotStarted}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {error ? (
                <div className="error-banner" role="alert" data-testid="error-banner">
                  <span className="error-line">{fill(chrome.workbench.errorLinePrefix, { 行: error.line ?? 1 })}</span>
                  <span className="error-reason">
                    <RichText text={error.message} />
                  </span>
                </div>
              ) : null}
              {level ? (
                <CodeEditor
                  ref={editorRef}
                  initialValue={level.starterCode}
                  onChange={(value) => {
                    codeRef.current = value;
                  }}
                  onRun={() => void runProgram()}
                  fontSize={editorFontSize}
                />
              ) : (
                <p className="muted editor-loading">{labels.loading}</p>
              )}
            </div>
          </section>

          <aside className="rail">
            <section className="card goals" aria-label={a11y.goal}>
              <header className="card-head">
                <h3 data-ui-panel-title>{labels.goalHeader}</h3>
                {/* 收起按钮放在计数左侧：计数胶囊保持在卡片头最右侧（像素皮肤：右侧留白与上下留白一致）。 */}
                <button type="button" className="btn btn-quiet card-collapse" onClick={() => setGoalsOpen((open) => !open)} aria-expanded={goalsOpen}>
                  {goalsOpen ? "收起" : "展开"}
                </button>
                <span className="card-tag">
                  {goals.filter((goal) => goal.done).length} / {goals.length}
                </span>
              </header>
              {goalsOpen ? (
                <div className="card-body">
                  <GoalList goals={goals} />
                </div>
              ) : null}
            </section>
            <PositionHud engine={engine} sessionId={sessionId} level={level} onOpenManual={onOpenManual} />
            <SceneIllustration levelId={levelId} />
            {copy?.challenge ? (
              <details className="card challenge" data-testid="challenge-card">
                <summary>挑战层 · {copy.challenge.title}（可跳过）</summary>
                <p className="challenge-goal">{copy.challenge.goal}</p>
                <p className="challenge-desc">{copy.challenge.desc}</p>
              </details>
            ) : null}
            <CoachCard
              message={coachMessage}
              hint={hint}
              hintLevel={hintIndex}
              canHint={!!copy && hintIndex < copy.hints.length}
              onHint={showHint}
              progressHint={progressHint}
              onOpenManual={onOpenManual}
            />
            {waitingForPlayer ? (
              <section className="card waiting" aria-label="轮到你">
                <header className="card-head">
                  <h3 data-ui-panel-title>轮到你</h3>
                </header>
                <p>
                  {engine.mode === "mock"
                    ? `现在轮到你亲自动手：${copy?.playerBeatUI ?? "完成最后一步"}。做完回来按下面的按钮确认。`
                    : `现在轮到你亲自动手：${copy?.playerBeatUI ?? "完成最后一步"}。做完回来按下面的按钮确认。`}
                </p>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void playerBeat()}
                  data-testid="btn-player-beat"
                >
                  {copy?.playerBeatAction ?? "我已在游戏里完成"}
                </button>
                {copy?.playerBeatGuide?.length ? (
                  <div className="player-beat-guide" data-testid="player-beat-guide">
                    <h4>第 4 盏灯怎么点</h4>
                    <ol>
                      {copy.playerBeatGuide.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <details className="mc-help" data-testid="mc-help" open>
                  <summary>{chrome.workbench.mcHelpTitle}</summary>
                  <p>{chrome.workbench.mcHelpIntro}</p>
                  <ol>
                    {chrome.workbench.mcHelpSteps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p>
                    世界里飘着的中文字是「标注」，用来认第几盏灯、谁是艾拉和灰崽。右上角的「世界标注：开/关」可以随时让它们出现或消失。
                  </p>
                  <p className="mc-help-reset">{chrome.workbench.mcHelpReset}</p>
                  <button type="button" className="btn btn-quiet" onClick={() => void resetWorkbench()} data-testid="btn-help-reset">
                    我弄乱了世界，重置本关
                  </button>
                </details>
              </section>
            ) : null}
            <ResultCard
              levelId={levelId}
              phase={phase}
              stateLabel={phaseLabel(phase, result, waitingForPlayer)}
              result={result}
              waitingForPlayer={waitingForPlayer}
              goals={goals}
            />
            <WorldLog lines={logs} />
          </aside>
        </main>
      )}

      {settleOpen && result?.passed && copy ? (
        <div className="settle-overlay" role="dialog" aria-modal="true" data-testid="settle-overlay">
          <div className="settle-card">
            <p className="settle-caption">{copy.act}</p>
            <h2 data-ui-title>{copy.settle.title}</h2>
            <Stars stars={result.stars} />
            <p className="settle-line">{copy.settle.stars}</p>
            <ConceptRevealCard levelId={levelId} level={level} onOpenCodex={onOpenCodex} />
            {copy.settle.detail ? <p className="settle-detail">{copy.settle.detail}</p> : null}
            <ul className="settle-goals">
              {goals.map((goal) => (
                <li key={goal.id} className="settle-goal">
                  <span className="criterion-mark" aria-hidden="true">
                    {goal.done ? "✓" : "✗"}
                  </span>
                  <span>
                    <RichText text={goal.text} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="settle-actions">
              <button type="button" className="btn btn-quiet" onClick={() => void resetWorkbench()} data-testid="btn-settle-replay">
                {buttons.replay}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => void resetWorkbench()} data-testid="btn-settle-reset">
                重置本关
              </button>
              {nextLevel ? (
                <button type="button" className="btn btn-primary" onClick={() => onNextLevel(nextLevel.id)} data-testid="btn-settle-next">
                  {buttons.nextLevel}
                </button>
              ) : null}
              <button type="button" className="btn btn-quiet" onClick={onBack} data-testid="btn-settle-back">
                {buttons.back}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <footer className="wb-actions">
        <div className="actions-main">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void runProgram()}
            disabled={phase === "running" || !level}
            data-testid="btn-run"
          >
            {buttons.run}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => void stopProgram()}
            disabled={phase !== "running"}
            data-testid="btn-stop"
          >
            {buttons.stop}
          </button>
          <button type="button" className="btn" onClick={() => void resetWorkbench()} disabled={!sessionId} data-testid="btn-reset">
            {buttons.reset}
          </button>
        </div>
        <div className="actions-extra">
          <RuneGlyph id={levelId} size={20} />
          <span className="muted small">{labels.keyRun}</span>
        </div>
      </footer>
    </div>
  );
}
