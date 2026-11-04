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
import type { LevelCard } from "../copy";
import type { GoalState } from "./GoalList";
import type { LevelView, RunResult, SessionPhase, SnapshotView, StudioEngine, StudioEvent } from "../types";
import { EngineUnavailableError } from "../types";
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
import { summarizeEnv, type EnvState } from "../shell-env";
import { Stars } from "./Stars";
import { WorldLog } from "./WorldLog";

interface WorkbenchProps {
  levelId: string;
  engine: StudioEngine;
  /** 桌面壳下发的 EnvState（环境状态唯一来源，与壳顶栏四灯同源）；无壳时为 null。 */
  env: EnvState | null;
  onBack: () => void;
  onOpenJournal: () => void;
  onOpenCodex: () => void;
  /** 打开指令手册（顶栏菜单/教练卡链接；App 统一渲染模态）。 */
  onOpenManual: () => void;
  /** 用当前关卡打开试符台（REPL 不再强制跳回第一关）。 */
  onOpenRepl: () => void;
  /** 查看本关完整解（调试工具，收在「帮助」菜单里）。 */
  onOpenSolution: () => void;
  /** 打开本关配套教材（与右下角常驻入口共用 App 的 TextbookWindow）。 */
  onOpenTextbook: () => void;
  onCompleted: () => void;
  nextLevel: LevelCard | null;
  onNextLevel: (levelId: string) => void;
}

interface WorkbenchError {
  message: string;
  line?: number;
  /** 后端给的可操作建议（docs/49 §2.4）：和 message 一起显示，不再只有泛化错误。 */
  hint?: string;
  /** 后端错误码（INVALID_STATE / MC_UNAVAILABLE / ENGINE_OFFLINE …）。 */
  code?: string;
  /** 可恢复错误：错误卡给「重置本关后重试」动作。 */
  recoverable?: boolean;
}

/** 触发一次 run 的客户端兜底超时：避免 POST 挂住后按钮永远转圈。 */
const RUN_REQUEST_TIMEOUT_MS = 45_000;

function readableEngineError(cause: unknown, levelId: string): WorkbenchError {
  if (cause instanceof EngineUnavailableError) {
    return {
      message: cause.message.trim().length > 0 ? cause.message : chrome.workbench.errorGeneric,
      ...(cause.hint ? { hint: cause.hint } : {}),
      ...(cause.code ? { code: cause.code } : {}),
      recoverable: cause.recoverable,
    };
  }
  return { message: humanizeError(cause instanceof Error ? cause.message : undefined, levelId) };
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
  env,
  onBack,
  onOpenJournal,
  onOpenCodex,
  onOpenManual,
  onOpenRepl,
  onOpenSolution,
  onOpenTextbook,
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
  const [annotationsOn, setAnnotationsOn] = useState(() => {
    try { return localStorage.getItem("loom.annotations") !== "off"; } catch { return true; }
  });
  const [editorFontSize, setEditorFontSize] = useState(() => {
    try {
      const saved = Number(localStorage.getItem("loom.editor.fontSize"));
      return Number.isFinite(saved) && saved >= 13 && saved <= 22 ? saved : 16;
    } catch { return 16; }
  });
  /** 顶栏菜单：同一时间只开一个（帮助 / 关卡），避免两个下拉叠在一起。 */
  const [openMenu, setOpenMenu] = useState<"help" | "levels" | null>(null);
  const [goalsOpen, setGoalsOpen] = useState(true);
  const [worldOpen, setWorldOpen] = useState(() => !(typeof window !== "undefined" && window.matchMedia("(max-width: 1100px)").matches));
  const [settleOpen, setSettleOpen] = useState(false);
  const errorHoldRef = useRef(false);
  /** 同步守卫：双击「运行」/回车连发时，第二次请求直接拦掉（渲染闭包里的 phase 可能还没更新）。 */
  const runInFlightRef = useRef(false);
  /** 当前结果（快照轮询回调里读最新值，不依赖渲染闭包）。 */
  const resultRef = useRef<RunResult | null>(null);
  /** 自动确认玩家节拍：同一「epoch + 进度签名」只触发一次；失败后冷却重试。 */
  const autoBeatKeyRef = useRef<string | null>(null);
  const beatInFlightRef = useRef(false);
  const beatCooldownUntilRef = useRef(0);
  /** reset 后的抑制窗口：旧 epoch 的轮询结果可能晚到，别让它触发自动确认。 */
  const suppressBeatUntilRef = useRef(0);
  /** 快照里的会话 epoch（防重放/去重用；顶层 epoch 可能被插件快照覆盖）。 */
  const sessionEpochRef = useRef<number | null>(null);
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
  /** 四灯压缩成一条状态（与壳顶栏同源）：四灯全绿时让位给会话状态，否则优先报环境异常。 */
  const envSummary = env ? summarizeEnv(env) : null;
  /** L2：关卡会话进行中客户端掉线（壳下发 clientLost）→ 壳会盖红色阻断层，Studio 内同步禁用操作兜底。 */
  const clientLost = env?.clientLost === true;

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
    return () => {
      try { window.parent?.postMessage({ type: "loom:session", sessionId: null, levelId: null, previousSessionId: sessionId }, "*"); }
      catch { /* parent closed */ }
    };
  }, [sessionId, levelId]);

  useEffect(() => {
    if (!sessionId) return;
    const unsubscribe = engine.subscribe(sessionId, (event: StudioEvent) => {
      if (event.type === "state") {
        // 真实试符台的「恢复现场」复用本关 reset；同步清掉工作台的旧结果与结算。
        if (event.state === "loading") {
          resultRef.current = null;
          autoBeatKeyRef.current = null;
          suppressBeatUntilRef.current = Date.now() + 2000;
          errorHoldRef.current = false;
          setResult(null);
          setSettleOpen(false);
          setError(null);
          setEngineHint(null);
          setResultHint(null);
          setCompletedNotice(null);
        }
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
        // 新一轮的真实评分结果到达 → 上一轮的「错误保持」与红条立即作废（P1-3：
        // 旧实现只在 run 开头/reset 清 error，会出现「正确结果 + 红条」同时显示）。
        if (hasResult) {
          errorHoldRef.current = false;
          setError(null);
        }
        resultRef.current = hasResult ? event.result : null;
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
        resultRef.current = null;
        setResult(null);
        setPhase("error");
        errorHoldRef.current = true;
        const raw = String(event.message ?? "");
        const syntaxLike = typeof event.line === "number" || /SyntaxError|Unexpected token|Unexpected end|Unexpected identifier|Unterminated/i.test(raw);
        if (syntaxLike) {
          const authored = copy?.errors.syntax ?? "这一行还没写完：先看括号、引号和逗号，改完再运行一次。";
          if (typeof event.line === "number") {
            void engine.inGame(sessionId, "第 " + String(event.line) + " 行还没写完。看看括号和数字。", "actionbar");
            editorRef.current?.revealLine(event.line);
          }
          // 没有行号时不要伪造「第 1 行」：error 卡会按「运行出错」展示（P1-3）。
          setError({ message: resolveCopy(authored), ...(typeof event.line === "number" ? { line: event.line } : {}) });
        } else {
          // 沙箱/运行时错误不是语法错误，不能伪装成「第 1 行没写完」。
          // 引擎消息本身是中文人话（可能夹英文 API 名）：有中文就原样展示，别被 humanize 吞成泛化文案。
          const readable = /[\u4e00-\u9fff]/.test(raw) ? raw : humanizeError(raw, levelId);
          setError({ message: readable });
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
    if (!sessionId) return;
    void engine.inGame(sessionId, "这一关已经重置。");
    await engine.reset(sessionId);
    errorHoldRef.current = false;
    // 重置后旧 epoch 的快照可能晚到：抑制窗口 + 清自动确认签名，避免旧进度把新会话自动结算。
    autoBeatKeyRef.current = null;
    beatCooldownUntilRef.current = 0;
    suppressBeatUntilRef.current = Date.now() + 2000;
    sessionEpochRef.current = null;
    setPhase("ready");
    resultRef.current = null;
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
      // 重置世界但保留编辑器里的代码：用户粘过来的参考解不能被清掉（docs/49 §2.4）。
    }
  }, [engine, level, sessionId]);

  const runProgram = useCallback(async () => {
    // 同步守卫：双击/回车连发时第二次请求在 setState 生效前就被拦掉，不会两个 run 抢同一会话。
    if (!sessionId || runInFlightRef.current || phase === "running") return;
    // L2 客户端丢失：壳已用红色阻断层兜底，Studio 内也不允许再提交运行。
    if (clientLost) return;
    runInFlightRef.current = true;
    resultRef.current = null;
    autoBeatKeyRef.current = null;
    setResult(null);
    setError(null);
    setLogs([chrome.workbench.runStarted]);
    setEngineHint(null);
    setResultHint(null);
    setCompletedNotice(null);
    setSettleOpen(false);
    errorHoldRef.current = false;
    setPhase("running");
    try {
      await engine.run(sessionId, codeRef.current);
    } catch (cause) {
      setError(readableEngineError(cause, levelId));
      errorHoldRef.current = false;
      setPhase("ready");
    } finally {
      runInFlightRef.current = false;
    }
  }, [clientLost, engine, levelId, phase, sessionId]);

  const stopProgram = useCallback(async () => {
    if (!sessionId) return;
    await engine.stop(sessionId);
  }, [engine, sessionId]);

  /**
   * 请求确认玩家节拍（手动兜底/自动确认共用）。
   * auto=true 时失败不弹红条（下个轮询周期静默重试）；手动失败展示真实原因。
   */
  const requestPlayerBeat = useCallback(
    async (auto: boolean) => {
      if (!sessionId || beatInFlightRef.current) return;
      // L2 客户端丢失期间不允许确认玩家节拍（否则会把「没做到」误当完成）。
      if (clientLost) return;
      beatInFlightRef.current = true;
      try {
        // 不传 simulate：paper 世界引擎只按真实世界评分（confirm-only），mock 世界自动模拟。
        await engine.playerBeat(sessionId);
      } catch (cause) {
        if (auto) {
          // 允许下个轮询重试（比如引擎刚好在重连/恢复场景）。
          autoBeatKeyRef.current = null;
          beatCooldownUntilRef.current = Date.now() + 3000;
        } else {
          setError(readableEngineError(cause, levelId));
        }
      } finally {
        beatInFlightRef.current = false;
      }
    },
    [clientLost, engine, levelId, sessionId],
  );

  const playerBeat = useCallback(async () => {
    // 手动兜底：paper 下真人右键后若自动检测没触发，玩家仍可自己点「我已在游戏里完成」。
    autoBeatKeyRef.current = "manual";
    beatCooldownUntilRef.current = Date.now() + 2000;
    await requestPlayerBeat(false);
  }, [requestPlayerBeat]);

  /**
   * 快照轮询回调（docs/49 §2.3 自动检测）：
   * ① 按 id 实时同步目标面板（解决「世界 3/3 完成但面板只打勾 2/3」）；
   * ② 当 state=READY、progress 全部通过（含玩家步骤）、本关确有玩家任务、且还没通过时，
   *    一次性自动确认玩家节拍 → SSE result 到达后现有逻辑自动打开结算浮层。
   */
  const handleSnapshot = useCallback(
    (snapshot: SnapshotView) => {
      const progress = Array.isArray(snapshot.progress) ? snapshot.progress : [];
      if (typeof snapshot.sessionEpoch === "number") sessionEpochRef.current = snapshot.sessionEpoch;
      if (progress.length > 0) {
        setGoals((previous) => {
          if (previous.length === 0) return previous;
          let changed = false;
          const next = previous.map((goal) => {
            const step = progress.find((item) => item.id === goal.id);
            if (!step) return goal;
            if (step.passed === goal.done && step.text === goal.text) return goal;
            changed = true;
            return { ...goal, text: step.text, done: step.passed };
          });
          return changed ? next : previous;
        });
      }
      // ---- 自动确认玩家节拍 ----
      if (!sessionId || beatInFlightRef.current) return;
      if (snapshot.state !== "READY") return;
      if (resultRef.current?.passed) return;
      // 「本关有玩家任务」：优先用快照里的 playerBeatRequired；旧引擎回退到目标里的 player 标记。
      const hasPlayerStepInProgress = progress.some((step) => step.player === true);
      const beatRequired =
        snapshot.playerBeatRequired ?? (hasPlayerStepInProgress || level?.objectives.some((goal) => goal.player) === true);
      if (!beatRequired) return;
      const allPassed = snapshot.allPassed ?? (progress.length > 0 && progress.every((step) => step.passed));
      if (!allPassed) return;
      // progress 里有玩家步骤时，allPassed 已经包含「玩家亲手完成」；
      // 否则（如 L02/L09）必须看到快照里的 player 放置事件，避免织偶一跑完就自动确认。
      if (!hasPlayerStepInProgress && snapshot.playerBeatDone !== true) return;
      const now = Date.now();
      if (now < beatCooldownUntilRef.current || now < suppressBeatUntilRef.current) return;
      const signature = `${snapshot.sessionEpoch ?? "?"}|${progress.map((step) => (step.passed ? "1" : "0")).join("")}`;
      if (autoBeatKeyRef.current === signature) return;
      autoBeatKeyRef.current = signature;
      void requestPlayerBeat(true);
    },
    [level, requestPlayerBeat, sessionId],
  );

  /** 可恢复错误（INVALID_STATE 等）的「重置本关后重试」动作。 */
  const recoverFromError = useCallback(async () => {
    await resetWorkbench();
    await runProgram();
  }, [resetWorkbench, runProgram]);

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

  /** 「关卡」菜单：世界标注开关（成功写 localStorage，并同步给引擎）。 */
  const toggleAnnotations = useCallback(() => {
    const next = !annotationsOn;
    setAnnotationsOn(next);
    try { localStorage.setItem("loom.annotations", next ? "on" : "off"); } catch { /* ignore */ }
    if (sessionId) void engine.setAnnotations(sessionId, next);
  }, [annotationsOn, engine, sessionId]);

  // 菜单打开时：点菜单外 / 按 Esc 都收回（Esc 只收菜单，不触发其它面板）。
  useEffect(() => {
    if (!openMenu) return;
    // 让 App 的全局 Esc 处理先让行（否则菜单开着按 Esc 会顺带打开旅途手记）。
    document.body.classList.add("has-open-menu");
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".wb-menu-wrap")) return;
      setOpenMenu(null);
    };
    const onMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpenMenu(null);
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onMenuKeyDown, true);
    return () => {
      document.body.classList.remove("has-open-menu");
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onMenuKeyDown, true);
    };
  }, [openMenu]);

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
    if (error) {
      return typeof error.line === "number"
        ? `先改第 ${error.line} 行，再点一次「运行」。`
        : "先按错误提示改一改，再点一次「运行」。";
    }
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

  const phaseText = phaseLabel(phase, result, waitingForPlayer);
  /** 会话状态配色：只表达状态，不承担按钮职责。 */
  const phaseTone = result?.passed || phase === "graded"
    ? (result?.passed ? "is-pass" : "is-error")
    : phase === "error"
      ? "is-error"
      : phase === "running" || waitingForPlayer
        ? "is-busy"
        : "is-idle";
  /**
   * 顶栏只显示一条状态：环境异常（四灯非全绿 / L2 客户端丢失）优先于会话状态，
   * 保证 Studio 与壳顶栏四灯不会各说各话；四灯全绿时才显示「未运行/运行中/…」。
   */
  const envOverridesStatus = envSummary !== null && envSummary.tone !== "online" && envSummary.tone !== "mock";
  const statusText = envOverridesStatus ? envSummary!.text : phaseText;
  const statusTone = envOverridesStatus ? `is-${envSummary!.tone}` : phaseTone;
  const statusTitle = envSummary?.title ?? "";

  return (
    <div className="workbench">
      <header className="wb-top">
        <button type="button" className="btn btn-quiet" onClick={onBack} disabled={clientLost} data-testid="btn-back">
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
          {/* 一级动作只保留「帮助 / 关卡」两个菜单 + 状态；系统级控制（置顶/伴玩/连接）归桌面壳。 */}
          <div className="wb-menu-wrap">
            <button
              type="button"
              className="btn btn-quiet"
              aria-haspopup="menu"
              aria-expanded={openMenu === "help"}
              onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}
              data-testid="btn-help-menu"
            >
              {chrome.workbench.helpMenu} ▾
            </button>
            {openMenu === "help" ? (
              <div className="wb-menu" role="menu" aria-label={chrome.workbench.helpMenu} data-testid="help-menu">
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); onOpenManual(); }} data-testid="btn-manual">
                  {chrome.workbench.manualButton}
                </button>
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); onOpenRepl(); }} data-testid="btn-repl-top">
                  {chrome.workbench.replButton}
                </button>
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); onOpenJournal(); }} data-testid="btn-journal">
                  {journalLabels.title}
                </button>
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); onOpenTextbook(); }} data-testid="btn-textbook-menu">
                  {chrome.workbench.textbookButton}
                </button>
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); onOpenSolution(); }} data-testid="btn-solution">
                  {chrome.workbench.solutionButton}
                </button>
              </div>
            ) : null}
          </div>
          <div className="wb-menu-wrap">
            <button
              type="button"
              className="btn btn-quiet"
              aria-haspopup="menu"
              aria-expanded={openMenu === "levels"}
              onClick={() => setOpenMenu(openMenu === "levels" ? null : "levels")}
              data-testid="btn-level-menu"
            >
              {chrome.workbench.levelMenu} ▾
            </button>
            {openMenu === "levels" ? (
              <div className="wb-menu" role="menu" aria-label={chrome.workbench.levelMenu} data-testid="level-menu">
                <button type="button" role="menuitem" className="btn btn-quiet" onClick={() => { setOpenMenu(null); void resetWorkbench(); }} data-testid="btn-reset-top">
                  重置本关
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="btn btn-quiet"
                  onClick={() => { setOpenMenu(null); toggleAnnotations(); }}
                  title="世界里的中文浮空字是路标，帮你认第几盏灯、谁是艾拉和灰崽；不想看可以随时关掉。"
                  data-testid="btn-annotations"
                >
                  {chrome.system.annotations}：{annotationsOn ? chrome.system.on : chrome.system.off}
                </button>
              </div>
            ) : null}
          </div>
          <span
            className={`phase-chip ${statusTone}`}
            data-phase={phase}
            data-env-state={envSummary?.tone ?? undefined}
            role="status"
            aria-live="polite"
            title={statusTitle}
            data-testid="phase-chip"
          >
            <span className="phase-dot" aria-hidden="true" />
            {statusText}
          </span>
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
                disabled={phase === "running" || !level || clientLost}
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
                  <span className="error-line">
                    {typeof error.line === "number" ? fill(chrome.workbench.errorLinePrefix, { 行: error.line }) : "运行出错："}
                  </span>
                  <span className="error-reason">
                    <RichText text={error.message} />
                  </span>
                  {error.hint ? (
                    <span className="error-reason muted small" data-testid="error-hint">
                      <RichText text={error.hint} />
                    </span>
                  ) : null}
                  {error.code ? (
                    <span className="muted small" data-testid="error-code">错误码：{error.code}</span>
                  ) : null}
                  {error.recoverable ? (
                    <button type="button" className="btn" onClick={() => void recoverFromError()} data-testid="btn-error-reset">
                      重置本关后重试
                    </button>
                  ) : null}
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
            <PositionHud engine={engine} sessionId={sessionId} level={level} onOpenManual={onOpenManual} onSnapshot={handleSnapshot} />
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
                  disabled={clientLost}
                  data-testid="btn-player-beat"
                >
                  {copy?.playerBeatAction ?? "我已在游戏里完成"}
                </button>
                {copy?.playerBeatGuide?.length ? (
                  <div className="player-beat-guide" data-testid="player-beat-guide">
                    <h4>第 4 盏灯怎么点</h4>
                    <ol>
                      {copy.playerBeatGuide.map((step) => (
                        <li key={step}><RichText text={step} /></li>
                      ))}
                    </ol>
                  </div>
                ) : null}
                <details className="mc-help" data-testid="mc-help" open>
                  <summary>{chrome.workbench.mcHelpTitle}</summary>
                  <p>{chrome.workbench.mcHelpIntro}</p>
                  <ol>
                    {chrome.workbench.mcHelpSteps.map((step) => (
                      <li key={step}><RichText text={step} /></li>
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
            disabled={phase === "running" || !level || clientLost}
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
