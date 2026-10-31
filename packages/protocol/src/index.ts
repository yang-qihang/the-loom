import { z } from "zod";

/** 学生可见的学生 API 里「返回 Promise、需要 await」的方法名。 */
export const ASYNC_SDK_METHODS = new Set([
  "moveTo", "place", "say", "collect", "deposit", "ringBell", "placeTorch",
  "patrol", "plant", "harvest", "fill", "clear", "placeSign", "giveTool",
  "give", "assign", "release", "runTablet", "treatZombieVillager",
  "ringDawnBell", "keystone", "send", "receive", "waitIdle", "wait",
  "setBlock", "build",
]);

export const ASYNC_SDK_RECEIVERS = new Set(["golem", "world", "allay"]);

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()]);
export const Vec2Schema = z.tuple([z.number(), z.number()]);
export const BlockIdSchema = z.string().min(1);
export const PrioritySchema = z.enum(["P0", "P1", "P2", "P3"]);

export const ObjectiveSchema = z.object({
  id: z.string().min(1),
  learnerView: z.string().min(1),
  evidence: z.union([
    z.string().min(1),
    z.object({
      kind: z.enum(["machine", "reflection", "predict"]),
      ref: z.string().optional(),
    }),
  ]),
});

export const RewardSchema = z.object({
  rune: z.string().min(1),
  advancement: z.string().regex(/^loomcraft\/[a-z0-9_/]+$/),
  codexPage: z.string().min(1),
});

export const LevelMetaSchema = z.object({
  id: z.string().regex(/^(L\d{2}|LAB-[A-Z])$/),
  title: z.object({ zh: z.string().min(1), en: z.string().optional() }),
  act: z.number().int().min(1).max(3),
  order: z.number().int().min(1),
  priority: PrioritySchema,
  prerequisites: z.array(z.string()),
  estimatedMinutes: z.number().int().min(5).max(35),
  difficulty: z.number().int().min(1).max(5),
  abstractions: z.array(z.string()).min(1).max(2),
  objectives: z.array(ObjectiveSchema).min(1),
  misconceptions: z.array(z.string()),
  apiIntroduced: z.array(z.string()),
  apiAllowlist: z.array(z.string()),
  syntaxIntroduced: z.array(z.string()),
  reward: RewardSchema,
  languageLevel: z.string().optional(),
});

export const WorldEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  type: z.string().min(1),
  actor: z.string().optional(),
  actorType: z.enum(["player", "agent"]).optional(),
  pos: Vec3Schema.optional(),
  tick: z.number().int().nonnegative().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const WorldSnapshotSchema = z.object({
  levelId: z.string(),
  trialId: z.string().optional(),
  seed: z.number().int(),
  vars: z.record(z.string(), z.unknown()),
  blocks: z.record(z.string(), z.string()),
  agents: z.record(z.string(), z.object({ pos: Vec3Schema })),
  npcs: z.record(z.string(), z.object({ pos: Vec3Schema })).optional(),
  events: z.array(WorldEventSchema),
  tick: z.number().int().nonnegative(),
});

export const RpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.string().min(1),
  method: z.string().min(1),
  params: z.unknown().optional(),
});

export type Vec3 = z.infer<typeof Vec3Schema>;
export type WorldEvent = z.infer<typeof WorldEventSchema>;
export type WorldSnapshot = z.infer<typeof WorldSnapshotSchema>;
export type LevelMeta = z.infer<typeof LevelMetaSchema>;
export type RpcRequest = z.infer<typeof RpcRequestSchema>;
