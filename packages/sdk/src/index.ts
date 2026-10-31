export type Vec3 = [number, number, number];
export type Vec2 = [number, number];
export type BlockId = string;

export interface Golem {
  readonly pos: Vec3;
  moveTo(x: number, z: number): Promise<void>;
  place(block: BlockId, x: number, y: number, z: number): Promise<void>;
  say(text: string): Promise<void>;
}

export interface World {
  readonly vars: Record<string, unknown>;
}

export interface StudentSdk {
  golem: Golem;
  world: World;
}

export { ASYNC_SDK_METHODS, ASYNC_SDK_RECEIVERS } from "../../protocol/src/index";
