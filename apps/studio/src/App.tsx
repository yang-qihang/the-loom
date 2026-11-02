import { useCallback, useEffect, useMemo, useState } from "react";
import { createEngine } from "./engine";
import { MapWall } from "./components/MapWall";
import { Workbench } from "./components/Workbench";
import { AboutScreen, QuitScreen, SettingsScreen } from "./components/SystemScreens";
import { ActIntroOverlay, JournalOverlay, LevelOpeningOverlay, PrologueOverlay } from "./components/onboarding";
import { ReplScreen } from "./components/ReplScreen";
import { CodexScreen } from "./components/CodexScreen";
import { GuidanceManual } from "./components/GuidanceManual";
import { SolutionViewer } from "./components/SolutionViewer";
import { TextbookLauncher } from "./components/textbook/TextbookLauncher";
import { TextbookWindow } from "./components/textbook/TextbookWindow";
import { TEXTBOOK, isTextbookRead, markTextbookRead } from "./textbook";
import { levelCards, levelCopy } from "./copy";
import { useShellEnv } from "./shell-env";
import {
  EMPTY_PROGRESS,
  loadProgress,
  markActSeen,
  markLevelCompleted,
  markLevelStarted,
  markPrologueSeen,
  type StudioProgress,
} from "./progress";
import type { LevelCard } from "./copy";
import type { LevelView, StudioEngine } from "./types";

type Screen = { kind: "map" } | { kind: "workbench"; levelId: string } | { kind: "about" } | { kind: "settings" } | { kind: "quit" };
type Overlay =
  | { kind: "prologue"; mode: "first" | "replay" }
  | { kind: "act"; act: number; levelId: string; mode: "first" | "replay" }
  | { kind: "opening"; levelId: string }
  | null;

interface AppProps {
  engine?: StudioEngine;
}

export default function App({ engine: injectedEngine }: AppProps = {}) {
  const engine = useMemo(() => injectedEngine ?? createEngine(), [injectedEngine]);
  /** 桌面壳下发的 EnvState（唯一环境状态源）；浏览器直开/无壳时为 null。 */
  const shellEnv = useShellEnv();
  const [progress, setProgress] = useState<StudioProgress>(() => (typeof localStorage === "undefined" ? { ...EMPTY_PROGRESS } : loadProgress()));
  const [screen, setScreen] = useState<Screen>({ kind: "map" });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  /** 试符台打开时用哪个关卡（修复「打开 REPL 跳回第一关」）。 */
  const [replLevelId, setReplLevelId] = useState<string | null>(null);
  /** 指令手册打开时用哪个关卡（模态由 App 统一渲染，Esc 优先级最高）。 */
  const [manualLevelId, setManualLevelId] = useState<string | null>(null);
  const [manualLevel, setManualLevel] = useState<LevelView | null>(null);
  /** 完整解查看（调试）：点顶栏「完整解（调试）」时按关卡取一次 LevelView。 */
  const [solutionLevelId, setSolutionLevelId] = useState<string | null>(null);
  const [solutionLevel, setSolutionLevel] = useState<LevelView | null>(null);
  const [solutionLoading, setSolutionLoading] = useState(false);
  const [solutionError, setSolutionError] = useState<string | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
  /** 配套教材：当前打开的章节（levelId）；null = 关闭。开合由挂载/卸载控制。 */
  const [textbookLevelId, setTextbookLevelId] = useState<string | null>(null);
  const [cards, setCards] = useState<LevelCard[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLevels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCards(await engine.listLevels());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    void loadLevels();
  }, [loadLevels]);

  // 桌面壳启动真实引擎/Paper 需要几秒；地图加载失败时自动重试，避免玩家看到死错误页。
  useEffect(() => {
    if (!error) return;
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      if (attempts > 30) { window.clearInterval(timer); return; }
      void loadLevels();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [error, loadLevels]);

  // 首次进入：先播序章；跳过也算看过，并解锁旅途手记。
  useEffect(() => {
    if (!progress.prologueSeen && overlay === null) {
      setOverlay({ kind: "prologue", mode: "first" });
    }
    // 只在挂载时决定一次首播。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finishPrologue = useCallback(() => {
    setProgress((current) => markPrologueSeen(current));
    setOverlay(null);
  }, []);

  const startLevelFlow = useCallback(
    (levelId: string, act: number) => {
      if (!progress.prologueSeen) {
        setOverlay({ kind: "prologue", mode: "first" });
        return;
      }
      if (!progress.actsSeen.includes(act)) {
        setOverlay({ kind: "act", act, levelId, mode: "first" });
        return;
      }
      if (progress.levelsStarted.includes(levelId)) {
        setScreen({ kind: "workbench", levelId });
        return;
      }
      setOverlay({ kind: "opening", levelId });
    },
    [progress.actsSeen, progress.levelsStarted, progress.prologueSeen],
  );

  const finishAct = useCallback(
    (levelId: string, act: number) => {
      setProgress((current) => markActSeen(current, act));
      setOverlay({ kind: "opening", levelId });
    },
    [],
  );

  const startLevel = useCallback(
    (levelId: string) => {
      setProgress((current) => markLevelStarted(current, levelId));
      setOverlay(null);
      setScreen({ kind: "workbench", levelId });
    },
    [],
  );

  const completeLevel = useCallback((levelId: string) => {
    setProgress((current) => markLevelCompleted(current, levelId));
  }, []);

  // 配套教材（用户任务 6）：入口常驻工作台；关闭时把本章记为已读。
  const openTextbook = useCallback((levelId: string) => {
    if (!TEXTBOOK[levelId]) return;
    setTextbookLevelId(levelId);
  }, []);
  const closeTextbook = useCallback(() => {
    setTextbookLevelId((current) => {
      if (current) markTextbookRead(current);
      return null;
    });
    // 已读状态会影响入口文案（读本关教材 / 回看教材），触发一次重渲染。
    setProgress((current) => ({ ...current }));
  }, []);
  // 首次进入某关时自动打开本章教材；之后可从常驻入口随时回看。
  useEffect(() => {
    if (screen.kind !== "workbench") return;
    const levelId = screen.levelId;
    if (!TEXTBOOK[levelId] || isTextbookRead(levelId)) return;
    setTextbookLevelId(levelId);
  }, [screen]);

  const nextPlayableLevel = useMemo(() => {
    if (!cards) return null;
    const current = screen.kind === "workbench" ? screen.levelId : null;
    if (!current) return null;
    const order = cards.find((card) => card.id === current)?.order ?? 0;
    return cards.find((card) => card.order > order && card.status === "可玩") ?? null;
  }, [cards, screen]);

  // 试符台：按关卡上下文打开（地图/手记入口用最近开始的关卡）。
  const replOpen = replLevelId !== null;
  const latestLevelId = progress.levelsStarted.length > 0 ? progress.levelsStarted[progress.levelsStarted.length - 1] : "L01";
  const openRepl = useCallback((levelId?: string) => {
    setReplLevelId(levelId ?? latestLevelId ?? "L01");
  }, [latestLevelId]);

  // 指令手册：打开时取一次关卡视图（命名点/标题）；失败也能用本地 registry 渲染。
  useEffect(() => {
    let disposed = false;
    if (!manualLevelId) {
      setManualLevel(null);
      return;
    }
    setManualLevel(null);
    void engine
      .loadLevel(manualLevelId)
      .then((loaded) => {
        if (!disposed) setManualLevel(loaded);
      })
      .catch(() => {
        /* 手册内容仍来自本地 registry；关卡视图只是锦上添花。 */
      });
    return () => {
      disposed = true;
    };
  }, [engine, manualLevelId]);

  // 完整解：打开时取一次关卡视图（referenceSolution 来自引擎 /api/levels/:id）。
  useEffect(() => {
    let disposed = false;
    if (!solutionLevelId) {
      setSolutionLevel(null);
      setSolutionError(null);
      setSolutionLoading(false);
      return;
    }
    setSolutionLevel(null);
    setSolutionError(null);
    setSolutionLoading(true);
    void engine
      .loadLevel(solutionLevelId)
      .then((loaded) => {
        if (!disposed) setSolutionLevel(loaded);
      })
      .catch((cause: unknown) => {
        if (!disposed) setSolutionError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!disposed) setSolutionLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [engine, solutionLevelId]);

  // 浮层打开时锁住页面滚动，避免背景页面滚动穿帮。
  useEffect(() => {
    document.body.classList.toggle("has-overlay", journalOpen || manualLevelId !== null || replOpen || codexOpen || solutionLevelId !== null || overlay !== null);
    return () => document.body.classList.remove("has-overlay");
  }, [codexOpen, journalOpen, manualLevelId, overlay, replOpen, solutionLevelId]);

  // Esc 在任何界面开/关旅途手记；不销毁当前界面（不丢进度）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // 关卡页顶栏下拉菜单打开时，Esc 由菜单自己收起（Workbench 监听 document）；
      // 这里不再顺带打开旅途手记，避免一次 Esc 触发两个面板。
      if (document.body.classList.contains("has-open-menu")) return;
      // 教材窗口在最上层（body portal）；Esc 先关它，避免同时触发旅途手记。
      if (textbookLevelId !== null) {
        closeTextbook();
        return;
      }
      if (solutionLevelId !== null) {
        setSolutionLevelId(null);
        return;
      }
      if (manualLevelId !== null) {
        setManualLevelId(null);
        return;
      }
      if (codexOpen) {
        setCodexOpen(false);
        return;
      }
      if (replOpen) {
        setReplLevelId(null);
        return;
      }
      if (journalOpen) {
        setJournalOpen(false);
        return;
      }
      if (overlay) {
        if (overlay.kind === "prologue" && overlay.mode === "first") finishPrologue();
        else if (overlay.kind === "act") finishAct(overlay.levelId, overlay.act);
        else setOverlay(null);
        return;
      }
      if (progress.prologueSeen) setJournalOpen(true);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [closeTextbook, codexOpen, finishAct, finishPrologue, journalOpen, manualLevelId, overlay, progress.prologueSeen, replOpen, solutionLevelId, textbookLevelId]);

  const overlays = (
    <>
      {codexOpen ? <CodexScreen progress={progress} onBack={() => setCodexOpen(false)} /> : null}
      {replOpen ? (
        <ReplScreen
          engine={engine}
          levelId={replLevelId ?? latestLevelId}
          env={shellEnv}
          onBack={() => setReplLevelId(null)}
          onOpenManual={() => setManualLevelId(replLevelId ?? latestLevelId)}
        />
      ) : null}
      {manualLevelId !== null ? (
        <GuidanceManual
          levelId={manualLevelId}
          level={manualLevel}
          engine={engine}
          onClose={() => setManualLevelId(null)}
          onOpenRepl={() => {
            const target = manualLevelId;
            setManualLevelId(null);
            setReplLevelId(target);
          }}
        />
      ) : null}
      {solutionLevelId !== null ? (
        <SolutionViewer
          level={solutionLevel}
          loading={solutionLoading}
          error={solutionError}
          onClose={() => setSolutionLevelId(null)}
          onOpenManual={() => {
            const target = solutionLevelId;
            setSolutionLevelId(null);
            setManualLevelId(target);
          }}
        />
      ) : null}
      {journalOpen && !overlay && !replOpen ? (
        <JournalOverlay
          progress={progress}
          onClose={() => setJournalOpen(false)}
          onReplayPrologue={() => {
            setJournalOpen(false);
            setOverlay({ kind: "prologue", mode: "replay" });
          }}
          onReplayAct={(act) => {
            setJournalOpen(false);
            setOverlay({ kind: "act", act, levelId: "", mode: "replay" });
          }}
          onOpenRepl={() => {
            setJournalOpen(false);
            openRepl();
          }}
          onOpenCodex={() => {
            setJournalOpen(false);
            setCodexOpen(true);
          }}
        />
      ) : null}
      {overlay?.kind === "prologue" ? (
        <PrologueOverlay
          mode={overlay.mode}
          onDone={() => {
            setOverlay(null);
            if (overlay.mode === "first") finishPrologue();
          }}
        />
      ) : null}
      {overlay?.kind === "act" ? (
        <ActIntroOverlay
          act={overlay.act}
          mode={overlay.mode}
          onDone={() => {
            if (overlay.mode === "first") finishAct(overlay.levelId, overlay.act);
            else setOverlay(null);
          }}
        />
      ) : null}
      {overlay?.kind === "opening" ? (
        <LevelOpeningOverlay levelId={overlay.levelId} onStart={() => startLevel(overlay.levelId)} />
      ) : null}
      {/* 配套教材：非模态浮动窗口（portal 到 body）；不参与 has-overlay 滚动锁。 */}
      {textbookLevelId !== null ? (
        <TextbookWindow
          chapters={TEXTBOOK}
          currentId={textbookLevelId}
          onNavigate={(levelId) => setTextbookLevelId(levelId)}
          onClose={closeTextbook}
        />
      ) : null}
    </>
  );

  if (screen.kind === "about") {
    return <AboutScreen onBack={() => setScreen({ kind: "map" })} />;
  }
  if (screen.kind === "settings") {
    return <SettingsScreen onBack={() => setScreen({ kind: "map" })} />;
  }
  if (screen.kind === "quit") {
    return <QuitScreen onBack={() => setScreen({ kind: "map" })} />;
  }

  if (screen.kind === "workbench") {
    return (
      <>
        <Workbench
          key={screen.levelId}
          levelId={screen.levelId}
          engine={engine}
          env={shellEnv}
          onBack={() => {
            setScreen({ kind: "map" });
            void loadLevels();
          }}
          onOpenJournal={() => setJournalOpen(true)}
          onOpenCodex={() => setCodexOpen(true)}
          onOpenManual={() => setManualLevelId(screen.levelId)}
          onOpenRepl={() => openRepl(screen.levelId)}
          onOpenSolution={() => setSolutionLevelId(screen.levelId)}
          onOpenTextbook={() => openTextbook(screen.levelId)}
          onCompleted={() => completeLevel(screen.levelId)}
          nextLevel={nextPlayableLevel}
          onNextLevel={(levelId) => {
            const act = levelCopy(levelId)?.act.startsWith("第二幕") ? 2 : levelCopy(levelId)?.act.startsWith("第三幕") ? 3 : 1;
            startLevelFlow(levelId, act);
          }}
        />
        <TextbookLauncher levelId={screen.levelId} onOpen={openTextbook} />
        {overlays}
      </>
    );
  }

  return (
    <>
      <MapWall
        cards={cards}
        loading={loading}
        error={error}
        engineMode={engine.mode}
        shellEnv={shellEnv}
        journalEnabled={progress.prologueSeen}
        onOpenRepl={() => openRepl()}
        onOpenCodex={() => setCodexOpen(true)}
        onOpenJournal={() => setJournalOpen(true)}
        onOpenAbout={() => setScreen({ kind: "about" })}
        onOpenSettings={() => setScreen({ kind: "settings" })}
        onQuit={() => setScreen({ kind: "quit" })}
        onSelect={(card) => startLevelFlow(card.id, card.act)}
        onRetry={() => void loadLevels()}
      />
      {overlays}
    </>
  );
}
