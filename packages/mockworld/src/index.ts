import type { Container, Golem, NamedPoint as SdkNamedPoint, PointLike, World } from "../../sdk/src/index";
import type { WorldEvent, WorldSnapshot } from "../../protocol/src/index";

type Pos = [number, number, number];

const normItem = (item: string): string => {
  const lower = String(item ?? "").toLowerCase();
  return lower.includes(":") ? lower : `minecraft:${lower}`;
};

/** 解析命名点 / {x,y,z} / [x,y,z]（与 WorldPort.resolveTarget 同语义，避免包循环依赖）。 */
function resolvePoint(target: PointLike, fallbackY = 0): Pos {
  if (Array.isArray(target)) return [Number(target[0]), Number(target[1]), Number(target[2])];
  const object = target as { x?: unknown; y?: unknown; z?: unknown };
  if (object && typeof object.x === "number" && typeof object.z === "number") {
    return [Number(object.x), typeof object.y === "number" ? Number(object.y) : fallbackY, Number(object.z)];
  }
  throw new Error(`不认识的坐标：${JSON.stringify(target)}（可以用命名点如 eira、barrel，或 (x, z) 两个数字）`);
}

const keyOf = (pos: ArrayLike<number>): string => `${Math.floor(pos[0])},${Math.floor(pos[1])},${Math.floor(pos[2])}`;

const POINT_NAMES: Record<string, string> = {
  eira: "艾拉",
  barrel: "木桶",
  bucket: "倒蛋位",
  cakeTower: "蛋糕塔",
  barn: "谷仓",
  bell: "钟",
  well: "井",
  gate: "北门",
  scarecrow: "稻草人",
  keystone: "合龙石基座",
  cage: "牢笼",
  cauldron: "炼药锅",
  lever: "总拉杆",
  shrine: "护符盒",
};

/** 从 vars 自动派生命名点：阵列（lamps/plots…）变成 xxx1..N，三元组变成同名点（含中文名）。 */
function deriveFallbackPoints(vars: Record<string, unknown>, eiraPos?: Pos): Record<string, SdkNamedPoint> {
  const points: Record<string, SdkNamedPoint> = {};
  const asPos = (value: unknown): Pos | null =>
    Array.isArray(value) && value.length === 3 && value.every(v => typeof v === "number")
      ? [value[0] as number, value[1] as number, value[2] as number]
      : null;
  for (const [key, value] of Object.entries(vars)) {
    const pos = asPos(value);
    if (pos) {
      points[key] = Object.freeze({ x: pos[0], y: pos[1], z: pos[2], name: POINT_NAMES[key] ?? key });
      continue;
    }
    if (Array.isArray(value) && value.length > 1) {
      const allPos = value.map(asPos);
      if (allPos.every((item): item is Pos => item !== null)) {
        const base = POINT_NAMES[key] ?? key.replace(/(s|es)$/i, "");
        const keyBase = key.replace(/(s|es)$/i, "");
        allPos.forEach((item, index) => {
          points[`${keyBase}${index + 1}`] = Object.freeze({ x: item[0], y: item[1], z: item[2], name: `${base} ${index + 1}` });
        });
      }
    }
  }
  if (!points.eira && eiraPos) points.eira = Object.freeze({ x: eiraPos[0], y: eiraPos[1], z: eiraPos[2], name: "艾拉" });
  return points;
}

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
  /** 本关命名坐标点（由 WorldPort 在 prepare 时注入）。 */
  points: Record<string, SdkNamedPoint> = {};
  /** 容器内容：key=容器位置 → 物品→数量。 */
  readonly containers = new Map<string, Map<string, number>>();
  /** 织偶背包：物品→数量。 */
  readonly bag = new Map<string, number>();
  private seq = 0;
  private tick = 0;

  constructor(vars: Record<string, unknown> = {}, spawn: Pos = [0, 65, 0], eira: Pos = [0, 65, 6]) {
    // RT-03：vars 只以 deep-frozen 副本形式暴露；评分真值不会因学生代码被改写。
    this.vars = frozenClone(vars);
    this.agents = { golem: { pos: spawn } };
    this.npcs = { eira: { pos: eira } };
    this.points = deriveFallbackPoints(this.vars, this.npcs.eira.pos);
  }

  private emit(event: Omit<WorldEvent, "seq" | "tick">): void {
    this.seq += 1;
    this.events.push({ ...event, seq: this.seq, tick: this.tick });
  }

  /** 配置命名点（WorldPort.prepare 调用；显式点优先，保留自动派生点）。 */
  setPoints(points: Record<string, SdkNamedPoint>): void {
    this.points = Object.freeze({ ...deriveFallbackPoints(this.vars, this.npcs.eira?.pos), ...points });
  }

  private emitPlace(actor: string, actorType: "agent" | "player", pos: Pos, block: string): void {
    this.emit({ type: "block.place", actor, actorType, pos, data: { block } });
  }

  private golemRich(): Golem & {
    moveToPoint(target: PointLike): Promise<void>;
    placePoint(block: string, target: PointLike): Promise<void>;
    goTo(target: PointLike): Promise<void>;
    collect(item: string, target: PointLike): Promise<void>;
    deposit(item: string, target: PointLike, count?: number): Promise<void>;
    count(item: string): number;
    harvest(crop: string, target: PointLike): Promise<void>;
    plant(crop: string, target: PointLike): Promise<void>;
  } {
    const self = this;
    const state = () => self.agents.golem.pos;
    const walk = async (x: number, z: number): Promise<void> => {
      const from = [...state()];
      const to: Pos = [x, state()[1], z];
      self.agents.golem.pos = to;
      self.emit({ type: "agent.move", actor: "golem", actorType: "agent", pos: to, data: { from } });
    };
    const put = async (block: string, x: number, y: number, z: number): Promise<void> => {
      const d = Math.hypot(x - state()[0], z - state()[2]);
      if (d > 4.5) throw new Error(`织偶离目标太远（${d.toFixed(1)} 格）`);
      const normalized = normItem(block);
      self.blocks.set(keyOf([x, y, z]), normalized);
      self.emitPlace("golem", "agent", [x, y, z], normalized);
    };
    return {
      get pos() {
        return [...state()] as Pos;
      },
      async moveTo(x: number, z: number) {
        await walk(Number(x), Number(z));
      },
      async moveToPoint(target: PointLike) {
        const [x, , z] = resolvePoint(target);
        await walk(x, z);
      },
      async goTo(target: PointLike) {
        const [x, , z] = resolvePoint(target);
        await walk(x, z);
      },
      async place(block: string, x: number, y: number, z: number) {
        await put(block, Number(x), Number(y), Number(z));
      },
      async placePoint(block: string, target: PointLike) {
        const [x, y, z] = resolvePoint(target);
        await put(block, x, y, z);
      },
      async collect(item: string, target: PointLike) {
        const pos = resolvePoint(target);
        const want = normItem(item);
        const current = self.blocks.get(keyOf(pos));
        if (!current || current !== want) {
          throw new Error(`(${pos[0]}, ${pos[2]}) 这一格没有可以收走的${want.replace("minecraft:", "")}`);
        }
        self.blocks.delete(keyOf(pos));
        const bagKey = want.replace("minecraft:", "");
        self.bag.set(bagKey, (self.bag.get(bagKey) ?? 0) + 1);
        self.emitPlace("golem", "agent", pos, "minecraft:air");
      },
      async deposit(item: string, target: PointLike, count = 1) {
        const n = Math.max(1, Math.floor(Number(count) || 1));
        const want = normItem(item);
        const bagKey = want.replace("minecraft:", "");
        const have = self.bag.get(bagKey) ?? 0;
        if (have < n) throw new Error(`灰崽身上只有 ${have} 件${bagKey}，不够放下 ${n} 件`);
        const base = resolvePoint(target);
        let y = base[1];
        for (let step = 0; step < 5; step += 1) {
          const current = self.blocks.get(keyOf([base[0], y, base[2]]));
          if (!current || current === "minecraft:air") break;
          y += 1;
        }
        const pos: Pos = [base[0], y, base[2]];
        self.bag.set(bagKey, have - n);
        self.blocks.set(keyOf(pos), want);
        const containerKey = keyOf(base);
        const contents = self.containers.get(containerKey) ?? new Map<string, number>();
        contents.set(bagKey, (contents.get(bagKey) ?? 0) + n);
        self.containers.set(containerKey, contents);
        self.emitPlace("golem", "agent", pos, want);
      },
      count(item: string): number {
        return self.bag.get(normItem(item).replace("minecraft:", "")) ?? 0;
      },
      async harvest(crop: string, target: PointLike) {
        // docs/48：harvest 是「收成熟的」——空格/没成熟的作物是 no-op（教学口径：空格无动作）。
        const want = normItem(crop);
        const current = self.blocks.get(keyOf(resolvePoint(target)));
        if (!current || (current !== want && current !== `${want}_sprout`)) return;
        const bagKey = want.replace("minecraft:", "");
        self.blocks.delete(keyOf(resolvePoint(target)));
        self.bag.set(bagKey, (self.bag.get(bagKey) ?? 0) + 1);
        self.emitPlace("golem", "agent", resolvePoint(target), "minecraft:air");
      },
      async plant(crop: string, target: PointLike) {
        const sprout = `${normItem(crop)}_sprout`;
        const [x, y, z] = resolvePoint(target);
        await put(sprout, x, y, z);
      },
      async say(text: string) {
        self.emit({ type: "say", actor: "golem", actorType: "agent", data: { text } });
      },
    };
  }

  get golem(): Golem {
    return this.golemRich();
  }

  /** 容器视图（world.container(point)）。 */
  containerView(target: PointLike): Container {
    const contents = this.containers.get(keyOf(resolvePoint(target))) ?? new Map<string, number>();
    return {
      count: (item: string) => contents.get(normItem(item).replace("minecraft:", "")) ?? 0,
      items: () =>
        [...contents.entries()]
          .filter(([, count]) => count > 0)
          .map(([item, count]) => ({ item: `minecraft:${item}`, count })),
    };
  }

  get world(): World {
    // 已是 frozenClone：学生写入在严格模式下抛错、非严格模式下静默失效，都不会污染评分快照。
    const self = this;
    return {
      vars: this.vars,
      points: this.points,
      container: (target: PointLike) => self.containerView(target),
    };
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
