#!/usr/bin/env node
/**
 *   npm run server                      # http/ws :8787, mqtt :1883, token in server/.token
 *   npm run server -- --port 8787 --mqtt-port 1883 --local-only
 */
import { startBackend, lanAddresses } from './backend.mjs'

const args = process.argv.slice(2)
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}
const local = args.includes('--local-only')

const b = await startBackend({
  port: Number(arg('port', 8787)),
  mqttPort: Number(arg('mqtt-port', 1883)),
  host: local ? '127.0.0.1' : '0.0.0.0',
})
const lan = lanAddresses()
console.log(`
SmartSpace 3D backend is running
  web socket / signaling : http://localhost:${b.port}   (the Vite dev server proxies /signal /telemetry /api to it)
  MQTT broker            : ${(lan[0]?.address ?? 'localhost')}:${b.mqttPort}   user "smartspace"
  ACCESS TOKEN           : ${b.token}
                           (also in server/.token — paste it into  IoT mode → Live Data → Connect,
                            and into MQTT_PASS in the generated firmware)
${local ? '  bound to 127.0.0.1 only (--local-only)\n' : '  listening on all interfaces; keep it on a trusted network\n'}`)

const stop = async () => {
  await b.close()
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
