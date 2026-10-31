import { MockWorld } from "../../mockworld/src/index";
import type { Annotation } from "./index";
import type { WorldEvent, WorldSnapshot, Vec3 } from "../../protocol/src/index";
import type { AgentActions, FxCue, LevelContent, WorldPort } from "./index";

/** 把 MockWorld 包成 WorldPort，供 Engine/CI 使用。 */
export class MockWorldPort implements WorldPort {
  readonly kind = "mock" as const;
  private mock = new MockWorld();
  private unsubs: Array<() => void> = [];

  async prepare(content: LevelContent): Promise<void> {
    this.mock = new MockWorld({ ...content.def.world.vars });
    this.actorState.clear();
    await content.prepare(this);
    await content.afterPrepare?.(this);
  }

  async reset(content: LevelContent): Promise<void> {
    await this.prepare(content);
  }

  async snapshot(levelId: string): Promise<WorldSnapshot> {
    return this.mock.snapshot(levelId);
  }

  private readonly actorState = new Map<string, { pos: Vec3 }>();

  agent(name: string): AgentActions {
    if (name === "golem") return this.mock.golem;
    let state = this.actorState.get(name);
    if (!state) {
      state = { pos: [0, 65, 0] };
      this.actorState.set(name, state);
    }
    const mock = this.mock;
    const emit = (event: Omit<WorldEvent, "seq" | "tick">): void => {
      mock.events.push({ ...event, seq: mock.events.length + 1, tick: 0 });
    };
    const actor = state;
    return {
      get pos(): Vec3 {
        return [...actor.pos] as Vec3;
      },
      async moveTo(x: number, z: number): Promise<void> {
        const from = [...actor.pos] as Vec3;
        const to: Vec3 = [x, actor.pos[1], z];
        actor.pos = to;
        emit({ type: "agent.move", actor: name, actorType: "agent", pos: to, data: { from } });
      },
      async place(block: string, x: number, y: number, z: number): Promise<void> {
        const d = Math.hypot(x - actor.pos[0], z - actor.pos[2]);
        if (d > 4.5) throw new Error(`织偶离目标太远（${d.toFixed(1)} 格）`);
        mock.blocks.set(`${x},${y},${z}`, `minecraft:${block}`);
        emit({ type: "block.place", actor: name, actorType: "agent", pos: [x, y, z], data: { block: `minecraft:${block}` } });
      },
      async say(text: string): Promise<void> {
        emit({ type: "say", actor: name, actorType: "agent", data: { text } });
      },
    };
  }

  async teleportAgent(name: string, pos: Vec3): Promise<void> {
    if (name === "golem") return;
    this.actorState.set(name, { pos: [...pos] as Vec3 });
  }

  get world() {
    return this.mock.world;
  }

  onEvent(listener: (event: WorldEvent) => void): () => void {
    void listener;
    return () => {};
  }

  async teleportPlayer(_pos: Vec3): Promise<void> {}
  async setBlocks(entries: Array<{ pos: Vec3; block: string }>): Promise<void> {
    for (const e of entries) this.mock.blocks.set(e.pos.join(","), e.block.startsWith("minecraft:") ? e.block : `minecraft:${e.block}`);
  }
  async clearRegion(_from: Vec3, _to: Vec3): Promise<void> {
    this.mock.blocks.clear();
  }
  async spawnEntity(spec: { type: string; id?: string; name?: string; pos: Vec3; role?: string }): Promise<void> {
    void spec;
  }
  async clearEntities(_ids?: string[]): Promise<void> {}
  async setTime(_ticks: number): Promise<void> {}
  async setWeather(_weather: "clear" | "rain" | "thunder"): Promise<void> {}
  async playerPlace(block: string, pos: Vec3): Promise<void> {
    this.mock.playerPlace(block, pos);
  }
  async fx(_cue: FxCue): Promise<void> {}
  async annotate(_entries: Annotation[]): Promise<void> {}
  async setAnnotationsVisible(_visible: boolean): Promise<void> {}
  async dispose(): Promise<void> {
    for (const off of this.unsubs) off();
    this.unsubs = [];
  }
}
