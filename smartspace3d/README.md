# SmartSpace 3D — Intelligent Indoor Environment Simulator

A browser-based **indoor digital twin**. Build a room from real dimensions, furnish it with 3D
models, add fans / AC / lights / windows, seat random people, then watch a physically-grounded
simulation cool the room, light it, and automatically control the devices.

```bash
npm install
npm run dev        # http://localhost:5173  (the "Seminar Hall Demo" is seeded on first run)
npm test           # 148 tests (simulation, camera/vision, IoT planner, firmware, Wokwi, live link)
npm run build      # type-check + production build
```

---

## 1. The idea in one page

| Step | What the user does | What the app does |
|---|---|---|
| 1 | Enters name, type, L × W × H (m / cm / ft) | Builds floor + 4 walls in **world metres**; tiles repeat per physical tile size, never stretched |
| 2 | Drags furniture in (chair, bench, sofa, bed, table, plant, carpet …) | Procedural 3D models, grid snap, collision, rotate/resize, undo/redo |
| 3 | Saves the space under a unique name; makes any number of spaces | IndexedDB (Dexie) autosave; reopening restores the last edit |
| 4 | Adds fans, AC units, lights, windows | Devices look different from furniture and show translucent **influence regions** |
| 5 | Clicks **Generate people** | Random head-count, then random unique seat slots (1 per chair, N per sofa/bench by length) |
| 6 | Sets target temp, initial temp (random 27–40 °C or manual), lux target | Splits the room into **zones**, simulates heat, light and device control over time |
| 7 | Watches heatmaps, charts, comfort status | Cooling time from the exponential formula **and** a live energy-balance model |

### Views
3D (dollhouse, like the reference image) · 2D top · Temperature · Lighting · Airflow · Occupancy ·
Coverage · Zones. Hovering a floor cell reports temperature, lux, occupancy and influencing devices.

---

## 2. Flaws in the original idea — and how they were fixed

| # | Original idea | Problem | Fix in SmartSpace 3D |
|---|---|---|---|
| 1 | "400 × 400 m²" room | Pixel/geometry cost explodes; units are ambiguous | World-space metres internally; sim resolution is independent of rendering and capped, with warnings for huge rooms |
| 2 | Enlarge AC/fan area so nobody is left out (step 10) | Fakes coverage: a person 15 m from the AC is **not** cooled by it | Device ranges are never inflated. Every occupant gets a zone; uncovered ones are **flagged "underserved"**, still included in comfort stats, and get only indirect cooling via air mixing |
| 3 | Each person belongs to one section | A person can sit under a fan **and** an AC | All overlapping devices are kept per occupant |
| 4 | Fan "reduces temperature by 2 °C" | A fan moves air; it does not remove heat (and adds motor heat) | Fan effect is a *perceived-temperature offset* (labelled so), with `E(r)=Emax·max(0,1−r/R)`; it never subtracts from the room's thermal energy |
| 5 | AC subtracts N °C per step | Not physical; ignores time and power | AC removes **watts**: `Ceff·dT/dt = Qgain − Qcool`, limited by capacity and air-supply conductance |
| 6 | Body temperature "27–40" | Body temp is ~37 °C; 27–40 is **ambient** | Random value is the *initial indoor air temperature*; people add ~75 W sensible heat each |
| 7 | Exponential formula everywhere | Only valid for constant conditions, single zone | Used for the single-zone estimate, the cooling-curve overlay and validation; the grid uses the energy balance with heat gains, mixing, walls |
| 8 | Average temp = comfort | 20 °C + 28 °C averages to a "perfect" 24 °C | Three separate statuses: average reached · **every occupied zone** within ±tol · uniformity (spread) |
| 9 | Open window = brighter | Closed glass still transmits daylight | Light transmittance and open/closed are separate: opening changes ventilation, not lux |
| 10 | Light "influence" like temperature | Light follows inverse-square + beam angle | Lux = I·cosθ/d² with a near-field clamp; walls block; daylight added from windows; dimming, not just on/off |
| 11 | Controller changes speed continuously | Flapping devices | Rule-based controller with hysteresis, minimum interval, worst-violation priority across shared zones, and AUTO/MANUAL per device |
| 12 | Cooling time via `Q = m·Cp·ΔT` only | Air is a tiny fraction of the thermal mass | Adds effective capacitance `Ceff` (walls, floor, furniture); the air-only figure is shown as the idealised lower bound |

### Worked example (also in the Cooling tab and tests)
10 × 8 × 3 m = 240 m³ → 288 kg air. `Q = 288 × 1005 × 8 K = 2 315 520 J`. With 3500 W AC and
1000 W gains, `t = Q / 2500 ≈ 926 s ≈ 15.4 min` — an **idealised air-only** figure. The dynamic
model with `Ceff` gives a longer, more realistic time.

Time to reach a target with the exponential model:
`t = −(1/k)·ln((Tdes − Ttarget)/(Tinit − Ttarget))`, valid only when `Tdes` lies strictly between
`Tinit` and `Ttarget`; otherwise the UI says it is *unreachable* or only *asymptotically approached*.

---

## 3. Architecture

```
src/
  types/          Strongly-typed document model (Space, Obj, Device, Scenario …)
  objects/        Catalog, placement rules, collision, space factory
  simulation/     Pure TypeScript, no React:
    grid.ts         cell grid, wall/door connectivity
    influence.ts    fan/AC falloff + directional profiles
    zones.ts        coverage analysis, zone labelling
    occupancy.ts    seat slots, unique random allocation
    lighting.ts     artificial + daylight illuminance
    analytic.ts     exponential + Q=mCpΔT closed forms
    engine.ts       time-stepped energy balance + controller
    scenario.ts     lighting/temperature scenario generator
  store/          Zustand: editor (undo/redo), simulation, UI, hover
  database/       Repository interface + Dexie impl, JSON import/export, schema migration
  three/          R3F scene, procedural models, overlays, textures, thumbnails
  components/     layout, panels, simulation dock, charts, shadcn-style UI
  demo/           Seminar Hall Demo (30×20×4 m, 120 seats, 73 occupants)
  tests/          vitest (45 tests)
```

Design rules: simulation never imports React or Three; rendering never touches the database;
persistence sits behind `repository.ts` so IndexedDB can be swapped for an API.

---

## 4. Status vs. the spec

Implemented and verified (type-check, 45 tests, production build, and a headless-browser run of the demo):

- Dashboard (create / open / rename / duplicate / delete / export / import), unit switching, thumbnails
- 3D dollhouse editor, orthographic camera, fit / top / isometric / reset, 2D view, layer views
- Procedural 3D library (furniture, architecture, devices), drag-drop, snapping, collision, undo/redo
- Floor materials, custom texture upload with repeat/scale/rotation, per-region floors
- Walls / doors / windows, seat slots, random unique occupancy, 3D people
- Fan & AC influence editing, user-defined levels, directional profiles
- Zone/coverage analysis with underserved flagging; thermal + lighting engines; auto-controller with hysteresis and manual override
- Charts from real engine output; scenarios per space; autosave; JSON import/export with schema versioning

Known gaps (honest list):

- The simulation runs on the main thread inside a 10 ms frame budget rather than a **Web Worker**;
  fine for the demo grid, but a worker is the next step for very large/fine grids.
- Models are procedural Three.js geometry, not imported GLB assets.
- Humidity / latent heat and true CFD airflow are out of scope (educational approximation).
- No auth / cloud sync (the repository interface is ready for it).

## 5. Manual test checklist
1. **Create space** 20 × 15 × 4 m → walls + tiled floor appear.
2. Drag a chair in, move/rotate/resize/delete it; properties panel follows.
3. Floor tab → upload a tile PNG → refresh the page → texture persists.
4. Add 10 chairs → **Generate people** → fixed 7 → exactly 7 distinct seats.
5. Add a fan → drag its radius handle; add an AC → rotate its region.
6. Simulation → Start at 32 °C, target 24 °C; watch the heatmap and Charts; set a fan to MANUAL and confirm the controller leaves it.
7. Create three spaces; reopen each from the dashboard.

---

## 6. Three-mode digital twin (one project, three views)

The slim icon bar between the library and the workspace switches modes. All three share one project: the
same room, devices, seats, coordinates and saved data. Switching never changes or reloads the project.

| Mode | What it does |
|---|---|
| **Virtual Simulation** | Everything from sections 1–5, unchanged. |
| **Live Camera Digital Twin** | Phone (WebRTC + QR), video or image input → person detection → tracking → seat mapping → occupancy for the simulation. |
| **IoT Hardware Integration** | Plans a real prototype for this room: controllers, pins, circuit, firmware, Wokwi files, live MQTT link. |

### Run it
```bash
npm install
npm run fetch-model     # person-detection model (needs internet to huggingface.co); or use "Choose .onnx file" in the UI
npm run dev:all         # app (https, self-signed) + backend (MQTT broker, signalling, WebSocket)
npm run sim-device -- --space <id> --ctrl esp32-a --token <TOKEN> ...   # a SIMULATED controller (command shown in Live Data)
```
Phone camera needs HTTPS and the phone's permission; accept the one-time certificate warning on the phone.
`SMARTSPACE_HTTP=1` gives plain http (fine on localhost; phones will refuse the camera).

### Camera mode (single occupancy source)
- Occupancy has one authoritative source at a time: Random / Manual / Camera / IoT. **Live Occupancy Feed** switches to Camera; switching it off restores the previous source.
- Detection runs in a Web Worker (YOLOv8n-person via onnxruntime-web). No face recognition; raw frames are never stored or uploaded; a visible indicator shows when a camera is active.
- Calibration (homography from ≥4 floor points, or PnP) maps image positions to the floor plan; each person is assigned to at most one seat (Hungarian assignment), with temporal filtering (confirm 1.5 s, clear 5 s). Uncertain tracks can be corrected by hand. Multiple cameras are supported.
- Without the model file you can still draw person boxes by hand and map them to seats.

### IoT mode
- **Generate Hardware Setup** builds: mapping table, controller count with reasons (pins, I²C addresses → TCA9548A, PWM → PCA9685, analog → ADS1115, Raspberry Pi has no ADC), pin and electrical validation, firmware per controller, a connection guide and bill of materials, and Wokwi files.
- Parts: ESP32 / Arduino Uno / Raspberry Pi; DHT22, DS18B20, BME280; BH1750, LDR; PIR (motion only, never a seat count).
- **Safety design**: a fan is a small DC motor behind a logic-level MOSFET with flyback diode and a separate supply (never on a GPIO); AC is a status LED or small blower (never mains); lights are PWM LEDs. The validator refuses plans that break these rules.
- **Live link**: device → MQTT → backend → WebSocket → browser. Sensors are tagged *simulated / live / stale / unavailable*. Commands count as applied only after the controller acknowledges them. Controllers boot **disarmed**, refuse output while disarmed, and turn everything off when heartbeats stop. Modes: Simulation Only / Hardware Monitor (readings feed the simulation, no commands) / Hardware Control (explicit arm with confirmation). E-STOP is always visible.
- **Wokwi** (docs/wokwi-notes.md): diagram.json, sketch.ino, libraries.txt, wokwi.toml. Wokwi has no BME280, BH1750, DC motor, PCA9685, ADS1115, TCA9548A or full Raspberry Pi; unsupported parts are substituted and labelled, or the export is refused with a reason. Wokwi documents no import link, so *Open in Wokwi* opens a blank project and you paste the files.

### What is and is not verified
Verified in this build: type-check, 148 tests, production build; planner / validator rules; generated ESP32 (core 2.x and 3.x) and Uno sketches compile against API stubs; Raspberry Pi scripts byte-compile; live link tested against the real backend with a simulated controller (arm, set, refusal while disarmed, fail-safe, e-stop); headless-browser runs of all three modes.

**Not verified**: real person detection (the model could not be downloaded in the build sandbox), any real board or sensor, the Wokwi files inside Wokwi (the sandbox cannot reach wokwi.com), a physical phone camera. Pin facts come from vendor datasheets and are listed in `src/iot/boards.ts`; check them against the board you buy. LDR readings are relative, not lux, until you calibrate them.

### Manual checklist for the new modes
1. Camera → Live Occupancy Feed ON → badge turns green; OFF restores the old source.
2. Upload an image/video, calibrate four floor points, draw/confirm a person → seat is marked occupied in the 3D room and the heat map reacts.
3. IoT → add two fans and two lights to a room → Generate Hardware Setup → one controller, no validation errors, each output on its own pin.
4. Override a fan pin to GPIO6 (flash) or GPIO34 (input-only) in Pin Mapping → red error appears.
5. Run `npm run server`, `npm run sim-device …`, paste the token in Live Data, Connect → sensors show *live*.
6. Hardware Control → Arm… → outputs follow the simulation, each marked *confirmed*; E-STOP zeroes them.

## 7. Refinement release (layout, metrics, window daylight, Wokwi-style IoT workspace)

**Layout.** The library collapse button is at the top-right of the left panel (the mode rail and the 3D camera are untouched; the panel animates its width). The bottom dock shows one horizontally scrollable row of nine cards: Room Temperature, Target Temperature, Occupancy, Lighting, Active Fans, Active AC Units, Energy Used, Estimated Time to Comfort, Heat Gains. Occupied Zones, Uniformity and Simulation Time are hidden from the overview only; the engine still computes them.

**Window natural-light influence.** Select a window: a golden region (length, width at glass, spread, direction, intensity, fall-off, optional profile) is drawn in 3D with drag handles, and the Properties panel has a *Natural light influence* section. The same function (`src/simulation/daylight.ts`) feeds the overlay and the lighting simulation, so the heatmap, the lux readings and the auto-lighting follow the region. Windows without the new `daylight` field behave exactly as before (no migration). Glass transmittance, shading and open/closed stay separate settings. It is an approximate contribution, not ray tracing.

**IoT workspace.** *Generate Hardware Setup* builds a **hardware manifest** (`src/iot/manifest.ts`) from the validated plan; the circuit, the firmware pin tables, the Wokwi diagram, path highlighting and the sensor simulation all read the same plan/netlist, so a GPIO cannot differ between diagram and code (a test checks every output GPIO in the manifest against the firmware table and the netlist).
- Toolbar: Generate, All / Inputs / Outputs (the other side is greyed), 2D / 3D, Run / Pause / Stop (they drive the app's shared simulation clock), a "Validated / N problems" badge, and a Setup drawer (controller, sensor parts, AC representation, number of sensor zones, PIR, run mode, E-STOP).
- 2D circuit: part pictures (ESP32 / Uno / Pi, DHT22, DS18B20, BME280, BH1750, LDR, PIR, LED + resistor, DC motor and its N-MOSFET driver as two separate parts wired gate ← controller pin, supply + → motor, motor − → drain, source → GND, plus a breadboard backdrop); wires come from the netlist: red = 3.3/5 V, black = GND, yellow = digital, blue = sensor data, green = PWM, purple = I²C, orange = motor supply. Click a part or a wire to highlight its whole path; click a sensor to set its value.
- Sensor popover: Simulated (slider 15–45 °C / 0–2000 lx plus a number field; the value is injected once into the same engine the rest of the app uses, so fans, AC and lights react through the normal controller; no loop) or Live Hardware (shows what the board reports; nothing is invented).
- Outputs show the commanded duty from the shared simulation: the motor rotor spins faster with the level, the LED brightens with dimming. Each card is labelled with what the value is: *simulated*, *you set N*, *live hardware*, *commanded by simulation* or *acknowledged by hardware* (only an ack from a connected board counts as acknowledged). The sensor popover's Simulated / Live Hardware choice is stored per sensor and decides which value the card shows.
- 3D view: controllers, sensors and outputs at the room's coordinates, wires coloured the same way.
- Scaling: by default a big room is split over several controllers (one master + nodes, one MQTT broker) instead of PCA9685 / TCA9548A expanders, so every node can be simulated in Wokwi. Older spaces keep expanders (`scaling: 'expanders'`). Inter-controller ESP-NOW / UART / I²C links are not generated.
- Right panel: Code (syntax highlighting, line numbers, firmware / Wokwi files / manifest.json, Copy, Download Code, Download Project), Libraries, Pin Mapping, Checks, Live.
- *Download Project* zip: `manifest.json`, `README.md`, `connection-guide.md`, and per controller `hardware/<id>/{sketch.ino, diagram.json, libraries.txt, wokwi.toml}` (Wokwi simulation copy) plus `hardware/<id>/firmware/` (real-hardware firmware). Wokwi has no documented import link, so *Open Wokwi* opens an empty project and you paste the files; this was not tested against wokwi.com from here.

**Verified here:** type-check, 166 unit tests, production build, and a headless-Chromium run of: filters, path highlight, sensor injection, Run/Pause/Stop, 3D view, Download Project, window daylight edit + reload persistence. **Not verified:** generated firmware on real boards, diagram.json inside wokwi.com, MQTT between several real controllers.
