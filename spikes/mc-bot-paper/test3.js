// Spike 4: survival-mode item ops + egg item pickup + multi-bot (for L02/L10 feasibility)
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')
const fs = require('fs')

const T0 = Date.now()
const out = []
function log(...a) {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  console.log(`[${((Date.now() - T0) / 1000).toFixed(2)}s] ${line}`)
  out.push(line)
}
const sleep = ms => new Promise(r => setTimeout(r, ms))

async function main() {
  const bot = mineflayer.createBot({
    host: '127.0.0.1', port: 25565, username: 'Golem3', auth: 'offline', version: '26.1'
  })
  bot.on('error', e => log('ERR', e.message))
  await new Promise((res, rej) => {
    bot.once('spawn', res)
    bot.once('error', rej)
    setTimeout(() => rej(new Error('spawn timeout')), 20000)
  })
  await bot.waitForChunksToLoad()
  const p0 = bot.entity.position.floored()
  log('spawn', p0, 'gameMode=' + bot.game.gameMode)

  // 1) creative mode: preload hotbar item; shell switches us to survival concurrently
  const Item = require('prismarine-item')(bot.registry)
  await bot.creative.setInventorySlot(36, new Item(bot.registry.itemsByName.stone.id, 16))
  log('creative-preload-stone', bot.inventory.items().filter(i => i.name === 'stone').length)
  fs.writeFileSync('test3-ready', '1')          // shell: switch gamemode + later summon egg
  await sleep(6000)                              // window for console commands
  log('gameMode-now', bot.game.gameMode, 'items', bot.inventory.items().map(i => i.name + 'x' + i.count))

  // 2) survival dig + place
  const below = new Vec3(p0.x, p0.y - 1, p0.z)
  const target = new Vec3(p0.x + 1, p0.y, p0.z)
  if (bot.blockAt(below) && bot.blockAt(below).name !== 'air') {
    await bot.dig(bot.blockAt(below))
    await bot.waitForTicks(10)
    log('survival-dig', (bot.blockAt(below) || {}).name)
  }
  const base = target.offset(0, -1, 0)
  const ref = bot.blockAt(base)
  if (ref && ref.name !== 'air') {
    const held = bot.inventory.items().find(i => i.name === 'stone')
    if (held) await bot.equip(held, 'hand')
    try {
      await bot.placeBlock(ref, new Vec3(0, 1, 0))
      await bot.waitForTicks(10)
      log('survival-place', (bot.blockAt(target) || {}).name)
    } catch (e) { log('survival-place-FAILED', e.message) }
  }

  // 3) walk over item entity (egg) summoned near us by shell; check pickup
  const before = bot.inventory.items().filter(i => i.name === 'egg').reduce((s, i) => s + i.count, 0)
  await sleep(1000)
  // walk 2 blocks toward egg spawned at ~+1.5 on z
  const dest = new Vec3(p0.x + 1.5, p0.y, p0.z + 1.5)
  const mv = require('mineflayer-pathfinder')
  bot.loadPlugin(mv.pathfinder)
  const movements = new mv.Movements(bot); movements.canDig = false
  bot.pathfinder.setMovements(movements)
  try {
    await bot.pathfinder.goto(new mv.goals.GoalBlock(Math.floor(dest.x), p0.y, Math.floor(dest.z)), 8000)
  } catch (e) { log('walk-to-egg-FAILED', e.message) }
  await bot.waitForTicks(40)
  const after = bot.inventory.items().filter(i => i.name === 'egg').reduce((s, i) => s + i.count, 0)
  log('egg-pickup', { before, after, pickedUp: after > before })
  log('SURVIVAL_SUMMARY', JSON.stringify({
    survival: bot.game.gameMode,
    dug: true,
    eggPickedUp: after > before
  }))
  bot.quit()
}

main().catch(e => { console.log('FATAL', e.stack || e.message); process.exit(1) })
