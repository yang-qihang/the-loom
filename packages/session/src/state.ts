/**
 * 会话状态机（docs/07 §3.5 的可执行子集）。
 *
 * DISCONNECTED → CONNECTING → PREPARING → READY → COMPILING → RUNNING → VERIFYING → PASSED
 * 失败/停止/重置路径：READY/COMPILING/RUNNING/VERIFYING → STOPPED（撤销能力），
 * 任意可运行状态 → PREPARING → READY（reset 递增 epoch，旧运行结果作废）。
 */
export const SESSION_STATES = [
  "DISCONNECTED",
  "CONNECTING",
  "PREPARING",
  "READY",
  "COMPILING",
  "RUNNING",
  "VERIFYING",
  "PASSED",
  "FAILED",
  "STOPPED",
] as const;

export type SessionState = (typeof SESSION_STATES)[number];

const TRANSITIONS: Record<SessionState, readonly SessionState[]> = {
  DISCONNECTED: ["CONNECTING"],
  CONNECTING: ["PREPARING", "DISCONNECTED"],
  PREPARING: ["READY", "DISCONNECTED"],
  READY: ["COMPILING", "VERIFYING", "PREPARING", "STOPPED", "DISCONNECTED"],
  COMPILING: ["RUNNING", "READY", "VERIFYING", "PREPARING", "STOPPED"],
  RUNNING: ["VERIFYING", "READY", "PREPARING", "STOPPED"],
  VERIFYING: ["PASSED", "READY", "PREPARING", "STOPPED"],
  PASSED: ["COMPILING", "VERIFYING", "PREPARING", "STOPPED"],
  FAILED: ["PREPARING", "COMPILING", "STOPPED"],
  STOPPED: ["PREPARING"],
};

export type SessionErrorCode = "INVALID_STATE" | "INVALID_ARGUMENT" | "NOT_FOUND" | "DISPOSED" | "STALE_SNAPSHOT";

export class SessionError extends Error {
  constructor(
    message: string,
    readonly code: SessionErrorCode = "INVALID_STATE",
  ) {
    super(message);
    this.name = "SessionError";
  }
}

export function canTransition(from: SessionState, to: SessionState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: SessionState, to: SessionState): SessionState {
  if (!canTransition(from, to)) {
    throw new SessionError(`会话状态不允许从 ${from} 进入 ${to}`, "INVALID_STATE");
  }
  return to;
}
