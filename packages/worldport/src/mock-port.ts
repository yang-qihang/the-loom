import { MockWorld } from "../../mockworld/src/index";
import type { NamedPoint, PointLike } from "../../sdk/src/index";
import type { WorldEvent, WorldSnapshot, Vec3 } from "../../protocol/src/index";
import {
  resolveTarget,
  toSdkPoints,
  posKey,
  type AgentActions,
  type FxCue,
  type LevelContent,
  type Annotation,
  type RichAgentActions,
  type SemanticStateSnapshot,
  type WorldPort,
} from "./index";

const normItem = (item: string): string => {
  const lower = String(item ?? "").toLowerCase();
  return lower.includes(":") ? lower : `minecraft:${lower}`;
};
const shortItem = (item: string): string => normItem(item).replace("minecraft:", "");

interface ActorState {
  pos: Vec3;
  /** 语义 API 的背包（其它织偶/角色用；灰崽的背包在 MockWorld.bag 里，评分/快照共用）。 */
  bag: Map<string, number>;
}

/** 把 MockWorld 包成 WorldPort，供 Engine/CI 使用。 */
export class MockWorldPort implements WorldPort {
  readonly kind = "mock" as const;
  private mock = new MockWorld();
  private unsubs: Array<() => void> = [];
  private readonly actorState = new Map<string, ActorState>();

  async prepare(content: LevelContent): Promise<void> {
    this.mock = new MockWorld({ ...content.def.world.vars });
    // 命名点（docs/48 §1.1）：prepare 时注入，world.points / 沙箱全局常量 / HUD 同源。
    this.mock.setPoints(toSdkPoints(content.def));
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

  agent(name: string): AgentActions {
    if (name === "golem") {
      // MockWorld.golem 已实现语义方法（moveToPoint/placePoint/goTo/collect/deposit/count）；
      // 基础签名保持旧形状（SDK 类型里 collect 等是可选），运行时按 RichAgentActions 取用。
      return this.mock.golem as unknown as RichAgentActions;
    }
    let state = this.actorState.get(name);
    if (!state) {
      state = { pos: [0, 65, 0], bag: new Map() };
      this.actorState.set(name, state);
    }
    return this.#makeActor(name, state);
  }

  /**
   * L10 等关卡的其它织偶/角色：动作与灰崽同语义，但事件 actor 记真实名字。
   * 语义方法与 MockWorld.golem 的规则保持一致（collect 校验目标格方块、deposit 向上找空气格），
   * 背包/容器仍然落在 MockWorld 的共享状态里，所以 world.container 与评分快照一致。
   */
  #makeActor(name: string, actor: ActorState): RichAgentActions {
    const port = this;
    const emit = (event: Omit<WorldEvent, "seq" | "tick">): void => {
      port.mock.events.push({ ...event, seq: port.mock.events.length + 1, tick: 0 });
    };
    const label = name === "golem" ? "灰崽" : name;
    const walk = async (x: number, z: number): Promise<void> => {
      const from = [...actor.pos] as Vec3;
      const to: Vec3 = [x, actor.pos[1], z];
      actor.pos = to;
      emit({ type: "agent.move", actor: name, actorType: "agent", pos: to, data: { from } });
    };
    const put = async (block: string, x: number, y: number, z: number): Promise<void> => {
      const d = Math.hypot(x - actor.pos[0], z - actor.pos[2]);
      if (d > 4.5) throw new Error(`织偶离目标太远（${d.toFixed(1)} 格）`);
      const normalized = normItem(block);
      port.mock.blocks.set(posKey([x, y, z]), normalized);
      emit({ type: "block.place", actor: name, actorType: "agent", pos: [x, y, z], data: { block: normalized } });
    };
    return {
      get pos(): Vec3 {
        return [...actor.pos] as Vec3;
      },
      async moveTo(x: number, z: number): Promise<void> {
        await walk(Number(x), Number(z));
      },
      async moveToPoint(target: PointLike): Promise<void> {
        const [x, , z] = resolveTarget(target, actor.pos[1]);
        await walk(x, z);
      },
      async goTo(target: PointLike): Promise<void> {
        const [x, , z] = resolveTarget(target, actor.pos[1]);
        await walk(x, z);
      },
      async place(block: string, x: number, y: number, z: number): Promise<void> {
        await put(block, Number(x), Number(y), Number(z));
      },
      async placePoint(block: string, target: PointLike): Promise<void> {
        const [x, y, z] = resolveTarget(target, actor.pos[1]);
        await put(block, x, y, z);
      },
      async collect(item: string, target: PointLike): Promise<void> {
        const pos = resolveTarget(target, actor.pos[1]);
        const want = normItem(item);
        const current = port.mock.blocks.get(posKey(pos));
        if (!current || current !== want) {
          throw new Error(`(${pos[0]}, ${pos[2]}) 这一格没有可以收走的${shortItem(want)}`);
        }
        port.mock.blocks.delete(posKey(pos));
        const bagKey = shortItem(want);
        actor.bag.set(bagKey, (actor.bag.get(bagKey) ?? 0) + 1);
        emit({ type: "block.place", actor: name, actorType: "agent", pos, data: { block: "minecraft:air" } });
      },
      async deposit(item: string, target: PointLike, count = 1): Promise<void> {
        const n = Math.max(1, Math.floor(Number(count) || 1));
        const want = normItem(item);
        const bagKey = shortItem(want);
        const have = actor.bag.get(bagKey) ?? 0;
        if (have < n) throw new Error(`${label}身上只有 ${have} 件${bagKey}，不够放下 ${n} 件`);
        const base = resolveTarget(target, actor.pos[1]);
        let y = base[1];
        for (let step = 0; step < 5; step += 1) {
          const current = port.mock.blocks.get(posKey([base[0], y, base[2]]));
          if (!current || current === "minecraft:air") break;
          y += 1;
        }
        const pos: Vec3 = [base[0], y, base[2]];
        actor.bag.set(bagKey, have - n);
        port.mock.blocks.set(posKey(pos), want);
        const containerKey = posKey(base);
        const contents = port.mock.containers.get(containerKey) ?? new Map<string, number>();
        contents.set(bagKey, (contents.get(bagKey) ?? 0) + n);
        port.mock.containers.set(containerKey, contents);
        emit({ type: "block.place", actor: name, actorType: "agent", pos, data: { block: want } });
      },
      count(item: string): number {
        return actor.bag.get(shortItem(item)) ?? 0;
      },
      async harvest(crop: string, target: PointLike): Promise<void> {
        // 宽容语义（与 MockWorld.harvest 一致）：空格/没成熟的作物是 no-op，不抛错也不发事件。
        const pos = resolveTarget(target, actor.pos[1]);
        const want = normItem(crop);
        const current = port.mock.blocks.get(posKey(pos));
        if (!current || (current !== want && current !== `${want}_sprout`)) return;
        port.mock.blocks.delete(posKey(pos));
        const bagKey = shortItem(want);
        actor.bag.set(bagKey, (actor.bag.get(bagKey) ?? 0) + 1);
        emit({ type: "block.place", actor: name, actorType: "agent", pos, data: { block: "minecraft:air" } });
      },
      async plant(crop: string, target: PointLike): Promise<void> {
        const [x, y, z] = resolveTarget(target, actor.pos[1]);
        await put(`${normItem(crop)}_sprout`, x, y, z);
      },
      async say(text: string): Promise<void> {
        emit({ type: "say", actor: name, actorType: "agent", data: { text: String(text) } });
      },
    };
  }

  async teleportAgent(name: string, pos: Vec3): Promise<void> {
    if (name === "golem") return;
    this.actorState.set(name, { pos: [...pos] as Vec3, bag: this.actorState.get(name)?.bag ?? new Map() });
  }

  get world() {
    return this.mock.world;
  }

  get points(): Record<string, NamedPoint> {
    return this.mock.points;
  }

  /** 语义状态快照：沙箱 worker 的同步缓存初值（背包/容器/命名点）。 */
  semantic(): SemanticStateSnapshot {
    const bag: Record<string, number> = {};
    for (const [item, count] of this.mock.bag) if (count > 0) bag[item] = count;
    const containers: Record<string, Record<string, number>> = {};
    for (const [key, contents] of this.mock.containers) {
      const record: Record<string, number> = {};
      for (const [item, count] of contents) if (count > 0) record[item] = count;
      if (Object.keys(record).length > 0) containers[key] = record;
    }
    // MockWorld.points 已合并 vars 自动派生点（lamp1..N 等），与 world.points / 沙箱全局同源。
    return { points: this.mock.points, bag, containers };
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
  async activatePlayerBeat(): Promise<void> {}
  async playerGive(_item: string, _count = 1): Promise<void> {}

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
