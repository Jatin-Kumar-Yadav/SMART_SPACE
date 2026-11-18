/**
 * Core domain types for SmartSpace 3D.
 *
 * Coordinate convention (all values in SI units — metres, seconds, °C, W):
 *   x : east  (0 … length)
 *   y : up    (0 = floor, `height` = ceiling)
 *   z : south (0 … width)
 * An object's `position` is the centre of its footprint at its base elevation.
 * Local object space has +z as the "front" (the side people face when seated).
 */

export type Vec2 = [number, number]
export type Vec3 = [number, number, number]

export const SCHEMA_VERSION = 3

export type SpaceType =
  | 'classroom'
  | 'seminar-hall'
  | 'auditorium'
  | 'office'
  | 'conference-room'
  | 'house'
  | 'custom'

export type ObjectCategory = 'furniture' | 'architecture' | 'device'

export type ObjectKind =
  // furniture
  | 'chair'
  | 'officeChair'
  | 'bench'
  | 'desk'
  | 'diningTable'
  | 'coffeeTable'
  | 'sofa'
  | 'bed'
  | 'cabinet'
  | 'wardrobe'
  | 'bookshelf'
  | 'podium'
  | 'plant'
  | 'carpet'
  // architecture
  | 'door'
  | 'window'
  | 'column'
  // environmental devices
  | 'ceilingFan'
  | 'wallFan'
  | 'splitAC'
  | 'acVent'
  | 'ceilingLight'
  | 'bulb'
  | 'tubeLight'
  | 'lamp'

export type MountType = 'floor' | 'ceiling' | 'wall'

// ───────────────────────── Floor ─────────────────────────

export type FloorPresetId =
  | 'ceramic'
  | 'marble'
  | 'wood'
  | 'carpet'
  | 'concrete'
  | 'stone'
  | 'vinyl'

export interface FloorMaterial {
  preset: FloorPresetId
  /** id of an uploaded texture in the `textures` table; overrides `preset` when set */
  textureId?: string
  /** physical size (m) covered by ONE repetition of the texture */
  tileSize: number
  /** degrees */
  rotation: number
  offset: Vec2
  roughness: number
  tint: string
  /** when true, stretch a single image over the whole floor instead of tiling */
  stretch: boolean
}

export interface FloorRegion {
  id: string
  name: string
  /** rectangle in room coordinates */
  x: number
  z: number
  w: number
  d: number
  material: FloorMaterial
}

// ───────────────────────── Walls ─────────────────────────

export interface Wall {
  id: string
  a: Vec2
  b: Vec2
  thickness: number
  height: number
  /** perimeter walls are cut away when they face the camera (dollhouse view) */
  perimeter?: boolean
  /** unit outward normal for perimeter walls */
  outward?: Vec2
  color?: string
}

// ───────────────────────── Devices ─────────────────────────

export type DeviceMode = 'auto' | 'manual'
export type InfluenceShape = 'circle' | 'rect' | 'directional'

export interface ProfilePoint {
  /** metres along the device's forward axis (negative = behind) */
  x: number
  /** relative strength; normalised by the maximum of the profile */
  v: number
}

/** One operating level of a fan or AC unit. Level 0 is always OFF. */
export interface AirLevel {
  label: string
  /** circular influence radius (m) */
  radius: number
  /** length of rect / directional region (m) */
  length: number
  /** width of rect / directional region (m) */
  width: number
  /**
   * User-defined PERCEIVED temperature offset (°C) at the centre of the region.
   * For fans this is a comfort offset, not a physical air-temperature change.
   */
  effectC: number
  /** fraction of nominal cooling capacity delivered (AC only) */
  coolingFrac: number
  /** air-movement velocity (m/s) that enhances mixing inside the influence region */
  airflow: number
  /** electrical power (W) */
  powerW: number
}

export interface FanDevice {
  type: 'fan'
  mode: DeviceMode
  level: number
  levels: AirLevel[]
}

export interface AcDevice {
  type: 'ac'
  mode: DeviceMode
  level: number
  levels: AirLevel[]
  shape: InfluenceShape
  /** only used when shape === 'directional' */
  profile: ProfilePoint[]
  /** nominal cooling capacity at the rated return temperature (W) */
  capacityW: number
  supplyTempC: number
  cop: number
}

export interface LightDevice {
  type: 'light'
  mode: DeviceMode
  on: boolean
  /** 0…1 */
  dimming: number
  lumens: number
  powerW: number
  /** full beam angle in degrees (360 = omnidirectional) */
  beamAngle: number
}

export type DeviceConfig = FanDevice | AcDevice | LightDevice

// ───────────────────────── Scene objects ─────────────────────────

export interface WallAttachment {
  wallId: string
  /** distance (m) along the wall from point `a` to the object's centre */
  offset: number
}

export interface WindowConfig {
  open: boolean
  /** visible-light transmittance of the glass, 0…1 */
  transmittance: number
  /** 0 = no shading, 1 = fully shaded */
  shading: number
  /** solar heat gain coefficient 0…1 */
  shgc: number
}

export interface SceneObject {
  id: string
  kind: ObjectKind
  name: string
  /** footprint centre; y = base elevation */
  position: Vec3
  /** rotation about the vertical axis (radians) */
  rotationY: number
  /** actual size in metres (w = x, h = y, d = z in local space) */
  dims: Vec3
  color?: string
  locked: boolean
  visible: boolean
  /** may occupants sit here? */
  seatable?: boolean
  /** override of automatically computed seat count */
  seatCountOverride?: number
  wall?: WallAttachment
  window?: WindowConfig
  device?: DeviceConfig
}

// ───────────────────────── Occupancy ─────────────────────────

export interface SeatSlot {
  /** `${objectId}:${index}` */
  key: string
  objectId: string
  index: number
  /** world-space position of the seat surface centre */
  position: Vec3
  /** world-space yaw the seated person faces (radians) */
  facing: number
}

export interface Occupant {
  id: string
  seatKey: string
  objectId: string
  slotIndex: number
  position: Vec3
  facing: number
  activity: 'seated'
  /** sensible heat contribution (W) */
  heatW: number
}

export type OccupancyMode = 'random' | 'fixed' | 'percentage'

/**
 * Which source is authoritative for the occupants of a scenario.
 * Exactly one source drives `Scenario.occupants` at a time.
 *  - random / manual : the existing generator (manual = fixed number or percentage)
 *  - camera          : seats confirmed by the live camera pipeline
 *  - iot             : reserved (a PIR sensor reports motion, not a seat count)
 */
export type OccupancySource = 'random' | 'manual' | 'camera' | 'iot'

export interface OccupancyConfig {
  mode: OccupancyMode
  fixed: number
  percentage: number
}

// ───────────────────────── Scenarios ─────────────────────────

export type LightingPreset =
  | 'sunny-morning'
  | 'cloudy-afternoon'
  | 'evening'
  | 'night'
  | 'custom'

export interface LightingScenario {
  preset: LightingPreset
  /** hour of day 0…24 */
  timeOfDay: number
  /** 0…1 */
  cloudCover: number
}

export type Resolution = 'coarse' | 'standard' | 'fine'

export interface SimSettings {
  resolution: Resolution
  /** effective thermal capacitance as a multiple of the air-only capacitance */
  thermalMassMultiplier: number
  /** optional explicit override of Ceff (J/K) */
  ceffOverride?: number
  /** overall envelope U-value (W/m²K) applied to walls + roof */
  envelopeU: number
  equipmentW: number
  occupantHeatW: number
  airDensity: number
  /** comfort tolerance (°C) around the target for occupied zones */
  toleranceC: number
  /** include the educational AC perceived offset in comfort temperature */
  educationalAcOffset: boolean
}

export interface DeviceState {
  mode: DeviceMode
  level?: number
  on?: boolean
  dimming?: number
}

export interface Scenario {
  id: string
  name: string
  initialTempC: number
  outsideTempC: number
  targetTempC: number
  targetLux: number
  occupancy: OccupancyConfig
  occupancySource: OccupancySource
  /**
   * The random / manual occupants that were in place when the camera took over.
   * They are restored (not regenerated) when the camera is switched off.
   */
  stashedOccupants?: Occupant[]
  occupants: Occupant[]
  lighting: LightingScenario
  autoLighting: boolean
  deviceStates: Record<string, DeviceState>
  windowStates: Record<string, boolean>
  sim: SimSettings
}

// ───────────────────────── Live camera ─────────────────────────

export interface CalibrationPoint {
  /** pixel position in the calibration frame */
  image: Vec2
  /** matching room coordinate (x, y, z) in metres; y = 0 for floor points */
  world: Vec3
}

export type CalibrationLevel = 'none' | 'poor' | 'fair' | 'good'

export interface CameraConfig {
  id: string
  name: string
  /** size in pixels of the frame the calibration points were picked on */
  imageSize: Vec2
  /** assumed horizontal field of view (°) – used to build the intrinsic matrix */
  hFovDeg: number
  points: CalibrationPoint[]
  /** 3×3 row-major homography: floor (x, z) → image pixel */
  homography?: number[]
  /** estimated camera pose in room coordinates */
  pose?: { position: Vec3; /** row-major 3×3 world→camera rotation */ rotation: number[] }
  reprojectionErrorPx?: number
  level: CalibrationLevel
  updatedAt: number
}

// ───────────────────────── IoT hardware ─────────────────────────

export type ControllerFamily = 'esp32' | 'uno' | 'rpi'
export type SensorKind = 'temperature' | 'light' | 'presence'
export type TempSensorPart = 'dht22' | 'ds18b20' | 'bme280'
export type LightSensorPart = 'bh1750' | 'ldr'
export type HardwareRunMode = 'simulation' | 'monitor' | 'control'

/** A measurement point in the room that a physical sensor reports for. */
export interface SensorPoint {
  id: string
  name: string
  kind: SensorKind
  /** world coordinate where the physical quantity is measured */
  position: Vec3
  /** light sensors: the fixture(s) this point is associated with (not co-located) */
  fixtureIds: string[]
  /** true while the position was proposed by the generator and not edited by the user */
  auto: boolean
  /** label of the virtual zone this point represents, e.g. "A" */
  zone?: string
}

export interface HardwareConfig {
  controller: ControllerFamily
  tempPart: TempSensorPart
  lightPart: LightSensorPart
  includePresence: boolean
  /** how an AC unit is represented on the prototype (never a mains/compressor interface) */
  acOutput?: 'led' | 'blower' | 'both'
  sensors: SensorPoint[]
  runMode: HardwareRunMode
  mqttTopicRoot: string
  /** virtual devices left out of the prototype (object ids) */
  excludedDeviceIds?: string[]
  /** manual pin choices: "<partId>:<signal>" → pin id. Used to experiment; the validator checks them. */
  pinOverrides?: Record<string, string>
  /** voltage of the separate motor supply (V) */
  motorSupplyV?: number
}

// ───────────────────────── Space ─────────────────────────

export interface Dimensions {
  length: number
  width: number
  height: number
}

export type LengthUnit = 'm' | 'cm' | 'ft'

export interface Space {
  schemaVersion: number
  id: string
  name: string
  type: SpaceType
  dims: Dimensions
  unit: LengthUnit
  floor: FloorMaterial
  floorRegions: FloorRegion[]
  walls: Wall[]
  objects: SceneObject[]
  scenarios: Scenario[]
  activeScenarioId: string
  cameras: CameraConfig[]
  hardware?: HardwareConfig
  thumbnail?: string
  createdAt: number
  updatedAt: number
}

export interface SpaceSummary {
  id: string
  name: string
  type: SpaceType
  dims: Dimensions
  objectCount: number
  seatCapacity: number
  thumbnail?: string
  updatedAt: number
}

export interface StoredTexture {
  id: string
  name: string
  blob: Blob
  createdAt: number
}
