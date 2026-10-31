// Spike 5: 3 bots same server (L10 feasibility)
const mineflayer = require('mineflayer')
const bots = []
const names = ['LeftWeaver', 'RightWeaver', 'ExtraGolem']
const t0 = Date.now()
function log(...a) { console.log(`[${((Date.now()-t0)/1000).toFixed(2)}s]`, ...a) }
let ready = 0
for (const name of names) {
  const bot = mineflayer.createBot({ host: '127.0.0.1', port: 25565, username: name, auth: 'offline', version: '26.1' })
  bots.push(bot)
  bot.on('error', e => log(name, 'ERR', e.message))
  bot.once('spawn', async () => {
    await bot.waitForChunksToLoad()
    ready++
    log(name, 'spawn', bot.entity.position.floored(), 'seesPlayers', Object.keys(bot.players).length)
    if (ready === names.length) {
      await new Promise(r => setTimeout(r, 1500))
      for (const b of bots) {
        log('FINAL', b.username, 'pos', b.entity.position.floored(), 'players', Object.keys(b.players).length,
          'nearbyEntities', Object.values(b.entities).filter(e => e.type === 'player' && e.username !== b.username).map(e => e.username))
      }
      log('MULTIBOT_OK', JSON.stringify({ bots: names.length, allSeeEachOther: bots.every(b => Object.keys(b.players).length === names.length) }))
      for (const b of bots) b.quit()
    }
  })
}
setTimeout(() => { log('TIMEOUT'); for (const b of bots) b.quit() }, 30000)
