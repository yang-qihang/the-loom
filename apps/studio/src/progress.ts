/** Studio 本地进度（localStorage）：序章/幕开场/关卡开场/已解锁名词/上一关。 */
export interface StudioProgress {
  prologueSeen: boolean;
  actsSeen: number[];
  levelsStarted: string[];
  lastCompletedLevelId: string | null;
}

const KEY = "loom.studio.progress.v1";

export const EMPTY_PROGRESS: StudioProgress = {
  prologueSeen: false,
  actsSeen: [],
  levelsStarted: [],
  lastCompletedLevelId: null,
};

export function loadProgress(): StudioProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY_PROGRESS };
    const parsed = JSON.parse(raw) as Partial<StudioProgress>;
    return {
      prologueSeen: Boolean(parsed.prologueSeen),
      actsSeen: Array.isArray(parsed.actsSeen) ? parsed.actsSeen.filter((n) => typeof n === "number") : [],
      levelsStarted: Array.isArray(parsed.levelsStarted) ? parsed.levelsStarted.filter((s) => typeof s === "string") : [],
      lastCompletedLevelId: typeof parsed.lastCompletedLevelId === "string" ? parsed.lastCompletedLevelId : null,
    };
  } catch {
    return { ...EMPTY_PROGRESS };
  }
}

export function saveProgress(progress: StudioProgress): StudioProgress {
  try {
    localStorage.setItem(KEY, JSON.stringify(progress));
  } catch {
    /* 本地存储不可用时静默；进度不清空内存态。 */
  }
  return progress;
}

export function markPrologueSeen(progress: StudioProgress): StudioProgress {
  return saveProgress({ ...progress, prologueSeen: true });
}

export function markActSeen(progress: StudioProgress, act: number): StudioProgress {
  if (progress.actsSeen.includes(act)) return progress;
  return saveProgress({ ...progress, actsSeen: [...progress.actsSeen, act] });
}

export function markLevelStarted(progress: StudioProgress, levelId: string): StudioProgress {
  if (progress.levelsStarted.includes(levelId)) return progress;
  return saveProgress({ ...progress, levelsStarted: [...progress.levelsStarted, levelId] });
}

export function markLevelCompleted(progress: StudioProgress, levelId: string): StudioProgress {
  const started = progress.levelsStarted.includes(levelId)
    ? progress.levelsStarted
    : [...progress.levelsStarted, levelId];
  return saveProgress({ ...progress, levelsStarted: started, lastCompletedLevelId: levelId });
}
