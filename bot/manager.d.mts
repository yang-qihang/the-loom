// bot/manager.mjs 的最小类型声明（供 apps/engine 的 PaperWorldPort 注入使用）。
export interface GolemBotOptions {
  name?: string;
  host?: string;
  port?: number;
  log?: (line: string) => void;
  [key: string]: unknown;
}

export class GolemBot {
  constructor(opts: Record<string, unknown>);
  readonly name: string;
  readonly connected: boolean;
  connect(timeoutMs?: number): Promise<void>;
  disconnect(): Promise<void> | void;
  moveTo(x: number, z: number, timeoutMs?: number): Promise<unknown>;
  place(block: string, x: number, y: number, z: number, timeoutMs?: number): Promise<unknown>;
  say(text: string): Promise<void>;
  readonly pos: [number, number, number];
}
