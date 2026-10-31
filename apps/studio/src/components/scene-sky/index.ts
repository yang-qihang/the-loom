import { ACT1_SKY } from "./act1";
import { ACT2_SKY } from "./act2";
import { ACT3_SKY } from "./act3";
import { DEFAULT_SKY, type SkyProfile } from "./types";

export const SKY_BY_LEVEL: Record<string, SkyProfile> = { ...ACT1_SKY, ...ACT2_SKY, ...ACT3_SKY };

export function skyFor(levelId: string): SkyProfile {
  return SKY_BY_LEVEL[levelId] ?? DEFAULT_SKY;
}
