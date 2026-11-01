/**
 * L10 — 双织者（真实双 bot 版 · MockWorld 等价实现）
 *
 * 叙事与词表以 docs/23-world-bible.md 为准；教学意图见 content/levels/L10-two-weavers.md；
 * 双 bot 铺桥的真实参数来自 docs/02c-finale-spike.md（路线 A：预铺 80% + 两只 bot 补缺口 + 玩家合龙石）。
 *
 * 学生面新增三个符号（docs/12 L10）：
 *   agent("左织") / agent("右织")  → 两只独立织偶（各自有真实沙箱与邮箱）
 *   agent.send(msg) / agent.receive() → 先发后等的握手，避免死锁
 *   world.supply(pos).count(block)  → 材料箱只读快照
 *   world.keystone()                → 正式流程唤起玩家右键；测试模式由 playerBeat 等价落位
 *
 * 真实 Paper 侧：两只 mineflayer bot（LeftWeaver / RightWeaver）由插件 bots.set 同时登记；
 * 桥面几何固定为 y=65、宽 3（z=-1..1）、x=0..deck-1；缺口中心列 x=gapStart..gapStart+gap-1，
 * 两只 bot 补 gap-1 块，中央一格留给玩家合龙石。
 */
import { defineLevel, type ChallengeDef, type GraderApi, type LevelDef } from "../../packages/level-spec/src/index";
import type { LevelContent } from "../../packages/worldport/src/index";

type Pos = [number, number, number];

const DECK = 28;
const GAP = 5;
const GAP_START = 10;
const BRIDGE_WIDTH = 3;
const DECK_Y = 65;
const LEFT_SHARE = Math.ceil((GAP - 1) / 2);
const RIGHT_SHARE = GAP - 1 - LEFT_SHARE;
const KEYSTONE_X = GAP_START + LEFT_SHARE;
const LEFT_AGENT = "LeftWeaver";
const RIGHT_AGENT = "RightWeaver";

const pos = (p: unknown): Pos => p as Pos;
const num = (g: GraderApi, name: string): number => Number(g.var(name));
const deckKey = (x: number, z: number, y = DECK_Y): string => `${x},${y},${z}`;

const L10_BASE: LevelDef = defineLevel({
  id: "L10",
  meta: {
    id: "L10",
    title: { zh: "双织者", en: "The Two Weavers" },
    act: 3,
    order: 10,
    priority: "P2",
    prerequisites: ["L09"],
    estimatedMinutes: 24,
    difficulty: 5,
    abstractions: ["A13"],
    objectives: [
      { id: "o-protocol", learnerView: "用消息约定两只织偶谁先动、谁后动", evidence: { kind: "machine", ref: "both-weavers" } },
      { id: "o-budget", learnerView: "把共享材料按约定分给两个执行者，一块不超、一块不丢", evidence: { kind: "machine", ref: "materials-exact" } },
      { id: "o-deadlock", learnerView: "能解释「先发后等」为什么能避免死锁", evidence: { kind: "predict", ref: "deadlock-order" } },
    ],
    misconceptions: ["wait-before-send", "take-ceil-for-both", "keystone-can-preplace", "message-order-free", "more-agents-means-faster"],
    apiIntroduced: ["agent", "agent.send", "agent.receive", "world.supply"],
    apiAllowlist: [
      "golem.pos", "golem.moveTo", "golem.place", "golem.say",
      "agent", "agent.pos", "agent.moveTo", "agent.place", "agent.say",
      "agent.collect", "agent.send", "agent.receive", "agent.waitIdle",
      "world.supply", "world.keystone",
    ],
    syntaxIntroduced: ["多 agent", "消息收发", "Promise.all 复用"],
    reward: { rune: "A13", advancement: "loomcraft/act3/two_weavers", codexPage: "A13" },
    languageLevel: "act3",
  },
  world: {
    vars: {
      deck: DECK,
      gap: GAP,
      gapStart: GAP_START,
      bridgeWidth: BRIDGE_WIDTH,
      deckY: DECK_Y,
      leftAgent: LEFT_AGENT,
      rightAgent: RIGHT_AGENT,
      leftBank: [1, DECK_Y, 0],
      rightBank: [DECK - 2, DECK_Y, 0],
      keystone: [KEYSTONE_X, DECK_Y, 0],
      materialsBox: [-2, DECK_Y, 0],
      materialsTotal: GAP - 1,
      testMode: true,
    },
    entities: [
      { type: "agent", role: "agent", id: LEFT_AGENT, name: "左织" },
      { type: "agent", role: "agent", id: RIGHT_AGENT, name: "右织" },
      { type: "villager", role: "npc", id: "eira", name: "艾拉" },
    ],
  },
  code: {
    expectedLoc: 74,
    starterCode: `// 两只织偶各有一个邮箱：谁先发、谁先等，决定它们会不会卡死。
// 桥面 3 格宽；缺口从 x=10 开始，桥面高度 65。两只各补一半，材料箱只有缺口块数。
const 桥 = world.vars
const left = agent("左织")
const right = agent("右织")

// 阶段一：单织偶铺桥（先跑一次，看它铺到一半就被峡谷逼回来）
async function 单织偶铺桥(): Promise<void> {
  for (let i = 0; i < 桥.gap - 1; i++) {
    const x = 桥.gapStart + i
    await left.moveTo(x, -1)
    await left.place("oak_planks", x, 桥.deckY, 0)
  }
  await left.say("我一个人铺不完")
}

// 阶段二：两只织偶。先各自写一个 async 函数：
// 1) 先把份额发给对方（send 要写在 receive 前面）
// 2) 收对方回话，核对份额
// 3) 各取一半材料，从两头往中间铺（左岸走 z=-1，右岸走 z=1）
// 4) 铺完互报数字，最后用 Promise.all 一起等
// TODO: 写 左织开工 / 右织开工
`,
    referenceSolution: `const 桥 = world.vars
const left = agent("左织")
const right = agent("右织")
const 木板 = "oak_planks"
const 材料总数 = world.supply(桥.materialsBox as number[]).count(木板)
const 左份额 = Math.ceil(材料总数 / 2)
const 右份额 = 材料总数 - 左份额
const 缺口起点 = Number(桥.gapStart)
const 桥面高度 = Number(桥.deckY)

async function 左取料(块数: number): Promise<void> {
  for (let i = 0; i < 块数; i++) {
    const 取到 = await left.collect(木板, 桥.materialsBox as number[])
    if (取到 !== 1) {
      throw new Error("材料箱提前空了")
    }
  }
}

async function 右取料(块数: number): Promise<void> {
  for (let i = 0; i < 块数; i++) {
    const 取到 = await right.collect(木板, 桥.materialsBox as number[])
    if (取到 !== 1) {
      throw new Error("材料箱提前空了")
    }
  }
}

async function 左铺桥(块数: number): Promise<void> {
  for (let i = 0; i < 块数; i++) {
    const x = 缺口起点 + i
    await left.moveTo(x, -1)
    await left.place(木板, x, 桥面高度, 0)
  }
  await left.say("左岸铺好了")
}

async function 右铺桥(块数: number): Promise<void> {
  for (let i = 0; i < 块数; i++) {
    const x = 缺口起点 + 左份额 + 1 + i
    await right.moveTo(x, 1)
    await right.place(木板, x, 桥面高度, 0)
  }
  await right.say("右岸铺好了")
}

async function 左织开工(): Promise<void> {
  await right.send(String(左份额))
  const 回话 = await left.receive()
  if (回话.text !== String(右份额)) {
    throw new Error("右岸的份额对不上")
  }
  await 左取料(左份额)
  await 左铺桥(左份额)
  await right.send(String(左份额))
  await left.receive()
}

async function 右织开工(): Promise<void> {
  await left.send(String(右份额))
  const 回话 = await right.receive()
  if (回话.text !== String(左份额)) {
    throw new Error("左岸的份额对不上")
  }
  await 右取料(右份额)
  await 右铺桥(右份额)
  await left.send(String(右份额))
  await right.receive()
}

await Promise.all([左织开工(), 右织开工()])
await agent.waitIdle()
await left.say("桥面铺好了，最后一块交给织者")
await world.keystone()
`,
  },
  task: {
    mainTask: "两只织偶分工补桥：先互报份额、各取一半材料，再从两岸同时铺到中间；桥面只剩一格时，由你放合龙石。",
    makeTask: "桥变宽或缺口变长时协议不改：只让份额与铺法跟着缺口走，两只织偶仍各说一句完工再交给你。",
    playerBeat: "桥面只剩中央一格时，你手持合龙石右键中央基座；放下后触发合龙演出与村民过桥。",
    playerBeatHint: "手持合龙石，对准中央基座按右键",
    successCriteria: [
      {
        id: "deck-full",
        text: "全桥面（预铺 + 织偶补 + 合龙石）没有缺口",
        check: g => {
          const deck = num(g, "deck");
          const gap = num(g, "gap");
          const start = num(g, "gapStart");
          const y = num(g, "deckY");
          const keystone = start + Math.ceil((gap - 1) / 2);
          const zs = num(g, "bridgeWidth") === 3 ? [-1, 0, 1] : [0];
          for (const z of zs) {
            for (let x = 0; x < deck; x++) {
              const id = g.block([x, y, z]).id;
              if (z === 0 && x === keystone) {
                if (id !== "minecraft:lodestone") return false;
              } else if (id !== "minecraft:oak_planks") {
                return false;
              }
            }
          }
          return true;
        },
      },
      {
        id: "both-weavers",
        text: "两只织偶都动了：都铺过桥、都发过完工消息",
        check: g => {
          const left = String(g.var("leftAgent"));
          const right = String(g.var("rightAgent"));
          const moves = g.events("agent.move").filter(e => e.actorType === "agent");
          const says = g.events("say").filter(e => e.actorType === "agent");
          return [left, right].every(a => moves.some(e => e.actor === a) && says.some(e => e.actor === a));
        },
      },
      {
        id: "materials-exact",
        text: "织偶放置数等于材料箱初始数（缺口块全部用完、一块不丢）",
        check: g => {
          const gap = num(g, "gap");
          const left = String(g.var("leftAgent"));
          const right = String(g.var("rightAgent"));
          const places = g.events("block.place").filter(
            e => e.actorType === "agent" && e.data?.block === "minecraft:oak_planks",
          );
          // 同一个格子只算一次：不重置连续跑两遍时，重复事件不能把「各铺一半」判错。
          const keysOf = (actor: string) =>
            new Set(places.filter(e => e.actor === actor && !!e.pos).map(e => e.pos!.join(",")));
          const leftKeys = keysOf(left);
          const rightKeys = keysOf(right);
          const distinct = new Set([...leftKeys, ...rightKeys]);
          return (
            distinct.size === gap - 1 &&
            leftKeys.size === Math.ceil((gap - 1) / 2) &&
            rightKeys.size === Math.floor((gap - 1) / 2)
          );
        },
      },
      {
        id: "keystone-by-player",
        text: "合龙石由玩家亲手落位（测试模式等价）",
        check: g =>
          g.events("block.place").some(
            e => e.data?.block === "minecraft:lodestone" && (e.actorType === "player" || Boolean(g.var("testMode"))),
          ),
      },
    ],
    hiddenTests: [
      {
        id: "h-bridge-complete",
        name: "换更长的缺口也要桥面无缝",
        setup: { deck: DECK, gap: GAP, bridgeWidth: BRIDGE_WIDTH },
        assertions: [
          {
            id: "h-bridge-ok",
            text: "缺口随机时桥面仍无缺口、合龙石落位",
            check: g => {
              const deck = num(g, "deck");
              const y = num(g, "deckY");
              const zs = num(g, "bridgeWidth") === 3 ? [-1, 0, 1] : [0];
              let planks = 0;
              let lodestones = 0;
              for (const z of zs) {
                for (let x = 0; x < deck; x++) {
                  const id = g.block([x, y, z]).id;
                  if (id === "minecraft:oak_planks") planks++;
                  if (id === "minecraft:lodestone" && z === 0) lodestones++;
                }
              }
              return planks >= (DECK - 1) * zs.length && lodestones === 1;
            },
          },
        ],
      },
      {
        id: "h-both-active",
        name: "两只织偶都在线且都动过",
        setup: { deck: DECK, gap: GAP },
        assertions: [
          {
            id: "h-both-ok",
            text: "左织与右织都有移动与放置事件",
            check: g => {
              const left = String(g.var("leftAgent"));
              const right = String(g.var("rightAgent"));
              return [left, right].every(a =>
                g.events("block.place").some(e => e.actorType === "agent" && e.actor === a),
              );
            },
          },
        ],
      },
    ],
  },
  challenge: {
    id: "L10-tight-budget",
    title: "挑战：最紧预算",
    goal: "缺口只有 4 块料（3 块由织偶铺、1 块留给玩家），一块不丢、不超；完成消息只能报数字",
    check: g => {
      const places = g.events("block.place").filter(
        e => e.actorType === "agent" && e.data?.block === "minecraft:oak_planks",
      );
      const says = g.events("say").filter(e => e.actorType === "agent");
      const distinct = new Set(places.filter(e => !!e.pos).map(e => e.pos!.join(",")));
      return distinct.size === num(g, "gap") - 1 && says.every(e => !String(e.data?.text ?? "").includes("完工"));
    },
  } as ChallengeDef,
  narrative: {
    worldState: "峡谷把村子和大织机隔成两半，散线已经爬到织机底座；对岸的灯一盏也没亮，桥面断在中间，只剩两岸各一截旧织纹。",
    opening: [
      "峡谷把村子和大织机隔成两半，散线已经爬到织机底座；对岸的灯一盏也没亮，桥面断在中间，只剩两岸各一截旧织纹。",
      "让两只织偶从两岸同时补上缺口：先约定各自取几块、从哪头开始铺，再把桥面铺到只剩中间一格。",
      "最后一块合龙石只有活人的手能放；织偶能替你铺桥，替不了你把这座桥合上。",
    ],
    whyYou: "最后一块合龙石只有活人的手能放；织偶能替你铺桥，替不了你把这座桥合上。",
  },
  // 玩家可见任务进度：与 grading criteria 共用同一份世界快照真值；合龙石是玩家节拍。
  progress: [
    {
      id: "l10-deck-ready",
      text: "织偶把桥面铺到中央，留出最后一格",
      check: g => {
        const deck = num(g, "deck");
        const gap = num(g, "gap");
        const start = num(g, "gapStart");
        const y = num(g, "deckY");
        const keystone = start + Math.ceil((gap - 1) / 2);
        const zs = num(g, "bridgeWidth") === 3 ? [-1, 0, 1] : [0];
        for (const z of zs) {
          for (let x = 0; x < deck; x++) {
            if (z === 0 && x === keystone) continue; // 最后一格留给玩家放合龙石
            if (g.block([x, y, z]).id !== "minecraft:oak_planks") return false;
          }
        }
        return true;
      },
    },
    {
      id: "l10-both-weavers",
      text: "两只织偶各报份额、各铺一半",
      check: g => {
        const left = String(g.var("leftAgent"));
        const right = String(g.var("rightAgent"));
        const moves = g.events("agent.move").filter(e => e.actorType === "agent");
        const says = g.events("say").filter(e => e.actorType === "agent");
        const bothActive = [left, right].every(a => moves.some(e => e.actor === a) && says.some(e => e.actor === a));
        const gap = num(g, "gap");
        const places = g.events("block.place").filter(e => e.actorType === "agent" && e.data?.block === "minecraft:oak_planks");
        // 同一个格子只算一次：不重置连续跑两遍时，重复事件不能把「各铺一半」判错。
        const keysOf = (actor: string) =>
          new Set(places.filter(e => e.actor === actor && !!e.pos).map(e => e.pos!.join(",")));
        const leftKeys = keysOf(left);
        const rightKeys = keysOf(right);
        const distinct = new Set([...leftKeys, ...rightKeys]);
        return (
          bothActive &&
          distinct.size === gap - 1 &&
          leftKeys.size === Math.ceil((gap - 1) / 2) &&
          rightKeys.size === Math.floor((gap - 1) / 2)
        );
      },
    },
    {
      id: "l10-keystone",
      text: "中央一格由你亲手放合龙石",
      player: true,
      check: g =>
        g.events("block.place").some(
          e => e.data?.block === "minecraft:lodestone" && (e.actorType === "player" || Boolean(g.var("testMode"))),
        ),
    },
  ],
  phases: ["单织偶失败与先发后等", "双织偶协议与合龙"],
});

/** 正式关卡（L10 起显式 await + 多 agent）。 */
export const L10: LevelDef & { challenge: ChallengeDef; runMode: "explicit" } = Object.assign(L10_BASE, {
  runMode: "explicit" as const,
}) as LevelDef & { challenge: ChallengeDef; runMode: "explicit" };

export const L10_CHALLENGE: ChallengeDef = L10_BASE.challenge as ChallengeDef;

/** 桥面起点：给真实 bot 的落点（与 vars 对齐，e2e 也直接读 vars）。 */
export const L10_BRIDGE = {
  deck: DECK,
  gap: GAP,
  gapStart: GAP_START,
  bridgeWidth: BRIDGE_WIDTH,
  deckY: DECK_Y,
  keystone: [KEYSTONE_X, DECK_Y, 0] as Pos,
  leftBank: [1, DECK_Y, 0] as Pos,
  rightBank: [DECK - 2, DECK_Y, 0] as Pos,
  materialsTotal: GAP - 1,
  leftAgent: LEFT_AGENT,
  rightAgent: RIGHT_AGENT,
} as const;

/** MockWorld 场景：峡谷两岸、三格宽桥面、中央缺口留给玩家合龙石。 */
export const L10Content: LevelContent & { challenge: ChallengeDef } = {
  def: L10,
  challenge: L10_CHALLENGE,
  async prepare(port) {
    const vars = port.world.vars;
    const bridge = L10_BRIDGE;
    const blocks: Array<{ pos: Pos; block: string }> = [];
    const put = (x: number, y: number, z: number, block: string): void => {
      blocks.push({ pos: [x, y, z], block });
    };
    const zs = bridge.bridgeWidth === 3 ? [-1, 0, 1] : [0];

    // 峡谷底与桥墩（真实 MC 里是峡谷岩壁与旧桥墩）
    for (let x = -6; x <= bridge.deck + 5; x++) {
      for (let z = -3; z <= 3; z++) {
        put(x, 63, z, Math.abs(z) <= 1 && x >= 0 && x < bridge.deck ? "minecraft:stone_bricks" : "minecraft:deepslate");
      }
    }
    // 两岸平台与桥面：侧轨全铺，中央列只在缺口外铺；缺口中央一格留空给合龙石
    for (let x = -4; x <= bridge.deck + 3; x++) {
      for (const z of zs) {
        const inGap = z === 0 && x >= bridge.gapStart && x < bridge.gapStart + bridge.gap;
        const isKeystone = z === 0 && x === bridge.keystone[0];
        if (inGap) continue;
        put(x, bridge.deckY, z, "minecraft:oak_planks");
        if (isKeystone) continue;
      }
    }
    // 桥面两侧护栏（拦的是视线与坠落，拦不到中间通道）
    for (let x = 0; x < bridge.deck; x++) {
      if (x % 4 === 0) {
        put(x, bridge.deckY + 1, -2, "minecraft:oak_fence");
        put(x, bridge.deckY + 1, 2, "minecraft:oak_fence");
      }
    }
    // 左岸材料箱与告示、右岸村民与灯
    put(-2, bridge.deckY, -2, "minecraft:chest");
    put(-2, bridge.deckY + 1, -2, "minecraft:lantern");
    put(-4, bridge.deckY, 2, "minecraft:barrel");
    put(bridge.deck + 2, bridge.deckY, 2, "minecraft:lantern");
    put(bridge.deck + 2, bridge.deckY, -2, "minecraft:barrel");
    put(0, bridge.deckY + 3, -2, "minecraft:red_wool");
    put(bridge.deck - 1, bridge.deckY + 3, 2, "minecraft:red_wool");
    // 对岸大织机剪影（远景地标）
    for (let y = bridge.deckY + 1; y <= bridge.deckY + 5; y++) {
      put(bridge.deck + 4, y, 0, y % 2 === 0 ? "minecraft:dark_oak_planks" : "minecraft:spruce_log");
    }
    put(bridge.deck + 4, bridge.deckY + 6, 0, "minecraft:lantern");

    await port.clearRegion([-8, 60, -3], [bridge.deck + 8, 84, 9]);
    await port.setBlocks(blocks);
    await port.setTime(12000);
    await port.setWeather("clear");
    await port.spawnEntity({ type: "villager", id: "eira", name: "艾拉", pos: [-4, bridge.deckY, 2] });
    for (let i = 0; i < 4; i++) {
      await port.spawnEntity({ type: "villager", id: `villager-${i}`, name: "村民", pos: [bridge.deck + 2 + (i % 2), bridge.deckY, -1 + (i % 3)] });
    }
  },
  async afterPrepare(port) {
    await port.playerGive("minecraft:lodestone", 4);
    // 两只织偶各就各位（插件 finalize 会把所有 bot 传到同一 agentSpawn，这里再分开）
    await port.teleportAgent(L10_BRIDGE.leftAgent, [L10_BRIDGE.leftBank[0], L10_BRIDGE.deckY + 1, L10_BRIDGE.leftBank[2]]);
    await port.teleportAgent(L10_BRIDGE.rightAgent, [L10_BRIDGE.rightBank[0], L10_BRIDGE.deckY + 1, L10_BRIDGE.rightBank[2]]);
  },
  async playerBeat(port) {
    // 织者之印：最后一块合龙石只有活人的手能放（真实流程是玩家右键）
    await port.playerPlace("lodestone", pos(L10_BRIDGE.keystone));
  },
};
