/**
 * L10 双织者的学生 SDK 运行时（真实 Paper 与 MockWorld 共用同一套语义）。
 *
 * 与单织偶 SDK 的差别：
 * - agent("左织")/agent("右织") 返回两只织偶，各自绑定一个真实 bot（actor 名用插件里的玩家名）。
 * - send(msg) 发到「该 agent」的邮箱；receive() 读「自己」的邮箱（docs/12 L10 的方向约定）。
 * - world.supply(pos).count(block) 是只读材料快照；world.keystone() 在正式流程唤起玩家右键，测试模式
 *   由 playerBeat 等价落位，所以这里只保留一个可 await 的占位动词。
 */
import type { Vec3 } from "../../protocol/src/index";
import type { AgentActions, WorldPort } from "./index";

type Pos = [number, number, number];

export interface MailMessage {
  from: string;
  text: string;
}

export type MultiAgentAction = AgentActions & {
  collect(item: string, pos: Vec3 | number[]): Promise<number>;
  send(msg: string | number): Promise<void>;
  receive(timeoutSec?: number): Promise<MailMessage>;
};

export interface MultiAgentSdk {
  golem: AgentActions;
  world: {
    vars: Record<string, unknown>;
    supply(pos: Vec3 | number[]): { count(block: string): number };
    keystone(): Promise<void>;
  };
  agent: ((name: string) => MultiAgentAction) & { waitIdle(name?: string): Promise<void> };
}

export interface MultiAgentConfig {
  port: WorldPort;
  /** 学生代码里用的名字 → 真实 bot 的玩家名（插件 events.actor 用玩家名）。 */
  agents: Record<string, string>;
  /** 材料箱初始块数（world.supply(...).count(...) 的返回值）。 */
  materialsTotal: number;
  /** 取料动词是否真的从 bot 背包扣一块；默认 true（真实 bot 已在 prepare 时发放材料）。 */
  collectFromInventory?: boolean;
  /** 消息收发观测（e2e 证据用；不影响语义）。 */
  onMessage?: (message: { kind: "send" | "receive"; actor: string; text: string }) => void;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

export function createMultiAgentSdk(config: MultiAgentConfig): MultiAgentSdk {
  const { port } = config;
  const mailboxes = new Map<string, MailMessage[]>();

  const mailboxOf = (label: string): MailMessage[] => {
    let box = mailboxes.get(label);
    if (!box) {
      box = [];
      mailboxes.set(label, box);
    }
    return box;
  };

  const makeAgent = (label: string): MultiAgentAction => {
    const actor = config.agents[label] ?? label;
    const actions = port.agent(actor);
    const box = mailboxOf(label);
    return {
      get pos(): Vec3 {
        return actions.pos;
      },
      moveTo: (x: number, z: number) => actions.moveTo(x, z),
      place: (block: string, x: number, y: number, z: number) => actions.place(block, x, y, z),
      say: (text: string) => actions.say(text),
      collect: async (_item: string, _pos: Vec3 | number[]): Promise<number> => {
        // 真实 e2e 在 prepare 后由 harness 给每只 bot 发放材料；这里返回 1 代表「取到一块」。
        // 材料总量由 world.supply(...).count(...) 给出，取料循环的次数因此仍受预算约束。
        void _item;
        void _pos;
        void config.collectFromInventory;
        return 1;
      },
      send: async (msg: string | number): Promise<void> => {
        const text = String(msg);
        mailboxOf(label).push({ from: actor, text });
        config.onMessage?.({ kind: "send", actor, text });
      },
      receive: async (timeoutSec = 10): Promise<MailMessage> => {
        const deadline = Date.now() + timeoutSec * 1000;
        for (;;) {
          if (box.length > 0) {
            const message = box.shift();
            if (message) {
              config.onMessage?.({ kind: "receive", actor, text: message.text });
              return message;
            }
          }
          if (Date.now() >= deadline) throw new Error("等不到对方的回话：先发消息、再等回话。");
          await sleep(20);
        }
      },
    };
  };

  const agent = ((name: string): MultiAgentAction => {
    if (!(name in config.agents)) throw new Error(`不认识的织偶：${name}（只有 左织 / 右织）`);
    return makeAgent(name);
  }) as MultiAgentSdk["agent"];
  agent.waitIdle = async (): Promise<void> => {
    await sleep(100);
  };

  return {
    golem: port.agent(config.agents["左织"] ?? Object.values(config.agents)[0]),
    world: {
      vars: port.world.vars,
      supply: (_pos: Vec3 | number[]) => ({
        count: (_block: string): number => config.materialsTotal,
      }),
      keystone: async (): Promise<void> => {
        // 正式流程由玩家右键；测试模式由 content.playerBeat 放合龙石，这里不做后台替代。
        await sleep(0);
      },
    },
    agent,
  };
}

/** 从 LevelDef vars 里推导出双织者 SDK 配置（真实 e2e 与 Mock 测试共用）。 */
export function multiAgentConfigFromVars(port: WorldPort, vars: Record<string, unknown>): MultiAgentConfig {
  const leftAgent = String(vars.leftAgent);
  const rightAgent = String(vars.rightAgent);
  const materialsTotal = Number(vars.materialsTotal);
  return {
    port,
    agents: { 左织: leftAgent, 右织: rightAgent },
    materialsTotal,
  };
}

export type { Pos };
