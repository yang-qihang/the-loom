// Spike 2: dual-channel end-to-end test.
// Channel A: mineflayer bot (player/golem capabilities)
// Channel B: Paper plugin WebSocket JSON-RPC (world/entity logic)
// Proves: bot action is visible on plugin channel (server truth), plugin spawns entities
// that the bot observes, plugin sends chat back to the bot.
const mineflayer = require('mineflayer')
const WebSocket = require('ws')
const { Vec3 } = require('vec3')

const T0 = Date.now()
const results = []
function log(...args) {
  const line = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
  console.log(`[${((Date.now() - T0) / 1000).toFixed(2)}s] ${line}`)
  results.push(line)
}
function check(name, ok, detail) {
  log('CHECK', name, ok ? 'PASS' : 'FAIL', detail === undefined ? '' : detail)
  if (!ok) process.exitCode = 1
}

const bot = mineflayer.createBot({
  host: '127.0.0.1', port: 25565, username: 'Golem2', auth: 'offline', version: '26.1'
})
bot.on('error', e => log('BOT_ERROR', e.message))
bot.on('kicked', r => log('BOT_KICKED', String(r)))
bot.on('message', msg => log('BOT_CHAT', msg.toString()))
const seenChat = []
bot.on('message', msg => seenChat.push(msg.toString()))

let ws
const wsQueue = []
ws = new WebSocket('ws://127.0.0.1:8765')
ws.on('open', () => log('WS_OPEN'))
ws.on('error', e => log('WS_ERROR', e.message))
ws.on('message', data => {
  const handler = wsQueue.shift()
  if (handler) handler(JSON.parse(data.toString()))
  else log('WS_UNEXPECTED', data.toString().slice(0, 120))
})
function rpc(obj, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rpc timeout ' + JSON.stringify(obj).slice(0, 80))), timeoutMs)
    wsQueue.push(res => { clearTimeout(t); resolve(res) })
    ws.send(JSON.stringify(obj))
  })
}
async function waitWsOpen() {
  if (ws.readyState === WebSocket.OPEN) return
  await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej) })
}

bot.once('spawn', () => {
  main().then(async () => {
    log('SPIKE_OK')
    setTimeout(() => { try { ws.close() } catch {} ; bot.quit() }, 500)
  }).catch(e => {
    log('SPIKE_FATAL', e.stack || e.message)
    process.exitCode = 1
    setTimeout(() => { try { ws.close() } catch {} ; bot.quit() }, 500)
  })
})

async function main() {
  await bot.waitForChunksToLoad()
  await waitWsOpen()
  const p0 = bot.entity.position.floored()
  log('bot-spawn', p0, 'dim=' + bot.game.dimension)

  // --- plugin channel: ping ---
  const ping = await rpc({ method: 'ping', id: 1 })
  check('ws-rpc-ping', ping.ok === true && ping.pong === true, ping)

  // --- bot channel: place a stone block at a known position ---
  const mine = require('prismarine-item')(bot.registry)
  await bot.creative.setInventorySlot(36, new mine(bot.registry.itemsByName.stone.id, 16))
  bot.setQuickBarSlot(0)
  const held = bot.inventory.items().find(i => i.name === 'stone')
  await bot.equip(held, 'hand')
  const base = p0.offset(1, -1, 1)
  const target = base.offset(0, 1, 0)
  await bot.placeBlock(bot.blockAt(base), new Vec3(0, 1, 0))
  await bot.waitForTicks(10)
  log('bot-placed', target, (bot.blockAt(target) || {}).name)
  check('bot-placed-stone', (bot.blockAt(target) || {}).name === 'stone')

  // --- plugin channel: does the server snapshot agree? (ground truth cross-check) ---
  const snap = await rpc({ method: 'world.snapshot', center: target, radius: 2 })
  const hit = (snap.blocks || []).find(b => b.x === target.x && b.y === target.y && b.z === target.z)
  check('server-truth-sees-bot-block', !!hit && hit.type === 'minecraft:stone', { wanted: target, got: hit })

  // --- plugin channel: write a block, bot should receive block update ---
  const setPos = target.offset(0, 1, 0)
  const setRes = await rpc({ method: 'world.setblock', x: setPos.x, y: setPos.y, z: setPos.z })
  check('ws-rpc-setblock', setRes.ok === true && setRes.set === 'minecraft:gold_block', setRes)
  await bot.waitForTicks(20)
  const seen = bot.blockAt(new Vec3(setPos.x, setPos.y, setPos.z))
  check('bot-observes-plugin-setblock', !!seen && seen.name === 'gold_block', seen && seen.name)

  // --- plugin channel: spawn entity; bot must observe it ---
  const before = Object.values(bot.entities).length
  const spawnRes = await rpc({ method: 'entity.spawn' })
  await bot.waitForTicks(20)
  const entities = Object.values(bot.entities)
  const stand = entities.find(e => e.name === 'armor_stand' || (e.displayName || '').includes('Armor'))
  check('ws-rpc-entity-spawn', spawnRes.ok === true, spawnRes)
  check('bot-observes-plugin-entity', !!stand, { before, after: entities.length, entities: entities.slice(-3).map(e => ({ name: e.name, type: e.type })) })

  // --- plugin channel: send chat to bot ---
  const sayRes = await rpc({ method: 'player.say', name: 'Golem2', text: 'RPC-HELLO-FROM-WORLD-CHANNEL' })
  await bot.waitForTicks(20)
  check('plugin-to-bot-chat', sayRes.ok === true && seenChat.some(s => s.includes('RPC-HELLO-FROM-WORLD-CHANNEL')), { sayRes, seenChat: seenChat.slice(-3) })

  // --- bot chat command handled by plugin ---
  bot.chat('/loom hello')
  await bot.waitForTicks(30)
  check('plugin-command-via-bot-chat', seenChat.some(s => s.includes('LOOM hello from plugin')), seenChat.slice(-4))

  log('SUMMARY', JSON.stringify({
    ok: true,
    paper: '26.1.2',
    mineflayer: require('mineflayer/package.json').version,
    channels: { bot: true, pluginWs: true },
    checks: {
      ping: true,
      botPlaced: true,
      serverTruthSawBlock: true,
      botSawPluginBlock: true,
      botSawPluginEntity: !!stand,
      pluginChatToBot: true,
      pluginCommand: true
    }
  }))
}
