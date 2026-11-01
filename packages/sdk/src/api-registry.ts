/**
 * 学生可见 API 指令手册（单一数据源）：
 * - Studio「指令手册」面板 / REPL help / 文档面板
 * - Monaco 的 SDK 声明（apps/studio/src/data/sdk.ts 与之对齐）
 *
 * 规则（docs/12）：写操作动词开头、读操作名词；同一符号跨关卡签名不变；新关卡只新增。
 * 每条都必须有：一句人话语义 + 可照抄示例 + 从哪一关开始出现。
 */
export interface ApiDocPoint {
  /** 该条 API 从哪一关开始可用（L01–L10）。 */
  sinceLevel: string;
  /** 学生可见签名，如 `golem.collect("egg", perch1)`。 */
  signature: string;
  /** 一句人话说明：它到底做了什么。 */
  summary: string;
  /** 计算/边界说明（可选）。 */
  details?: string;
  /** 可照抄示例（一行或多行）。 */
  example: string;
  /** 分类：移动 / 方块 / 物品 / 表达 / 世界 / 交互。 */
  kind: "move" | "block" | "item" | "say" | "world" | "use";
}

export const API_REGISTRY: ApiDocPoint[] = [
  {
    sinceLevel: "L01",
    signature: "golem.moveTo(x, z)",
    summary: "让灰崽走到横坐标为 x、前后坐标为 z 的地面格；只负责走，不放东西。",
    details: "x 向东，z 向南；高度不用写，灰崽会自己走到那一格的地面上。",
    example: "golem.moveTo(-12, 10)\ngolem.moveTo(eira)",
    kind: "move",
  },
  {
    sinceLevel: "L01",
    signature: "golem.goTo(target)",
    summary: "moveTo 的同义词：走到一个命名点（如 eira、barrel、lamp1）。",
    example: "golem.goTo(eira)",
    kind: "move",
  },
  {
    sinceLevel: "L01",
    signature: "golem.place(block, x, y, z)",
    summary: "在指定坐标放一个方块；y 是高度（上下）。",
    details: "目标位置必须是空气；大多数方块需要下方有支撑。",
    example: 'golem.place("lantern", -12, 14, 10)',
    kind: "block",
  },
  {
    sinceLevel: "L01",
    signature: "golem.place(block, target)",
    summary: "在命名点所在的格子放方块（高度用点自带的高度），不用再背三个数字。",
    example: 'golem.moveTo(lamp1)\ngolem.place("lantern", lamp1)',
    kind: "block",
  },
  {
    sinceLevel: "L01",
    signature: "golem.say(text)",
    summary: "让灰崽说一句话；和艾拉对话、报数都用它。",
    example: 'golem.say("木桶里有 6 枚蛋")',
    kind: "say",
  },
  {
    sinceLevel: "L01",
    signature: "golem.pos",
    summary: "灰崽现在的位置（只读），返回 [x, y, z]。",
    details: "写 console.log(golem.pos) 可以在运行日志里看到坐标；也可以写进表达式。",
    example: "const [x, y, z] = golem.pos",
    kind: "world",
  },
  {
    sinceLevel: "L02",
    signature: "golem.collect(item, target)",
    summary: '把目标格子上的东西收进背包，比如把蛋收走：collect("egg", perch1)。',
    details: "目标格必须是这种物品（如窝里的蛋）；收走以后那一格变成空气，背包里会多 1 件。",
    example: 'golem.moveTo(perch1)\ngolem.collect("egg", perch1)',
    kind: "item",
  },
  {
    sinceLevel: "L02",
    signature: "golem.deposit(item, target, count?)",
    summary: '把背包里的东西放进目标容器（木桶/箱子），例如 deposit("egg", barrel) 倒 1 枚蛋进桶。',
    details: "默认倒 1 件；count 可一次倒多件。倒进去以后可以用 world.container(...).count() 查数量。",
    example: 'golem.moveTo(barrel)\ngolem.deposit("egg", barrel)',
    kind: "item",
  },
  {
    sinceLevel: "L02",
    signature: "golem.count(item)",
    summary: "问灰崽背包里还有几件这种物品（同步返回数字）。",
    example: 'if (golem.count("egg") < 4) { golem.collect("egg", perch) }',
    kind: "item",
  },
  {
    sinceLevel: "L02",
    signature: "world.container(target).count(item)",
    summary: "读容器里已经有多少件物品（比如木桶里已有几枚蛋）。",
    example: 'const n = world.container(barrel).count("egg")\ngolem.say(`木桶里有 ${n} 枚蛋`)',
    kind: "world",
  },
  {
    sinceLevel: "L02",
    signature: "world.container(target).items()",
    summary: "列出容器里的所有物品和数量。",
    example: "console.log(world.container(barrel).items())",
    kind: "world",
  },
  {
    sinceLevel: "L04",
    signature: "golem.harvest(crop, target)",
    summary: '把成熟的作物收走（如 harvest("wheat", cell)），等价于把那一格的作物收进背包。',
    example: 'golem.harvest("wheat", fieldA1)',
    kind: "item",
  },
  {
    sinceLevel: "L04",
    signature: "golem.plant(crop, target)",
    summary: '在目标格种下作物（如 plant("wheat", cell)）。',
    example: 'golem.plant("wheat", fieldA1)',
    kind: "item",
  },
];

/** 全局命名点说明（不在 API_REGISTRY 里，随关卡数据变化）。 */
export interface NamedPointDoc {
  name?: string;
  pos: [number, number, number];
}

export function registryForLevel(levelId: string, order: (id: string) => number): ApiDocPoint[] {
  const max = order(levelId);
  return API_REGISTRY.filter(entry => order(entry.sinceLevel) <= max).sort((a, b) => order(a.sinceLevel) - order(b.sinceLevel));
}
