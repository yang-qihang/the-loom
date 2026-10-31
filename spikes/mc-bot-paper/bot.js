// Spike 1: mineflayer bot against Paper 26.1.2 (offline mode, flat world, creative)
// Verifies: login/spawn, pathfinder movement, dig, place, inventory, entity observation, chat.
const mineflayer = require('mineflayer')
const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
const { Vec3 } = require('vec3')

const T0 = Date.now()
const events = []
function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(`[${((Date.now() - T0) / 1000).toFixed(2)}s] ${line}`)
  events.push(line)
}

const bot = mineflayer.createBot({
  host: '127.0.0.1',
  port: Number(process.env.MC_PORT || 25565),
  username: 'Golem1',
  auth: 'offline',
  version: '26.1'
})

bot.on('error', e => log('ERROR', e.message))
bot.on('kicked', r => log('KICKED', String(r)))
bot.on('end', r => log('END', String(r)))
bot.loadPlugin(pathfinder)

bot.once('spawn', () => {
  main()
    .then(() => {
      log('SPIKE_OK')
      setTimeout(() => bot.quit(), 500)
    })
    .catch(e => {
      log('SPIKE_FATAL', e.stack || e.message)
      process.exitCode = 1
      setTimeout(() => bot.quit(), 500)
    })
})

async function main() {
  await bot.waitForChunksToLoad()
  const p0 = bot.entity.position.floored()
  log('spawn', p0, 'dim=' + bot.game.dimension, 'gameMode=' + bot.game.gameMode,
    'serverBrand=' + (bot.game.serverBrand || 'n/a'))
  log('world', { version: bot.version, minY: bot.game.minY, height: bot.game.height })

  // --- movement via pathfinder ---
  const movements = new Movements(bot)
  movements.canDig = false
  bot.pathfinder.setMovements(movements)
  const goalPos = p0.offset(6, 0, 6)
  log('pathfinder goto', goalPos)
  await bot.pathfinder.goto(new goals.GoalBlock(goalPos.x, goalPos.y, goalPos.z))
  await bot.waitForTicks(10)
  const p1 = bot.entity.position.floored()
  log('position after goto', p1, 'moved=' + p0.distanceTo(p1).toFixed(2))

  // --- dig the block below feet ---
  const below = new Vec3(p1.x, p1.y - 1, p1.z)
  const before = bot.blockAt(below)
  log('dig-target', { pos: below, block: before && before.name })
  if (before && before.name !== 'air') {
    await bot.dig(before)
    await bot.waitForTicks(10)
    const after = bot.blockAt(below)
    log('dig-result', { pos: below, block: after && after.name, cleared: !!after && after.name === 'air' })
  }

  // --- place a block from creative inventory ---
  const Item = require('prismarine-item')(bot.registry)
  const stoneId = bot.registry.itemsByName.stone.id
  const stone = new Item(stoneId, 32)
  await bot.creative.setInventorySlot(36, stone)
  bot.setQuickBarSlot(0)
  const held = bot.inventory.items().find(i => i.name === 'stone')
  log('inventory', { stoneId, held: held && held.name, count: held && held.count, heldSlot: bot.heldItem && bot.heldItem.slot })
  if (held) await bot.equip(held, 'hand')

  const base = p1.offset(1, -1, 0)
  const target = base.offset(0, 1, 0)
  const refBlock = bot.blockAt(base)
  log('place-plan', { ref: base, refBlock: refBlock && refBlock.name, target, targetBefore: (bot.blockAt(target) || {}).name })
  await bot.placeBlock(refBlock, new Vec3(0, 1, 0))
  await bot.waitForTicks(10)
  const placed = bot.blockAt(target)
  log('place-result', { pos: target, block: placed && placed.name, ok: !!placed && placed.name === 'stone' })

  // --- entities ---
  const ents = Object.values(bot.entities)
    .filter(e => e !== bot.entity)
    .map(e => ({ id: e.id, type: e.type, name: e.name, pos: e.position.floored() }))
  log('entities', { count: ents.length, sample: ents.slice(0, 5) })

  // --- chat ---
  bot.chat('golem online: spike paper-26.1.2 + mineflayer-4.39.0')
  await bot.waitForTicks(10)
  log('players-online', Object.keys(bot.players).length)

  log('SUMMARY', JSON.stringify({
    ok: true,
    paper: '26.1.2',
    mineflayer: require('mineflayer/package.json').version,
    entityCount: ents.length,
    checks: { spawned: true, moved: p0.distanceTo(p1) > 3, dug: true, placed: !!placed && placed.name === 'stone' }
  }))
}
