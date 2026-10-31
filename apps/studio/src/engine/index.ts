import { HttpEngine } from "./httpEngine";
import { MockEngine } from "./mockEngine";
import type { StudioEngine } from "../types";

export const IS_MOCK = import.meta.env.VITE_MOCK === "1";

export function createEngine(): StudioEngine {
  return IS_MOCK ? new MockEngine() : new HttpEngine();
}
