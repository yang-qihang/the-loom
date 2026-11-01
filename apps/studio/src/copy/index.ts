import catalogJson from "./catalog.json";
import levelsJson from "./levels.json";

/** v3.1 起文案值可能是字符串或 { text, codeRefs }；统一归一化成字符串（代码引用包反引号）。 */
function normalizeCopyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeCopyValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.text === "string" && Array.isArray(record.codeRefs)) {
      return resolveCopy({ text: record.text, codeRefs: record.codeRefs as string[] });
    }
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) normalized[key] = normalizeCopyValue(item);
    return normalized;
  }
  return value;
}

/** docs/22 v3 §2.5 交接 JSON 的原样副本（唯一机器源；值可能是带 codeRefs 的对象）。 */
export const deck = normalizeCopyValue(levelsJson) as unknown as typeof levelsJson;

export type CopyText = string | { text: string; codeRefs: string[] };

export interface WorldTerm {
  term: string;
  explain: string;
}

export interface Opening {
  worldState: string;
  task: string;
  whyYou: string;
}

export interface SettleCopy {
  title: string;
  next: string;
  stars: string;
  detail?: string;
}

export interface ChallengeCopy {
  title: string;
  goal: string;
  desc: string;
}

export interface TrialUI {
  start: string;
  nights: string[];
  result: string;
  progress?: string;
}

export interface PredictItem {
  q: string;
  options: string[];
}

/** 概念揭晓（docs/48 §1.6）：结算页/手记/织典展示「你刚才学的概念」。 */
export interface ConceptReveal {
  /** 中文名（如「变量」）。 */
  term: string;
  /** 英文原词（如 variable）；缺失时不显示括号。 */
  en?: string;
  /** 一句话：它是什么。 */
  what: string;
  /** 一句话：为什么要用它。 */
  why: string;
  /** 指回玩家刚才做的事。 */
  mapping: string;
}

export interface LevelCopy {
  title: string;
  act: string;
  worldTerms: WorldTerm[];
  goals: [string, string, string];
  coachOpen: string[];
  coachReact: string[];
  hints: string[];
  predict: PredictItem[];
  errors: Record<string, string>;
  challenge: ChallengeCopy;
  fail: string;
  timeout: string;
  reset: string;
  settle: SettleCopy;
  achievement: string;
  codexName: string;
  codexExplain: string;
  playerBeatUI: string;
  playerBeatAction?: string;
  playerBeatGuide?: string[];
  firstStep: string;
  opening: Opening;
  journalRecap?: string;
  trialUI?: TrialUI;
  /** 玩家可见概念揭晓（内容团队写；缺失时回退织典页）。 */
  conceptReveal?: ConceptReveal;
}

export interface PrologueScreen {
  scene: string;
  speaker: string;
  lines: string[];
}

export interface PrologueCopy {
  title: string;
  skippable: string;
  screens: PrologueScreen[];
}

export interface ActCopy {
  title: string;
  screens: string[];
}

export interface JournalCopy {
  world: string;
  me: string;
  terms: string;
}

interface GlobalCopy {
  buttons: Record<string, string>;
  states: Record<string, string>;
  labels: Record<string, string>;
  results: Record<string, string>;
  a11y: Record<string, string>;
  uiTerms: Record<string, string>;
  rules: Record<string, string>;
  journalLabels: Record<string, string>;
}

export const globalCopy = deck.global as unknown as GlobalCopy;
export const buttons = globalCopy.buttons;
export const states = globalCopy.states;
export const labels = globalCopy.labels;
export const results = globalCopy.results;
export const a11y = globalCopy.a11y;
export const rules = globalCopy.rules;
export const journalLabels = globalCopy.journalLabels;
export const prologue = deck.prologue as PrologueCopy;
export const acts = deck.acts as Record<string, ActCopy>;
export const journal = deck.journal as JournalCopy;
export const chrome = catalogJson;

export const STATUS_PLAYABLE = chrome.map.statusPlayable;
export const STATUS_UNMADE = chrome.map.statusUnmade;

/** 把带 codeRefs 的对象还原成「中文 + 反引号代码引用」的文本。 */
export function resolveCopy(value: CopyText): string {
  if (typeof value === "string") return value;
  let text = value.text;
  for (const ref of value.codeRefs) text = text.split(ref).join(`\`${ref}\``);
  return text;
}

export function levelCopy(id: string): LevelCopy | null {
  const value = (deck as unknown as Record<string, unknown>)[id];
  if (!value || typeof value !== "object" || !("title" in (value as Record<string, unknown>))) return null;
  return value as LevelCopy;
}

export interface LevelCard {
  id: string;
  title: string;
  act: number;
  order: number;
  minutes: number;
  runeName: string;
  status: string;
}

const DECK_LEVEL_META: Record<string, { minutes: number; runeName: string }> = {
  L01: { minutes: 10, runeName: "顺序之符" },
  L02: { minutes: 11, runeName: "记忆之符" },
  L03: { minutes: 11, runeName: "抉择之符" },
  L04: { minutes: 13, runeName: "循环之符" },
};

/** 地图墙卡片：引擎可玩的来自目录；其余显示「尚未织成」。 */
export function levelCards(available?: Set<string>): LevelCard[] {
  const usable = available ?? new Set(["L01"]);
  const cards: LevelCard[] = chrome.levels.map((extra) => ({
    id: extra.id,
    title: extra.title,
    act: extra.act,
    order: extra.order,
    minutes: extra.minutes,
    runeName: extra.runeName,
    status: usable.has(extra.id) ? STATUS_PLAYABLE : STATUS_UNMADE,
  }));
  for (const id of ["L01", "L02", "L03", "L04"] as const) {
    const copy = levelCopy(id);
    if (!copy) continue;
    const meta = DECK_LEVEL_META[id];
    cards.push({
      id,
      title: copy.title,
      act: copy.act.startsWith("第二幕") ? 2 : copy.act.startsWith("第三幕") ? 3 : 1,
      order: Number(id.slice(1)),
      minutes: meta.minutes,
      runeName: meta.runeName,
      status: usable.has(id) ? STATUS_PLAYABLE : STATUS_UNMADE,
    });
  }
  return cards.sort((a, b) => a.order - b.order);
}

export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^{}]+)\}/g, (_match, key: string) => String(values[key] ?? ""));
}

export function starsText(stars: number): string {
  return (states[`stars${stars}`] ?? `${stars} 星`).trim();
}

export function progressText(done: number, total: number): string {
  return `已完成 ${done}/${total}`;
}

export function hintLabel(level: number): string {
  return `提示 ${level}/3`;
}

/** 已解锁名词：按进入过的关卡顺序聚合，按名词去重。 */
export function unlockedTerms(startedLevelIds: string[]): WorldTerm[] {
  const seen = new Set<string>();
  const terms: WorldTerm[] = [];
  for (const id of startedLevelIds) {
    const copy = levelCopy(id);
    if (!copy) continue;
    for (const term of copy.worldTerms) {
      if (seen.has(term.term)) continue;
      seen.add(term.term);
      terms.push(term);
    }
  }
  return terms;
}

/** 引擎日志可能夹带英文/内部词；统一转成干净中文，无法转的丢弃。 */
export function sanitizeLog(line: string): string | null {
  const text = line.trim();
  if (!text) return null;
  if (/epoch/i.test(text)) return chrome.workbench.engineLogReset;
  if (/已停止当前运行/.test(text)) return chrome.workbench.engineLogStopped;
  return /[\u4e00-\u9fff]/.test(text) ? text : null;
}

/** 引擎错误消息可能夹带英文/堆栈；给玩家看的错误统一成中文短句。 */
export function humanizeError(message: string | undefined, levelId?: string): string {
  const text = (message ?? "").trim();
  const level = levelId ? levelCopy(levelId) : null;
  const fallback = level?.fail ?? chrome.workbench.errorGeneric;
  if (!text) return fallback;
  const meaningful = /[\u4e00-\u9fff]/.test(text);
  const hasLatinWords = /[A-Za-z]{2,}/.test(text);
  const technical = /[{}[\]<>;=>]|Error|Cannot|Unexpected|Syntax|TS\d+/.test(text);
  if (meaningful && !hasLatinWords && !technical) return text;
  return fallback;
}

export function needsPlayerBeat(levelId: string, passed: boolean): boolean {
  return !passed && !!levelCopy(levelId);
}
