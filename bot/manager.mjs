// LoomCraft golem bot manager (T1).
// Service channel only: every movement is an explicit moveTo(); no auto-dig, no pillaring.
// Locked versions: mineflayer 4.39.0 + mineflayer-pathfinder 2.4.5 (see bot/package.json).
import mineflayer from "mineflayer";
import pathfinderPkg from "mineflayer-pathfinder";

const { pathfinder, Movements, goals } = pathfinderPkg;

export { pathfinder, Movements, goals };

/** Error with a human-readable Chinese message plus a machine code (for the coach layer). */
export class GolemError extends Error {
  constructor(code, message, cause) {
    super(message, { cause });
    this.name = "GolemError";
    this.code = code;
  }
}

function withTimeout(promise, ms, code, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new GolemError(code, message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const SOLID_BELOW = new Set([
  "stone", "stone_bricks", "dirt", "grass_block", "oak_planks", "spruce_planks", "cobblestone",
  "sand", "gravel", "deepslate", "andesite", "diorite", "granite", "barrier", "bedrock",
]);

/** A block the golem can stand on: full collision box (works for hay/farmland/planks/… too). */
function isSolid(block) {
  if (!block || block.name === "air") return false;
  if (SOLID_BELOW.has(block.name)) return true;
  return block.boundingBox === "block";
}

export class GolemBot {
  /**
   * @param {{host?:string, port?:number, name:string, version?:string, log?:(line:string)=>void}} opts
   */
  constructor(opts) {
    this.host = opts.host ?? process.env.MC_HOST ?? "127.0.0.1";
    this.port = opts.port ?? Number(process.env.MC_PORT ?? 25565);
    this.name = opts.name;
    this.version = opts.version ?? "26.1";
    this.log = opts.log ?? ((line) => console.log(`[bot:${this.name}] ${line}`));
    this.bot = null;
    this._moveSeq = 0;
    this._nudgeFlip = false;
  }

  get connected() {
    return !!this.bot && this.bot.entity != null && this.bot._client?.socket != null;
  }

  /** @returns {Promise<void>} resolves after spawn + chunks loaded */
  async connect(timeoutMs = 45_000) {
    if (this.connected) return;
    const bot = mineflayer.createBot({
      host: this.host,
      port: this.port,
      username: this.name,
      auth: "offline",
      version: this.version,
      hideErrors: false,
    });
    this.bot = bot;
    bot.loadPlugin(pathfinder);

    bot.on("kicked", (reason) => this.log(`kicked: ${String(reason).slice(0, 200)}`));
    bot.on("error", (err) => this.log(`error: ${err.message}`));
    bot.on("end", (reason) => this.log(`end: ${reason}`));

    await withTimeout(
      new Promise((resolve, reject) => {
        bot.once("spawn", resolve);
        bot.once("error", reject);
      }),
      timeoutMs,
      "BOT_CONNECT_TIMEOUT",
      `织偶 ${this.name} 在 ${timeoutMs / 1000}s 内没有进入世界`,
    );
    await bot.waitForChunksToLoad();

    const movements = new Movements(bot);
    movements.canDig = false;            // 学生不能靠挖掘作弊
    movements.allowParkour = true;       // 玩家能跳过 1 格门槛/台阶；场景装饰不应把织偶判成死路
    movements.allow1by1towers = false;   // 禁止垫高
    movements.canOpenDoors = true;       // 能推开木门；否则会被自己盖的房子关住
    movements.allowSprinting = true;
    bot.pathfinder.setMovements(movements);
    this.log(`online as ${bot.username} at ${fmtPos(bot.entity.position)}`);
  }

  async reconnect() {
    this.log("reconnecting...");
    try {
      this.bot?.quit();
    } catch {
      /* ignore */
    }
    this.bot = null;
    await this.connect();
  }

  get pos() {
    const p = this.bot?.entity?.position;
    if (!p) return [0, 0, 0];
    return [Math.floor(p.x), Math.floor(p.y), Math.floor(p.z)];
  }

  get groundY() {
    const p = this.bot?.entity?.position;
    return p ? Math.floor(p.y) : 0;
  }

  /**
   * Walkable standing cells near (x,z), sorted by effort from the current position.
   * Lamp pillars block the exact lamp cell, so moveTo always aims at an adjacent cell;
   * candidates are sorted by distance from the bot to avoid "goal behind an obstacle" stalls.
   */
  findStandCells(x, z) {
    const y = this.groundY;
    const me = this.bot?.entity?.position ?? { x: 0, y: 0, z: 0 };
    const offsets = [
      [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
      [2, 0], [0, 2], [-2, 0], [0, -2], [1, 1], [1, -1], [-1, 1], [-1, -1],
      [2, 2], [2, -2], [-2, 2], [-2, -2],
    ];
    const cells = [];
    for (const [dx, dz] of offsets) {
      const cx = Math.floor(x) + dx;
      const cz = Math.floor(z) + dz;
      const below = this.bot.blockAt(this._vec(cx, y - 1, cz));
      const feet = this.bot.blockAt(this._vec(cx, y, cz));
      const head = this.bot.blockAt(this._vec(cx, y + 1, cz));
      if (!below || !isSolid(below)) continue;
      if (!feet || feet.name !== "air") continue;
      if (!head || head.name !== "air") continue;
      const targetDist = Math.hypot(cx - x, cz - z);
      if (targetDist > 2.5) continue;
      const effort = Math.abs(cx + 0.5 - me.x) + Math.abs(cz + 0.5 - me.z);
      cells.push({ x: cx, z: cz, y, targetDist, effort });
    }
    cells.sort((a, b) => a.effort - b.effort || a.targetDist - b.targetDist);
    return cells;
  }

  /** Wait until the chunks around the bot are loaded (teleports / prepare happen server-side). */
  async ensureChunks(timeoutMs = 8_000) {
    if (!this.bot?.entity) return;
    const started = Date.now();
    try {
      await Promise.race([this.bot.waitForChunksToLoad(), this._sleep(timeoutMs)]);
    } catch {
      /* fall through to polling */
    }
    while (Date.now() - started < timeoutMs) {
      const p = this.bot.entity.position;
      if (this.bot.blockAt(this._vec(Math.floor(p.x), Math.floor(p.y) - 1, Math.floor(p.z)))) return;
      await this._sleep(100);
    }
  }

  /** Walk to the lamp/point (x,z) using the pathfinder; per-attempt timeout + candidate fallback. */
  async moveTo(x, z, timeoutMs = 30_000) {
    if (!this.bot?.entity) throw new GolemError("BOT_OFFLINE", "织偶不在世界里");
    await this.ensureChunks();
    const me = this.bot.entity.position;
    if (Math.abs(me.y - this.groundY) < 1.5 && Math.hypot(me.x - (x + 0.5), me.z - (z + 0.5)) <= 2.4) {
      await this._sleep(40);
      return this.pos;
    }
    // chunks around the TARGET may still be streaming in after the scene teleport
    let cells = [];
    for (let attempt = 0; attempt < 25 && cells.length === 0; attempt++) {
      cells = this.findStandCells(x, z);
      if (cells.length === 0) await this._sleep(120);
    }
    // 目标格本身可能是灯笼/钟/农田等不可站立方块；真实玩家会站到旁边再动手。
    if (cells.length === 0) {
      for (let radius = 1; radius <= 3 && cells.length === 0; radius += 1) {
        for (let dx = -radius; dx <= radius && cells.length === 0; dx += 1) {
          for (let dz = -radius; dz <= radius && cells.length === 0; dz += 1) {
            if (Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
            cells = this.findStandCells(x + dx, z + dz);
          }
        }
      }
    }
    if (cells.length === 0) {
      // 最后一招：目标本身不可站立时，走到它附近（GoalNear），真实玩家也会站到格子边再动手。
      try {
        await this._gotoWithRecovery(new goals.GoalNear(x, this.groundY, z, 3), 8_000, `(${x}, ${z}) 附近`);
        await this._sleep(100);
        return this.pos;
      } catch (err) {
        throw new GolemError("NO_STAND_CELL", `(${x}, ${z}) 附近没有可以站立的格子`, err);
      }
    }
    const deadline = Date.now() + timeoutMs;
    let lastErr = null;
    for (const cell of cells.slice(0, 4)) {
      const remaining = deadline - Date.now();
      if (remaining < 1_500) break;
      const attemptMs = Math.min(remaining, 7_000);
      try {
        // 逐格 goto 带「卡住恢复」：mineflayer 客户端在头部高度装饰方块拐角会被挤住并原地打转，
        // 真玩家会贴边滑过去；这里检测到位置长时间不动就停 path、侧移+小跳，再重新寻路。
        await this._gotoWithRecovery(new goals.GoalBlock(cell.x, cell.y, cell.z), attemptMs, `(${x}, ${z})`);
        await this._sleep(150);
        return this.pos;
      } catch (err) {
        lastErr = err;
        try {
          this.bot.pathfinder.stop();
        } catch {
          /* ignore */
        }
        await this._sleep(120);
      }
    }
    // 精确格不可达时，先清掉 pathfinder 残留，再分两档靠近；真实玩家也会站到格子边再动手。
    const stopAndSettle = async () => {
      try { this.bot.pathfinder.stop(); this.bot.pathfinder.setGoal(null); } catch { /* ignore */ }
      await this._sleep(350);
    };
    for (const tolerance of [3, 5]) {
      await stopAndSettle();
      try {
        await this._gotoWithRecovery(new goals.GoalNear(x, this.groundY, z, tolerance), 10_000, `(${x}, ${z}) 附近`);
        await this._sleep(120);
        return this.pos;
      } catch { /* try larger tolerance */ }
    }
    if (lastErr instanceof GolemError) throw lastErr;
    throw new GolemError("MOVE_FAILED", `织偶无法走到 (${x}, ${z})：${lastErr?.message ?? "no path"}`, lastErr);
  }

  /**
   * pathfinder.goto 的「卡住检测 + 轻推恢复」包装。
   *
   * mineflayer 客户端在「头部高度」装饰方块（灯柱、栏杆、树干）的拐角会被压住：位置几乎不动，
   * 服务端持续把玩家拉回同一点，普通 goto 会一直等到超时。真 MC 客户端会沿方块面滑过去；
   * 这里检测 650ms 没位移就停 path、侧移一小步 + 小跳，然后重新寻路（最多 2 次），
   * 之后交给调用方的候选格/GoalNear 兜底。
   */
  async _gotoWithRecovery(goal, timeoutMs, label) {
    const deadline = Date.now() + Math.max(1_500, timeoutMs);
    let nudges = 0;
    let lastErr = null;
    while (Date.now() < deadline) {
      const gotoPromise = this.bot.pathfinder.goto(goal);
      let settled = false;
      gotoPromise.then(() => { settled = true; }).catch(() => { settled = true; });
      const startPos = this.bot.entity.position.clone();
      let lastPos = startPos.clone();
      let stillSince = Date.now();
      let outcome = "running";
      while (Date.now() < deadline) {
        await this._sleep(180);
        if (settled) { outcome = "settled"; break; }
        const pos = this.bot.entity.position;
        if (Math.hypot(pos.x - lastPos.x, pos.z - lastPos.z) > 0.12) {
          lastPos = pos.clone();
          stillSince = Date.now();
          continue;
        }
        if (Date.now() - stillSince > 650) { outcome = "stuck"; break; }
      }
      if (outcome === "settled") {
        try { await gotoPromise; return; } catch (error) { lastErr = error; }
      }
      try { this.bot.pathfinder.stop(); this.bot.pathfinder.setGoal(null); } catch { /* ignore */ }
      try { await gotoPromise; } catch (error) { lastErr = error; }
      for (const control of ["forward", "back", "left", "right", "jump", "sprint"]) {
        try { this.bot.setControlState(control, false); } catch { /* ignore */ }
      }
      if (outcome === "stuck" && nudges < 2 && Date.now() < deadline) {
        nudges += 1;
        await this._nudgeSideways(label);
        continue;
      }
      break;
    }
    if (lastErr instanceof GolemError) throw lastErr;
    throw new GolemError("MOVE_STUCK", `织偶走到 ${label} 时卡住了`, lastErr ?? undefined);
  }

  /** 侧移 + 小跳：把贴住方块拐角的角色挪开半步，再交给 pathfinder 重新规划。 */
  async _nudgeSideways(label) {
    const bot = this.bot;
    if (!bot?.entity) return;
    this._nudgeFlip = !this._nudgeFlip;
    const side = this._nudgeFlip ? 1 : -1;
    const baseYaw = bot.entity.yaw;
    try { await bot.look(baseYaw + (side * Math.PI) / 2, Math.PI / 8, true); } catch { /* ignore */ }
    bot.setControlState("forward", true);
    await this._sleep(240);
    bot.setControlState("jump", true);
    await this._sleep(120);
    bot.setControlState("jump", false);
    bot.setControlState("forward", false);
    try { await bot.look(baseYaw, 0, true); } catch { /* ignore */ }
    await this._sleep(120);
    this.log(`move recovery nudge ${side > 0 ? "right" : "left"} for ${label} at ${fmtPos(bot.entity.position)}`);
  }

  /**
   * Place a block at (x,y,z). Preconditions (docs/21 §5): reference block solid,
   * target air, reach <= 4.5 blocks; then place and verify the world changed.
   */
  async place(block, x, y, z, timeoutMs = 8_000) {
    if (!this.bot?.entity) throw new GolemError("BOT_OFFLINE", "织偶不在世界里");
    await this.ensureChunks();
    const itemName = String(block).replace(/^minecraft:/, "");
    const stack = this.bot.inventory.items().find((i) => i.name === itemName);
    if (!stack) throw new GolemError("NO_ITEM", `织偶背包里没有 ${itemName}`);

    const target = this._vec(Math.floor(x), Math.floor(y), Math.floor(z));
    const existing = this.bot.blockAt(target);
    if (!existing) throw new GolemError("TARGET_UNLOADED", `目标位置 (${x}, ${y}, ${z}) 不在已加载区块里`);
    if (existing.name !== "air") throw new GolemError("TARGET_OCCUPIED", `位置 (${x}, ${y}, ${z}) 已经有方块了`);

    const refPos = this._vec(Math.floor(x), Math.floor(y) - 1, Math.floor(z));
    const ref = this.bot.blockAt(refPos);
    if (!ref || !isSolid(ref)) {
      throw new GolemError("NO_SUPPORT", `(${x}, ${y}, ${z}) 下方没有可以承托的方块`);
    }

    const eye = this.bot.entity.position.offset(0, 1.62, 0);
    const center = target.offset(0.5, 0.5, 0.5);
    const reach = eye.distanceTo(center);
    if (reach > 4.5) throw new GolemError("OUT_OF_REACH", `目标太远了（${reach.toFixed(1)} 格 > 4.5 格）`);

    await this.bot.equip(stack, "hand");
    await this.bot.lookAt(refPos.offset(0.5, 0.5, 0.5), true);
    try {
      await withTimeout(
        this.bot.placeBlock(ref, target.offset(0, 0, 0).minus(refPos)),
        timeoutMs,
        "PLACE_TIMEOUT",
        `在 (${x}, ${y}, ${z}) 放置方块超时`,
      );
    } catch (err) {
      if (err instanceof GolemError) throw err;
      throw new GolemError("PLACE_REFUSED", `服务器拒绝了在 (${x}, ${y}, ${z}) 的放置：${err.message}`, err);
    }
    await this._waitForBlock(target, itemName, 2_000);
    return this.pos;
  }

  async say(text, timeoutMs = 3_000) {
    if (!this.bot) throw new GolemError("BOT_OFFLINE", "织偶不在世界里");
    this.bot.chat(String(text));
    await this._sleep(60);
    void timeoutMs;
  }

  async disconnect() {
    try {
      this.bot?.quit();
    } catch {
      /* ignore */
    }
    this.bot = null;
  }

  // ------------------------------------------------------------- internals

  _vec(x, y, z) {
    // vec3 is a mineflayer dependency; return type only needs .offset/.distanceTo
    return this.bot.entity.position.offset(x - 0, y - 0, z - 0).offset(0, 0, 0) && new (this.bot.entity.position.constructor)(x, y, z);
  }

  async _waitForBlock(target, expectedName, timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const b = this.bot.blockAt(target);
      if (b && b.name === expectedName) return;
      await this._sleep(80);
    }
    const actual = this.bot.blockAt(target)?.name ?? "unknown";
    throw new GolemError("PLACE_NOT_APPLIED", `放置没有生效：(${target.x}, ${target.y}, ${target.z}) 仍是 ${actual}`);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function fmtPos(p) {
  return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`;
}

export default GolemBot;
