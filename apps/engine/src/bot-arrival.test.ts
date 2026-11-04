import { describe, expect, it } from "vitest";
import { GolemBot } from "../../../bot/manager.mjs";
import { GameSession, type ResultEvent } from "../../../packages/session/src/session";
import { MockWorldPort } from "../../../packages/worldport/src/mock-port";
import { resolveTarget, type RichAgentActions } from "../../../packages/worldport/src/index";
import { L01Content } from "../../../content/levels/L01.content";

interface MovingBot {
  bot: { entity: { position: { x: number; y: number; z: number } }; pathfinder: { stop(): void; setGoal(goal: unknown): void } };
  pos: number[];
  ensureChunks(): Promise<void>;
  _sleep(ms: number): Promise<void>;
  findStandCells(x: number, z: number): Array<{ x: number; y: number; z: number }>;
  _gotoWithRecovery(goal: unknown): Promise<void>;
  moveTo(x: number, z: number): Promise<unknown>;
}

function movingBot(x: number, z: number): MovingBot {
  const golem = new GolemBot({ name: "ArrivalTest" }) as unknown as MovingBot;
  golem.bot = { entity: { position: { x, y: 11, z } }, pathfinder: { stop() {}, setGoal() {} } };
  golem.ensureChunks = async () => undefined;
  golem._sleep = async () => undefined;
  return golem;
}

describe("moveTo 的物理到达证据", () => {
  it("距方块中心很近、但取整后超过 2 格时，必须继续走到灯旁", async () => {
    const golem = movingBot(-9.9, 12.1);
    let walks = 0;
    golem.findStandCells = () => [{ x: -11, y: 11, z: 10 }];
    golem._gotoWithRecovery = async () => {
      walks += 1;
      golem.bot.entity.position = { x: -10.5, y: 11, z: 10.5 };
    };
    await golem.moveTo(-12, 10);
    expect(walks).toBe(1);
    expect(Math.hypot(golem.pos[0]! + 12, golem.pos[2]! - 10)).toBeLessThanOrEqual(2);
  });

  it("确实已在 2 格内时保持快速返回", async () => {
    const golem = movingBot(-10.5, 10.5);
    golem.findStandCells = () => { throw new Error("已经到达，不应重复寻路"); };
    await expect(golem.moveTo(-12, 10)).resolves.toEqual([-11, 11, 10]);
  });

  it("寻路回退停在 2 格以外不能把移动报告为成功", async () => {
    const golem = movingBot(-8.5, 13.5);
    golem.findStandCells = () => [];
    golem._gotoWithRecovery = async () => undefined;
    await expect(golem.moveTo(-12, 10)).rejects.toThrow();
  });

  it("三盏灯先跑、玩家点第四盏、补回程整段重跑：真实移动判定不会留下永久失败历史", async () => {
    // 只替换物理走路；使用 production GolemBot.moveTo、GameSession、关卡规则与评分。
    const golem = movingBot(0, 0);
    class PhysicalPort extends MockWorldPort {
      override agent(name: string): RichAgentActions {
        const base = super.agent(name) as RichAgentActions;
        const walk = async (x: number, z: number): Promise<void> => {
          // 模拟机器人先在灯柱对角外侧：中心距离允许旧早退，但实际方块距为 2.83。
          golem.bot.entity.position = { x: x + 2.1, y: 11, z: z + 2.1 };
          golem.findStandCells = () => [{ x: x + 1, y: 11, z }];
          golem._gotoWithRecovery = async () => { golem.bot.entity.position = { x: x + 1.5, y: 11, z: z + 0.5 }; };
          await golem.moveTo(x, z);
          // 记录真实位置，不能用请求的目标位置伪造到达证据。
          await base.moveTo(golem.pos[0]!, golem.pos[2]!);
        };
        return { ...base, moveTo: walk, moveToPoint: async target => {
          const [x, , z] = resolveTarget(target, 11);
          await walk(x, z);
        } };
      }
    }
    const session = await GameSession.create(L01Content, new PhysicalPort());
    const run = async (source: string): Promise<ResultEvent> => {
      const result = new Promise<ResultEvent>(resolve => {
        const off = session.subscribe(event => { if (event.type === "result") { off(); resolve(event); } });
      });
      await session.run(source);
      return result;
    };
    const partial = `golem.moveTo(lamp1)
golem.place("lantern", lamp1)
golem.moveTo(lamp2)
golem.place("lantern", lamp2)
golem.moveTo(lamp3)
golem.place("lantern", lamp3)`;
    try {
      const first = await run(partial);
      expect(first.passed).toBe(false);
      expect(first.playerBeatReady).toBe(true);
      const beat = await session.playerBeat();
      expect(beat.result?.passed).toBe(false);
      const final = await run(`${partial}\ngolem.moveTo(eira)`);
      expect(session.epoch).toBe(0); // 保留真人任务，不靠重置擦掉失败记录。
      expect(final.progress.every(step => step.passed)).toBe(true);
      expect(final.hidden.every(step => step.passed)).toBe(true);
      expect(final.passed).toBe(true);
      expect(final.stars).toBe(3);
    } finally { await session.dispose(); }
  });
});
