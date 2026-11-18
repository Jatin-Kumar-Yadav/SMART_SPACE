#!/usr/bin/env node
/**
 * Run a simulated controller against the local backend (no hardware needed).
 *
 *   node scripts/sim-device.mjs --space space_abc --ctrl esp32-a --token <TOKEN> \
 *        --actuators fan01:motor,led01:led --sensors temp01:temperature,lux01:light
 *
 * Type  `set temp01 28.5`  on stdin to change a simulated sensor. The command line for the current
 * plan is shown in the app under IoT mode → Live Data.
 */
import { createInterface } from 'node:readline'
import { createSimDevice } from '../server/sim-device.mjs'

const a = process.argv.slice(2)
const arg = (n, d) => {
  const i = a.indexOf(`--${n}`)
  return i >= 0 && a[i + 1] ? a[i + 1] : d
}
const list = (s) => (s ? s.split(',').filter(Boolean).map((x) => x.split(':')) : [])
const token = arg('token', process.env.SMARTSPACE_TOKEN)
if (!token) {
  console.error('Missing --token (see the backend start-up output or server/.token)')
  process.exit(1)
}
const dev = createSimDevice({
  brokerUrl: arg('broker', 'mqtt://127.0.0.1:1883'),
  token,
  space: arg('space', 'demo'),
  ctrl: arg('ctrl', 'esp32-a'),
  plan: arg('plan', ''),
  actuators: list(arg('actuators', 'fan01:motor,led01:led')).map(([id, kind]) => ({ id, kind })),
  sensors: list(arg('sensors', 'temp01:temperature,lux01:light')).map(([id, kind]) => ({ id, kind })),
})
createInterface({ input: process.stdin }).on('line', (l) => {
  const [cmd, id, v] = l.trim().split(/\s+/)
  if (cmd === 'set' && id && Number.isFinite(Number(v))) dev.setSensor(id, Number(v))
})
process.on('SIGINT', async () => { await dev.stop(); process.exit(0) })
