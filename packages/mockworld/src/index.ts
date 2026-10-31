import type { Golem, World } from "../../sdk/src/index";
import type { WorldEvent, WorldSnapshot } from "../../protocol/src/index";

type Pos = [number, number, number];

/** 递归冻结：学生拿到的 world.vars 只能是只读副本（RT-03）。 */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}

/** 深拷贝后冻结，保证快照与 SDK 视图都不会互相污染。 */
export function frozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

/** 无 Minecraft 的确定性世界：用于 T1 垂直切片与 CI。 */
export class MockWorld {
  readonly vars: Record<string, unknown>;
  readonly blocks = new Map<string, string>();
  readonly events: WorldEvent[] = [];
  readonly agents: Record<string, { pos: Pos }>;
  readonly npcs: Record<string, { pos: Pos }>;
  private seq = 0;
  private tick = 0;

  constructor(vars: Record<string, unknown> = {}, spawn: Pos = [0, 65, 0], eira: Pos = [0, 65, 6]) {
    // RT-03：vars 只以 deep-frozen 副本形式暴露；评分真值不会因学生代码被改写。
    this.vars = frozenClone(vars);
    this.agents = { golem: { pos: spawn } };
    this.npcs = { eira: { pos: eira } };
  }

  private emit(event: Omit<WorldEvent, "seq" | "tick">): void {
    this.seq += 1;
    this.events.push({ ...event, seq: this.seq, tick: this.tick });
  }

  get golem(): Golem {
    const self = this;
    return {
      get pos() {
        return [...self.agents.golem.pos] as Pos;
      },
      async moveTo(x, z) {
        const from = [...self.agents.golem.pos];
        const to: Pos = [x, self.agents.golem.pos[1], z];
        self.agents.golem.pos = to;
        self.emit({ type: "agent.move", actor: "golem", actorType: "agent", pos: to, data: { from } });
      },
      async place(block, x, y, z) {
        const d = Math.hypot(x - self.agents.golem.pos[0], z - self.agents.golem.pos[2]);
        if (d > 4.5) throw new Error(`织偶离目标太远（${d.toFixed(1)} 格）`);
        self.blocks.set(`${x},${y},${z}`, `minecraft:${block}`);
        self.emit({ type: "block.place", actor: "golem", actorType: "agent", pos: [x, y, z], data: { block: `minecraft:${block}` } });
      },
      async say(text) {
        self.emit({ type: "say", actor: "golem", actorType: "agent", data: { text } });
      },
    };
  }

  get world(): World {
    // 已是 frozenClone：学生写入在严格模式下抛错、非严格模式下静默失效，都不会污染评分快照。
    return { vars: this.vars };
  }

  /** 模拟玩家亲手操作（用于 playerBeat 验收）。 */
  playerPlace(block: string, pos: Pos): void {
    this.blocks.set(pos.join(","), `minecraft:${block}`);
    this.emit({ type: "block.place", actor: "player", actorType: "player", pos, data: { block: `minecraft:${block}` } });
  }

  snapshot(levelId = "L01"): WorldSnapshot {
    return {
      levelId,
      seed: 1,
      vars: this.vars,
      blocks: Object.fromEntries(this.blocks),
      agents: this.agents,
      npcs: this.npcs,
      events: this.events,
      tick: this.tick,
    };
  }
}
