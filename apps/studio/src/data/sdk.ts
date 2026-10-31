/** Monaco 补全用的 SDK 声明：与学生可见 API（docs/12 L1）一致。注释用英文，避免混入中文文案源。 */
export const SDK_DTS = `// Loom SDK — student-visible API (Act I)
type Vec3 = [number, number, number];

interface Golem {
  /** Current position (read-only snapshot). */
  readonly pos: Vec3;
  /** Walk to (x, z). Movement only. */
  moveTo(x: number, z: number): Promise<void>;
  /** Place a block at (x, y, z). */
  place(block: string, x: number, y: number, z: number): Promise<void>;
  /** Say one line. */
  say(text: string): Promise<void>;
}

interface World {
  /** Read-only world variables (e.g. lamp coordinates). */
  readonly vars: Record<string, unknown>;
}

declare const golem: Golem;
declare const world: World;
`;
