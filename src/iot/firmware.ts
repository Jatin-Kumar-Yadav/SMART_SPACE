import { pinOf } from './boards'
import { PARTS } from './parts'
import type { HardwarePlan, PinSpec, PlanPart } from './types'

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

/** Arduino pin expression: ESP32 / Uno numbers, A0… for Uno analog pins. */
function arduinoPin(p: PinSpec, family: HardwarePlan['family']): string {
  return family === 'uno' && p.id.startsWith('A') ? p.id : String(p.num)
}

export function generateFirmware(plan: HardwarePlan, opt: FirmwareOptions): FirmwareFile[] {
  return plan.controllers.map((c) => (plan.family === 'esp32' ? esp32(plan, c.id, opt) : plan.family === 'uno' ? uno(plan, c.id, opt) : rpi(plan, c.id, opt)))
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
const kindOf = (p: PlanPart) => (p.type === 'dcMotor' ? 'motor' : 'led')

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

// ═══════════════════════════ Arduino Uno (USB serial, no Wi-Fi) ═══════════════════════════

function uno(plan: HardwarePlan, ctrl: string, opt: FirmwareOptions): FirmwareFile {
  const c = ctx(plan, ctrl, opt)
  const libs = new Set<string>()
  const inc = new Set<string>()
  const decl: string[] = []
  const setup: string[] = []
  const readers: string[] = []
  const needWire = c.sda != null
  if (needWire) inc.add('#include <Wire.h>')
  const oneWire = c.sensors.filter((s) => s.type === 'ds18b20')
  for (const s of c.sensors) {
    const id = cid(s.id)
    const g = gpioOf(plan, s.id)
    const pin = g ? arduinoPin(g, 'uno') : ''
    if (s.type === 'dht22') {
      inc.add('#include <DHT.h>'); libs.add('DHT sensor library'); libs.add('Adafruit Unified Sensor')
      decl.push(`DHT dht_${id}(${pin}, DHT22);`)
      setup.push(`  dht_${id}.begin();`)
      readers.push(`  Serial.print(F("\\"${s.id}\\":{")); { float t = dht_${id}.readTemperature(); if (isnan(t)) Serial.print(F("\\"error\\":\\"read failed\\"")); else { Serial.print(F("\\"t\\":")); Serial.print(t, 2); } } Serial.print('}'); sep();`)
    } else if (s.type === 'ds18b20') {
      inc.add('#include <OneWire.h>'); inc.add('#include <DallasTemperature.h>'); libs.add('OneWire'); libs.add('DallasTemperature')
      if (!decl.some((d) => d.startsWith('OneWire '))) decl.push(`OneWire oneWire(${pin});`, 'DallasTemperature dallas(&oneWire);')
    } else if (s.type === 'bh1750') {
      inc.add('#include <BH1750.h>'); libs.add('BH1750')
      decl.push(`BH1750 lux_${id}(${hex(s.i2cAddr ?? 0x23)}); bool lux_${id}_ok = false;`)
      setup.push(`  lux_${id}_ok = lux_${id}.begin(BH1750::CONTINUOUS_HIGH_RES_MODE, ${hex(s.i2cAddr ?? 0x23)});`)
      readers.push(`  Serial.print(F("\\"${s.id}\\":{")); { float l = lux_${id}.readLightLevel(); if (!lux_${id}_ok || l < 0) Serial.print(F("\\"error\\":\\"read failed\\"")); else { Serial.print(F("\\"lux\\":")); Serial.print((long)l); } } Serial.print('}'); sep();`)
    } else if (s.type === 'ldr') {
      readers.push(`  Serial.print(F("\\"${s.id}\\":{\\"raw\\":")); { int r = analogRead(${pin}); Serial.print(r); Serial.print(F(",\\"rel\\":")); Serial.print(r / 1023.0, 3); } Serial.print(F(",\\"calibrated\\":false}")); sep(); // relative, NOT lux`)
    } else if (s.type === 'pir') {
      setup.push(`  pinMode(${pin}, INPUT);`)
      readers.push(`  Serial.print(F("\\"${s.id}\\":{\\"motion\\":")); Serial.print(digitalRead(${pin}) == HIGH ? F("true") : F("false")); Serial.print('}'); sep();`)
    } else if (s.type === 'bme280') {
      // the validator already rejects this (3.3 V part on a 5 V bus); keep the sketch honest instead of silently dropping it
      readers.push(`  Serial.print(F("\\"${s.id}\\":{\\"error\\":\\"BME280 unsupported on this board (needs level shifting)\\"}")); sep();`)
    }
  }
  if (oneWire.length) {
    setup.push('  dallas.begin();')
    readers.unshift('  dallas.requestTemperatures();')
    oneWire.forEach((s, i) => readers.push(`  Serial.print(F("\\"${s.id}\\":{")); { float t = dallas.getTempCByIndex(${i}); if (t == DEVICE_DISCONNECTED_C) Serial.print(F("\\"error\\":\\"probe not found\\"")); else { Serial.print(F("\\"t\\":")); Serial.print(t, 2); } } Serial.print('}'); sep();`))
  }
  const acts = c.acts.map((a) => ({ a, g: gpioOf(plan, a.id)! }))
  const code = `// ============================================================================
//  SmartSpace 3D firmware for ${c.label}  (${ctrl})   protocol v1, serial transport
//  GENERATED. The Arduino Uno has NO Wi-Fi: it talks over USB serial (115200 baud) to a gateway
//  (a PC script, an ESP32 or a Raspberry Pi) that relays to the MQTT broker. Not verified on hardware.
//
//  Commands (one per line):   SET <id> <duty 0..1>   ARM 1|0   ESTOP   HB
//  Output  (one JSON line per second):  {"v":1,"ctrl":...,"armed":...,"sensors":{...},"actuators":{...}}
//  Replies: {"v":1,"type":"ack","ok":true|false,...}
// ============================================================================
${[...inc].join('\n')}

const char CTRL_ID[] = "${ctrl}";
const unsigned long FAILSAFE_MS = ${opt.failsafeMs ?? 15000};
const unsigned long TELEMETRY_MS = ${opt.telemetryMs ?? 2000};

struct Act { const char* id; uint8_t pin; float duty; };
Act acts[] = {
${acts.map(({ a, g }) => `  {"${a.id}", ${arduinoPin(g, 'uno')}, 0.0f}, // ${a.label} on ${g.id}`).join('\n')}
};
const uint8_t NACT = sizeof(acts) / sizeof(acts[0]);
${decl.join('\n')}

bool armed = false;
unsigned long lastHb = 0, lastTel = 0, seq = 0;
bool first = true;
char line[48]; uint8_t len = 0;

void comma() { if (!first) Serial.print(','); first = false; }
void writeAct(uint8_t i) { analogWrite(acts[i].pin, (int)(constrain(acts[i].duty, 0.0f, 1.0f) * 255)); }
void zeroAll() { for (uint8_t i = 0; i < NACT; i++) { acts[i].duty = 0; writeAct(i); } }

void ack(const char* type, bool ok, const char* actuator, const char* err) {
  Serial.print(F("{\\"v\\":1,\\"type\\":\\"ack\\",\\"cmd\\":\\"")); Serial.print(type); Serial.print(F("\\",\\"ok\\":")); Serial.print(ok ? F("true") : F("false"));
  if (actuator) { Serial.print(F(",\\"actuator\\":\\"")); Serial.print(actuator); Serial.print('"'); }
  if (err) { Serial.print(F(",\\"error\\":\\"")); Serial.print(err); Serial.print('"'); }
  Serial.println('}');
}

void telemetry() {
  Serial.print(F("{\\"v\\":1,\\"ctrl\\":\\"")); Serial.print(CTRL_ID); Serial.print(F("\\",\\"seq\\":")); Serial.print(seq++);
  Serial.print(F(",\\"armed\\":")); Serial.print(armed ? F("true") : F("false")); Serial.print(F(",\\"sensors\\":{"));
  first = true;
${readers.map((r) => (r.includes('Serial.print') ? '  comma();' + r.slice(1).replace(/ sep\(\);/, '') : r)).join('\n')}
  Serial.print('}');
  Serial.print(F(",\\"actuators\\":{"));
  for (uint8_t i = 0; i < NACT; i++) { if (i) Serial.print(','); Serial.print('"'); Serial.print(acts[i].id); Serial.print(F("\\":{\\"duty\\":")); Serial.print(acts[i].duty, 3); Serial.print('}'); }
  Serial.println(F("}}"));
}

void handle(char* s) {
  char* cmd = strtok(s, " ");
  if (!cmd) return;
  if (!strcmp(cmd, "HB")) { lastHb = millis(); return; }
  if (!strcmp(cmd, "ESTOP")) { armed = false; zeroAll(); ack("estop", true, nullptr, nullptr); return; }
  if (!strcmp(cmd, "ARM")) { char* v = strtok(nullptr, " "); armed = v && v[0] == '1'; lastHb = millis(); if (!armed) zeroAll(); ack("arm", true, nullptr, nullptr); return; }
  if (!strcmp(cmd, "SET")) {
    char* id = strtok(nullptr, " "); char* v = strtok(nullptr, " ");
    if (!id || !v) { ack("set", false, nullptr, "usage: SET id duty"); return; }
    float d = atof(v);
    for (uint8_t i = 0; i < NACT; i++) if (!strcmp(acts[i].id, id)) {
      if (d < 0 || d > 1) { ack("set", false, id, "duty must be 0..1"); return; }
      if (d > 0 && !armed) { ack("set", false, id, "controller is disarmed"); return; }
      acts[i].duty = d; writeAct(i); lastHb = millis(); ack("set", true, id, nullptr); return;
    }
    ack("set", false, id, "unknown actuator"); return;
  }
  ack(cmd, false, nullptr, "unknown command");
}

void setup() {
  for (uint8_t i = 0; i < NACT; i++) { pinMode(acts[i].pin, OUTPUT); digitalWrite(acts[i].pin, LOW); }
  Serial.begin(115200);
${needWire ? '  Wire.begin();' : ''}
${setup.join('\n')}
  zeroAll();
  Serial.println(F("{\\"v\\":1,\\"type\\":\\"boot\\",\\"armed\\":false,\\"note\\":\\"booted DISARMED, outputs 0\\"}"));
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\\n' || ch == '\\r') { if (len) { line[len] = 0; handle(line); len = 0; } }
    else if (len < sizeof(line) - 1) line[len++] = ch;
  }
  unsigned long now = millis();
  if (armed && now - lastHb > FAILSAFE_MS) { armed = false; zeroAll(); }   // fail-safe: no heartbeat -> everything off
  if (now - lastTel >= TELEMETRY_MS) { lastTel = now; telemetry(); }
}
`
  return {
    controllerId: ctrl, name: `${ctrl}/${ctrl}.ino`, language: 'cpp', code, libraries: [...libs],
    steps: [
      `Library Manager → install: ${[...libs].join(', ') || 'no extra libraries'}.`,
      'Upload to the Uno, open the Serial Monitor at 115200 baud (line ending: Newline).',
      'Type ARM 1 then SET <id> 0.5 to test; the board boots DISARMED with outputs at 0.',
      'To use it with SmartSpace 3D Live Data, relay these serial lines to MQTT with a gateway (the Uno cannot connect to Wi-Fi).',
    ],
  }
}

// ═══════════════════════════ Raspberry Pi (Python 3) ═══════════════════════════

function rpi(plan: HardwarePlan, ctrl: string, opt: FirmwareOptions): FirmwareFile {
  const c = ctx(plan, ctrl, opt)
  const pip = new Set<string>(['paho-mqtt', 'gpiozero'])
  const imp: string[] = ['import json, time, threading', 'import paho.mqtt.client as mqtt', 'from gpiozero import PWMOutputDevice, MotionSensor']
  const init: string[] = []
  const read: string[] = []
  if (c.sensors.some((s) => s.type === 'dht22')) { imp.push('import board, adafruit_dht'); pip.add('adafruit-circuitpython-dht') }
  if (c.sensors.some((s) => s.type === 'ds18b20')) { imp.push('from w1thermsensor import W1ThermSensor'); pip.add('w1thermsensor') }
  if (c.sensors.some((s) => s.type === 'bh1750')) { imp.push('from smbus2 import SMBus'); pip.add('smbus2') }
  if (c.sensors.some((s) => s.type === 'bme280')) { imp.push('import board, adafruit_bme280.basic as adafruit_bme280'); pip.add('adafruit-circuitpython-bme280') }
  if (c.pcas.length) { imp.push('import board, busio', 'from adafruit_pca9685 import PCA9685'); pip.add('adafruit-circuitpython-pca9685') }
  if (c.adss.length) { imp.push('import board, busio, adafruit_ads1x15.ads1115 as ADS', 'from adafruit_ads1x15.analog_in import AnalogIn'); pip.add('adafruit-circuitpython-ads1x15') }
  if (c.tca) { imp.push('import adafruit_tca9548a'); pip.add('adafruit-circuitpython-tca9548a') }
  const needI2c = c.pcas.length || c.adss.length || c.tca || c.sensors.some((s) => s.type === 'bme280')
  if (needI2c) init.push('i2c = board.I2C()')
  if (c.tca) init.push(`tca = adafruit_tca9548a.TCA9548A(i2c, address=${hex(c.tca.i2cAddr ?? 0x70)})`)
  c.pcas.forEach((p, i) => init.push(`pca${i} = PCA9685(i2c, address=${hex(p.i2cAddr ?? 0x40)}); pca${i}.frequency = 1000`))
  c.adss.forEach((p, i) => init.push(`ads${i} = ADS.ADS1115(i2c, address=${hex(p.i2cAddr ?? 0x48)})`))

  const actRows = c.acts.map((a) => {
    const ch = plan.channels[a.id]
    if (ch?.kind === 'pca9685') return `    "${a.id}": {"kind": "${kindOf(a)}", "pca": pca${c.pcas.findIndex((p) => p.id === ch.expanderId)}, "ch": ${ch.channel}, "duty": 0.0},`
    const g = gpioOf(plan, a.id)!
    return `    "${a.id}": {"kind": "${kindOf(a)}", "dev": PWMOutputDevice(${g.num}, frequency=${a.type === 'dcMotor' ? 1000 : 500}, initial_value=0), "pin": ${g.num}, "duty": 0.0},  # ${g.id}`
  })

  for (const s of c.sensors) {
    const id = cid(s.id)
    const g = gpioOf(plan, s.id)
    if (s.type === 'dht22') {
      init.push(`dht_${id} = adafruit_dht.DHT22(board.D${g!.num})`)
      read.push(`    out["${s.id}"] = safe(lambda: {"t": round(dht_${id}.temperature, 2), "rh": round(dht_${id}.humidity, 1)})`)
    } else if (s.type === 'ds18b20') {
      const idx = c.sensors.filter((x) => x.type === 'ds18b20').indexOf(s)
      if (idx === 0) init.push('w1 = W1ThermSensor.get_available_sensors()  # needs: dtoverlay=w1-gpio in /boot/firmware/config.txt (default data pin GPIO4)')
      read.push(`    out["${s.id}"] = safe(lambda: {"t": round(w1[${idx}].get_temperature(), 2)})  # index = discovery order`)
    } else if (s.type === 'bme280') {
      init.push(`bme_${id} = adafruit_bme280.Adafruit_BME280_I2C(${c.tca && s.mux ? `tca[${s.mux.channel}]` : 'i2c'}, address=${hex(s.i2cAddr ?? 0x76)})`)
      read.push(`    out["${s.id}"] = safe(lambda: {"t": round(bme_${id}.temperature, 2), "rh": round(bme_${id}.relative_humidity, 1)})`)
    } else if (s.type === 'bh1750') {
      init.push(`bus_${id} = SMBus(1)`)
      read.push(`    out["${s.id}"] = safe(lambda: {"lux": round(bh1750(bus_${id}, ${hex(s.i2cAddr ?? 0x23)}))})`)
    } else if (s.type === 'ldr') {
      const ch = plan.channels[s.id]
      if (ch?.kind === 'ads1115') {
        const ai = c.adss.findIndex((p) => p.id === ch.expanderId)
        read.push(`    out["${s.id}"] = safe(lambda: ldr(AnalogIn(ads${ai}, ${ch.channel})))  # relative, NOT lux`)
      }
    } else if (s.type === 'pir') {
      init.push(`pir_${id} = MotionSensor(${g!.num})`)
      read.push(`    out["${s.id}"] = {"motion": bool(pir_${id}.motion_detected)}  # motion only, not a seat count`)
    }
  }

  const code = `#!/usr/bin/env python3
"""
SmartSpace 3D firmware for ${c.label} (${ctrl}).  Protocol v1.  GENERATED, not verified on hardware.
Install:  pip install ${[...pip].join(' ')}
Run:      python3 ${ctrl}.py          (set SMARTSPACE_TOKEN to the backend token)
Boots DISARMED with every output at 0. Fail-safe: no heartbeat for FAILSAFE_S -> outputs 0 and disarm.
A Raspberry Pi has no ADC: analog sensors only work through an ADS1115.
"""
import os
${imp.join('\n')}

MQTT_HOST = os.environ.get("SMARTSPACE_HOST", "${opt.mqttHost ?? '192.168.1.10'}")
MQTT_PORT = int(os.environ.get("SMARTSPACE_PORT", "${opt.mqttPort ?? 1883}"))
MQTT_USER = "smartspace"
MQTT_PASS = os.environ.get("SMARTSPACE_TOKEN", "PASTE_THE_BACKEND_TOKEN_HERE")
CTRL_ID = "${ctrl}"
ROOT = "${c.root}"
PLAN = "${slug(opt.spaceId)}"
FAILSAFE_S = ${(opt.failsafeMs ?? 15000) / 1000}
TELEMETRY_S = ${(opt.telemetryMs ?? 2000) / 1000}

${init.join('\n')}

ACTS = {
${actRows.join('\n')}
}
armed = False
last_hb = 0.0
seq = 0
t0 = time.time()
lock = threading.Lock()


def safe(fn):
    try:
        return fn()
    except Exception as e:  # a failed read is reported, never invented
        return {"error": str(e)[:60]}


def bh1750(bus, addr):
    bus.write_byte(addr, 0x10)
    time.sleep(0.18)
    d = bus.read_i2c_block_data(addr, 0x10, 2)
    return (d[0] << 8 | d[1]) / 1.2


def ldr(ch):
    return {"raw": ch.value, "rel": round(min(1.0, max(0.0, ch.value / 26400.0)), 3), "calibrated": False}


def write_act(a):
    d = max(0.0, min(1.0, a["duty"]))
    if "dev" in a:
        a["dev"].value = d
    else:
        a["pca"].channels[a["ch"]].duty_cycle = int(d * 0xFFFF)


def zero_all():
    for a in ACTS.values():
        a["duty"] = 0.0
        write_act(a)


def pub(client, sub, body, retain=False):
    client.publish(f"{ROOT}/{sub}", json.dumps(body, separators=(",", ":")), retain=retain)


def status(client, online=True):
    pub(client, "status", {"v": 1, "online": online, "armed": armed, "plan": PLAN, "fw": "gen-1.0"}, True)


def telemetry(client):
    global seq
    out = {}
${read.join('\n') || '    pass  # (no sensors on this controller)'}
    acts = {k: {"duty": round(a["duty"], 3), **({"pin": a["pin"]} if "pin" in a else {})} for k, a in ACTS.items()}
    pub(client, "telemetry", {"v": 1, "ctrl": CTRL_ID, "seq": seq, "uptime": int(time.time() - t0), "plan": PLAN, "armed": armed, "sensors": out, "actuators": acts})
    seq += 1


def on_message(client, _u, msg):
    global armed, last_hb
    try:
        m = json.loads(msg.payload)
    except ValueError:
        return
    t, mid = m.get("type"), m.get("id")

    def ack(ok, **extra):
        pub(client, "ack", {"v": 1, "id": mid, "ok": ok, "type": t, **extra})

    with lock:
        if t == "hb":
            last_hb = time.time()
        elif t == "estop":
            armed = False
            zero_all()
            status(client)
            ack(True, armed=False)
        elif t == "arm":
            armed = bool(m.get("on"))
            last_hb = time.time()
            if not armed:
                zero_all()
            status(client)
            ack(True, armed=armed)
        elif t == "set":
            who = m.get("actuator")
            try:
                d = float(m.get("duty"))
            except (TypeError, ValueError):
                return ack(False, actuator=who, error="duty must be 0..1")
            if who not in ACTS:
                return ack(False, actuator=who, error="unknown actuator")
            if not 0.0 <= d <= 1.0:
                return ack(False, actuator=who, error="duty must be 0..1")
            if d > 0 and not armed:
                return ack(False, actuator=who, error="controller is disarmed")
            ACTS[who]["duty"] = d
            write_act(ACTS[who])
            last_hb = time.time()
            ack(True, actuator=who, applied=d)
        else:
            ack(False, error="unknown command")


def main():
    global armed
    zero_all()
    print("Booted DISARMED, all outputs 0")
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=CTRL_ID)
    client.username_pw_set(MQTT_USER, MQTT_PASS)
    client.will_set(f"{ROOT}/status", json.dumps({"v": 1, "online": False}), retain=True)
    client.on_connect = lambda c, *_: (c.subscribe(f"{ROOT}/cmd"), status(c))
    client.on_message = on_message
    client.connect_async(MQTT_HOST, MQTT_PORT)
    client.loop_start()
    last = 0.0
    try:
        while True:
            now = time.time()
            with lock:
                if armed and now - last_hb > FAILSAFE_S:
                    armed = False
                    zero_all()
                    print("FAILSAFE: no heartbeat, outputs off, disarmed")
                    if client.is_connected():
                        status(client)
            if now - last >= TELEMETRY_S and client.is_connected():
                last = now
                with lock:
                    telemetry(client)
            time.sleep(0.1)
    finally:
        zero_all()
        client.loop_stop()


if __name__ == "__main__":
    main()
`
  return {
    controllerId: ctrl, name: `${ctrl}/${ctrl}.py`, language: 'python', code, libraries: [...pip],
    steps: [
      'Raspberry Pi OS: sudo raspi-config → Interfaces → enable I2C (and 1-Wire if you use DS18B20).',
      `pip install ${[...pip].join(' ')}`,
      'export SMARTSPACE_HOST=<computer running the backend>; export SMARTSPACE_TOKEN=<backend token>',
      `python3 ${ctrl}.py  — it boots DISARMED with outputs at 0. Arm it from the Live Data tab.`,
    ],
  }
}
