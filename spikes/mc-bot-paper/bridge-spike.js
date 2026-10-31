// task-17 spike: L10 "two bots build a bridge over a gap" + visual fallbacks.
// Route A: plugin pre-builds 80% deck; bots walk to the gap edge, place the last 2-3
//          blocks and advance; plugin teleport rescues anti-fall.
// Route A-control: same but NO rescue (answers "does the bot fall?").
// Route B: plugin fills the deck with a tick animation + ItemDisplay flying, bots only
//          walk to the edge and swing arms; scoring uses bridge state + actorType events.
const mineflayer = require('mineflayer')
const WebSocket = require('ws')
const { Vec3 } = require('vec3')

const DECK_Y = 99           // bridge blocks; walkable top y=100
const FEET_Y = DECK_Y + 1
const GAP = [5, 6, 7, 8]    // 4-block gap; left places 5,6; keystone at 7; right places 8
const T0 = Date.now()
const sleep = ms => new Promise(r => setTimeout(r, ms))
const results = { routeA: [], routeAControl: [], routeB: [], mannequin: null, display: null, chatLatency: [], logs: [] }
function log(...a) {
  const line = a.map(x => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')
  console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${line}`)
  results.logs.push(line)
}

// ---------------------------------------------------------------- WS RPC
let ws
const wsQueue = []
function connectWs() {
  return new Promise((res, rej) => {
    ws = new WebSocket('ws://127.0.0.1:8765')
    ws.on('open', () => { log('WS_OPEN'); res() })
    ws.on('error', rej)
    ws.on('message', data => {
      const h = wsQueue.shift()
      if (h) h(JSON.parse(data.toString()))
      else log('WS_UNEXPECTED', data.toString().slice(0, 100))
    })
  })
}
function rpc(obj, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('rpc timeout ' + JSON.stringify(obj).slice(0, 100))), timeoutMs)
    wsQueue.push(r => { clearTimeout(t); resolve(r) })
    ws.send(JSON.stringify(obj))
  })
}
const fill = (from, to, block) => rpc({ method: 'world.fill', from, to, block })
const blockAt = (x, y, z) => rpc({ method: 'world.block', x, y, z })
const tp = (name, x, y, z, yaw = 0, pitch = 0) => rpc({ method: 'player.teleport', name, x, y, z, yaw, pitch })
const drainEvents = async () => (await rpc({ method: 'events.drain' })).events || []

// ---------------------------------------------------------------- bots
function makeBot(name) {
  return new Promise((resolve, reject) => {
    const bot = mineflayer.createBot({
      host: '127.0.0.1', port: 25565, username: name, auth: 'offline', version: '26.1'
    })
    bot.on('error', e => log(name, 'ERR', e.message))
    bot.on('death', () => { bot.__deaths = (bot.__deaths || 0) + 1; log(name, 'DIED') })
    bot.once('spawn', async () => {
      try {
        await bot.waitForChunksToLoad()
        resolve(bot)
      } catch (e) { reject(e) }
    })
    setTimeout(() => reject(new Error(name + ' spawn timeout')), 25000)
  })
}

async function walkTo(bot, x, timeoutMs = 8000) {
  const { pathfinder, Movements, goals } = require('mineflayer-pathfinder')
  if (!bot.pathfinder) {
    bot.loadPlugin(pathfinder)
    const m = new Movements(bot); m.canDig = false; m.allowParkour = false; m.allow1by1towers = false
    bot.pathfinder.setMovements(m)
  }
  await bot.pathfinder.goto(new goals.GoalBlock(x, FEET_Y, 0), timeoutMs)
}

async function equipPlanks(bot) {
  const item = bot.inventory.items().find(i => i.name === 'oak_planks')
  if (item) await bot.equip(item, 'hand')
  return !!item
}

// Place one block in direction dir (must already be standing on refX block), then advance.
async function placeAndAdvance(bot, actorName, refX, dir, targetX, rescue) {
  // stand at ref block centre (guard against drift/slope)
  const p0 = bot.entity.position
  if (Math.floor(p0.x) !== refX || p0.y < DECK_Y + 0.5) {
    await tp(actorName, refX + 0.5, FEET_Y, 0.5, dir > 0 ? -90 : 90, 0)
    await sleep(150)
  }
  await bot.look(dir > 0 ? -Math.PI / 2 : Math.PI / 2, 0.45, true)
  const refBlock = bot.blockAt(new Vec3(refX, DECK_Y, 0))
  if (!refBlock || refBlock.name === 'air') throw new Error('no reference block at ' + refX)
  let placedOk = false
  try {
    await bot.placeBlock(refBlock, new Vec3(dir, 0, 0))
    await bot.waitForTicks(3)
    const placed = bot.blockAt(new Vec3(targetX, DECK_Y, 0))
    placedOk = !!placed && placed.name === 'oak_planks'
  } catch (e) {
    log(actorName, 'place-error', e.message)
  }
  // advance: try to walk one block; measure fall / drift
  let walkResult = { walked: false, fell: false, teleported: false }
  if (placedOk) {
    bot.setControlState('forward', true)
    const t0 = Date.now()
    try {
      while (Date.now() - t0 < 700) {
        await sleep(40)
        const p = bot.entity.position
        if (p.y < DECK_Y + 0.5) { walkResult.fell = true; break }
        if (Math.abs(p.x - (targetX + 0.5)) < 0.25) { walkResult.walked = true; break }
      }
    } finally {
      bot.setControlState('forward', false)
    }
    if (!walkResult.walked) {
      if (rescue) {
        await tp(actorName, targetX + 0.5, FEET_Y, 0.5)
        walkResult.teleported = true
        walkResult.walked = true
        await sleep(100)
      }
    }
  }
  return { placedOk, ...walkResult }
}

async function setupRig() {
  await fill([-8, DECK_Y - 1, -3], [22, DECK_Y + 4, 3], 'minecraft:air')
  await fill([-6, DECK_Y, -2], [0, DECK_Y, 2], 'minecraft:stone')     // left platform
  await fill([13, DECK_Y, -2], [19, DECK_Y, 2], 'minecraft:stone')    // right platform
  await fill([1, DECK_Y, 0], [4, DECK_Y, 0], 'minecraft:oak_planks')  // pre-built deck 80% (left)
  await fill([9, DECK_Y, 0], [12, DECK_Y, 0], 'minecraft:oak_planks') // pre-built deck (right)
}

async function resetTrial(bots, human, fullDeckReset) {
  // teleport everybody onto solid ground FIRST, then edit blocks (else a bot standing on
  // a gap block gets dropped when the gap is cleared -> artificial death mid-run)
  await tp('LeftWeaver', -2.5, FEET_Y, 0.5, -90, 0)
  await tp('RightWeaver', 15.5, FEET_Y, 0.5, 90, 0)
  await tp('HumanLike', (fullDeckReset ? 17.5 : 15.5), FEET_Y, 0.5, 90, 0)
  await sleep(120)
  if (fullDeckReset) {
    await fill([1, DECK_Y, 0], [12, DECK_Y, 0], 'minecraft:air')
    await fill([1, DECK_Y, 0], [4, DECK_Y, 0], 'minecraft:oak_planks')   // 80% pre-built deck restored
    await fill([9, DECK_Y, 0], [12, DECK_Y, 0], 'minecraft:oak_planks')
  } else {
    await fill([GAP[0], DECK_Y, 0], [GAP[3], DECK_Y, 0], 'minecraft:air')
  }
  await fill([-8, DECK_Y + 1, -3], [22, DECK_Y + 3, 3], 'minecraft:air')
  for (const b of bots) {
    await rpc({ method: 'player.clear', name: b.username })
    await rpc({ method: 'player.gamemode', name: b.username, mode: 'survival' })
    await rpc({ method: 'player.give', name: b.username, item: 'minecraft:oak_planks', count: 8 })
    b.__deaths = 0
  }
  await rpc({ method: 'player.clear', name: human.username })
  await rpc({ method: 'player.gamemode', name: human.username, mode: 'survival' })
  await rpc({ method: 'player.give', name: human.username, item: 'minecraft:lodestone', count: 2 })
  await sleep(200)
  await drainEvents()
}

async function checkBridge() {
  const got = {}
  for (let x = 1; x <= 12; x++) got[x] = (await blockAt(x, DECK_Y, 0)).block
  const planks = [1,2,3,4,5,6,8,9,10,11,12].filter(x => got[x] === 'minecraft:oak_planks').length
  return { got, complete: planks === 11 && got[7] === 'minecraft:lodestone', planks }
}

// ---------------------------------------------------------------- route A
async function runRouteA(trial, botsByName, human, rescue) {
  const t0 = Date.now()
  await resetTrial(Object.values(botsByName), human, false)
  const [left, right] = [botsByName['LeftWeaver'], botsByName['RightWeaver']]
  let placements = { LeftWeaver: 0, RightWeaver: 0 }
  let teleports = 0, falls = 0, walked = 0
  try {
    await walkTo(left, 4)
    await walkTo(right, 9)
    await equipPlanks(left); await equipPlanks(right)
    const placeT0 = Date.now()   // pure bridge-building phase starts here (after walking to edges)
    // left places x=5,6 ; right places x=8 (sequentially in JS, but both bots act concurrently at the MC level)
    let r = await placeAndAdvance(left, 'LeftWeaver', 4, 1, 5, rescue)
    if (r.placedOk) placements.LeftWeaver++; if (r.teleported) teleports++; if (r.fell) falls++; if (r.walked) walked++
    await equipPlanks(left)
    r = await placeAndAdvance(left, 'LeftWeaver', 5, 1, 6, rescue)
    if (r.placedOk) placements.LeftWeaver++; if (r.teleported) teleports++; if (r.fell) falls++; if (r.walked) walked++
    await equipPlanks(right)
    r = await placeAndAdvance(right, 'RightWeaver', 9, -1, 8, rescue)
    if (r.placedOk) placements.RightWeaver++; if (r.teleported) teleports++; if (r.fell) falls++; if (r.walked) walked++
    // player beat: human player places keystone at x=7, standing on right deck edge
    await walkTo(human, 9)
    await human.look(Math.PI / 2, 0.45, true)
    const ref = human.blockAt(new Vec3(8, DECK_Y, 0))
    await human.placeBlock(ref, new Vec3(-1, 0, 0))
    await human.waitForTicks(3)
    const bridge = await checkBridge()
    const events = await drainEvents()
    const placeEvents = events.filter(e => e.type === 'block.place')
    const by = {}
    for (const e of placeEvents) by[e.by] = (by[e.by] || 0) + 1
    const keystoneEv = placeEvents.find(e => e.block === 'minecraft:lodestone')
    const durationMs = Date.now() - t0
    const placeMs = Date.now() - placeT0
    const success = bridge.complete && placements.LeftWeaver === 2 && placements.RightWeaver === 1 &&
      !!keystoneEv && keystoneEv.actorType === 'player' && falls === 0
    const rec = { trial, rescue, success, durationMs, placeMs, falls, teleports, walked, placements,
      bridge, by, keystone: keystoneEv ? { by: keystoneEv.by, actorType: keystoneEv.actorType, byPlayer: keystoneEv.byPlayer } : null,
      botDeaths: [left.__deaths || 0, right.__deaths || 0] }
    log('ROUTE_A_TRIAL', JSON.stringify(rec))
    return rec
  } catch (e) {
    const rec = { trial, rescue, success: false, error: e.message, durationMs: Date.now() - t0 }
    log('ROUTE_A_TRIAL_ERROR', JSON.stringify(rec))
    return rec
  }
}

// ---------------------------------------------------------------- route B
async function runRouteB(trial, botsByName, human) {
  const t0 = Date.now()
  await resetTrial(Object.values(botsByName), human, true) // whole deck air
  const [left, right] = [botsByName['LeftWeaver'], botsByName['RightWeaver']]
  try {
    await walkTo(left, 4)
    await walkTo(right, 9)
    await walkTo(human, 9)   // stand on pre-built right deck edge so keystone at x=7 is in reach
    // "bots deliver materials" -> measure their walk + swing; bridge is built by plugin tick batches
    left.swingArm(); right.swingArm()
    const displays = []
    for (const [fromX, toX] of [[4, 9], [9, 4], [4, 9]]) {
      const d = await rpc({ method: 'display.spawnItem', x: fromX, y: FEET_Y + 1, z: 0, item: 'minecraft:oak_planks' })
      displays.push(d.uuid)
      await rpc({ method: 'display.animate', uuid: d.uuid, from: [fromX, FEET_Y + 1, 0], to: [toX, FEET_Y + 1, 0], ticks: 24 })
    }
    // progressive fill: 2 blocks per tick from both banks (mimics setBlockBatch per tick)
    const fillT0 = Date.now()
    for (const x of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12]) {
      await fill([x, DECK_Y, 0], [x, DECK_Y, 0], 'minecraft:oak_planks')
      if (x % 2 === 0) await sleep(50)
    }
    const fillMs = Date.now() - fillT0
    // player beat: keystone
    await human.look(Math.PI / 2, 0.45, true)
    // stand human at right edge to reach x=7? use x=9 stand -> ref x=8
    const ref = human.blockAt(new Vec3(8, DECK_Y, 0))
    await human.placeBlock(ref, new Vec3(-1, 0, 0))
    await human.waitForTicks(3)
    const bridge = await checkBridge()
    const events = (await drainEvents()).filter(e => e.type === 'block.place')
    const keystoneEv = events.find(e => e.block === 'minecraft:lodestone')
    for (const uuid of displays) await rpc({ method: 'display.remove', uuid }).catch(() => {})
    const durationMs = Date.now() - t0
    const success = bridge.complete && !!keystoneEv && keystoneEv.actorType === 'player'
    const rec = { trial, success, durationMs, fillMs, bridge, keystone: keystoneEv ? keystoneEv.actorType : null, displays: displays.length }
    log('ROUTE_B_TRIAL', JSON.stringify(rec))
    return rec
  } catch (e) {
    const rec = { trial, success: false, error: e.message, durationMs: Date.now() - t0 }
    log('ROUTE_B_TRIAL_ERROR', JSON.stringify(rec))
    return rec
  }
}

// ---------------------------------------------------------------- visual fallbacks
async function fetchSkinUrl(name) {
  try {
    const r1 = await fetch('https://api.mojang.com/users/profiles/minecraft/' + encodeURIComponent(name))
    if (!r1.ok) return null
    const { id } = await r1.json()
    const r2 = await fetch('https://sessionserver.mojang.com/session/minecraft/profile/' + id)
    if (!r2.ok) return null
    const prof = await r2.json()
    const prop = (prof.properties || []).find(p => p.name === 'textures')
    if (!prop) return null
    const decoded = JSON.parse(Buffer.from(prop.value, 'base64').toString('utf8'))
    return decoded.textures.SKIN.url
  } catch (e) { log('skin-fetch-failed', e.message); return null }
}

async function testMannequin(bots) {
  const skin = await fetchSkinUrl('Notch')
  log('SKIN_URL', skin || 'none')
  const before = new Set(Object.keys(bots[0].entities))
  const r = await rpc({ method: 'entity.mannequin', x: -2, y: FEET_Y, z: 2, name: 'EiraTest', skin: skin || '' })
  await sleep(1200)
  const fresh = Object.values(bots[0].entities).filter(e => !before.has(String(e.id)))
    .map(e => ({ id: e.id, name: e.name, type: e.type, pos: e.position.floored() }))
  const mannequinSeen = fresh.find(e => e.pos && Math.abs(e.pos.x + 2) < 2 && Math.abs(e.pos.y - FEET_Y) < 2 && Math.abs(e.pos.z - 2) < 2) || null
  const rec = { rpc: r, freshEntities: fresh, mannequinSeen,
    note: 'visual skin cannot be verified without a real MC client; server-side profile set + protocol-level entity visibility only' }
  log('MANNEQUIN', JSON.stringify(rec))
  return rec
}

async function testItemDisplay(bots) {
  let samples = []
  const before = new Set(Object.keys(bots[0].entities))
  const d = await rpc({ method: 'display.spawnItem', x: -2, y: FEET_Y + 2, z: 2, item: 'minecraft:oak_planks' })
  await sleep(600)
  const fresh = Object.values(bots[0].entities).filter(e => !before.has(String(e.id)))
  const targetId = fresh.length ? fresh[fresh.length - 1].id : null
  samples = []
  const sampler = setInterval(() => {
    const target = targetId != null ? bots[0].entities[targetId] : null
    if (target) samples.push({ t: Date.now(), x: +target.position.x.toFixed(2), y: +target.position.y.toFixed(2) })
  }, 100)
  await rpc({ method: 'display.animate', uuid: d.uuid, from: [-2, FEET_Y + 2, 2], to: [14, FEET_Y + 2, 2], ticks: 60 })
  await sleep(4000)
  clearInterval(sampler)
  await rpc({ method: 'display.remove', uuid: d.uuid }).catch(() => {})
  const xs = samples.map(s => s.x)
  const freshInfo = fresh.map(e => ({ id: e.id, type: e.type, name: e.name }))
  const unique = new Set(xs).size
  const rec = { freshEntities: freshInfo, targetId, samples: samples.length, uniquePositions: unique, firstX: xs[0], lastX: xs[xs.length - 1],
    moved: xs.length > 1 && Math.abs(xs[xs.length - 1] - xs[0]) > 3,
    note: 'bot-side positions show interpolated server positions; client-side smoothness not verifiable without MC client' }
  log('ITEMDISPLAY', JSON.stringify(rec))
  return rec
}

async function testChatLatency(a, b) {
  const out = []
  if (!b.__chatEvents) {
    b.__chatEvents = []
    b.on('chat', (username, message) => b.__chatEvents.push({ message, t: Date.now() }))
  }
  for (let i = 0; i < 10; i++) {
    const t0 = Date.now()
    b.__chatEvents = []
    await sleep(100)
    a.chat('PING-' + i)
    const start = Date.now()
    while (Date.now() - start < 1000) {
      await sleep(10)
      const hit = b.__chatEvents.find(e => e.message.includes('PING-' + i))
      if (hit) { out.push({ i, ms: hit.t - start }); break }
    }
  }
  const ms = out.map(o => o.ms).sort((x, y) => x - y)
  const rec = { rounds: 10, received: out.length, p50: ms[Math.floor(ms.length / 2)], max: ms[ms.length - 1] }
  log('CHAT_LATENCY', JSON.stringify(rec))
  return rec
}

// ---------------------------------------------------------------- main
async function main() {
  await connectWs()
  const ping = await rpc({ method: 'ping' })
  log('PING', JSON.stringify(ping))
  await rpc({ method: 'bots.set', names: ['LeftWeaver', 'RightWeaver'] })
  const left = await makeBot('LeftWeaver')
  const right = await makeBot('RightWeaver')
  const human = await makeBot('HumanLike') // deliberately NOT in bot list -> actorType=player
  const botsByName = { LeftWeaver: left, RightWeaver: right }
  log('BOTS_READY')
  await setupRig()
  log('RIG_READY')

  const only = process.env.ONLY || ''
  if (only !== 'B') {
    for (let i = 1; i <= 10; i++) results.routeA.push(await runRouteA(i, botsByName, human, true))
    for (let i = 1; i <= 5; i++) results.routeAControl.push(await runRouteA(100 + i, botsByName, human, false))
  }
  if (only !== 'A') {
    for (let i = 1; i <= 5; i++) results.routeB.push(await runRouteB(i, botsByName, human))
  }

  results.chatLatency = await testChatLatency(left, right)
  results.mannequin = await testMannequin([left])
  results.display = await testItemDisplay([left])

  const okA = results.routeA.filter(r => r.success).length
  const okC = results.routeAControl.filter(r => r.success).length
  const okB = results.routeB.filter(r => r.success).length
  const avg = a => a.length ? Math.round(a.reduce((s, r) => s + (r.durationMs || 0), 0) / a.length) : 0
  const summary = {
    routeA: { success: okA + '/10', avgMs: avg(results.routeA), avgPlaceMs: avg(results.routeA.map(r => ({durationMs: r.placeMs}))), falls: results.routeA.reduce((s, r) => s + (r.falls || 0), 0), teleports: results.routeA.reduce((s, r) => s + (r.teleports || 0), 0) },
    routeAControl: { success: okC + '/5', falls: results.routeAControl.reduce((s, r) => s + (r.falls || 0), 0) },
    routeB: { success: okB + '/5', avgMs: avg(results.routeB), avgFillMs: avg(results.routeB.map(r => ({durationMs: r.fillMs}))) },
    mannequin: results.mannequin && results.mannequin.rpc && results.mannequin.rpc.ok,
    display: results.display && results.display.moved,
    chatLatency: results.chatLatency
  }
  log('SUMMARY', JSON.stringify(summary))
  require('fs').writeFileSync('bridge-spike-results.json', JSON.stringify({ summary, results }, null, 1))
  for (const b of [left, right, human]) b.quit()
  try { ws.close() } catch {}
  process.exit(0)
}

main().catch(e => { log('FATAL', e.stack || e.message); process.exit(1) })
