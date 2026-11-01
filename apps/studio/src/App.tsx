import { useCallback, useEffect, useMemo, useState } from "react";
import { createEngine } from "./engine";
import { MapWall } from "./components/MapWall";
import { Workbench } from "./components/Workbench";
import { AboutScreen, QuitScreen, SettingsScreen } from "./components/SystemScreens";
import { ActIntroOverlay, JournalOverlay, LevelOpeningOverlay, PrologueOverlay } from "./components/onboarding";
import { ReplScreen } from "./components/ReplScreen";
import { CodexScreen } from "./components/CodexScreen";
import { GuidanceManual } from "./components/GuidanceManual";
import { levelCards, levelCopy } from "./copy";
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
  const [progress, setProgress] = useState<StudioProgress>(() => (typeof localStorage === "undefined" ? { ...EMPTY_PROGRESS } : loadProgress()));
  const [screen, setScreen] = useState<Screen>({ kind: "map" });
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [journalOpen, setJournalOpen] = useState(false);
  /** 试符台打开时用哪个关卡（修复「打开 REPL 跳回第一关」）。 */
  const [replLevelId, setReplLevelId] = useState<string | null>(null);
  /** 指令手册打开时用哪个关卡（模态由 App 统一渲染，Esc 优先级最高）。 */
  const [manualLevelId, setManualLevelId] = useState<string | null>(null);
  const [manualLevel, setManualLevel] = useState<LevelView | null>(null);
  const [codexOpen, setCodexOpen] = useState(false);
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

  // 浮层打开时锁住页面滚动，避免背景页面滚动穿帮。
  useEffect(() => {
    document.body.classList.toggle("has-overlay", journalOpen || manualLevelId !== null || replOpen || codexOpen || overlay !== null);
    return () => document.body.classList.remove("has-overlay");
  }, [codexOpen, journalOpen, manualLevelId, overlay, replOpen]);

  // Esc 在任何界面开/关旅途手记；不销毁当前界面（不丢进度）。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
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
  }, [codexOpen, finishAct, finishPrologue, journalOpen, manualLevelId, overlay, progress.prologueSeen, replOpen]);

  const overlays = (
    <>
      {codexOpen ? <CodexScreen progress={progress} onBack={() => setCodexOpen(false)} /> : null}
      {replOpen ? (
        <ReplScreen
          engine={engine}
          levelId={replLevelId ?? latestLevelId}
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
          onBack={() => {
            setScreen({ kind: "map" });
            void loadLevels();
          }}
          onOpenJournal={() => setJournalOpen(true)}
          onOpenCodex={() => setCodexOpen(true)}
          onOpenManual={() => setManualLevelId(screen.levelId)}
          onOpenRepl={() => openRepl(screen.levelId)}
          onCompleted={() => completeLevel(screen.levelId)}
          nextLevel={nextPlayableLevel}
          onNextLevel={(levelId) => {
            const act = levelCopy(levelId)?.act.startsWith("第二幕") ? 2 : levelCopy(levelId)?.act.startsWith("第三幕") ? 3 : 1;
            startLevelFlow(levelId, act);
          }}
        />
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
