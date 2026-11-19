import { pinOf } from './boards'
import { PARTS } from './parts'
import type { HardwarePlan, PlanPart } from './types'

export interface FirmwareOptions {
  /** space id used in the MQTT topic root */
  spaceId: string
  topicRoot?: string
  wifiSsid?: string
  mqttHost?: string
  mqttPort?: number
  /** failsafe: outputs go to 0 and the controller disarms after this long without a heartbeat */
  failsafeMs?: number
  telemetryMs?: number
}

export interface FirmwareFile {
  controllerId: string
  /** file name to save, e.g. esp32-a/esp32-a.ino */
  name: string
  language: 'cpp' | 'python'
  code: string
  /** Arduino Library Manager names / pip packages */
  libraries: string[]
  /** how to run / flash it */
  steps: string[]
}

const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]/g, '_')
const cid = (id: string) => id.replace(/[^A-Za-z0-9_]/g, '_')
const hex = (n: number) => `0x${n.toString(16).toUpperCase()}`

export function generateFirmware(plan: HardwarePlan, opt: FirmwareOptions): FirmwareFile[] {
  return plan.controllers.map((c) => esp32(plan, c.id, opt))
}

interface Ctx {
  plan: HardwarePlan
  ctrl: string
  label: string
  root: string
  parts: PlanPart[]
  sensors: PlanPart[]
  acts: PlanPart[]
  pcas: PlanPart[]
  adss: PlanPart[]
  tca?: PlanPart
  sda?: string
  scl?: string
}

function ctx(plan: HardwarePlan, ctrl: string, opt: FirmwareOptions): Ctx {
  const parts = plan.parts.filter((p) => p.controllerId === ctrl)
  const sda = plan.pins.find((u) => u.controllerId === ctrl && u.fn === 'i2c-sda')?.pinId ?? plan.nets.find((n) => n.id === `${ctrl}:SDA`)?.endpoints.find((e) => e.owner === ctrl)?.pin
  const scl = plan.pins.find((u) => u.controllerId === ctrl && u.fn === 'i2c-scl')?.pinId ?? plan.nets.find((n) => n.id === `${ctrl}:SCL`)?.endpoints.find((e) => e.owner === ctrl)?.pin
  return {
    plan, ctrl, label: plan.controllers.find((c) => c.id === ctrl)!.label,
    root: `${opt.topicRoot ?? 'smartspace'}/${slug(opt.spaceId)}/${ctrl}`,
    parts,
    sensors: parts.filter((p) => PARTS[p.type].category === 'sensor'),
    acts: parts.filter((p) => PARTS[p.type].category === 'actuator'),
    pcas: parts.filter((p) => p.type === 'pca9685'),
    adss: parts.filter((p) => p.type === 'ads1115'),
    tca: parts.find((p) => p.type === 'tca9548a'),
    sda, scl,
  }
}

const gpioOf = (plan: HardwarePlan, id: string) => {
  const ch = plan.channels[id]
  return ch?.kind === 'gpio' ? pinOf(plan.family, ch.pinId) : undefined
}
// ═══════════════════════════ ESP32 (Arduino core 2.x and 3.x) ═══════════════════════════

function esp32(plan: HardwarePlan, ctrl: string, opt: FirmwareOptions): FirmwareFile {
  const c = ctx(plan, ctrl, opt)
  const libs = new Set<string>(['PubSubClient', 'ArduinoJson'])
  const inc = new Set<string>(['#include <WiFi.h>', '#include <PubSubClient.h>', '#include <ArduinoJson.h>'])
  const decl: string[] = []
  const setup: string[] = []
  const needWire = c.sda != null
  if (needWire) inc.add('#include <Wire.h>')

  // ── actuators ──
  const actRows = c.acts.map((a) => {
    const ch = plan.channels[a.id]
    const f = a.type === 'dcMotor' ? 20000 : 5000
    if (ch?.kind === 'pca9685') {
      const idx = c.pcas.findIndex((p) => p.id === ch.expanderId)
      return `  {"${a.id}", -1, ${idx}, ${ch.channel}, ${f}, 0.0f}, // ${a.label}`
    }
    const g = gpioOf(plan, a.id)!
    return `  {"${a.id}", ${g.num}, -1, 0, ${f}, 0.0f}, // ${a.label} on ${g.id}`
  })
  if (c.pcas.length) {
    inc.add('#include <Adafruit_PWMServoDriver.h>')
    libs.add('Adafruit PWM Servo Driver Library')
    decl.push(`Adafruit_PWMServoDriver pca[${c.pcas.length}] = {${c.pcas.map((p) => `Adafruit_PWMServoDriver(${hex(p.i2cAddr ?? 0x40)})`).join(', ')}};`)
  }

  // ── sensors ──
  const oneWire = c.sensors.filter((s) => s.type === 'ds18b20')
  const readers: string[] = []
  const tcaFn = c.tca ? `selectMux(${hex(c.tca.i2cAddr ?? 0x70)}, ` : ''
  const sel = (p: PlanPart) => (p.mux && c.tca ? `${tcaFn}${p.mux.channel}); ` : '')
  for (const s of c.sensors) {
    const id = cid(s.id)
    const g = gpioOf(plan, s.id)
    if (s.type === 'dht22') {
      inc.add('#include <DHT.h>'); libs.add('DHT sensor library'); libs.add('Adafruit Unified Sensor')
      decl.push(`DHT dht_${id}(${g!.num}, DHT22); // ${s.label}`)
      setup.push(`  dht_${id}.begin();`)
      readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); float t = dht_${id}.readTemperature(); if (isnan(t)) o["error"] = "read failed"; else { o["t"] = round(t * 100) / 100.0; float h = dht_${id}.readHumidity(); if (!isnan(h)) o["rh"] = round(h * 10) / 10.0; } }`)
    } else if (s.type === 'ds18b20') {
      inc.add('#include <OneWire.h>'); inc.add('#include <DallasTemperature.h>'); libs.add('OneWire'); libs.add('DallasTemperature')
      if (!decl.some((d) => d.startsWith('OneWire '))) decl.push(`OneWire oneWire(${g!.num});`, 'DallasTemperature dallas(&oneWire);')
    } else if (s.type === 'bme280') {
      inc.add('#include <Adafruit_BME280.h>'); libs.add('Adafruit BME280 Library'); libs.add('Adafruit Unified Sensor')
      decl.push(`Adafruit_BME280 bme_${id}; bool bme_${id}_ok = false; // ${s.label}`)
      setup.push(`  ${sel(s)}bme_${id}_ok = bme_${id}.begin(${hex(s.i2cAddr ?? 0x76)});`)
      readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); ${sel(s)}if (!bme_${id}_ok) o["error"] = "not found"; else { o["t"] = round(bme_${id}.readTemperature() * 100) / 100.0; o["rh"] = round(bme_${id}.readHumidity() * 10) / 10.0; } }`)
    } else if (s.type === 'bh1750') {
      inc.add('#include <BH1750.h>'); libs.add('BH1750')
      decl.push(`BH1750 lux_${id}(${hex(s.i2cAddr ?? 0x23)}); bool lux_${id}_ok = false; // ${s.label}`)
      setup.push(`  ${sel(s)}lux_${id}_ok = lux_${id}.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, ${hex(s.i2cAddr ?? 0x23)});`)
      readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); ${sel(s)}float l = lux_${id}.readLightLevel(); if (!lux_${id}_ok || l < 0) o["error"] = "read failed"; else o["lux"] = round(l); }`)
    } else if (s.type === 'ldr') {
      const ch = plan.channels[s.id]
      if (ch?.kind === 'ads1115') {
        inc.add('#include <Adafruit_ADS1X15.h>'); libs.add('Adafruit ADS1X15')
        const ai = c.adss.findIndex((p) => p.id === ch.expanderId)
        if (!decl.some((d) => d.startsWith('Adafruit_ADS1115 ads'))) decl.push(`Adafruit_ADS1115 ads[${c.adss.length}];`)
        readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); int16_t raw = ads[${ai}].readADC_SingleEnded(${ch.channel}); o["raw"] = raw; o["rel"] = round(constrain(raw / 26400.0, 0.0, 1.0) * 1000) / 1000.0; o["calibrated"] = false; } // relative reading: NOT lux`)
      } else {
        readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); int raw = analogRead(${g!.num}); o["raw"] = raw; o["rel"] = round(raw / 4095.0 * 1000) / 1000.0; o["calibrated"] = false; } // relative reading: NOT lux`)
        setup.push(`  analogSetPinAttenuation(${g!.num}, ADC_11db);`)
      }
    } else if (s.type === 'pir') {
      setup.push(`  pinMode(${g!.num}, INPUT);`)
      readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); o["motion"] = digitalRead(${g!.num}) == HIGH; } // motion only, not a seat count`)
    }
  }
  if (oneWire.length) {
    setup.push('  dallas.begin();', '  Serial.printf("DS18B20 probes found: %d\\n", dallas.getDeviceCount());')
    setup.push('  for (int i = 0; i < dallas.getDeviceCount(); i++) { DeviceAddress a; if (dallas.getAddress(a, i)) { Serial.printf("  probe %d address: ", i); for (int b = 0; b < 8; b++) Serial.printf("%02X", a[b]); Serial.println(); } }')
    readers.push('  dallas.requestTemperatures();')
    oneWire.forEach((s, i) => readers.push(`  { JsonObject o = sens["${s.id}"].to<JsonObject>(); float t = dallas.getTempCByIndex(${i}); if (t == DEVICE_DISCONNECTED_C) o["error"] = "probe ${i} not found"; else o["t"] = round(t * 100) / 100.0; } // index = discovery order, see the addresses printed at boot`))
  }
  if (c.adss.length) c.adss.forEach((p, i) => setup.push(`  ads[${i}].begin(${hex(p.i2cAddr ?? 0x48)});`))
  if (c.pcas.length) c.pcas.forEach((_, i) => setup.push(`  pca[${i}].begin(); pca[${i}].setPWMFreq(1000);`))

  const pcaApply = c.pcas.length ? `else pca[a.pca].setPWM(a.ch, 0, (uint16_t)(a.duty * 4095));` : ''
  const code = `// ============================================================================
//  SmartSpace 3D firmware for ${c.label}  (${ctrl})
//  GENERATED. Protocol v1. Review every pin against YOUR board before wiring.
//  Not verified on hardware by SmartSpace 3D.
// ============================================================================
${[...inc].join('\n')}

// ---------- configuration: edit these ----------
const char*    WIFI_SSID   = "${opt.wifiSsid ?? 'YOUR_WIFI_NAME'}";
const char*    WIFI_PASS   = "YOUR_WIFI_PASSWORD";
const char*    MQTT_HOST   = "${opt.mqttHost ?? '192.168.1.10'}";   // the computer running the SmartSpace backend
const uint16_t MQTT_PORT   = ${opt.mqttPort ?? 1883};
const char*    MQTT_USER   = "smartspace";
const char*    MQTT_PASS   = "PASTE_THE_BACKEND_TOKEN_HERE";        // printed by the backend / server/.token
const char*    CTRL_ID     = "${ctrl}";                    // MQTT client id: must equal this
const char*    ROOT        = "${c.root}";
const uint32_t FAILSAFE_MS  = ${opt.failsafeMs ?? 15000};   // no heartbeat for this long -> outputs 0 and disarm
const uint32_t TELEMETRY_MS = ${opt.telemetryMs ?? 2000};
const char*    PLAN_NAME   = "${slug(opt.spaceId)}";

// ---------- actuators ----------
// id, gpio (-1 = on a PCA9685), pca board index, pca channel, PWM Hz, duty (0..1)
struct Act { const char* id; int pin; int pca; int ch; int hz; float duty; };
Act acts[] = {
${actRows.join('\n')}
};
const int NACT = sizeof(acts) / sizeof(acts[0]);
${decl.join('\n')}

WiFiClient net;
PubSubClient mqtt(net);
bool armed = false;
uint32_t lastHb = 0, lastTel = 0, seq = 0;
String tTelemetry, tStatus, tCmd, tAck;
${needWire ? `
${c.tca ? `void selectMux(uint8_t addr, uint8_t channel) { Wire.beginTransmission(addr); Wire.write(1 << channel); Wire.endTransmission(); }\n` : ''}` : ''}
void writeAct(int i) {
  Act &a = acts[i];
  float d = constrain(a.duty, 0.0f, 1.0f);
  if (a.pin >= 0) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcWrite(a.pin, (uint32_t)(d * 255));
#else
    ledcWrite(i, (uint32_t)(d * 255));
#endif
  } ${pcaApply}
}
void zeroAll() { for (int i = 0; i < NACT; i++) { acts[i].duty = 0; writeAct(i); } }

void publishStatus(bool online) {
  JsonDocument d; d["v"] = 1; d["online"] = online; d["armed"] = armed; d["plan"] = PLAN_NAME; d["fw"] = "gen-1.0";
  char b[200]; size_t n = serializeJson(d, b); mqtt.publish(tStatus.c_str(), (const uint8_t*)b, n, true);
}
void sendAck(const char* id, bool ok, const char* type, const char* actuator, float applied, const char* err) {
  JsonDocument d; d["v"] = 1; d["id"] = id; d["ok"] = ok; d["type"] = type;
  if (actuator) { d["actuator"] = actuator; if (ok) d["applied"] = applied; }
  if (err) d["error"] = err;
  char b[260]; size_t n = serializeJson(d, b); mqtt.publish(tAck.c_str(), (const uint8_t*)b, n);
}
void publishTelemetry() {
  JsonDocument d; d["v"] = 1; d["ctrl"] = CTRL_ID; d["seq"] = seq++; d["uptime"] = millis() / 1000; d["plan"] = PLAN_NAME; d["armed"] = armed;
  JsonObject sens = d["sensors"].to<JsonObject>();
${readers.join('\n') || '  // (no sensors on this controller)'}
  JsonObject act = d["actuators"].to<JsonObject>();
  for (int i = 0; i < NACT; i++) { JsonObject o = act[acts[i].id].to<JsonObject>(); o["duty"] = round(acts[i].duty * 1000) / 1000.0; if (acts[i].pin >= 0) o["pin"] = acts[i].pin; }
  char b[1000]; size_t n = serializeJson(d, b); mqtt.publish(tTelemetry.c_str(), (const uint8_t*)b, n);
}

void onMessage(char*, byte* payload, unsigned int len) {
  JsonDocument d;
  if (deserializeJson(d, (const char*)payload, len)) return;
  const char* type = d["type"] | "";
  const char* id = d["id"] | "";
  if (!strcmp(type, "hb")) { lastHb = millis(); return; }
  if (!strcmp(type, "estop")) { armed = false; zeroAll(); publishStatus(true); publishTelemetry(); sendAck(id, true, type, nullptr, 0, nullptr); return; }
  if (!strcmp(type, "arm")) {
    armed = d["on"] | false; lastHb = millis();
    if (!armed) zeroAll();
    publishStatus(true); sendAck(id, true, type, nullptr, 0, nullptr); return;
  }
  if (!strcmp(type, "set")) {
    const char* who = d["actuator"] | "";
    float duty = d["duty"] | -1.0f;
    for (int i = 0; i < NACT; i++) if (!strcmp(acts[i].id, who)) {
      if (duty < 0 || duty > 1) { sendAck(id, false, type, who, 0, "duty must be 0..1"); return; }
      if (duty > 0 && !armed) { sendAck(id, false, type, who, 0, "controller is disarmed"); return; }
      acts[i].duty = duty; writeAct(i); lastHb = millis();
      sendAck(id, true, type, who, duty, nullptr); return;
    }
    sendAck(id, false, type, who, 0, "unknown actuator"); return;
  }
  sendAck(id, false, type, nullptr, 0, "unknown command");
}

void connectNetwork() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    uint32_t t = millis();
    while (WiFi.status() != WL_CONNECTED && millis() - t < 15000) delay(250);
  }
  if (WiFi.status() == WL_CONNECTED && !mqtt.connected()) {
    String will = "{\\"v\\":1,\\"online\\":false}";
    if (mqtt.connect(CTRL_ID, MQTT_USER, MQTT_PASS, tStatus.c_str(), 0, true, will.c_str())) {
      mqtt.subscribe(tCmd.c_str());
      publishStatus(true);
    }
  }
}

void setup() {
  // outputs first: they must be OFF before anything else runs (the MOSFET gate pull-down also holds them off while booting)
  for (int i = 0; i < NACT; i++) {
    if (acts[i].pin < 0) continue;
#if ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(acts[i].pin, acts[i].hz, 8);
#else
    ledcSetup(i, acts[i].hz, 8); ledcAttachPin(acts[i].pin, i);
#endif
  }
  Serial.begin(115200);
${needWire ? `  Wire.begin(${pinOf(plan.family, c.sda!)!.num}, ${pinOf(plan.family, c.scl!)!.num});` : ''}
${setup.join('\n')}
  zeroAll();
  tTelemetry = String(ROOT) + "/telemetry"; tStatus = String(ROOT) + "/status"; tCmd = String(ROOT) + "/cmd"; tAck = String(ROOT) + "/ack";
  mqtt.setServer(MQTT_HOST, MQTT_PORT); mqtt.setCallback(onMessage); mqtt.setBufferSize(1200);
  Serial.println("Booted DISARMED, all outputs 0");
}

void loop() {
  connectNetwork();
  mqtt.loop();
  uint32_t now = millis();
  // fail-safe: an armed controller without heartbeats (or without the network) turns everything off
  if (armed && now - lastHb > FAILSAFE_MS) {
    armed = false; zeroAll();
    Serial.println("FAILSAFE: no heartbeat, outputs off, disarmed");
    if (mqtt.connected()) publishStatus(true);
  }
  if (now - lastTel >= TELEMETRY_MS) { lastTel = now; if (mqtt.connected()) publishTelemetry(); }
}
`
  return {
    controllerId: ctrl, name: `${ctrl}/${ctrl}.ino`, language: 'cpp', code, libraries: [...libs],
    steps: [
      'Arduino IDE → Boards Manager → install "esp32 by Espressif Systems" (2.x or 3.x both work).',
      `Library Manager → install: ${[...libs].join(', ')}.`,
      'Edit Wi-Fi name/password, the broker address and the backend token at the top of the sketch.',
      'Select your ESP32 board, upload, open the Serial Monitor at 115200 baud.',
      'The controller boots DISARMED with every output at 0. Arm it from the Live Data tab.',
    ],
  }
}
